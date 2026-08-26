"""prayer_room voice_link routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
import logging
from datetime import datetime
from backend.services.media.sfu_regions import build_voice_link_sfu_fields
from backend.api.prayer_room.helpers import (
    VOICE_LINK_MAX_PARTICIPANTS,
    _deactivate_participant,
    _generate_room_code,
    _generate_room_id,
    _is_anonymous_user,
    _is_voice_link_room,
    _public_base_url,
    get_firestore_client,
    get_user_from_session,
)


@prayer_room_bp.route("/voice-link/create", methods=["POST"])
def create_voice_link_room():
    """Create a private 1:1 voice-only call room; TTL starts when the guest joins."""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required to create voice links"}), 401

        if _is_anonymous_user(user):
            return jsonify({"error": "Sign in required to start a voice call"}), 403

        host_id = user["user_id"]
        host_name = user.get("user_name") or user.get("name") or "Host"
        if len(host_name) > 30:
            return jsonify({"error": "Host name must be 30 characters or less"}), 400

        room_id = _generate_room_id()
        room_code = _generate_room_code(8)
        created_at = datetime.utcnow()
        sfu_fields = build_voice_link_sfu_fields(
            headers=request.headers,
            body=request.get_json(silent=True) or {},
        )

        room_data = {
            "room_id": room_id,
            "room_name": f"Voice call with {host_name}",
            "room_type": "voice_link",
            "room_privacy": "private",
            "room_code": room_code,
            "host_id": host_id,
            "host_name": host_name,
            "created_at": created_at,
            "call_started_at": None,
            "sfu_region": sfu_fields["sfu_region"],
            "sfu_url": sfu_fields["sfu_url"],
            "media_mode": "audio_only",
            "participants": [
                {
                    "user_id": host_id,
                    "user_name": host_name,
                    "joined_at": created_at,
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
                "allow_anonymous": False,
                "max_participants": VOICE_LINK_MAX_PARTICIPANTS,
                "auto_mute_new_participants": False,
            },
            "max_speakers": VOICE_LINK_MAX_PARTICIPANTS,
            "ended_reason": None,
        }

        db = get_firestore_client()
        db.collection("prayer_rooms").document(room_id).set(room_data)

        share_url = f"{_public_base_url()}/call/{room_id}?code={room_code}"

        return jsonify(
            {
                "success": True,
                "room_id": room_id,
                "room_code": room_code,
                "share_url": share_url,
                "expires_at": None,
                "host_id": host_id,
                "host_name": host_name,
                "sfu_region": sfu_fields["sfu_region"],
                "sfu_url": sfu_fields["sfu_url"],
            }
        )

    except Exception as e:
        logging.error(f"Error creating voice link room: {e}", exc_info=True)
        return jsonify({"error": "Failed to create voice link"}), 500


@prayer_room_bp.route("/voice-link/participant-disconnected/<room_id>", methods=["POST"])
def voice_link_participant_disconnected(room_id):
    """Host marks a guest inactive when SFU drops them without calling /leave."""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json() or {}
        target_user_id = (data.get("user_id") or "").strip()
        if not target_user_id:
            return jsonify({"error": "user_id is required"}), 400

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()
        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict() or {}
        if not _is_voice_link_room(room_data):
            return jsonify({"error": "Not a voice link room"}), 400
        if room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the host can update participant status"}), 403
        if target_user_id == room_data.get("host_id"):
            return jsonify({"error": "Cannot deactivate the host"}), 400

        participants = list(room_data.get("participants", []))
        participants, changed = _deactivate_participant(participants, target_user_id, reason="media_disconnected")
        if not changed:
            return jsonify({"success": True, "updated": False})

        room_ref.update(
            {
                "participants": participants,
                "last_activity": datetime.utcnow(),
            }
        )
        return jsonify({"success": True, "updated": True})
    except Exception as e:
        logging.error(f"Error deactivating voice link participant: {e}", exc_info=True)
        return jsonify({"error": "Failed to update participant"}), 500
