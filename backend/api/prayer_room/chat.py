"""prayer_room chat routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
from backend.core.input_validation import validate_data, sanitize_string
import logging
import uuid
from google.cloud import firestore
from backend.api.prayer_room.helpers import (
    _mirror_chat_message_to_rtdb,
    get_firestore_client,
    get_user_from_session,
)


@prayer_room_bp.route("/<room_id>/chat", methods=["POST"])
def send_chat_message(room_id):
    """Send a chat message to the room"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            logging.error("Chat message: No user in session")
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json()
        if not data:
            logging.error("Chat message: No JSON data in request")
            return jsonify({"error": "Invalid request: JSON data required"}), 400

        # Use authenticated user data, not from request body
        user_id = user.get("user_id")
        if not user_id:
            logging.error(f"Chat message: No user_id in session user: {user}")
            return jsonify({"error": "Invalid user session"}), 401

        user_name = user.get("name", "Anonymous")

        # Validate input data
        is_valid, validation_errors = validate_data(data, "chat_message")
        if not is_valid:
            logging.error(f"Chat message validation failed: {validation_errors}")
            return jsonify({"error": "Invalid input", "details": validation_errors}), 400

        message = sanitize_string(data["message"], max_length=1000)
        if not message or not message.strip():
            return jsonify({"error": "Message cannot be empty"}), 400

        db = get_firestore_client()

        # Add message to chat collection
        chat_data = {
            "room_id": room_id,
            "user_id": user_id,
            "user_name": user_name,
            "message": message,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "message_id": str(uuid.uuid4()),
        }

        db.collection("chat_messages").add(chat_data)
        logging.info(f"Chat message added successfully for room {room_id} by user {user_id}")

        # Also write to RTDB for real-time delivery to all connected clients
        _mirror_chat_message_to_rtdb(
            room_id,
            chat_data["message_id"],
            user_id,
            user_name,
            message,
            "text",
        )

        return jsonify({"success": True, "message_id": chat_data["message_id"]}), 200

    except KeyError as e:
        logging.error(f"Chat message KeyError: {str(e)}", exc_info=True)
        return jsonify({"error": f"Missing required field: {str(e)}"}), 400
    except Exception as e:
        logging.error(f"Error sending chat message: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to send message"}), 500


@prayer_room_bp.route("/<room_id>/chat", methods=["GET"])
def get_chat_messages(room_id):
    """Get chat messages for a room"""
    try:
        db = get_firestore_client()

        # Try to get recent messages (last 50)
        try:
            messages_query = (
                db.collection("chat_messages")
                .where("room_id", "==", room_id)
                .order_by("timestamp", direction="DESCENDING")
                .limit(50)
            )

            messages = []
            for doc in messages_query.stream():
                message_data = doc.to_dict()
                messages.append(
                    {
                        "message_id": message_data.get("message_id"),
                        "user_id": message_data.get("user_id"),
                        "user_name": message_data.get("user_name"),
                        "message": message_data.get("message"),
                        "timestamp": message_data.get("timestamp").isoformat()
                        if message_data.get("timestamp")
                        else None,
                    }
                )

            # Reverse to get chronological order
            messages.reverse()

        except Exception as index_error:
            # If index error, return empty messages array
            logging.warning(f"Firestore index error for chat messages: {str(index_error)}")
            messages = []

        return jsonify({"success": True, "messages": messages})

    except Exception as e:
        logging.error(f"Error getting chat messages: {str(e)}")
        return jsonify({"error": "Failed to get messages"}), 500
