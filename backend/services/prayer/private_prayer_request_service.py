"""Private mobile prayer-request matching service.

This intentionally does not share storage with the public Prayer Wall.  Private
requests need transactional claiming, restricted access, and short-lived state.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import logging
import uuid

from firebase_admin import firestore

from backend.integrations.push_service import send_push_to_user


logger = logging.getLogger(__name__)

COLLECTION = "private_prayer_requests"
APPLICATIONS = "prayer_warrior_applications"
REQUEST_TTL = timedelta(days=2)
CALL_DURATION_MINUTES = 15
MAX_DESCRIPTION_LENGTH = 500
MAX_CHURCH_LENGTH = 80
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
PLATFORM_ADMIN_EMAILS = frozenset({"dev@bamwe.com", "kubjca@gmail.com"})
WARRIOR_LANGUAGES = ("english", "spanish", "kirundi")


def _now():
    return datetime.utcnow()


def _as_naive_utc(value):
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is not None:
        return datetime.utcfromtimestamp(value.timestamp())
    return value


def _serialize(value):
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return value.isoformat() + "Z"
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    return value


def _first_name(profile, fallback_name):
    return (profile.get("firstName") or fallback_name or "Member").strip().split()[0][:50]


def _parse_preferred_at(value):
    """A time the requester wants to be prayed for. A live call is separate."""
    if not value:
        raise ValueError("Choose a time when you would like to be prayed for")
    try:
        start = datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError as exc:
        raise ValueError("Preferred time must be a valid date") from exc
    now = _now()
    latest = now + timedelta(days=7)
    if start < now or start > latest:
        raise ValueError("Choose a time within the next seven days")
    return start


def _parse_availability(availability):
    if not isinstance(availability, list) or not availability:
        raise ValueError("Select at least one availability window for a live call")
    now = _now()
    latest = now + timedelta(days=7)
    normalized = []
    for window in availability[:14]:
        if not isinstance(window, dict):
            raise ValueError("Availability windows are invalid")
        try:
            start = datetime.fromisoformat(str(window.get("start_at", "")).replace("Z", "+00:00")).replace(tzinfo=None)
            end = datetime.fromisoformat(str(window.get("end_at", "")).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError as exc:
            raise ValueError("Availability times must be valid ISO dates") from exc
        if start < now or end <= start or end - start < timedelta(minutes=15) or end > latest:
            raise ValueError("Choose a 15-minute window within the next seven days")
        normalized.append({"start_at": start, "end_at": end})
    return sorted(normalized, key=lambda item: item["start_at"])


def _send(user_id, title, body, data, preference=None, profile=None):
    """Best-effort push; opt-outs do not affect the request transaction."""
    try:
        profile = profile or {}
        if preference and profile.get(preference) is False:
            return
        send_push_to_user(user_id, title, body, data)
    except Exception:
        logger.warning("Prayer-request notification failed for %s", user_id, exc_info=True)


def _request_payload(doc_id, request_data, viewer_id, leader_view=False):
    data = dict(request_data)
    data["id"] = doc_id
    if leader_view:
        return {
            "id": doc_id,
            "status": data.get("status"),
            "requester_first_name": data.get("requester_first_name"),
            "description": data.get("description"),
            "preferred_language": data.get("preferred_language"),
            "wants_live_call": data.get("wants_live_call"),
            "preferred_at": _serialize(data.get("preferred_at")),
            "availability": _serialize(data.get("availability", [])),
            "expires_at": _serialize(data.get("expires_at")),
            "created_at": _serialize(data.get("created_at")),
            "prayer_count": data.get("prayer_count", 0),
            "available_to_lead": True,
        }
    if viewer_id not in (data.get("requester_id"), data.get("leader_id")):
        return None
    result = {key: value for key, value in data.items() if key not in {"requester_id", "leader_id", "room_code"}}
    if viewer_id == data.get("requester_id"):
        result.pop("leader_first_name", None)
        result["viewer_role"] = "requester"
    else:
        result["viewer_role"] = "leader"
    return _serialize(result)


def _get_profile(db, user_id):
    snapshot = db.collection("users").document(user_id).get()
    return snapshot.to_dict() if snapshot.exists else {}


def _notify_eligible_leaders(db, request_id, request_data, title, body, event, exclude_ids=()):
    """Fan out inbox-state changes without exposing the private request content."""
    language = request_data.get("preferred_language")
    excluded = set(exclude_ids)
    for leader_doc in db.collection("users").where("is_prayer_leader", "==", True).stream():
        if leader_doc.id in excluded:
            continue
        leader = leader_doc.to_dict() or {}
        languages = [str(item).lower() for item in leader.get("prayer_languages", [])]
        if language in languages and _available_for_call(leader, request_data.get("preferred_at")):
            _send(
                leader_doc.id,
                title,
                body,
                {
                    "type": "private_prayer_request",
                    "requestId": request_id,
                    "event": event,
                    "status": request_data.get("status"),
                },
                "notify_prayer_requests",
                leader,
            )


def create_request(db, user, description, preferred_language, wants_live_call, availability, preferred_at):
    if user.get("is_anonymous"):
        raise PermissionError("Sign in is required to request private prayer")
    description = (description or "").strip()
    language = (preferred_language or "").strip().lower()
    if len(description) < 10 or len(description) > MAX_DESCRIPTION_LENGTH:
        raise ValueError("Describe your request in 10 to 500 characters")
    if not language or len(language) > 35:
        raise ValueError("Choose a preferred language")

    parsed_preferred = _parse_preferred_at(preferred_at)
    call_end = parsed_preferred + timedelta(minutes=CALL_DURATION_MINUTES)
    if call_end > _now() + timedelta(days=7):
        raise ValueError("Choose a time within the next seven days")
    # Every private request schedules a live call at the chosen time when a warrior accepts.
    parsed_availability = [{"start_at": parsed_preferred, "end_at": call_end}]
    requester_id = user["user_id"]
    profile = _get_profile(db, requester_id)
    now = _now()
    request_ref = db.collection(COLLECTION).document()
    data = {
        "requester_id": requester_id,
        "requester_first_name": _first_name(profile, user.get("user_name")),
        "description": description,
        "preferred_language": language,
        "wants_live_call": True,
        "preferred_at": parsed_preferred,
        "availability": parsed_availability,
        "status": "active",
        "created_at": now,
        "expires_at": now + REQUEST_TTL,
        "leader_id": None,
        "leader_first_name": None,
        "claimed_at": None,
        "scheduled_at": None,
        "room_id": None,
        "room_code": None,
        "prayer_count": 0,
    }
    request_ref.set(data)
    # A request is also the safe, authenticated place to save this preference.
    db.collection("users").document(requester_id).set({"preferred_prayer_language": language}, merge=True)

    _notify_eligible_leaders(
        db,
        request_ref.id,
        data,
        "New prayer request",
        "A live prayer call is waiting in a language you serve.",
        "created",
        exclude_ids=(requester_id,),
    )
    return _request_payload(request_ref.id, data, requester_id)


def list_for_user(db, user_id):
    profile = _get_profile(db, user_id)
    is_leader = profile.get("is_prayer_leader") is True
    now = _now()
    items = []
    if is_leader:
        languages = [str(item).lower() for item in profile.get("prayer_languages", [])]
        for doc in db.collection(COLLECTION).where("status", "==", "active").stream():
            data = doc.to_dict() or {}
            if _as_naive_utc(data.get("expires_at")) and _as_naive_utc(data["expires_at"]) <= now:
                continue
            if data.get("preferred_language") in languages and _available_for_call(profile, data.get("preferred_at")):
                items.append(_request_payload(doc.id, data, user_id, leader_view=True))
    for doc in db.collection(COLLECTION).where("requester_id", "==", user_id).stream():
        item = _request_payload(doc.id, doc.to_dict() or {}, user_id)
        if item:
            items.append(item)
    for doc in db.collection(COLLECTION).where("leader_id", "==", user_id).stream():
        item = _request_payload(doc.id, doc.to_dict() or {}, user_id)
        if item:
            items.append(item)
    unique = {item["id"]: item for item in items}
    return sorted(unique.values(), key=lambda item: item.get("created_at", ""), reverse=True), is_leader


def claim_request(db, request_id, leader, slot_start):
    if leader.get("is_anonymous"):
        raise PermissionError("Sign in is required to lead private prayer")
    leader_profile = _get_profile(db, leader["user_id"])
    if leader_profile.get("is_prayer_leader") is not True:
        raise PermissionError("Prayer leader access is required")
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def claim(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError("Prayer request not found")
        data = snapshot.to_dict() or {}
        now = _now()
        expires_at = _as_naive_utc(data.get("expires_at"))
        if data.get("status") != "active" or not expires_at or expires_at <= now:
            raise RuntimeError("This prayer request is no longer available")
        if data.get("preferred_language") not in [
            str(item).lower() for item in leader_profile.get("prayer_languages", [])
        ]:
            raise PermissionError("This request is not in a language you serve")
        scheduled_at = None
        if data.get("wants_live_call"):
            try:
                scheduled_at = datetime.fromisoformat(str(slot_start).replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError as exc:
                raise ValueError("Choose one of the available times") from exc
            if not any(window["start_at"] == scheduled_at for window in data.get("availability", [])):
                raise ValueError("Choose one of the available times")
            if not _available_for_call(leader_profile, scheduled_at):
                raise PermissionError("This call is outside the times you are available")
        transaction.update(
            request_ref,
            {
                "status": "scheduled" if scheduled_at else "claimed",
                "leader_id": leader["user_id"],
                "leader_first_name": _first_name(leader_profile, leader.get("user_name")),
                "claimed_at": now,
                "scheduled_at": scheduled_at,
            },
        )
        data.update(
            {
                "status": "scheduled" if scheduled_at else "claimed",
                "leader_id": leader["user_id"],
                "leader_first_name": _first_name(leader_profile, leader.get("user_name")),
                "claimed_at": now,
                "scheduled_at": scheduled_at,
            }
        )
        return data

    data = claim(db.transaction())
    _send(
        data["requester_id"],
        "A prayer leader has accepted",
        "A prayer leader is ready to pray with you.",
        {
            "type": "private_prayer_request",
            "requestId": request_id,
            "event": "claimed",
            "status": data["status"],
        },
        "notify_prayer_requests",
        _get_profile(db, data["requester_id"]),
    )
    _notify_eligible_leaders(
        db,
        request_id,
        data,
        "Prayer request claimed",
        "This request is no longer available in your inbox.",
        "claimed",
        exclude_ids=(data["requester_id"], leader["user_id"]),
    )
    return _request_payload(request_id, data, leader["user_id"])


def cancel_request(db, request_id, requester_id):
    """Cancel a request and any generated matched call as one transaction."""
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def cancel(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError("Prayer request not found")
        data = snapshot.to_dict() or {}
        if data.get("requester_id") != requester_id:
            raise PermissionError("Only the requester can cancel this prayer request")
        if data.get("status") == "cancelled":
            return data, False
        if data.get("status") not in {"active", "claimed", "scheduled"}:
            raise RuntimeError("This prayer request can no longer be cancelled")

        now = _now()
        updates = {"status": "cancelled", "cancelled_at": now}
        transaction.update(request_ref, updates)
        if data.get("room_id"):
            transaction.update(
                db.collection("prayer_rooms").document(data["room_id"]),
                {"is_active": False, "ended_at": now, "ended_by": "requester", "ended_reason": "request_cancelled"},
            )
        data.update(updates)
        return data, True

    data, changed = cancel(db.transaction())
    if changed and data.get("leader_id"):
        _send(
            data["leader_id"],
            "Prayer request cancelled",
            "The requester cancelled their private prayer request.",
            {
                "type": "private_prayer_request",
                "requestId": request_id,
                "event": "cancelled",
                "status": data["status"],
            },
            "notify_prayer_requests",
            _get_profile(db, data["leader_id"]),
        )
    if changed:
        _notify_eligible_leaders(
            db,
            request_id,
            data,
            "Prayer request cancelled",
            "This request is no longer available in your inbox.",
            "cancelled",
            exclude_ids=(data["requester_id"], data.get("leader_id")),
        )
    return _request_payload(request_id, data, requester_id)


def record_prayer(db, request_id, user_id):
    """Increment the private request's anonymous/count-only prayer total."""
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def increment(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError("Prayer request not found")
        data = snapshot.to_dict() or {}
        if user_id not in (data.get("requester_id"), data.get("leader_id")):
            raise PermissionError("You are not authorized to pray for this request")
        if data.get("status") in {"cancelled", "expired"}:
            raise RuntimeError("This prayer request is no longer active")
        prayer_count = int(data.get("prayer_count", 0)) + 1
        transaction.update(request_ref, {"prayer_count": prayer_count})
        return prayer_count

    return increment(db.transaction())


def expire_requests(db):
    now = _now()
    expired = 0
    for doc in db.collection(COLLECTION).where("status", "==", "active").stream():
        data = doc.to_dict() or {}
        if _as_naive_utc(data.get("expires_at")) and _as_naive_utc(data["expires_at"]) <= now:

            @firestore.transactional
            def expire(transaction, request_ref):
                snapshot = request_ref.get(transaction=transaction)
                current = snapshot.to_dict() if snapshot.exists else None
                if not current or current.get("status") != "active":
                    return None
                expires_at = _as_naive_utc(current.get("expires_at"))
                if not expires_at or expires_at > now:
                    return None
                transaction.update(request_ref, {"status": "expired", "expired_at": now})
                return current

            expired_request = expire(db.transaction(), doc.reference)
            if not expired_request:
                continue
            _send(
                expired_request["requester_id"],
                "Your prayer request needs your attention",
                "No leader was able to accept it in time. You can submit it again.",
                {"type": "private_prayer_request", "requestId": doc.id, "action": "resubmit"},
                "notify_prayer_requests",
                _get_profile(db, expired_request["requester_id"]),
            )
            expired += 1
    return expired


def open_scheduled_call(db, request_id, user_id):
    """Create the 1:1 voice room only when the booked time is reached."""
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def create_room(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError("Prayer request not found")
        data = snapshot.to_dict() or {}
        if user_id not in (data.get("requester_id"), data.get("leader_id")):
            raise PermissionError("You are not part of this prayer request")
        if data.get("status") != "scheduled":
            raise RuntimeError("This request does not have a scheduled call")
        scheduled_at = _as_naive_utc(data.get("scheduled_at"))
        if not scheduled_at or _now() < scheduled_at - timedelta(minutes=10):
            raise RuntimeError("This call is not ready yet")
        if data.get("room_id"):
            return data

        leader_id = data["leader_id"]
        leader_profile = _get_profile(db, leader_id)
        leader_name = _first_name(leader_profile, data.get("leader_first_name"))
        room_id = uuid.uuid4().hex[:8].upper()
        room_code = uuid.uuid4().hex[:8].upper()
        room_data = {
            "room_id": room_id,
            "room_name": "Private prayer call",
            "room_type": "matched_prayer_call",
            "room_privacy": "private",
            "room_code": room_code,
            "host_id": leader_id,
            "host_name": leader_name,
            "created_at": _now(),
            "call_started_at": None,
            "call_duration_minutes": CALL_DURATION_MINUTES,
            "media_mode": "audio_only",
            # Both people are added by the regular join endpoint. Starting
            # empty is important: the voice-link timer must begin only after
            # both have actually joined the media room.
            "participants": [],
            "is_active": True,
            "is_locked": False,
            "settings": {
                "allow_anonymous": False,
                "max_participants": 2,
                "auto_mute_new_participants": False,
            },
            "max_speakers": 2,
            "ended_reason": None,
            "private_prayer_request_id": request_id,
            "participant_ids": [data["requester_id"], leader_id],
        }
        transaction.set(db.collection("prayer_rooms").document(room_id), room_data)
        transaction.update(request_ref, {"room_id": room_id, "room_code": room_code})
        data.update({"room_id": room_id, "room_code": room_code})
        return data

    data = create_room(db.transaction())
    return {
        "room_id": data["room_id"],
        "room_code": data["room_code"],
        "duration_minutes": CALL_DURATION_MINUTES,
    }


def _empty_availability():
    return {"timezone": "", "slots": []}


def _quarter_minute(value, latest):
    try:
        minute = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Choose a time in 15-minute steps") from exc
    if minute < 0 or minute > latest or minute % 15 != 0:
        raise ValueError("Choose a time in 15-minute steps")
    return minute


def _parse_warrior_availability(raw):
    """Weekly ranges. The same day may carry more than one range."""
    if not isinstance(raw, dict):
        raise ValueError("Choose at least one time range you can take a call")
    timezone_name = str(raw.get("timezone") or "").strip()
    if not timezone_name or len(timezone_name) > 64:
        raise ValueError("Choose a timezone for your available times")
    try:
        ZoneInfo(timezone_name)
    except Exception as exc:
        raise ValueError("Choose a timezone for your available times") from exc
    slots_in = raw.get("slots")
    if not isinstance(slots_in, list) or not slots_in:
        raise ValueError("Choose at least one time range you can take a call")
    cleaned = []
    seen = set()
    for slot in slots_in[:14]:
        if not isinstance(slot, dict):
            raise ValueError("Choose a valid time range")
        weekday = str(slot.get("weekday") or "").strip().lower()[:3]
        if weekday not in WEEKDAYS:
            raise ValueError("Choose a day of the week")
        start = _quarter_minute(slot.get("start_minute"), (24 * 60) - 15)
        end = _quarter_minute(slot.get("end_minute"), 24 * 60)
        if end <= start:
            raise ValueError("The end time has to be later the same day")
        if end - start < CALL_DURATION_MINUTES:
            raise ValueError("Each range must be at least 15 minutes")
        key = (weekday, start, end)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append({"weekday": weekday, "start_minute": start, "end_minute": end})
    if not cleaned:
        raise ValueError("Choose at least one time range you can take a call")
    return {"timezone": timezone_name, "slots": cleaned}


def _available_for_call(profile, preferred_at):
    """True when the 15-minute call fits inside one of this warrior's ranges."""
    availability = (profile or {}).get("prayer_availability") or {}
    preferred = _as_naive_utc(preferred_at)
    slots = availability.get("slots") if isinstance(availability, dict) else None
    if not preferred or not slots:
        return False
    try:
        zone = ZoneInfo(str(availability.get("timezone") or ""))
    except Exception:
        return False
    local = preferred.replace(tzinfo=timezone.utc).astimezone(zone)
    weekday = WEEKDAYS[local.weekday()]
    minute = local.hour * 60 + local.minute
    return any(
        isinstance(slot, dict)
        and slot.get("weekday") == weekday
        and int(slot.get("start_minute", 1)) <= minute
        and minute + CALL_DURATION_MINUTES <= int(slot.get("end_minute", 0))
        for slot in slots
    )


def _application_payload(status, languages, note, submitted_at, church="", availability=None):
    return {
        "status": status,
        "languages": languages,
        "note": note or "",
        "church": church or "",
        "availability": availability or _empty_availability(),
        "submitted_at": _serialize(submitted_at) if submitted_at else None,
    }


def get_warrior_application(db, user_id):
    """Return whether this person is enrolled, waiting, or has not applied."""
    profile = _get_profile(db, user_id)
    if profile.get("is_prayer_leader") is True:
        languages = [str(item).lower() for item in profile.get("prayer_languages", [])]
        return _application_payload("enrolled", languages, "", None, availability=profile.get("prayer_availability"))
    snapshot = db.collection(APPLICATIONS).document(user_id).get()
    if not snapshot.exists:
        return _application_payload("none", [], "", None)
    data = snapshot.to_dict() or {}
    return _application_payload(
        data.get("status") or "pending",
        data.get("languages") or [],
        data.get("note"),
        data.get("submitted_at"),
        data.get("church"),
        data.get("availability"),
    )


def submit_warrior_application(db, user, languages, note, church="", availability=None):
    """Store a pending application. Enrollment stays an admin grant."""
    if user.get("is_anonymous"):
        raise PermissionError("Sign in is required to apply as a prayer warrior")
    user_id = user["user_id"]
    profile = _get_profile(db, user_id)
    if profile.get("is_prayer_leader") is True:
        raise RuntimeError("You are already a prayer warrior")
    cleaned = []
    for item in languages or []:
        language = str(item).strip().lower()
        if language not in WARRIOR_LANGUAGES:
            raise ValueError("Choose English, Spanish, or Kirundi")
        if language not in cleaned:
            cleaned.append(language)
    if not cleaned:
        raise ValueError("Choose at least one language")
    note = (note or "").strip()
    if len(note) < 10 or len(note) > MAX_DESCRIPTION_LENGTH:
        raise ValueError("Tell us a little about yourself in 10 to 500 characters")
    church = (church or "").strip()
    if len(church) > MAX_CHURCH_LENGTH:
        raise ValueError("Church name must be 80 characters or fewer")
    parsed_availability = _parse_warrior_availability(availability)
    now = _now()
    ref = db.collection(APPLICATIONS).document(user_id)
    existing = ref.get()
    submitted_at = now
    if existing.exists:
        previous = existing.to_dict() or {}
        submitted_at = previous.get("submitted_at") or now
    ref.set(
        {
            "user_id": user_id,
            "first_name": _first_name(profile, user.get("user_name")),
            "languages": cleaned,
            "note": note,
            "church": church,
            "availability": parsed_availability,
            "status": "pending",
            "submitted_at": submitted_at,
            "updated_at": now,
        }
    )
    db.collection("users").document(user_id).set({"prayer_availability": parsed_availability}, merge=True)
    return _application_payload("pending", cleaned, note, submitted_at, church, parsed_availability)


def is_platform_admin(user):
    email = str((user or {}).get("email") or "").strip().lower()
    return email in PLATFORM_ADMIN_EMAILS


def mark_platform_admin(db, user):
    """Remember that this allowlisted account is an admin."""
    if not is_platform_admin(user):
        return False
    db.collection("users").document(user["user_id"]).set({"is_admin": True}, merge=True)
    return True


def list_pending_warrior_applications(db):
    """Applications still waiting for an admin to accept or decline."""
    items = []
    for doc in db.collection(APPLICATIONS).stream():
        data = doc.to_dict() or {}
        if data.get("status") != "pending":
            continue
        items.append(
            {
                "user_id": doc.id,
                "first_name": data.get("first_name") or "",
                "languages": list(data.get("languages") or []),
                "note": data.get("note") or "",
                "church": data.get("church") or "",
                "availability": data.get("availability") or _empty_availability(),
                "status": "pending",
                "submitted_at": _serialize(data.get("submitted_at")),
            }
        )
    items.sort(key=lambda item: item.get("submitted_at") or "")
    return items


def review_warrior_application(db, reviewer_id, applicant_id, decision):
    """Accept grants prayer-warrior access. Decline leaves the person unenrolled."""
    if decision not in ("accept", "decline"):
        raise ValueError("Choose accept or decline")
    ref = db.collection(APPLICATIONS).document(applicant_id)
    snapshot = ref.get()
    if not snapshot.exists:
        raise ValueError("Application not found")
    data = snapshot.to_dict() or {}
    if data.get("status") != "pending":
        raise ValueError("This application has already been reviewed")
    now = _now()
    if decision == "accept":
        db.collection("users").document(applicant_id).set(
            {
                "is_prayer_leader": True,
                "prayer_languages": list(data.get("languages") or []),
                "prayer_availability": data.get("availability") or _empty_availability(),
            },
            merge=True,
        )
        status = "enrolled"
    else:
        status = "declined"
    ref.set({"status": status, "reviewed_at": now, "reviewed_by": reviewer_id}, merge=True)
    return {"user_id": applicant_id, "status": status}


def send_due_call_reminders(db):
    """Send one-hour and call-start notifications; invoked by Cloud Scheduler."""
    now = _now()
    sent = 0
    for doc in db.collection(COLLECTION).where("status", "==", "scheduled").stream():
        data = doc.to_dict() or {}
        scheduled_at = _as_naive_utc(data.get("scheduled_at"))
        if not scheduled_at:
            continue
        minutes_until = (scheduled_at - now).total_seconds() / 60
        update = {}
        if 55 <= minutes_until <= 65 and not data.get("reminder_1h_sent_at"):
            update["reminder_1h_sent_at"] = now
            title, body, event = (
                "Prayer call in one hour",
                "Your private prayer call begins in about one hour.",
                "reminder",
            )
        elif -2 <= minutes_until <= 2 and not data.get("reminder_live_sent_at"):
            update["reminder_live_sent_at"] = now
            title, body, event = "Your prayer call is ready", "Tap to join your private prayer call.", "call_ready"
        else:
            continue
        doc.reference.update(update)
        for participant_id in (data.get("requester_id"), data.get("leader_id")):
            if participant_id:
                _send(
                    participant_id,
                    title,
                    body,
                    {"type": "private_prayer_request", "requestId": doc.id, "event": event},
                    "session_reminders_enabled",
                    _get_profile(db, participant_id),
                )
        sent += 1
    return sent
