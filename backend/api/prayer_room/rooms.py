"""prayer_room rooms routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
from backend.core.input_validation import sanitize_string
import logging
from datetime import datetime
from backend.api.prayer_room.helpers import (
    _is_room_participant,
    _is_voice_link_room,
    _reject_anonymous_outside_voice_link,
    get_firestore_client,
    get_user_from_session,
)


@prayer_room_bp.route("/rooms", methods=["GET"])
def get_active_rooms():
    """Get list of active prayer rooms"""
    try:
        db = get_firestore_client()

        # Get active rooms
        rooms_query = (
            db.collection("prayer_rooms")
            .where("is_active", "==", True)
            .order_by("created_at", direction="DESCENDING")
            .limit(20)
        )

        rooms = []
        for doc in rooms_query.stream():
            room_data = doc.to_dict()
            if _is_voice_link_room(room_data):
                continue
            # Convert datetime objects to strings for JSON serialization
            if "created_at" in room_data:
                room_data["created_at"] = room_data["created_at"].isoformat()

            # Add participant count
            room_data["participant_count"] = len(room_data.get("participants", []))

            # Preserve host_name before removing participants
            host_name = room_data.get("host_name", "Anonymous")
            room_privacy = room_data.get("room_privacy", "public")

            # Remove sensitive data
            if "participants" in room_data:
                del room_data["participants"]

            # Ensure host_name and privacy are included in the response
            room_data["host_name"] = host_name
            room_data["room_privacy"] = room_privacy

            rooms.append(room_data)

        return jsonify({"rooms": rooms})

    except Exception as e:
        logging.error(f"Error getting active rooms: {str(e)}")
        return jsonify({"error": "Failed to get rooms"}), 500


@prayer_room_bp.route("/room/<room_id>", methods=["GET"])
def get_room_details(room_id):
    """Get details of a specific room"""
    try:
        db = get_firestore_client()

        room_doc = db.collection("prayer_rooms").document(room_id).get()
        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        if room_data.get("room_type") == "matched_prayer_call":
            user = get_user_from_session()
            if not user:
                return jsonify({"error": "Authentication required"}), 401
            if user["user_id"] not in room_data.get("participant_ids", []):
                return jsonify({"error": "You are not part of this private prayer call"}), 403
            # Credentials and internal request linkage are returned only through
            # the authenticated private-prayer call endpoint.
            room_data.pop("room_code", None)
            room_data.pop("private_prayer_request_id", None)
            room_data.pop("participant_ids", None)

        # Convert datetime objects to strings
        if "created_at" in room_data:
            room_data["created_at"] = room_data["created_at"].isoformat()

        # Add participant count
        room_data["participant_count"] = len(room_data.get("participants", []))

        return jsonify({"room": room_data})

    except Exception as e:
        logging.error(f"Error getting room details: {str(e)}")
        return jsonify({"error": "Failed to get room details"}), 500


@prayer_room_bp.route("/room/<room_id>/settings", methods=["PUT"])
def update_room_settings(room_id):
    """Update room settings (host only)"""
    try:
        data = request.get_json()
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id)
        room_data = room_doc.get().to_dict()

        # Check if user is the host
        if room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the host can update settings"}), 403

        # Update settings
        new_settings = data.get("settings", {})
        current_settings = room_data.get("settings", {})
        current_settings.update(new_settings)

        room_doc.update({"settings": current_settings, "updated_at": datetime.utcnow()})

        return jsonify({"success": True, "settings": current_settings})

    except Exception as e:
        logging.error(f"Error updating room settings: {str(e)}")
        return jsonify({"error": "Failed to update settings"}), 500


@prayer_room_bp.route("/room/<room_id>/end", methods=["POST"])
def end_room(room_id):
    """End a prayer room (host only; voice_link allows either participant)."""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id)
        room_snap = room_doc.get()
        if not room_snap.exists:
            return jsonify({"error": "Room not found"}), 404
        room_data = room_snap.to_dict() or {}

        anon_reject = _reject_anonymous_outside_voice_link(user, room_data)
        if anon_reject:
            return anon_reject

        data = request.get_json(silent=True) or {}
        ended_reason = data.get("ended_reason", "user")
        if ended_reason not in ("user", "timeout"):
            ended_reason = "user"

        if _is_voice_link_room(room_data):
            if not _is_room_participant(room_data, user["user_id"]):
                return jsonify({"error": "Only call participants can end this call"}), 403
        elif room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the host can end the room"}), 403

        room_doc.update(
            {
                "is_active": False,
                "ended_at": datetime.utcnow(),
                "ended_by": user["user_id"],
                "ended_reason": ended_reason,
            }
        )

        return jsonify({"success": True})

    except Exception as e:
        logging.error(f"Error ending room: {str(e)}")
        return jsonify({"error": "Failed to end room"}), 500


# Multi-Device Session Management Endpoints
@prayer_room_bp.route("/<room_id>/check-session", methods=["POST"])
def check_user_session(room_id):
    try:
        user = get_user_from_session()
        user_id = user.get("user_id") if user else None

        if not user_id:
            return jsonify({"error": "User not authenticated"}), 401

        db = get_firestore_client()
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        participants = room_data.get("participants", [])

        session_exists = any(
            p.get("user_id") == user_id and p.get("session_id") and p.get("is_active", True) for p in participants
        )

        return jsonify({"session_exists": session_exists})
    except Exception as e:
        logging.error(f"Error checking user session in room {room_id}: {e}", exc_info=True)
        return jsonify({"error": "Failed to check user session"}), 500


@prayer_room_bp.route("/<room_id>/register-session", methods=["POST"])
def register_user_session(room_id):
    """Register a new device session"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json()
        device_id = data.get("device_id")
        device_info = data.get("device_info", {})

        # Use authenticated user ID
        user_id = user["user_id"]

        if not device_id:
            return jsonify({"error": "Device ID is required"}), 400

        # Sanitize device info to prevent information disclosure
        sanitized_device_info = {
            "user_agent": sanitize_string(device_info.get("user_agent", ""), max_length=200),
            "platform": sanitize_string(device_info.get("platform", ""), max_length=50),
            "language": sanitize_string(device_info.get("language", ""), max_length=10),
        }

        db = get_firestore_client()

        # Deactivate any existing sessions for this user across ALL rooms
        # This ensures users can only have one active session at a time
        # OPTIMIZED: Use collection group query for better performance
        try:
            sessions_query = (
                db.collection_group("device_sessions")
                .where("user_id", "==", user_id)
                .where("is_active", "==", True)
                .limit(10)
            )

            batch = db.batch()
            session_count = 0
            for session_doc in sessions_query.stream():
                batch.update(session_doc.reference, {"is_active": False, "ended_at": datetime.utcnow()})
                session_count += 1

            if session_count > 0:
                batch.commit()
                logging.info(f"Deactivated {session_count} existing session(s) for user {user_id}")
        except Exception as e:
            logging.warning(f"Collection group query failed, using fallback: {e}")
            try:
                # Fallback: only check current room
                current_room_sessions = (
                    db.collection("prayer_rooms")
                    .document(room_id)
                    .collection("device_sessions")
                    .where("user_id", "==", user_id)
                    .where("is_active", "==", True)
                    .stream()
                )

                for session_doc in current_room_sessions:
                    session_doc.reference.update({"is_active": False, "ended_at": datetime.utcnow()})
            except Exception as fallback_error:
                logging.error(f"Fallback session deactivation also failed: {fallback_error}")

        # Register new session
        session_data = {
            "user_id": user_id,
            "device_id": device_id,
            "device_info": sanitized_device_info,
            "is_active": True,
            "created_at": datetime.utcnow(),
            "last_seen": datetime.utcnow(),
        }

        db.collection("prayer_rooms").document(room_id).collection("device_sessions").add(session_data)

        return jsonify({"success": True})

    except Exception as e:
        logging.error(f"Error registering session: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to register session"}), 500


@prayer_room_bp.route("/<room_id>/disconnect-session", methods=["POST"])
def disconnect_session(room_id):
    """Disconnect existing session (for device switching)"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        user_id = user["user_id"]

        db = get_firestore_client()

        # Deactivate all sessions for this user
        sessions_ref = (
            db.collection("prayer_rooms")
            .document(room_id)
            .collection("device_sessions")
            .where("user_id", "==", user_id)
            .where("is_active", "==", True)
        )

        for session_doc in sessions_ref.stream():
            session_doc.reference.update({"is_active": False, "ended_at": datetime.utcnow()})

        return jsonify({"success": True})

    except Exception as e:
        logging.error(f"Error disconnecting session: {str(e)}")
        return jsonify({"error": "Failed to disconnect session"}), 500


@prayer_room_bp.route("/my-rooms", methods=["GET"])
def get_my_rooms():
    """Get all rooms created by the current user"""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get rooms created by this user (simplified query to avoid composite index)
        rooms_ref = db.collection("prayer_rooms").where("host_id", "==", user["user_id"]).limit(50)

        rooms = []
        for doc in rooms_ref.stream():
            room_data = doc.to_dict()
            room_data["room_id"] = doc.id
            # Convert Firestore timestamps to ISO strings
            if "created_at" in room_data and hasattr(room_data["created_at"], "timestamp"):
                room_data["created_at"] = room_data["created_at"].timestamp()
            if "last_activity" in room_data and hasattr(room_data["last_activity"], "timestamp"):
                room_data["last_activity"] = room_data["last_activity"].timestamp()
            rooms.append(room_data)

        # Sort by created_at in Python (since we can't order_by in the query)
        rooms.sort(key=lambda x: x.get("created_at", 0), reverse=True)

        return jsonify({"rooms": rooms})

    except Exception as e:
        logging.error(f"Error getting user rooms: {str(e)}")
        return jsonify({"error": "Failed to get user rooms"}), 500
