"""prayer_room participants routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
import logging
from datetime import datetime
import uuid
from backend.api.prayer_room.helpers import (
    _mirror_chat_message_to_rtdb,
    _reject_anonymous_outside_voice_link,
    count_speakers,
    find_participant,
    get_firestore_client,
    get_max_speakers,
    get_user_from_session,
    normalize_participants,
    set_participant_role,
)


@prayer_room_bp.route("/<room_id>/participants", methods=["GET"])
def get_room_participants(room_id):
    """Get room participants - Optimized for fast loading"""
    try:
        # Get current user to update their name if needed
        user = get_user_from_session()

        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id).get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        participants = room_data.get("participants", [])
        host_id = room_data.get("host_id")
        max_speakers = get_max_speakers(room_data)

        # Filter out inactive participants (is_active defaults to True for backward compatibility)
        participants = [p for p in participants if p.get("is_active", True)]

        participants, _, participants_changed = normalize_participants(participants, host_id)

        # Only update participant name if necessary and user exists
        # This should be rare, so do it asynchronously after returning response
        if user:
            user_id = user["user_id"]
            user_name = user.get("user_name") or user.get("name", "Anonymous")

            # Check if update is needed (quick check first)
            participant_needs_update = False
            for participant in participants:
                if participant.get("user_id") == user_id:
                    if participant.get("user_name") != user_name:
                        participant_needs_update = True
                        participant["user_name"] = user_name
                    break

            # Only write to Firestore if update is needed
            if participant_needs_update:
                # Firestore update can happen asynchronously
                room_ref = db.collection("prayer_rooms").document(room_id)
                room_ref.update({"participants": participants, "last_activity": datetime.utcnow()})

        if participants_changed or room_data.get("max_speakers") != max_speakers:
            room_ref = db.collection("prayer_rooms").document(room_id)
            room_ref.update(
                {"participants": participants, "last_activity": datetime.utcnow(), "max_speakers": max_speakers}
            )

        return jsonify(
            {
                "success": True,
                "participants": participants,
                "room_name": room_data.get("room_name"),
                "is_active": room_data.get("is_active", False),
                "max_speakers": max_speakers,
            }
        )

    except Exception as e:
        logging.error(f"Error getting room participants: {str(e)}")
        return jsonify({"error": "Failed to get participants"}), 500


@prayer_room_bp.route("/<room_id>/mute", methods=["POST"])
def mute_participant(room_id):
    """Mute/unmute a participant (host only - for muting other participants)"""
    try:
        data = request.get_json()
        user_id = data.get("user_id")
        is_muted = data.get("is_muted", False)

        if not user_id:
            return jsonify({"error": "User ID is required"}), 400

        # Get the requesting user to check if they're the host
        requesting_user = get_user_from_session()
        if not requesting_user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()

        # Check if requesting user is the host
        if room_data.get("host_id") != requesting_user["user_id"]:
            return jsonify({"error": "Only the host can mute participants"}), 403

        participants = room_data.get("participants", [])

        # Update participant mute status
        participant_found = False
        for participant in participants:
            if participant["user_id"] == user_id:
                participant["is_muted"] = is_muted
                participant["mute_source"] = "host"  # Track who muted
                participant_found = True
                break

        if not participant_found:
            return jsonify({"error": "Participant not found"}), 404

        normalized_participants, _, _ = normalize_participants(participants, room_data.get("host_id"))
        room_ref.update(
            {
                "participants": normalized_participants,
                "last_activity": datetime.utcnow(),
                "max_speakers": get_max_speakers(room_data),
            }
        )

        return jsonify({"success": True, "is_muted": is_muted})

    except Exception as e:
        logging.error(f"Error muting participant: {str(e)}")
        return jsonify({"error": "Failed to mute participant"}), 500


@prayer_room_bp.route("/<room_id>/self-mute", methods=["POST"])
def self_mute_participant(room_id):
    """Update own mute status (any authenticated user can mute/unmute themselves)"""
    try:
        data = request.get_json()
        is_muted = data.get("is_muted", False)

        # Get the requesting user
        requesting_user = get_user_from_session()
        if not requesting_user:
            return jsonify({"error": "Authentication required"}), 401

        user_id = requesting_user["user_id"]

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()

        anon_reject = _reject_anonymous_outside_voice_link(requesting_user, room_data)
        if anon_reject:
            return anon_reject

        participants = room_data.get("participants", [])

        # Find and update the requesting user's mute status
        participant_found = False
        for participant in participants:
            if participant.get("user_id") == user_id:
                participant["is_muted"] = is_muted
                # Store metadata about mute source (preserved by normalize_participants)
                participant["mute_source"] = "self"
                participant["mute_updated_at"] = datetime.utcnow()
                participant_found = True
                break

        # If participant not found, create entry (shouldn't happen, but handle gracefully)
        if not participant_found:
            user_name = requesting_user.get("name", requesting_user.get("user_name", "Anonymous"))
            new_participant = {
                "user_id": user_id,
                "user_name": user_name,
                "joined_at": datetime.utcnow(),
                "is_muted": is_muted,
                "is_host": user_id == room_data.get("host_id"),
                "role": "listener",
                "mute_source": "self",
                "mute_updated_at": datetime.utcnow(),
            }
            participants.append(new_participant)

        # Normalize participants (preserves all fields including mute_source and mute_updated_at)
        normalized_participants, _, _ = normalize_participants(participants, room_data.get("host_id"))
        room_ref.update(
            {
                "participants": normalized_participants,
                "last_activity": datetime.utcnow(),
                "max_speakers": get_max_speakers(room_data),
            }
        )

        logging.info(f"User {user_id} {'muted' if is_muted else 'unmuted'} themselves in room {room_id}")
        return jsonify({"success": True, "is_muted": is_muted})

    except Exception as e:
        logging.error(f"Error updating self mute status: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to update mute status"}), 500


@prayer_room_bp.route("/room/<room_id>/request-speaker", methods=["POST"])
def request_speaker_role(room_id):
    """Listener requests or cancels a request to become a speaker."""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json(silent=True) or {}
        action = data.get("action", "request")

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        participants = room_data.get("participants", [])
        host_id = room_data.get("host_id")
        max_speakers = get_max_speakers(room_data)

        participants, _, changed = normalize_participants(participants, host_id)
        participant = find_participant(participants, user["user_id"])

        if not participant:
            return jsonify({"error": "Participant not found in room"}), 404

        if participant.get("role") == "speaker":
            message = "You are already a speaker."
        elif action == "cancel":
            if participant.get("requested_role"):
                participant["requested_role"] = None
                participant["request_timestamp"] = None
                changed = True
            message = "Speaker request cancelled."
        else:
            if participant.get("requested_role") == "speaker":
                message = "Speaker request already submitted."
            else:
                participant["requested_role"] = "speaker"
                participant["request_timestamp"] = datetime.utcnow()
                changed = True
                message = "Speaker request sent."

        if changed or room_data.get("max_speakers") != max_speakers:
            room_ref.update(
                {"participants": participants, "last_activity": datetime.utcnow(), "max_speakers": max_speakers}
            )

        return jsonify(
            {"success": True, "participants": participants, "max_speakers": max_speakers, "message": message}
        )

    except Exception as e:
        logging.error(f"Error handling speaker request: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to update speaker request"}), 500


@prayer_room_bp.route("/room/<room_id>/promote-speaker", methods=["POST"])
def promote_speaker(room_id):
    """Host promotes a participant to speaker role (up to cap)."""
    try:
        host = get_user_from_session()
        if not host:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json(silent=True) or {}
        target_user_id = data.get("user_id")
        if not target_user_id:
            return jsonify({"error": "Target user_id is required"}), 400

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        if room_data.get("host_id") != host["user_id"]:
            return jsonify({"error": "Only the host can promote speakers"}), 403

        participants = room_data.get("participants", [])
        host_id = room_data.get("host_id")
        max_speakers = get_max_speakers(room_data)

        participants, _, changed = normalize_participants(participants, host_id)
        target = find_participant(participants, target_user_id)

        if not target:
            return jsonify({"error": "Participant not found"}), 404

        if target.get("role") == "speaker":
            return jsonify(
                {
                    "success": True,
                    "participants": participants,
                    "max_speakers": max_speakers,
                    "message": "Participant is already a speaker.",
                }
            )

        current_speakers = count_speakers(participants)
        if current_speakers >= max_speakers:
            return jsonify({"error": f"Maximum of {max_speakers} speakers reached."}), 400

        participants, role_changed = set_participant_role(participants, target_user_id, "speaker")
        if role_changed:
            changed = True

        if changed or room_data.get("max_speakers") != max_speakers:
            room_ref.update(
                {"participants": participants, "last_activity": datetime.utcnow(), "max_speakers": max_speakers}
            )

        return jsonify(
            {
                "success": True,
                "participants": participants,
                "max_speakers": max_speakers,
                "message": "Participant promoted to speaker.",
            }
        )

    except Exception as e:
        logging.error(f"Error promoting speaker: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to promote participant"}), 500


@prayer_room_bp.route("/room/<room_id>/demote-speaker", methods=["POST"])
def demote_speaker(room_id):
    """Host demotes a speaker to listener role."""
    try:
        host = get_user_from_session()
        if not host:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json(silent=True) or {}
        target_user_id = data.get("user_id")
        if not target_user_id:
            return jsonify({"error": "Target user_id is required"}), 400

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        host_id = room_data.get("host_id")

        # Allow self-demotion or host demotion
        is_self_demotion = target_user_id == host["user_id"]
        is_host = host_id == host["user_id"]

        if not is_self_demotion and not is_host:
            return jsonify({"error": "Only the host can demote other speakers"}), 403

        if target_user_id == host_id:
            return jsonify({"error": "Host cannot be demoted from speaker role"}), 400

        participants = room_data.get("participants", [])
        max_speakers = get_max_speakers(room_data)

        participants, _, changed = normalize_participants(participants, host_id)
        target = find_participant(participants, target_user_id)

        if not target:
            return jsonify({"error": "Participant not found"}), 404

        if target.get("role") != "speaker":
            return jsonify(
                {
                    "success": True,
                    "participants": participants,
                    "max_speakers": max_speakers,
                    "message": "Participant is already a listener.",
                }
            )

        participants, role_changed = set_participant_role(participants, target_user_id, "listener")
        if role_changed:
            target = find_participant(participants, target_user_id)
            if target:
                target["is_muted"] = True
            changed = True

        if changed or room_data.get("max_speakers") != max_speakers:
            room_ref.update(
                {"participants": participants, "last_activity": datetime.utcnow(), "max_speakers": max_speakers}
            )

        return jsonify(
            {
                "success": True,
                "participants": participants,
                "max_speakers": max_speakers,
                "message": "Participant demoted to listener.",
            }
        )

    except Exception as e:
        logging.error(f"Error demoting speaker: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to demote participant"}), 500


@prayer_room_bp.route("/room/<room_id>/speaker-requests", methods=["GET"])
def get_speaker_requests(room_id):
    """Return pending speaker requests for host moderation UI."""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id).get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        if room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the host can view speaker requests"}), 403

        participants = room_data.get("participants", [])
        participants, _, _ = normalize_participants(participants, room_data.get("host_id"))

        requests = []
        for participant in participants:
            if participant.get("requested_role") == "speaker":
                timestamp = participant.get("request_timestamp")
                if isinstance(timestamp, datetime):
                    ts_value = timestamp.isoformat()
                else:
                    ts_value = timestamp
                requests.append(
                    {
                        "user_id": participant.get("user_id"),
                        "user_name": participant.get("user_name"),
                        "request_timestamp": ts_value,
                    }
                )

        requests.sort(key=lambda item: item.get("request_timestamp") or "")

        return jsonify({"success": True, "requests": requests, "max_speakers": get_max_speakers(room_data)})

    except Exception as e:
        logging.error(f"Error fetching speaker requests: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to fetch speaker requests"}), 500


@prayer_room_bp.route("/<room_id>/remove", methods=["POST"])
def remove_participant(room_id):
    """Remove a participant from the room (host only)"""
    try:
        data = request.get_json()
        user_id = data.get("user_id")

        if not user_id:
            return jsonify({"error": "User ID is required"}), 400

        # Get the requesting user to check if they're the host
        requesting_user = get_user_from_session()
        if not requesting_user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()

        # Check if requesting user is the host
        if room_data.get("host_id") != requesting_user["user_id"]:
            return jsonify({"error": "Only the host can remove participants"}), 403

        participants = room_data.get("participants", [])

        # Find the participant to remove
        participant_to_remove = None
        for participant in participants:
            if participant["user_id"] == user_id:
                participant_to_remove = participant
                break

        if not participant_to_remove:
            return jsonify({"error": "Participant not found"}), 404

        # Remove participant
        participants = [p for p in participants if p["user_id"] != user_id]

        # Add notification message to chat
        chat_ref = db.collection("chat_messages")
        sys_msg_id = str(uuid.uuid4())
        notification_message = {
            "room_id": room_id,
            "message_id": sys_msg_id,
            "user_id": "system",
            "user_name": "System",
            "message": f"👋 {participant_to_remove.get('user_name', 'A participant')} has been removed from the room by the host.",
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

        room_ref.update({"participants": participants, "last_activity": datetime.utcnow()})

        return jsonify({"success": True, "removed_user": participant_to_remove.get("user_name", "Unknown")})

    except Exception as e:
        logging.error(f"Error removing participant: {str(e)}")
        return jsonify({"error": "Failed to remove participant"}), 500
