"""prayer_room lifecycle routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
from backend.core.input_validation import sanitize_string
from backend.integrations.push_service import send_push_to_group
import logging
from datetime import datetime
import uuid
from backend.services.media.sfu_regions import get_sfu_url_for_room, maybe_migrate_voice_link_sfu_at_guest_join
from backend.api.prayer_room.helpers import (
    MAX_ACTIVE_SPEAKERS,
    VOICE_LINK_MAX_PARTICIPANTS,
    _active_participant_count,
    _format_expires_at_iso,
    _is_anonymous_user,
    _is_group_member,
    _is_room_participant,
    _is_voice_link_expired,
    _is_voice_link_room,
    _mirror_chat_message_to_rtdb,
    _normalize_utc_datetime,
    _reject_anonymous_outside_voice_link,
    _voice_link_code_matches,
    _voice_link_timer_start_if_needed,
    get_firestore_client,
    get_max_speakers,
    get_user_from_session,
    normalize_participants,
)


@prayer_room_bp.route("/create", methods=["POST"])
def create_prayer_room():
    """Create a new prayer room"""
    try:
        # Check if user is authenticated
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required to create rooms"}), 401

        if _is_anonymous_user(user):
            return jsonify({"error": "Sign in required to create a room"}), 403

        data = request.get_json()
        room_name = data.get("room_name", "Prayer Room")
        room_privacy = data.get("room_privacy", "public")  # 'public' or 'private'
        host_id = user["user_id"]  # Use authenticated user's ID
        host_name = user["user_name"]  # Use authenticated user's name

        # Validate room privacy
        if room_privacy not in ["public", "private"]:
            return jsonify({"error": 'Room privacy must be either "public" or "private"'}), 400

        # Validate room name length
        if len(room_name) > 50:
            return jsonify({"error": "Room name must be 50 characters or less"}), 400

        # Validate host name length
        if len(host_name) > 30:
            return jsonify({"error": "Host name must be 30 characters or less"}), 400

        # Generate room ID
        room_id = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])

        # Generate room code for private rooms
        room_code = None
        if room_privacy == "private":
            room_code = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:8]])

        # Create room document
        room_data = {
            "room_id": room_id,
            "room_name": room_name,
            "room_privacy": room_privacy,
            "room_code": room_code,  # Only set for private rooms
            "host_id": host_id,
            "host_name": host_name,
            "created_at": datetime.utcnow(),
            "participants": [
                {
                    "user_id": host_id,
                    "user_name": host_name,
                    "joined_at": datetime.utcnow(),
                    "is_muted": False,
                    "is_host": True,
                    "role": "speaker",
                    "requested_role": None,
                    "request_timestamp": None,
                }
            ],
            "is_active": True,
            "is_locked": False,
            "settings": {
                "allow_anonymous": room_privacy == "public",  # Only allow anonymous for public rooms
                "max_participants": 50,
                "auto_mute_new_participants": False,
            },
            "max_speakers": MAX_ACTIVE_SPEAKERS,
        }

        db = get_firestore_client()
        db.collection("prayer_rooms").document(room_id).set(room_data)

        return jsonify(
            {
                "success": True,
                "room_id": room_id,
                "room_name": room_name,
                "room_code": room_code,  # Include room code for private rooms
                "host_id": host_id,
                "message": f'Room "{room_name}" created successfully',
            }
        )

    except Exception as e:
        logging.error(f"Error creating prayer room: {str(e)}")
        return jsonify({"error": "Failed to create prayer room"}), 500


@prayer_room_bp.route("/group-session", methods=["POST"])
def ensure_group_prayer_session():
    """Return an active group-bound private room, or create one.

    Members join without a room code (see join_prayer_room group_id bypass).
    """
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json(silent=True) or {}
        group_id = data.get("group_id")
        if not group_id or not isinstance(group_id, str):
            return jsonify({"error": "group_id is required"}), 400

        uid = user["user_id"]
        host_name = user.get("user_name") or user.get("display_name") or "Host"
        if len(host_name) > 30:
            return jsonify({"error": "User name must be 30 characters or less"}), 400

        db = get_firestore_client()
        if not _is_group_member(db, group_id, uid):
            return jsonify({"error": "Not a member of this group"}), 403

        group_snap = db.collection("prayer_groups").document(group_id).get()
        group = group_snap.to_dict() if group_snap.exists else {}
        gname = (group.get("name") or "Group").strip() or "Group"
        room_name = data.get("room_name") or f"{gname} — Live"
        room_name = str(room_name).strip()[:50]

        rooms_query = (
            db.collection("prayer_rooms").where("group_id", "==", group_id).where("is_active", "==", True).limit(1)
        )
        existing = list(rooms_query.stream())
        if existing:
            rd = existing[0].to_dict()
            return jsonify(
                {
                    "success": True,
                    "room_id": rd.get("room_id"),
                    "room_name": rd.get("room_name"),
                    "room_code": rd.get("room_code"),
                    "reused": True,
                }
            )

        room_id = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        room_code = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:8]])

        room_data = {
            "room_id": room_id,
            "room_name": room_name,
            "room_privacy": "private",
            "room_code": room_code,
            "group_id": group_id,
            "host_id": uid,
            "host_name": host_name,
            "created_at": datetime.utcnow(),
            "participants": [
                {
                    "user_id": uid,
                    "user_name": host_name,
                    "joined_at": datetime.utcnow(),
                    "is_muted": False,
                    "is_host": True,
                    "role": "speaker",
                    "requested_role": None,
                    "request_timestamp": None,
                }
            ],
            "is_active": True,
            "is_locked": False,
            "settings": {"allow_anonymous": False, "max_participants": 50, "auto_mute_new_participants": False},
            "max_speakers": MAX_ACTIVE_SPEAKERS,
        }

        db.collection("prayer_rooms").document(room_id).set(room_data)

        try:
            send_push_to_group(
                group_id,
                title=f"{gname} \u2014 Live Prayer",
                body=f"{host_name} started a live prayer session. Tap to join.",
                data={"type": "group_live", "groupId": group_id, "roomId": room_id},
                exclude_user=uid,
                priority="high",
                channel_id="group-live",
            )
        except Exception as push_err:
            logging.warning(f"Group session push failed (non-fatal): {push_err}")

        return jsonify(
            {
                "success": True,
                "room_id": room_id,
                "room_name": room_name,
                "room_code": room_code,
                "reused": False,
            }
        )
    except Exception as e:
        logging.error(f"ensure_group_prayer_session error: {e}", exc_info=True)
        return jsonify({"error": "Failed to start group session"}), 500


@prayer_room_bp.route("/find-by-code/<room_code>", methods=["GET"])
def find_room_by_code(room_code):
    """Find a room by its room code"""
    try:
        db = get_firestore_client()

        # Query rooms by room_code
        rooms_query = (
            db.collection("prayer_rooms").where("room_code", "==", room_code).where("is_active", "==", True).limit(1)
        )

        rooms = list(rooms_query.stream())

        if not rooms:
            return jsonify({"error": "Room not found"}), 404

        room_doc = rooms[0]
        room_data = room_doc.to_dict()

        return jsonify(
            {
                "success": True,
                "room_id": room_data.get("room_id"),
                "room_name": room_data.get("room_name"),
                "room_privacy": room_data.get("room_privacy", "public"),
            }
        )

    except Exception as e:
        logging.error(f"Error finding room by code: {str(e)}")
        return jsonify({"error": "Failed to find room"}), 500


@prayer_room_bp.route("/join/<room_id>", methods=["POST"])
def join_prayer_room(room_id):
    """Join an existing prayer room"""
    try:
        # Get user from session first
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "User not authenticated"}), 401

        user_id = user["user_id"]
        user_name = user["user_name"]
        data = request.get_json(silent=True) or {}

        # Validate user name length
        if len(user_name) > 30:
            return jsonify({"error": "User name must be 30 characters or less"}), 400

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()

        anon_reject = _reject_anonymous_outside_voice_link(user, room_data)
        if anon_reject:
            return anon_reject

        if not room_data.get("is_active", False):
            return jsonify({"error": "Room is not active"}), 400

        if room_data.get("is_locked", False):
            return jsonify({"error": "Room is locked"}), 400

        if _is_voice_link_room(room_data):
            if _is_voice_link_expired(room_data):
                return jsonify({"error": "This call has expired"}), 400
            if room_data.get("room_type") == "matched_prayer_call":
                if user_id not in room_data.get("participant_ids", []):
                    return jsonify({"error": "You are not part of this private prayer call"}), 403
            if not _voice_link_code_matches(room_data, data.get("room_code")):
                return jsonify({"error": "Invalid call link"}), 403
            display_name = sanitize_string(data.get("display_name", "")).strip()
            if display_name:
                user_name = display_name[:30]
            elif user_name in ("Anonymous", "") or not str(user_name).strip():
                user_name = "Guest"

        # Check room privacy and validate room code for private rooms
        room_privacy = room_data.get("room_privacy", "public")
        bonded_group_id = room_data.get("group_id")
        skip_private_code = (
            room_privacy == "private" and bonded_group_id and _is_group_member(db, bonded_group_id, user_id)
        )

        if room_privacy == "private" and not skip_private_code:
            raw_room_code = data.get("room_code", "")

            if isinstance(raw_room_code, (list, dict)):
                logging.warning(
                    f"join_prayer_room received non-string room_code payload for room {room_id}: {raw_room_code}"
                )
                provided_code = str(raw_room_code)
            else:
                provided_code = "" if raw_room_code is None else str(raw_room_code)

            provided_code = provided_code.strip().upper()
            room_code = room_data.get("room_code")

            if not room_code:
                logging.error(f"Private room {room_id} has no room_code set in database")
                return jsonify({"error": "Room configuration error: missing room code"}), 500

            if not provided_code:
                return jsonify({"error": "Room code is required for private rooms"}), 400

            # Normalize both codes to uppercase for comparison
            if provided_code != room_code.upper():
                logging.warning(
                    f"Invalid room code provided for room {room_id}: expected {room_code}, got {provided_code}"
                )
                return jsonify({"error": "Invalid room code"}), 400

        # Normalize participant metadata and check if user is already in the room
        participants = room_data.get("participants", [])
        host_id = room_data.get("host_id")
        max_speakers = get_max_speakers(room_data)

        participants, speaker_count, participants_changed = normalize_participants(participants, host_id)

        if _is_voice_link_room(room_data):
            already_in = _is_room_participant(room_data, user_id)
            if not already_in and _active_participant_count(participants) >= VOICE_LINK_MAX_PARTICIPANTS:
                return jsonify({"error": "This call is full"}), 403

        participant_updated = False
        for p in participants:
            if p.get("user_id") == user_id:
                # Archive the old session
                p["is_active"] = False
                p["archived_at"] = datetime.utcnow()
                p["reason_archived"] = "joined_from_new_device"
                participant_updated = True
                break

        # Remove the old participant entry if it was found and marked as inactive
        if participant_updated:
            participants = [p for p in participants if p.get("user_id") != user_id or p.get("is_active")]

        # Add participant to room
        new_participant = {
            "user_id": user_id,
            "user_name": user_name,
            "joined_at": datetime.utcnow(),
            "is_muted": False,
            "is_host": user_id == host_id,
            "role": "speaker"
            if _is_voice_link_room(room_data)
            else ("speaker" if (user_id == host_id or speaker_count < max_speakers) else "listener"),
            "requested_role": None,
            "request_timestamp": None,
        }

        if new_participant["role"] == "speaker" and user_id != host_id:
            speaker_count += 1

        participants.append(new_participant)
        update_fields = {
            "participants": participants,
            "last_activity": datetime.utcnow(),
            "max_speakers": max_speakers,
        }
        started_expires_at, timer_fields = _voice_link_timer_start_if_needed(room_data, participants)
        update_fields.update(timer_fields)

        sfu_migration = {}
        if _is_voice_link_room(room_data):
            sfu_migration = maybe_migrate_voice_link_sfu_at_guest_join(
                room_data,
                user_id,
                host_id,
                participants,
                headers=request.headers,
                body=data,
            )
            update_fields.update(sfu_migration)

        room_ref.update(update_fields)

        effective_room = {**room_data, **update_fields}

        response = {
            "success": True,
            "room_id": room_id,
            "room_name": room_data.get("room_name"),
            "host_id": host_id,
            "participants": participants,
            "max_speakers": max_speakers,
        }
        if _is_voice_link_room(room_data):
            response["room_type"] = room_data.get("room_type")
            response["host_name"] = room_data.get("host_name")
            response["sfu_region"] = effective_room.get("sfu_region")
            response["sfu_url"] = get_sfu_url_for_room(effective_room)
            if sfu_migration:
                response["sfu_migrated"] = True
            expires_at = started_expires_at or _normalize_utc_datetime(effective_room.get("expires_at"))
            response["call_started"] = bool(expires_at)
            if expires_at:
                response["expires_at"] = _format_expires_at_iso(expires_at)
                response["seconds_remaining"] = max(0, int((expires_at - datetime.utcnow()).total_seconds()))
        return jsonify(response)

    except Exception as e:
        logging.error(f"Error joining prayer room {room_id}: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to join prayer room"}), 500


@prayer_room_bp.route("/leave/<room_id>", methods=["POST"])
def leave_prayer_room(room_id):
    """Leave a prayer room"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        user_id = user["user_id"]

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()

        anon_reject = _reject_anonymous_outside_voice_link(user, room_data)
        if anon_reject:
            return anon_reject

        participants_before = list(room_data.get("participants", []))

        # Resolve host display name before mutating the participant list (host was incorrectly looked up after removal).
        host_name_for_notice = room_data.get("host_name") or "The host"
        for _p in participants_before:
            if _p.get("user_id") == user_id:
                host_name_for_notice = _p.get("user_name") or host_name_for_notice
                break

        # Remove leaver from participants
        participants = [p for p in participants_before if p.get("user_id") != user_id]

        # If host leaves, close the room and add notification message
        if room_data.get("host_id") == user_id:
            # Add notification message to chat
            chat_ref = db.collection("chat_messages")
            sys_msg_id = str(uuid.uuid4())
            notification_message = {
                "room_id": room_id,
                "message_id": sys_msg_id,
                "user_id": "system",
                "user_name": "System",
                "message": (
                    f"⚠️ {host_name_for_notice} (host) has ended this prayer session. "
                    f"The room will close for everyone in a few seconds."
                ),
                "timestamp": datetime.utcnow(),
                "message_type": "system_notification",
            }
            chat_ref.add(notification_message)
            _mirror_chat_message_to_rtdb(
                room_id,
                sys_msg_id,
                "system",
                "System",
                notification_message["message"],
                "system_notification",
            )

            room_ref.update({"is_active": False, "closed_at": datetime.utcnow(), "participants": []})
        else:
            normalized_participants, _, changed = normalize_participants(participants, room_data.get("host_id"))
            update_payload = {
                "participants": normalized_participants,
                "last_activity": datetime.utcnow(),
                "max_speakers": get_max_speakers(room_data),
            }
            room_ref.update(update_payload)

        return jsonify({"success": True})

    except Exception as e:
        logging.error(f"Error leaving prayer room: {str(e)}")
        return jsonify({"error": "Failed to leave prayer room"}), 500
