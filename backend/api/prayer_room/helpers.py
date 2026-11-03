"""Prayer-room helpers and shared utilities."""
from flask import jsonify, current_app
from backend.integrations.firebase_auth import get_rtdb_client
import logging
from datetime import datetime, timedelta
import uuid
import os


def exempt_from_rate_limit(f):
    """Decorator to exempt endpoint from main app rate limiting"""

    def wrapper(*args, **kwargs):
        # Try to exempt from main app limiter if available
        try:
            if "limiter" in current_app.extensions:
                current_app.extensions["limiter"]
                # This will be handled by the decorator below
        except Exception:
            pass
        return f(*args, **kwargs)

    wrapper.__name__ = f.__name__
    return wrapper


MAX_ACTIVE_SPEAKERS = 20
VOICE_LINK_MAX_PARTICIPANTS = 2
VOICE_LINK_TTL_MINUTES = 10
VOICE_LINK_WAIT_MINUTES = 30
VALID_PARTICIPANT_ROLES = {"speaker", "listener"}

# Standard prayer rooms and group live sessions must set this field.
# Mobile LiveRooms queries `room_type != matched_prayer_call`; Firestore
# inequality filters exclude documents that omit the field entirely, which
# made group calls invisible to other members.
DEFAULT_ROOM_TYPE = "prayer"
PRIVATE_ROOM_TYPES = frozenset({"voice_link", "matched_prayer_call"})


def _generate_room_id():
    return "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])


def _generate_room_code(length=8):
    return "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:length]])


def _is_voice_link_room(room_data):
    return bool(room_data) and room_data.get("room_type") in PRIVATE_ROOM_TYPES


def _missing_live_feed_room_type(room_data):
    """Rooms without room_type are excluded by Firestore != filters on live feeds."""
    if room_data is None:
        return False
    return not room_data.get("room_type")


def _live_feed_room_type_update(room_data):
    """Return a Firestore update dict when room_type must be backfilled for live visibility."""
    if _missing_live_feed_room_type(room_data):
        return {"room_type": DEFAULT_ROOM_TYPE}
    return {}


def _normalize_utc_datetime(value):
    """Normalize Firestore/datetime values to naive UTC for comparisons."""
    if value is None:
        return None
    if hasattr(value, "timestamp") and hasattr(value, "tzinfo"):
        if value.tzinfo is not None:
            return datetime.utcfromtimestamp(value.timestamp())
        return value.replace(tzinfo=None)
    return value


def _format_expires_at_iso(value):
    normalized = _normalize_utc_datetime(value)
    if not normalized:
        return None
    return normalized.isoformat() + "Z"


def _is_voice_link_expired(room_data, now=None):
    if not _is_voice_link_room(room_data):
        return False
    now = _normalize_utc_datetime(now) or datetime.utcnow()
    expires_at = _normalize_utc_datetime(room_data.get("expires_at"))
    if not expires_at:
        return False
    return expires_at <= now


def _active_participant_count(participants):
    return sum(1 for p in (participants or []) if p.get("is_active", True) is not False)


def _is_room_participant(room_data, user_id):
    for participant in room_data.get("participants", []):
        if participant.get("user_id") == user_id and participant.get("is_active", True) is not False:
            return True
    return False


def _is_anonymous_user(user):
    return bool(user and user.get("is_anonymous"))


def _voice_link_code_matches(room_data, provided_code):
    stored = (room_data.get("room_code") or "").strip().upper()
    provided = (provided_code or "").strip().upper()
    return bool(stored and provided and stored == provided)


def _reject_anonymous_outside_voice_link(user, room_data):
    """Anonymous Firebase sessions may only access voice_link rooms."""
    if not _is_anonymous_user(user):
        return None
    if not _is_voice_link_room(room_data):
        return jsonify({"error": "Anonymous access is limited to voice call links"}), 403
    return None


def _public_base_url():
    return os.getenv("PUBLIC_BASE_URL", "https://divinebridge.io").rstrip("/")


def _deactivate_participant(participants, user_id, reason="media_disconnected"):
    """Mark a participant inactive (e.g. SFU dropped them without calling /leave)."""
    changed = False
    for participant in participants or []:
        if participant.get("user_id") == user_id and participant.get("is_active", True) is not False:
            participant["is_active"] = False
            participant["archived_at"] = datetime.utcnow()
            participant["reason_archived"] = reason
            changed = True
    return participants, changed


def _voice_link_timer_start_if_needed(room_data, participants, now=None):
    """Start the call TTL when the second participant joins (guest connected)."""
    if not _is_voice_link_room(room_data):
        return None, {}
    if _normalize_utc_datetime(room_data.get("expires_at")):
        return None, {}
    if _active_participant_count(participants) < VOICE_LINK_MAX_PARTICIPANTS:
        return None, {}
    now = now or datetime.utcnow()
    duration_minutes = room_data.get("call_duration_minutes", VOICE_LINK_TTL_MINUTES)
    expires_at = now + timedelta(minutes=duration_minutes)
    return expires_at, {"expires_at": expires_at, "call_started_at": now}


def _expire_stale_voice_links(db, now=None):
    """Mark active voice_link rooms past expires_at or idle wait limit as ended."""
    now = now or datetime.utcnow()
    expired_count = 0
    try:
        rooms = db.collection("prayer_rooms").where("is_active", "==", True).stream()
        for doc in rooms:
            data = doc.to_dict() or {}
            if not _is_voice_link_room(data):
                continue
            expires_at = _normalize_utc_datetime(data.get("expires_at"))
            should_expire = False
            if expires_at and expires_at < now:
                should_expire = True
            elif not expires_at:
                created_at = _normalize_utc_datetime(data.get("created_at"))
                if created_at and created_at + timedelta(minutes=VOICE_LINK_WAIT_MINUTES) < now:
                    should_expire = True
            if should_expire:
                doc.reference.update(
                    {
                        "is_active": False,
                        "ended_at": now,
                        "ended_by": "system",
                        "ended_reason": "timeout",
                    }
                )
                expired_count += 1
    except Exception as e:
        logging.warning("expire_stale_voice_links failed: %s", e)
    return expired_count


def _mirror_chat_message_to_rtdb(
    room_id: str,
    message_id: str,
    user_id: str,
    user_name: str,
    message: str,
    message_type: str = "text",
) -> None:
    """Mirror chat to RTDB for low-latency clients (same path as send_chat_message)."""
    try:
        rtdb = get_rtdb_client()
        if not rtdb:
            return
        import time as _time

        rtdb.reference(f"/rooms/{room_id}/chat/{message_id}").set(
            {
                "message_id": message_id,
                "room_id": room_id,
                "user_id": user_id,
                "user_name": user_name,
                "message": message,
                "timestamp": int(_time.time() * 1000),
                "message_type": message_type,
            }
        )
    except Exception as rtdb_err:
        logging.warning("RTDB chat mirror failed (non-fatal): %s", rtdb_err)


def normalize_participants(participants, host_id):
    """Ensure participants have role/request metadata and host is always a speaker."""
    if not participants:
        return [], 0, False

    normalized = []
    speaker_count = 0
    changed = False

    # First ensure host is marked as speaker and count existing speakers
    for participant in participants:
        participant_copy = dict(participant)
        user_id = participant_copy.get("user_id")
        role = participant_copy.get("role")

        if user_id == host_id and role != "speaker":
            participant_copy["role"] = "speaker"
            role = "speaker"
            changed = True

        if role == "speaker":
            speaker_count += 1

        normalized.append(participant_copy)

    # Second pass to add defaults and fill missing roles within the cap
    for participant in normalized:
        role = participant.get("role")

        if role not in VALID_PARTICIPANT_ROLES:
            if participant.get("user_id") == host_id:
                participant["role"] = "speaker"
                role = "speaker"
            elif speaker_count < MAX_ACTIVE_SPEAKERS:
                participant["role"] = "speaker"
                role = "speaker"
                speaker_count += 1
            else:
                participant["role"] = "listener"
                role = "listener"
            changed = True

        if participant.get("requested_role") not in (None, "speaker"):
            participant["requested_role"] = None
            changed = True

        if "requested_role" not in participant:
            participant["requested_role"] = None
            changed = True

        if "request_timestamp" not in participant:
            participant["request_timestamp"] = None
            changed = True

        if "is_muted" not in participant:
            participant["is_muted"] = False
            changed = True

    return normalized, speaker_count, changed


def set_participant_role(participants, user_id, new_role):
    """Set a participant's role and clear any outstanding requests."""
    updated = False
    for participant in participants:
        if participant.get("user_id") == user_id:
            if participant.get("role") != new_role:
                participant["role"] = new_role
                updated = True
            if participant.get("requested_role"):
                participant["requested_role"] = None
                updated = True
            if participant.get("request_timestamp"):
                participant["request_timestamp"] = None
                updated = True
            break
    return participants, updated


def find_participant(participants, user_id):
    for participant in participants:
        if participant.get("user_id") == user_id:
            return participant
    return None


def count_speakers(participants):
    return sum(1 for participant in participants if participant.get("role") == "speaker")


def get_max_speakers(room_data):
    try:
        configured = int(room_data.get("max_speakers", MAX_ACTIVE_SPEAKERS))
    except (TypeError, ValueError):
        configured = MAX_ACTIVE_SPEAKERS
    configured = max(1, configured)
    return min(configured, MAX_ACTIVE_SPEAKERS)


def _is_group_member(db, group_id: str, user_id: str) -> bool:
    """True if user_id is in prayer_groups/{group_id}.member_ids."""
    if not group_id or not user_id:
        return False
    snap = db.collection("prayer_groups").document(group_id).get()
    if not snap.exists:
        return False
    members = snap.to_dict().get("member_ids") or []
    return user_id in members


# Rate limiting is now handled centrally in app.py
# Blueprint-level limiter removed to prevent conflicts


def send_email(recipient_email, subject, html_body):
    """
    Helper function to send generic HTML emails.
    Uses the email_sender module to send emails with HTML content.

    Args:
        recipient_email: Email address of recipient
        subject: Email subject line
        html_body: HTML content of the email
    """
    try:
        from backend.services.email.email_sender import EmailSender
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.utils import formataddr
        import smtplib

        # Create EmailSender instance
        sender = EmailSender()

        # Create message
        msg = MIMEMultipart("alternative")
        msg["From"] = formataddr(("Divine Bridge", sender.sender_email))
        msg["To"] = recipient_email
        msg["Subject"] = subject

        # Add plain text fallback (extract from HTML if needed)
        plain_text = f"Please view this email in an HTML-enabled email client.\n\n{subject}"

        # Attach both versions
        msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        # Send using SMTP
        with smtplib.SMTP(sender.smtp_server, sender.smtp_port) as server:
            server.starttls()
            server.login(sender.sender_email, sender.sender_password)
            server.send_message(msg)

        logging.info(f"Email sent successfully to {recipient_email}")
        return True

    except Exception as e:
        logging.error(f"Error sending email to {recipient_email}: {e}")
        return False


def get_firestore_client():
    """Get Firestore client instance"""
    from backend.integrations.firebase_auth import get_firestore_client as _get_firestore_client

    return _get_firestore_client()


def get_user_from_session():
    """Get user information from session or Firebase ID token

    Priority:
    1. Firebase ID token (most reliable, survives deployments)
    2. Flask session (regenerated if Firebase token is valid)

    This function now uses the shared auth_helpers module.
    """
    from backend.core.auth.helpers import get_user_from_session as get_user_helper

    return get_user_helper()


# Allow ``from .helpers import *`` to pull private helpers used by route modules.
__all__ = [name for name in globals() if not name.startswith("__")]
