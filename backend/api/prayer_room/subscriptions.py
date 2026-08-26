"""prayer_room subscriptions routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
from backend.core.auth.decorators import verify_cloud_scheduler
from google.api_core.retry import Retry
import logging
from datetime import datetime, timedelta
import uuid
from google.cloud import firestore
from backend.api.prayer_room.helpers import (
    _expire_stale_voice_links,
    get_firestore_client,
    get_user_from_session,
    send_email,
)


@prayer_room_bp.route("/reopen-room", methods=["POST"])
def reopen_room():
    """Reopen a previous room as a live session"""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json()
        original_room_id = data.get("original_room_id")

        if not original_room_id:
            return jsonify({"error": "Original room ID is required"}), 400

        db = get_firestore_client()

        # Get the original room data
        original_room_ref = db.collection("prayer_rooms").document(original_room_id)
        original_room_doc = original_room_ref.get()

        if not original_room_doc.exists:
            return jsonify({"error": "Original room not found"}), 404

        original_room_data = original_room_doc.to_dict()

        # Check if user is the original host
        if original_room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the original host can reopen rooms"}), 403

        # Generate new room ID
        new_room_id = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])

        # Create new room with same settings
        new_room_data = {
            "room_id": new_room_id,
            "room_name": original_room_data.get("room_name", "Prayer Room"),
            "room_description": original_room_data.get("room_description", ""),
            "room_privacy": original_room_data.get("room_privacy", "public"),
            "host_id": user["user_id"],
            "host_name": user["user_name"],
            "created_at": datetime.utcnow(),
            "last_activity": datetime.utcnow(),
            "participants": [
                {
                    "user_id": user["user_id"],
                    "user_name": user["user_name"],
                    "joined_at": datetime.utcnow(),
                    "is_muted": False,
                    "is_host": True,
                }
            ],
            "is_active": True,
            "is_locked": False,
            "settings": {
                "allow_anonymous": original_room_data.get("room_privacy", "public") == "public",
                "max_participants": 50,
                "auto_mute_new_participants": False,
            },
            "original_room_id": original_room_id,  # Track the original room
        }

        # Generate room code for private rooms
        if new_room_data["room_privacy"] == "private":
            new_room_data["room_code"] = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:8]])
        else:
            new_room_data["room_code"] = None

        # Deactivate any existing device sessions for this user across ALL rooms
        # This ensures users can only have one active session at a time
        # OPTIMIZED: Use collection group query for better performance
        try:
            sessions_query = (
                db.collection_group("device_sessions")
                .where("user_id", "==", user["user_id"])
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
                logging.info(f"Deactivated {session_count} existing session(s) for user {user['user_id']}")
        except Exception as e:
            logging.warning(f"Collection group query failed, using fallback: {e}")
            # Fallback: skip session deactivation if query fails

        # Save the new room
        db.collection("prayer_rooms").document(new_room_id).set(new_room_data)

        # Notify subscribers asynchronously (don't block room creation)
        try:
            from backend.api.prayer_room.scheduled import notify_subscribers_about_reopened_room

            notify_subscribers_about_reopened_room(
                original_room_id=original_room_id,
                new_room_id=new_room_id,
                room_name=new_room_data["room_name"],
                room_code=new_room_data.get("room_code"),
                host_name=user["user_name"],
            )
        except Exception as notify_error:
            logging.error(f"Error sending notifications (non-blocking): {str(notify_error)}")

        return jsonify(
            {
                "success": True,
                "room_id": new_room_id,
                "room_code": new_room_data.get("room_code"),
                "room_name": new_room_data["room_name"],
            }
        )

    except Exception as e:
        logging.error(f"Error reopening room: {str(e)}")
        return jsonify({"error": "Failed to reopen room"}), 500


@prayer_room_bp.route("/<room_id>/subscribe", methods=["POST"])
def subscribe_to_room(room_id):
    """Subscribe to room notifications"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get room info
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()
        original_room_id = room_data.get("original_room_id", room_id)

        # Check if already subscribed
        existing_subs = (
            db.collection("room_subscriptions")
            .where("original_room_id", "==", original_room_id)
            .where("user_id", "==", user["user_id"])
            .where("is_active", "==", True)
            .limit(1)
            .stream()
        )

        if list(existing_subs):
            return jsonify({"message": "Already subscribed", "subscribed": True}), 200

        # Create subscription
        subscription_data = {
            "room_id": room_id,
            "original_room_id": original_room_id,
            "user_id": user["user_id"],
            "user_email": user.get("email", ""),
            "user_name": user["user_name"],
            "room_name": room_data.get("room_name", "Prayer Room"),
            "host_id": room_data.get("host_id"),
            "host_name": room_data.get("host_name"),
            "subscribed_at": datetime.utcnow(),
            "is_active": True,
            "notification_preferences": {"email": True, "push": False},
        }

        db.collection("room_subscriptions").add(subscription_data)

        logging.info(f"User {user['user_id']} subscribed to room {room_id}")

        return jsonify(
            {"success": True, "message": "Successfully subscribed to room notifications", "subscribed": True}
        )

    except Exception as e:
        logging.error(f"Error subscribing to room: {str(e)}")
        return jsonify({"error": "Failed to subscribe"}), 500


@prayer_room_bp.route("/<room_id>/unsubscribe", methods=["POST"])
def unsubscribe_from_room(room_id):
    """Unsubscribe from room notifications"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get room's original_room_id
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if room_doc.exists:
            original_room_id = room_doc.to_dict().get("original_room_id", room_id)
        else:
            original_room_id = room_id

        # Find and deactivate subscriptions
        subscriptions = (
            db.collection("room_subscriptions")
            .where("original_room_id", "==", original_room_id)
            .where("user_id", "==", user["user_id"])
            .where("is_active", "==", True)
            .stream()
        )

        unsubscribed_count = 0
        for sub_doc in subscriptions:
            sub_doc.reference.update({"is_active": False, "unsubscribed_at": datetime.utcnow()})
            unsubscribed_count += 1

        logging.info(f"User {user['user_id']} unsubscribed from room {room_id}")

        return jsonify(
            {"success": True, "message": "Successfully unsubscribed from room notifications", "subscribed": False}
        )

    except Exception as e:
        logging.error(f"Error unsubscribing from room: {str(e)}")
        return jsonify({"error": "Failed to unsubscribe"}), 500


@prayer_room_bp.route("/<room_id>/subscription-status", methods=["GET"])
def get_subscription_status(room_id):
    """Check if user is subscribed to room"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"subscribed": False})

        db = get_firestore_client()

        # Get room's original_room_id
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if room_doc.exists:
            original_room_id = room_doc.to_dict().get("original_room_id", room_id)
        else:
            original_room_id = room_id

        # Check if subscribed
        subscriptions = (
            db.collection("room_subscriptions")
            .where("original_room_id", "==", original_room_id)
            .where("user_id", "==", user["user_id"])
            .where("is_active", "==", True)
            .limit(1)
            .stream()
        )

        subscribed = len(list(subscriptions)) > 0

        return jsonify({"subscribed": subscribed, "user_id": user["user_id"]})

    except Exception as e:
        logging.error(f"Error checking subscription status: {str(e)}")
        return jsonify({"subscribed": False}), 500


@prayer_room_bp.route("/unsubscribe-link", methods=["GET"])
def unsubscribe_via_email_link():
    """Unsubscribe from room via email link (no auth required)"""
    try:
        sub_id = request.args.get("sub_id")

        if not sub_id:
            return "Invalid unsubscribe link", 400

        db = get_firestore_client()
        sub_ref = db.collection("room_subscriptions").document(sub_id)
        sub_doc = sub_ref.get()

        if not sub_doc.exists:
            return "Subscription not found", 404

        sub_data = sub_doc.to_dict()
        room_name = sub_data.get("room_name", "Prayer Room")

        # Deactivate subscription
        sub_ref.update({"is_active": False, "unsubscribed_at": datetime.utcnow()})

        logging.info(f"User unsubscribed via email link: {sub_id}")

        # Return a simple HTML page
        return (
            f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Unsubscribed - Divine Bridge</title>
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                }}
                .container {{
                    background: white;
                    padding: 50px;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.1);
                    text-align: center;
                    max-width: 500px;
                }}
                h1 {{
                    color: #0f56ff;
                    margin-bottom: 20px;
                }}
                p {{
                    color: #666;
                    line-height: 1.6;
                    margin-bottom: 30px;
                }}
                .button {{
                    display: inline-block;
                    padding: 12px 30px;
                    background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 50px;
                    font-weight: 600;
                    margin-top: 20px;
                }}
                .emoji {{
                    font-size: 48px;
                    margin-bottom: 20px;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="emoji">✓</div>
                <h1>Unsubscribed Successfully</h1>
                <p>You've been unsubscribed from <strong>{room_name}</strong> notifications.</p>
                <p>You won't receive any more emails when this room reopens.</p>
                <p>If you change your mind, you can always resubscribe by joining the room and clicking the subscribe button.</p>
                <a href="/" class="button">Return to Divine Bridge</a>
            </div>
        </body>
        </html>
        """,
            200,
        )

    except Exception as e:
        logging.error(f"Error unsubscribing via link: {str(e)}")
        return "An error occurred", 500


def create_active_room_from_scheduled(scheduled_data, scheduled_room_id):
    """
    Create an active prayer room from scheduled room data
    Returns the new room_id
    """
    try:
        db = get_firestore_client()

        # Generate new room ID
        room_id = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])

        # Create active room data
        room_data = {
            "room_id": room_id,
            "room_name": scheduled_data.get("room_name", "Prayer Room"),
            "room_description": scheduled_data.get("room_description", ""),
            "room_privacy": scheduled_data.get("room_privacy", "public"),
            "room_code": scheduled_data.get("room_code"),
            "host_id": scheduled_data["host_id"],
            "host_name": scheduled_data["host_name"],
            "created_at": datetime.utcnow(),
            "last_activity": datetime.utcnow(),
            "participants": [
                {
                    "user_id": scheduled_data["host_id"],
                    "user_name": scheduled_data["host_name"],
                    "joined_at": datetime.utcnow(),
                    "is_muted": False,
                    "is_host": True,
                }
            ],
            "is_active": True,
            "is_locked": False,
            "scheduled_room_id": scheduled_room_id,  # Link back to scheduled room
            "settings": {
                "allow_anonymous": scheduled_data.get("room_privacy", "public") == "public",
                "max_participants": 50,
                "auto_mute_new_participants": False,
            },
        }

        # Save the active room
        db.collection("prayer_rooms").document(room_id).set(room_data)

        logging.info(f"Created active room {room_id} from scheduled room {scheduled_room_id}")

        return room_id

    except Exception as e:
        logging.error(f"Error creating active room from scheduled: {str(e)}")
        raise


def send_session_live_notifications(scheduled_data, room_id, scheduled_room_id):
    """
    Send email notifications that scheduled session is now live
    """
    try:
        room_name = scheduled_data.get("room_name", "Prayer Room")
        host_name = scheduled_data.get("host_name", "Host")
        room_code = scheduled_data.get("room_code")
        base_url = request.url_root.rstrip("/")

        # Build join URL
        join_url = f"{base_url}/prayer-room/join?room={room_id}"
        if room_code:
            join_url += f"&code={room_code}"

        # Send notification to host
        host_id = scheduled_data.get("host_id")
        if host_id:
            # Get host email from Firebase Auth
            try:
                import firebase_admin.auth

                host_user = firebase_admin.auth.get_user(host_id)
                host_email = host_user.email

                if host_email:
                    subject = f"🙏 {room_name} is Now Live!"
                    body = f"""
                    <html>
                    <head>
                        <style>
                            body {{
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                line-height: 1.6;
                                color: #333;
                                max-width: 600px;
                                margin: 0 auto;
                            }}
                            .header {{
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                padding: 30px;
                                text-align: center;
                                color: white;
                            }}
                            .content {{
                                padding: 30px;
                                background: #f8f9fa;
                            }}
                            .card {{
                                background: white;
                                border-radius: 10px;
                                padding: 25px;
                                margin: 20px 0;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }}
                            .button {{
                                display: inline-block;
                                padding: 15px 40px;
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                color: white !important;
                                text-decoration: none;
                                border-radius: 50px;
                                font-weight: 600;
                                font-size: 18px;
                                margin: 20px 0;
                            }}
                            .room-code {{
                                background: rgba(15, 86, 255, 0.1);
                                color: #0f56ff;
                                padding: 15px;
                                border-radius: 8px;
                                text-align: center;
                                font-size: 24px;
                                font-weight: bold;
                                letter-spacing: 3px;
                                margin: 15px 0;
                            }}
                            .footer {{
                                padding: 20px;
                                text-align: center;
                                color: #666;
                                font-size: 14px;
                            }}
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>🙏 Your Prayer Session is Live!</h1>
                        </div>
                        <div class="content">
                            <div class="card">
                                <h2>Hello {host_name}!</h2>
                                <p>Your scheduled prayer session <strong>{room_name}</strong> is now active and ready for participants.</p>
                                
                                {"<div class='room-code'>Room Code: " + room_code + "</div>" if room_code else ""}
                                
                                <div style="text-align: center;">
                                    <a href="{join_url}" class="button">
                                        Join Your Room Now
                                    </a>
                                </div>
                                
                                <p style="margin-top: 20px; color: #666; font-size: 14px;">
                                    Your participants will be notified that the session is live.
                                </p>
                                
                                <p style="color: #666; font-size: 14px;">
                                    🌟 <em>"For where two or three gather in my name, there am I with them." - Matthew 18:20</em>
                                </p>
                            </div>
                        </div>
                        <div class="footer">
                            <p>Divine Bridge - Connecting Hearts in Prayer</p>
                        </div>
                    </body>
                    </html>
                    """

                    send_email(host_email, subject, body)
                    logging.info(f"Sent session live notification to host {host_email}")

            except Exception as e:
                logging.error(f"Error sending notification to host: {str(e)}")

        # Notify RSVPed participants
        try:
            db = get_firestore_client()
            rsvps = (
                db.collection("scheduled_room_rsvps")
                .where("scheduled_room_id", "==", scheduled_room_id)
                .where("is_active", "==", True)
                .stream()
            )

            for rsvp_doc in rsvps:
                rsvp_data = rsvp_doc.to_dict()

                # Skip if user doesn't want live notifications
                if not rsvp_data.get("reminder_preferences", {}).get("email_live", True):
                    continue

                user_email = rsvp_data.get("user_email")
                user_name = rsvp_data.get("user_name", "Prayer Partner")
                rsvp_status = rsvp_data.get("rsvp_status", "interested")

                if user_email:
                    subject = f"🙏 {room_name} is Live Now!"
                    body = f"""
                    <html>
                    <head>
                        <style>
                            body {{
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                line-height: 1.6;
                                color: #333;
                                max-width: 600px;
                                margin: 0 auto;
                            }}
                            .header {{
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                padding: 30px;
                                text-align: center;
                                color: white;
                            }}
                            .content {{
                                padding: 30px;
                                background: #f8f9fa;
                            }}
                            .card {{
                                background: white;
                                border-radius: 10px;
                                padding: 25px;
                                margin: 20px 0;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }}
                            .button {{
                                display: inline-block;
                                padding: 15px 40px;
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                color: white !important;
                                text-decoration: none;
                                border-radius: 50px;
                                font-weight: 600;
                                font-size: 18px;
                                margin: 20px 0;
                            }}
                            .badge {{
                                display: inline-block;
                                padding: 8px 16px;
                                background: rgba(15, 86, 255, 0.1);
                                color: #0f56ff;
                                border-radius: 20px;
                                font-size: 14px;
                                font-weight: 600;
                                margin: 10px 0;
                            }}
                            .footer {{
                                padding: 20px;
                                text-align: center;
                                color: #666;
                                font-size: 14px;
                            }}
                            .unsubscribe {{
                                font-size: 12px;
                                color: #999;
                                margin-top: 20px;
                            }}
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>🙏 Your Prayer Session is Live!</h1>
                        </div>
                        <div class="content">
                            <div class="card">
                                <h2>Hello {user_name}!</h2>
                                <p>The prayer session you RSVPed to is now live and ready to join.</p>
                                
                                <div style="margin: 20px 0;">
                                    <strong style="font-size: 20px; color: #0f56ff;">{room_name}</strong><br>
                                    <span style="color: #666;">Hosted by {host_name}</span>
                                </div>
                                
                                <div class="badge">Your Status: {rsvp_status.title()}</div>
                                
                                <div style="text-align: center;">
                                    <a href="{join_url}" class="button">
                                        Join the Room Now
                                    </a>
                                </div>
                                
                                <p style="margin-top: 20px; color: #666; font-size: 14px;">
                                    Don't keep your prayer partners waiting! Click the button above to join the session.
                                </p>
                                
                                <p style="color: #666; font-size: 14px;">
                                    🌟 <em>"For where two or three gather in my name, there am I with them." - Matthew 18:20</em>
                                </p>
                            </div>
                        </div>
                        <div class="footer">
                            <p>Divine Bridge - Connecting Hearts in Prayer</p>
                            <p class="unsubscribe">
                                You received this email because you RSVPed to this prayer session.
                            </p>
                        </div>
                    </body>
                    </html>
                    """

                    send_email(user_email, subject, body)
                    logging.info(f"Sent session live notification to RSVPed user {user_email}")

        except Exception as rsvp_notify_error:
            logging.error(f"Error notifying RSVPed participants (non-blocking): {str(rsvp_notify_error)}")

    except Exception as e:
        logging.error(f"Error in send_session_live_notifications: {str(e)}")
        # Don't raise - this is a non-critical background task


@prayer_room_bp.route("/send-session-reminders", methods=["POST"])
@verify_cloud_scheduler()
def send_session_reminders():
    """
    Send reminder emails to RSVPed users for sessions starting in 1 hour
    Triggered by Cloud Scheduler every 15 minutes
    Protected by Cloud Scheduler verification
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()

        # Find sessions starting in approximately 1 hour (55-65 minutes from now)
        one_hour_from_now = now + timedelta(hours=1)
        window_start = one_hour_from_now - timedelta(minutes=5)
        window_end = one_hour_from_now + timedelta(minutes=5)

        logging.info(f"Checking for sessions starting between {window_start} and {window_end}")

        scheduled_rooms = (
            db.collection("scheduled_rooms")
            .where("status", "==", "scheduled")
            .where("scheduled_time", ">=", window_start)
            .where("scheduled_time", "<=", window_end)
            .stream()
        )

        reminded_count = 0
        errors = []

        for scheduled_doc in scheduled_rooms:
            try:
                scheduled_data = scheduled_doc.to_dict()
                scheduled_room_id = scheduled_doc.id
                room_name = scheduled_data.get("room_name", "Prayer Room")
                host_name = scheduled_data.get("host_name", "Host")
                scheduled_time = scheduled_data.get("scheduled_time")
                scheduled_data.get("room_code")
                base_url = request.url_root.rstrip("/")

                # Check if we already sent reminders for this session
                if scheduled_data.get("reminders_sent"):
                    logging.info(f"Reminders already sent for {scheduled_room_id}")
                    continue

                # Build join URL (will work when room activates)
                join_url = f"{base_url}/prayer-room"

                # Get all RSVPs
                rsvps = (
                    db.collection("scheduled_room_rsvps")
                    .where("scheduled_room_id", "==", scheduled_room_id)
                    .where("is_active", "==", True)
                    .stream()
                )

                email_count = 0
                for rsvp_doc in rsvps:
                    rsvp_data = rsvp_doc.to_dict()

                    # Skip if user doesn't want 1-hour reminders
                    if not rsvp_data.get("reminder_preferences", {}).get("email_1hour", True):
                        continue

                    user_email = rsvp_data.get("user_email")
                    user_name = rsvp_data.get("user_name", "Prayer Partner")
                    rsvp_status = rsvp_data.get("rsvp_status", "interested")

                    if user_email:
                        subject = f"⏰ Reminder: {room_name} starts in 1 hour"

                        time_display = (
                            scheduled_time.strftime("%I:%M %p") if hasattr(scheduled_time, "strftime") else "soon"
                        )

                        body = f"""
                        <html>
                        <head>
                            <style>
                                body {{
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                    line-height: 1.6;
                                    color: #333;
                                    max-width: 600px;
                                    margin: 0 auto;
                                }}
                                .header {{
                                    background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                    padding: 30px;
                                    text-align: center;
                                    color: white;
                                }}
                                .content {{
                                    padding: 30px;
                                    background: #f8f9fa;
                                }}
                                .card {{
                                    background: white;
                                    border-radius: 10px;
                                    padding: 25px;
                                    margin: 20px 0;
                                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                                }}
                                .button {{
                                    display: inline-block;
                                    padding: 15px 40px;
                                    background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                    color: white !important;
                                    text-decoration: none;
                                    border-radius: 50px;
                                    font-weight: 600;
                                    font-size: 18px;
                                    margin: 20px 0;
                                }}
                                .time-badge {{
                                    display: inline-block;
                                    padding: 12px 20px;
                                    background: rgba(15, 86, 255, 0.1);
                                    color: #0f56ff;
                                    border-radius: 10px;
                                    font-size: 24px;
                                    font-weight: 700;
                                    margin: 15px 0;
                                }}
                                .status-badge {{
                                    display: inline-block;
                                    padding: 8px 16px;
                                    background: rgba(16, 185, 129, 0.1);
                                    color: #10b981;
                                    border-radius: 20px;
                                    font-size: 14px;
                                    font-weight: 600;
                                    margin: 10px 0;
                                }}
                                .footer {{
                                    padding: 20px;
                                    text-align: center;
                                    color: #666;
                                    font-size: 14px;
                                }}
                            </style>
                        </head>
                        <body>
                            <div class="header">
                                <h1>⏰ Starting Soon!</h1>
                            </div>
                            <div class="content">
                                <div class="card">
                                    <h2>Hello {user_name}!</h2>
                                    <p>Your prayer session is starting in about <strong>1 hour</strong>.</p>
                                    
                                    <div style="margin: 20px 0; text-align: center;">
                                        <strong style="font-size: 20px; color: #0f56ff;">{room_name}</strong><br>
                                        <span style="color: #666;">Hosted by {host_name}</span>
                                        <div class="time-badge">⏰ {time_display}</div>
                                        <div class="status-badge">✓ You're {rsvp_status.title()}</div>
                                    </div>
                                    
                                    <p style="text-align: center; color: #666;">
                                        Get ready to join! The room will be available at the scheduled time.
                                    </p>
                                    
                                    <div style="text-align: center;">
                                        <a href="{join_url}" class="button">
                                            View Prayer Rooms
                                        </a>
                                    </div>
                                    
                                    <p style="margin-top: 20px; color: #666; font-size: 14px; text-align: center;">
                                        We'll send you another notification when the session goes live.
                                    </p>
                                    
                                    <p style="color: #666; font-size: 14px; text-align: center;">
                                        🌟 <em>"Be joyful in hope, patient in affliction, faithful in prayer." - Romans 12:12</em>
                                    </p>
                                </div>
                            </div>
                            <div class="footer">
                                <p>Divine Bridge - Connecting Hearts in Prayer</p>
                            </div>
                        </body>
                        </html>
                        """

                        send_email(user_email, subject, body)
                        email_count += 1
                        logging.info(f"Sent 1-hour reminder to {user_email} for session {scheduled_room_id}")

                # Mark this session as having reminders sent
                scheduled_doc.reference.update({"reminders_sent": True, "reminders_sent_at": now})

                if email_count > 0:
                    reminded_count += 1
                    logging.info(f"Sent {email_count} reminder emails for session {scheduled_room_id}")

            except Exception as session_error:
                error_msg = f"Error sending reminders for session {scheduled_doc.id}: {str(session_error)}"
                logging.error(error_msg)
                errors.append(error_msg)
                continue

        result = {"success": True, "timestamp": now.isoformat(), "sessions_reminded": reminded_count}

        if errors:
            result["errors"] = errors

        logging.info(f"Reminder check complete: {reminded_count} sessions processed")

        return jsonify(result), 200

    except Exception as e:
        logging.error(f"Error in send_session_reminders: {str(e)}")
        return jsonify({"success": False, "error": str(e), "timestamp": datetime.utcnow().isoformat()}), 500


@prayer_room_bp.route("/activate-scheduled-rooms", methods=["POST"])
@verify_cloud_scheduler()
def activate_scheduled_rooms():
    """
    Check for scheduled rooms whose time has arrived and activate them
    Triggered by Cloud Scheduler every 5 minutes
    Protected by Cloud Scheduler verification
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()

        expired_voice_links = _expire_stale_voice_links(db, now)

        logging.info(f"Checking for scheduled rooms to activate at {now}")

        # Find scheduled rooms whose time has arrived (within last 10 minutes)
        # We check a 10-minute window to catch any that might have been missed
        ten_minutes_ago = now - timedelta(minutes=10)

        scheduled_rooms = (
            db.collection("scheduled_rooms")
            .where("status", "==", "scheduled")
            .where("scheduled_time", "<=", now)
            .where("scheduled_time", ">=", ten_minutes_ago)
            .stream()
        )

        activated_count = 0
        errors = []

        for scheduled_doc in scheduled_rooms:
            try:
                scheduled_data = scheduled_doc.to_dict()
                scheduled_room_id = scheduled_doc.id
                room_name = scheduled_data.get("room_name", "Prayer Room")

                logging.info(f"Activating scheduled room: {scheduled_room_id} - {room_name}")

                # Create active room
                room_id = create_active_room_from_scheduled(scheduled_data, scheduled_room_id)

                # Update scheduled room status
                scheduled_doc.reference.update({"status": "active", "activated_at": now, "active_room_id": room_id})

                # Send notifications (non-blocking)
                try:
                    send_session_live_notifications(scheduled_data, room_id, scheduled_room_id)
                except Exception as notify_error:
                    logging.error(f"Error sending notifications (non-blocking): {str(notify_error)}")

                activated_count += 1
                logging.info(f"Successfully activated {room_name} as room {room_id}")

            except Exception as room_error:
                error_msg = f"Error activating room {scheduled_doc.id}: {str(room_error)}"
                logging.error(error_msg)
                errors.append(error_msg)
                continue

        result = {
            "success": True,
            "timestamp": now.isoformat(),
            "activated_count": activated_count,
            "checked_rooms": activated_count + len(errors),
            "expired_voice_links": expired_voice_links,
        }

        if errors:
            result["errors"] = errors

        logging.info(f"Activation check complete: {activated_count} rooms activated")

        return jsonify(result), 200

    except Exception as e:
        logging.error(f"Error in activate_scheduled_rooms: {str(e)}")
        return jsonify({"success": False, "error": str(e), "timestamp": datetime.utcnow().isoformat()}), 500


@prayer_room_bp.route("/generate-recurring-instances", methods=["POST"])
@verify_cloud_scheduler()
def generate_recurring_instances():
    """
    Generate next instances of recurring sessions
    Triggered by Cloud Scheduler daily
    Protected by Cloud Scheduler verification
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()

        # Look ahead 7 days
        look_ahead_days = 7
        check_until = now + timedelta(days=look_ahead_days)

        logging.info(f"Generating recurring instances up to {check_until}")

        # Find all recurring sessions (both scheduled and active)
        # We need to check both statuses because:
        # - "scheduled" = not yet activated
        # - "active" = currently live (but still need to generate future instances)
        all_recurring = []

        # Get scheduled recurring sessions (exclude cancelled)
        scheduled_recurring = (
            db.collection("scheduled_rooms")
            .where("is_recurring", "==", True)
            .where("status", "==", "scheduled")
            .stream()
        )
        all_recurring.extend(list(scheduled_recurring))

        # Get active recurring sessions (parent sessions that are currently live)
        active_recurring = (
            db.collection("scheduled_rooms").where("is_recurring", "==", True).where("status", "==", "active").stream()
        )
        all_recurring.extend(list(active_recurring))

        # Filter out cancelled recurring sessions
        all_recurring = [doc for doc in all_recurring if doc.to_dict().get("status") != "cancelled"]

        logging.info(f"Found {len(all_recurring)} recurring sessions (scheduled + active)")

        recurring_sessions = all_recurring

        generated_count = 0
        errors = []

        for rec_doc in recurring_sessions:
            try:
                rec_data = rec_doc.to_dict()
                rec_id = rec_doc.id

                recurrence_pattern = rec_data.get("recurrence_pattern")
                recurrence_end_date = rec_data.get("recurrence_end_date")
                last_generated_time = rec_data.get("last_generated_time", rec_data.get("scheduled_time"))
                recurrence_days = rec_data.get("recurrence_days", [])

                # Normalize datetimes (remove timezone info for comparison)
                if hasattr(recurrence_end_date, "replace") and recurrence_end_date.tzinfo:
                    recurrence_end_date = recurrence_end_date.replace(tzinfo=None)

                # Stop if we've passed the end date
                if recurrence_end_date and now > recurrence_end_date:
                    logging.info(f"Recurring session {rec_id} has ended, skipping")
                    continue

                # Calculate next instance times
                next_times = []

                # Ensure current_check is a naive datetime for comparison
                if isinstance(last_generated_time, datetime):
                    current_check = (
                        last_generated_time.replace(tzinfo=None) if last_generated_time.tzinfo else last_generated_time
                    )
                elif hasattr(last_generated_time, "replace"):
                    # Firestore timestamp
                    current_check = (
                        last_generated_time.replace(tzinfo=None)
                        if hasattr(last_generated_time, "tzinfo") and last_generated_time.tzinfo
                        else last_generated_time
                    )
                else:
                    current_check = last_generated_time

                if recurrence_pattern == "weekly":
                    # Generate instances for next 7 days
                    for day in range(1, look_ahead_days + 1):
                        next_time = current_check + timedelta(days=day)

                        # Check if this day of week matches recurrence_days
                        if not recurrence_days or next_time.weekday() in recurrence_days:
                            # Ensure check_until is naive for comparison
                            check_until_naive = check_until.replace(tzinfo=None) if check_until.tzinfo else check_until
                            recurrence_end_naive = (
                                recurrence_end_date.replace(tzinfo=None)
                                if recurrence_end_date
                                and hasattr(recurrence_end_date, "tzinfo")
                                and recurrence_end_date.tzinfo
                                else recurrence_end_date
                            )

                            if next_time <= check_until_naive and (
                                not recurrence_end_naive or next_time <= recurrence_end_naive
                            ):
                                # Check if instance doesn't already exist
                                existing = (
                                    db.collection("scheduled_rooms")
                                    .where("parent_recurring_id", "==", rec_id)
                                    .where("scheduled_time", "==", next_time)
                                    .limit(1)
                                    .stream()
                                )

                                if not list(existing):
                                    next_times.append(next_time)

                elif recurrence_pattern == "biweekly":
                    # Every 2 weeks
                    next_time = current_check + timedelta(weeks=2)
                    while next_time <= check_until and (not recurrence_end_date or next_time <= recurrence_end_date):
                        existing = (
                            db.collection("scheduled_rooms")
                            .where("parent_recurring_id", "==", rec_id)
                            .where("scheduled_time", "==", next_time)
                            .limit(1)
                            .stream()
                        )

                        if not list(existing):
                            next_times.append(next_time)
                        next_time += timedelta(weeks=2)

                elif recurrence_pattern == "monthly":
                    # Same day each month
                    next_time = current_check
                    for month in range(1, 4):  # Look ahead 3 months
                        # Add one month
                        if next_time.month == 12:
                            next_time = next_time.replace(year=next_time.year + 1, month=1)
                        else:
                            next_month = next_time.month + 1
                            # Handle day not existing in next month (e.g., Jan 31 -> Feb 28)
                            try:
                                next_time = next_time.replace(month=next_month)
                            except ValueError:
                                # Day doesn't exist, use last day of month
                                if next_month == 2:
                                    next_time = next_time.replace(month=2, day=28)
                                else:
                                    next_time = next_time.replace(month=next_month, day=30)

                        if next_time <= check_until and (not recurrence_end_date or next_time <= recurrence_end_date):
                            existing = (
                                db.collection("scheduled_rooms")
                                .where("parent_recurring_id", "==", rec_id)
                                .where("scheduled_time", "==", next_time)
                                .limit(1)
                                .stream()
                            )

                            if not list(existing):
                                next_times.append(next_time)

                # Create instances
                for next_time in next_times:
                    instance_data = {
                        "room_name": rec_data["room_name"],
                        "room_description": rec_data.get("room_description", ""),
                        "room_privacy": rec_data.get("room_privacy", "public"),
                        "room_code": rec_data.get("room_code"),
                        "host_id": rec_data["host_id"],
                        "host_name": rec_data["host_name"],
                        "scheduled_time": next_time,
                        "created_at": now,
                        "status": "scheduled",
                        "is_recurring": False,  # This is an instance, not the template
                        "parent_recurring_id": rec_id,  # Link back to recurring template
                        "is_recurring_instance": True,
                    }

                    db.collection("scheduled_rooms").add(instance_data)
                    generated_count += 1
                    logging.info(f"Generated instance for {rec_data['room_name']} at {next_time}")

                # Update last_generated_time
                if next_times:
                    rec_doc.reference.update({"last_generated_time": max(next_times)})

            except Exception as session_error:
                error_msg = f"Error generating instances for session {rec_doc.id}: {str(session_error)}"
                logging.error(error_msg)
                errors.append(error_msg)
                continue

        result = {"success": True, "timestamp": now.isoformat(), "instances_generated": generated_count}

        if errors:
            result["errors"] = errors

        logging.info(f"Recurring instance generation complete: {generated_count} instances created")

        return jsonify(result), 200

    except Exception as e:
        logging.error(f"Error in generate_recurring_instances: {str(e)}")
        return jsonify({"success": False, "error": str(e), "timestamp": datetime.utcnow().isoformat()}), 500


@prayer_room_bp.route("/public-scheduled-sessions", methods=["GET"])
def get_public_scheduled_sessions():
    """
    Get all upcoming public scheduled sessions
    Available to all users (no auth required)
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()

        # Get query parameters
        time_filter = request.args.get("time", "all")  # today, tomorrow, week, all
        limit = int(request.args.get("limit", 20))
        sort_by = request.args.get("sort", "soonest")  # soonest, popular

        logging.info(f"Fetching public scheduled sessions - filter: {time_filter}, sort: {sort_by}, limit: {limit}")

        # Base query - only scheduled (not active/completed), only public
        # Note: This requires a composite index: status, room_privacy, scheduled_time
        try:
            query = (
                db.collection("scheduled_rooms")
                .where("status", "==", "scheduled")
                .where("room_privacy", "==", "public")
                .where("scheduled_time", ">=", now)
            )
        except Exception as query_error:
            logging.error(f"Firestore query error (may need composite index): {str(query_error)}")
            # Fallback: Query without scheduled_time filter, filter in Python
            query = (
                db.collection("scheduled_rooms")
                .where("status", "==", "scheduled")
                .where("room_privacy", "==", "public")
            )

        # Get all matching sessions
        sessions = []
        recurring_parents = {}  # Track recurring parent sessions

        for doc in query.stream():
            session_data = doc.to_dict()
            session_data["scheduled_room_id"] = doc.id

            # Check if this is a child instance of a recurring session
            parent_recurring_id = session_data.get("parent_recurring_id")
            if parent_recurring_id:
                # This is a child instance - convert timestamp before storing
                scheduled_time_obj = session_data.get("scheduled_time")
                scheduled_timestamp = None

                if scheduled_time_obj:
                    if hasattr(scheduled_time_obj, "timestamp"):
                        # Firestore timestamp
                        scheduled_timestamp = scheduled_time_obj.timestamp()
                    elif isinstance(scheduled_time_obj, datetime):
                        # Python datetime
                        if scheduled_time_obj.tzinfo is None:
                            # Naive datetime - assume UTC
                            scheduled_timestamp = (scheduled_time_obj - datetime(1970, 1, 1)).total_seconds()
                        else:
                            scheduled_timestamp = scheduled_time_obj.timestamp()
                    elif isinstance(scheduled_time_obj, (int, float)):
                        # Already a number
                        scheduled_timestamp = scheduled_time_obj

                session_data["scheduled_time"] = scheduled_timestamp
                session_data["scheduled_room_id"] = doc.id

                # This is a child instance - skip it, we'll show the parent instead
                if parent_recurring_id not in recurring_parents:
                    # Fetch the parent recurring session
                    parent_doc = db.collection("scheduled_rooms").document(parent_recurring_id).get()
                    if parent_doc.exists:
                        recurring_parents[parent_recurring_id] = {"doc": parent_doc, "instances": []}

                # Add this instance to the parent's instances list
                if parent_recurring_id in recurring_parents:
                    recurring_parents[parent_recurring_id]["instances"].append(session_data)
                continue  # Skip adding this instance to sessions

            session_data["scheduled_room_id"] = doc.id

            # Convert timestamp to seconds (Unix timestamp) for JSON
            scheduled_time_obj = session_data.get("scheduled_time")
            scheduled_timestamp = None

            if scheduled_time_obj:
                if hasattr(scheduled_time_obj, "timestamp"):
                    # Firestore timestamp
                    scheduled_timestamp = scheduled_time_obj.timestamp()
                elif isinstance(scheduled_time_obj, datetime):
                    # Python datetime

                    if scheduled_time_obj.tzinfo is None:
                        # Naive datetime - assume UTC
                        scheduled_timestamp = (scheduled_time_obj - datetime(1970, 1, 1)).total_seconds()
                    else:
                        scheduled_timestamp = scheduled_time_obj.timestamp()
                elif isinstance(scheduled_time_obj, (int, float)):
                    # Already a number (timestamp)
                    scheduled_timestamp = scheduled_time_obj

                # Filter out past sessions if query didn't filter by time
                if scheduled_timestamp and scheduled_timestamp < now.timestamp():
                    continue

                session_data["scheduled_time"] = scheduled_timestamp

            if hasattr(session_data.get("created_at"), "timestamp"):
                session_data["created_at"] = session_data["created_at"].timestamp()

            # Get RSVP count for this session
            rsvp_count = (
                db.collection("scheduled_room_rsvps")
                .where("scheduled_room_id", "==", doc.id)
                .where("is_active", "==", True)
                .stream()
            )

            rsvp_stats = {"going": 0, "maybe": 0, "interested": 0}
            for rsvp_doc in rsvp_count:
                rsvp_data = rsvp_doc.to_dict()
                status = rsvp_data.get("rsvp_status", "interested")
                rsvp_stats[status] = rsvp_stats.get(status, 0) + 1

            session_data["rsvp_count"] = rsvp_stats
            session_data["total_rsvps"] = sum(rsvp_stats.values())

            # Check if current user has RSVPed
            user = get_user_from_session()
            if user:
                user_rsvp = (
                    db.collection("scheduled_room_rsvps")
                    .where("scheduled_room_id", "==", doc.id)
                    .where("user_id", "==", user["user_id"])
                    .where("is_active", "==", True)
                    .limit(1)
                    .stream()
                )

                user_rsvp_list = list(user_rsvp)
                if user_rsvp_list:
                    session_data["user_rsvp_status"] = user_rsvp_list[0].to_dict().get("rsvp_status")
                else:
                    session_data["user_rsvp_status"] = None
            else:
                session_data["user_rsvp_status"] = None

            sessions.append(session_data)

        # Add recurring parent sessions with their instances
        for parent_id, parent_info in recurring_parents.items():
            parent_doc = parent_info["doc"]
            parent_data = parent_doc.to_dict()
            instances = parent_info["instances"]

            if not instances:
                continue  # No instances, skip

            # Sort instances by time
            instances.sort(key=lambda x: x.get("scheduled_time", 0))

            # Get the next (soonest) instance time
            next_instance = instances[0]
            next_instance_time = next_instance.get("scheduled_time")

            # Convert parent session data
            parent_session = {
                "scheduled_room_id": parent_id,
                "room_name": parent_data.get("room_name"),
                "room_description": parent_data.get("room_description"),
                "host_name": parent_data.get("host_name"),
                "host_id": parent_data.get("host_id"),
                "room_privacy": parent_data.get("room_privacy"),
                "is_recurring": True,
                "recurrence_pattern": parent_data.get("recurrence_pattern"),
                "recurrence_days": parent_data.get("recurrence_days", []),
                "scheduled_time": next_instance_time,  # Use next instance time for sorting
                "instance_count": len(instances),
                "instances": [
                    {"scheduled_time": inst.get("scheduled_time"), "scheduled_room_id": inst.get("scheduled_room_id")}
                    for inst in instances
                ],
            }

            # Get RSVP count across all instances
            total_rsvps = 0
            for instance in instances:
                instance_id = instance.get("scheduled_room_id")
                if instance_id:
                    rsvp_count = (
                        db.collection("scheduled_room_rsvps")
                        .where("scheduled_room_id", "==", instance_id)
                        .where("is_active", "==", True)
                        .stream()
                    )
                    total_rsvps += len(list(rsvp_count))

            parent_session["total_rsvps"] = total_rsvps
            parent_session["rsvp_count"] = {"going": 0, "maybe": 0, "interested": total_rsvps}

            # Check if current user has RSVPed to any instance
            user = get_user_from_session()
            if user:
                user_rsvp_status = None
                for instance in instances:
                    instance_id = instance.get("scheduled_room_id")
                    if instance_id:
                        user_rsvp = (
                            db.collection("scheduled_room_rsvps")
                            .where("scheduled_room_id", "==", instance_id)
                            .where("user_id", "==", user["user_id"])
                            .where("is_active", "==", True)
                            .limit(1)
                            .stream()
                        )

                        user_rsvp_list = list(user_rsvp)
                        if user_rsvp_list:
                            user_rsvp_status = user_rsvp_list[0].to_dict().get("rsvp_status")
                            break

                parent_session["user_rsvp_status"] = user_rsvp_status
            else:
                parent_session["user_rsvp_status"] = None

            sessions.append(parent_session)

        # Apply time filter
        if time_filter == "today":
            end_of_today = datetime.utcnow().replace(hour=23, minute=59, second=59)
            sessions = [s for s in sessions if s["scheduled_time"] <= end_of_today.timestamp()]
        elif time_filter == "tomorrow":
            start_of_tomorrow = (datetime.utcnow() + timedelta(days=1)).replace(hour=0, minute=0, second=0)
            end_of_tomorrow = start_of_tomorrow.replace(hour=23, minute=59, second=59)
            sessions = [
                s
                for s in sessions
                if start_of_tomorrow.timestamp() <= s["scheduled_time"] <= end_of_tomorrow.timestamp()
            ]
        elif time_filter == "week":
            end_of_week = datetime.utcnow() + timedelta(days=7)
            sessions = [s for s in sessions if s["scheduled_time"] <= end_of_week.timestamp()]

        # Sort
        if sort_by == "popular":
            sessions.sort(key=lambda x: x["total_rsvps"], reverse=True)
        else:  # soonest
            sessions.sort(key=lambda x: x["scheduled_time"])

        # Apply limit
        sessions = sessions[:limit]

        return jsonify(
            {
                "success": True,
                "sessions": sessions,
                "total": len(sessions),
                "filters": {"time": time_filter, "sort": sort_by},
            }
        )

    except Exception as e:
        logging.error(f"Error getting public scheduled sessions: {str(e)}")
        return jsonify({"error": "Failed to get sessions"}), 500


@prayer_room_bp.route("/scheduled-session/<scheduled_room_id>/rsvp", methods=["POST"])
def rsvp_to_scheduled_session(scheduled_room_id):
    """RSVP to a scheduled session"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json() or {}
        rsvp_status = data.get("rsvp_status", "interested")  # going, maybe, interested

        # Validate RSVP status
        if rsvp_status not in ["going", "maybe", "interested"]:
            return jsonify({"error": "Invalid RSVP status"}), 400

        db = get_firestore_client()

        # Get the scheduled room
        scheduled_room_ref = db.collection("scheduled_rooms").document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()

        if not scheduled_room_doc.exists:
            return jsonify({"error": "Scheduled session not found"}), 404

        scheduled_data = scheduled_room_doc.to_dict()

        # Check if already RSVPed
        existing_rsvp = (
            db.collection("scheduled_room_rsvps")
            .where("scheduled_room_id", "==", scheduled_room_id)
            .where("user_id", "==", user["user_id"])
            .limit(1)
            .stream()
        )

        existing_rsvp_list = list(existing_rsvp)

        if existing_rsvp_list:
            # Update existing RSVP
            existing_rsvp_list[0].reference.update(
                {"rsvp_status": rsvp_status, "updated_at": datetime.utcnow(), "is_active": True}
            )
            logging.info(f"Updated RSVP for user {user['user_id']} to session {scheduled_room_id}")
        else:
            # Create new RSVP
            rsvp_data = {
                "scheduled_room_id": scheduled_room_id,
                "user_id": user["user_id"],
                "user_email": user.get("email", ""),
                "user_name": user["user_name"],
                "room_name": scheduled_data.get("room_name"),
                "rsvp_status": rsvp_status,
                "rsvp_at": datetime.utcnow(),
                "is_active": True,
                "reminder_preferences": {
                    "email_1hour": data.get("reminder_1hour", True),
                    "email_live": data.get("reminder_live", True),
                },
            }

            db.collection("scheduled_room_rsvps").add(rsvp_data)
            logging.info(f"Created RSVP for user {user['user_id']} to session {scheduled_room_id}")

        # Get updated RSVP counts
        rsvp_count = (
            db.collection("scheduled_room_rsvps")
            .where("scheduled_room_id", "==", scheduled_room_id)
            .where("is_active", "==", True)
            .stream()
        )

        rsvp_stats = {"going": 0, "maybe": 0, "interested": 0}
        for rsvp_doc in rsvp_count:
            rsvp_data = rsvp_doc.to_dict()
            status = rsvp_data.get("rsvp_status", "interested")
            rsvp_stats[status] = rsvp_stats.get(status, 0) + 1

        return jsonify(
            {
                "success": True,
                "message": "RSVP confirmed",
                "rsvp_status": rsvp_status,
                "rsvp_count": rsvp_stats,
                "total_rsvps": sum(rsvp_stats.values()),
            }
        )

    except Exception as e:
        logging.error(f"Error creating RSVP: {str(e)}")
        return jsonify({"error": "Failed to RSVP"}), 500


@prayer_room_bp.route("/scheduled-session/<scheduled_room_id>/rsvp", methods=["DELETE"])
def remove_rsvp_from_scheduled_session(scheduled_room_id):
    """Remove RSVP from a scheduled session"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Find and deactivate RSVP
        rsvps = (
            db.collection("scheduled_room_rsvps")
            .where("scheduled_room_id", "==", scheduled_room_id)
            .where("user_id", "==", user["user_id"])
            .where("is_active", "==", True)
            .stream()
        )

        removed_count = 0
        for rsvp_doc in rsvps:
            rsvp_doc.reference.update({"is_active": False, "removed_at": datetime.utcnow()})
            removed_count += 1

        logging.info(f"Removed RSVP for user {user['user_id']} from session {scheduled_room_id}")

        return jsonify({"success": True, "message": "RSVP removed", "removed": removed_count > 0})

    except Exception as e:
        logging.error(f"Error removing RSVP: {str(e)}")
        return jsonify({"error": "Failed to remove RSVP"}), 500


@prayer_room_bp.route("/delete-room/<room_id>", methods=["DELETE"])
def delete_room(room_id):
    """Delete a room created by the current user"""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get the room to verify ownership
        room_ref = db.collection("prayer_rooms").document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404

        room_data = room_doc.to_dict()

        # Check if user is the host
        if room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the room creator can delete rooms"}), 403

        # Delete the room
        room_ref.delete()

        return jsonify({"success": True})

    except Exception as e:
        logging.error(f"Error deleting room: {str(e)}")
        return jsonify({"error": "Failed to delete room"}), 500


@prayer_room_bp.route("/update-scheduled-room/<scheduled_room_id>", methods=["PUT"])
def update_scheduled_room(scheduled_room_id):
    """Update a scheduled room"""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json()
        room_name = data.get("room_name")
        room_description = data.get("room_description", "")
        scheduled_time = data.get("scheduled_time")
        room_privacy = data.get("room_privacy", "public")

        if not room_name:
            return jsonify({"error": "Room name is required"}), 400

        if not scheduled_time:
            return jsonify({"error": "Scheduled time is required"}), 400

        # Validate room name length
        if len(room_name) > 50:
            return jsonify({"error": "Room name must be 50 characters or less"}), 400

        # Parse scheduled time - handle local timezone (same logic as schedule_room)
        try:
            # Get timezone offset from request (in minutes)
            timezone_offset_minutes = data.get("timezone_offset", 0)

            if "T" in scheduled_time and "+" not in scheduled_time and "Z" not in scheduled_time:
                # Parse as local datetime and convert to UTC
                # getTimezoneOffset() returns minutes to ADD to local time to get UTC
                local_datetime = datetime.fromisoformat(scheduled_time)
                from datetime import timedelta

                offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                scheduled_datetime = local_datetime + offset_timedelta
                logging.info(
                    f"Updated scheduled time - converted to UTC: {scheduled_datetime} (local: {local_datetime}, offset: {timezone_offset_minutes} minutes)"
                )
            else:
                # This has timezone info, parse normally
                scheduled_datetime = datetime.fromisoformat(scheduled_time.replace("Z", "+00:00"))
        except ValueError as e:
            logging.error(f"Invalid scheduled time format: {scheduled_time}, error: {e}")
            return jsonify({"error": "Invalid scheduled time format"}), 400

        # Check if scheduled time is in the future (using UTC)
        now_utc = datetime.utcnow()
        if scheduled_datetime <= now_utc:
            return jsonify({"error": "Scheduled time must be in the future"}), 400

        db = get_firestore_client()

        # Get the scheduled room to verify ownership
        scheduled_room_ref = db.collection("scheduled_rooms").document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()

        if not scheduled_room_doc.exists:
            return jsonify({"error": "Scheduled room not found"}), 404

        scheduled_room_data = scheduled_room_doc.to_dict()

        # Check if user is the host
        if scheduled_room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the room creator can update scheduled rooms"}), 403

        # Update the scheduled room
        update_data = {
            "room_name": room_name,
            "room_description": room_description,
            "room_privacy": room_privacy,
            "scheduled_time": scheduled_datetime,
            "updated_at": datetime.utcnow(),
        }

        # Generate new room code for private rooms if privacy changed
        if room_privacy == "private" and scheduled_room_data.get("room_privacy") != "private":
            update_data["room_code"] = "".join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])

        scheduled_room_ref.update(update_data)

        return jsonify(
            {
                "success": True,
                "room_code": update_data.get("room_code", scheduled_room_data.get("room_code")),
                "message": "Scheduled room updated successfully",
            }
        )

    except Exception as e:
        logging.error(f"Error updating scheduled room: {str(e)}")
        return jsonify({"error": "Failed to update scheduled room"}), 500


@prayer_room_bp.route("/join-scheduled/<scheduled_room_id>", methods=["GET"])
def join_scheduled_room(scheduled_room_id):
    """Join a scheduled room by its scheduled room ID"""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get the scheduled room
        scheduled_room_ref = db.collection("scheduled_rooms").document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()

        if not scheduled_room_doc.exists:
            return jsonify({"error": "Scheduled room not found"}), 404

        scheduled_room_data = scheduled_room_doc.to_dict()

        # Check if the scheduled time has passed
        scheduled_time = scheduled_room_data.get("scheduled_time")
        if scheduled_time:
            # Convert Firestore timestamp to datetime if needed
            if hasattr(scheduled_time, "timestamp"):
                scheduled_datetime = datetime.fromtimestamp(scheduled_time.timestamp())
            elif isinstance(scheduled_time, dict) and "_seconds" in scheduled_time:
                scheduled_datetime = datetime.fromtimestamp(scheduled_time["_seconds"])
            else:
                scheduled_datetime = scheduled_time

            if scheduled_datetime <= datetime.now():
                return jsonify({"error": "This scheduled session has already passed"}), 400

        # Redirect to the prayer room join page with the scheduled room info
        room_name = scheduled_room_data.get("room_name", "Scheduled Prayer Room")
        room_privacy = scheduled_room_data.get("room_privacy", "public")
        room_code = scheduled_room_data.get("room_code", "")

        # Create a redirect URL with the scheduled room information
        redirect_url = f"/prayer-room/join?room={scheduled_room_id}&name={room_name}&privacy={room_privacy}"
        if room_code:
            redirect_url += f"&code={room_code}"

        return jsonify(
            {
                "success": True,
                "redirect_url": redirect_url,
                "room_name": room_name,
                "scheduled_time": scheduled_room_data.get("scheduled_time"),
                "room_privacy": room_privacy,
                "room_code": room_code,
            }
        )

    except Exception as e:
        logging.error(f"Error joining scheduled room: {str(e)}")
        return jsonify({"error": "Failed to join scheduled room"}), 500


@prayer_room_bp.route("/cleanup", methods=["POST"])
@verify_cloud_scheduler()
def run_cleanup():
    """Run bounded cleanup for rooms that have been ended for at least an hour."""
    try:
        db = get_firestore_client()
        if not _acquire_cleanup_lease(db):
            return jsonify({"success": True, "skipped": "cleanup already running"}), 200
        # Run all cleanup functions
        sessions_cleaned = cleanup_inactive_sessions()
        signaling_cleaned = cleanup_signaling_artifacts()
        chat_cleaned = cleanup_old_chat_messages()

        total_cleaned = sessions_cleaned + signaling_cleaned + chat_cleaned

        return jsonify(
            {
                "success": True,
                "sessions_cleaned": sessions_cleaned,
                "signaling_cleaned": signaling_cleaned,
                "chat_cleaned": chat_cleaned,
                "total_cleaned": total_cleaned,
            }
        )

    except Exception as e:
        logging.error(f"Error running cleanup: {str(e)}")
        return jsonify({"error": "Failed to run cleanup"}), 500


def _acquire_cleanup_lease(db):
    lock_ref = db.collection("_locks").document("prayer-room-cleanup")

    @firestore.transactional
    def acquire(transaction):
        now = datetime.utcnow()
        snapshot = lock_ref.get(transaction=transaction)
        data = snapshot.to_dict() if snapshot.exists else {}
        held_until = data.get("held_until") if data else None
        if held_until and getattr(held_until, "tzinfo", None):
            held_until = held_until.replace(tzinfo=None)
        if held_until and held_until > now:
            return False
        transaction.set(lock_ref, {"held_until": now + timedelta(minutes=14), "acquired_at": now})
        return True

    return acquire(db.transaction())


@prayer_room_bp.route("/metrics", methods=["GET"])
def get_metrics():
    """Get basic metrics for monitoring"""
    try:
        db = get_firestore_client()

        # Count active rooms
        active_rooms = db.collection("prayer_rooms").where("is_active", "==", True).limit(1000).stream()
        active_room_count = len(list(active_rooms))

        # Count total participants across all active rooms
        total_participants = 0
        for room_doc in db.collection("prayer_rooms").where("is_active", "==", True).stream():
            room_data = room_doc.to_dict()
            participants = room_data.get("participants", [])
            total_participants += len(participants)

        # Count recent chat messages (last hour)
        from datetime import datetime, timedelta

        recent_cutoff = datetime.utcnow() - timedelta(hours=1)
        recent_messages = db.collection("chat_messages").where("timestamp", ">", recent_cutoff).limit(1000).stream()
        recent_message_count = len(list(recent_messages))

        return jsonify(
            {
                "active_rooms": active_room_count,
                "total_participants": total_participants,
                "recent_messages": recent_message_count,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )

    except Exception as e:
        logging.error(f"Error getting metrics: {str(e)}")
        return jsonify({"error": "Failed to get metrics"}), 500


def _ended_rooms_for_cleanup(db, limit=100):
    """Never sweep active calls; keep each maintenance invocation bounded."""
    cutoff = datetime.utcnow() - timedelta(hours=1)
    return list(
        db.collection("prayer_rooms")
        .where("is_active", "==", False)
        .where("ended_at", "<", cutoff)
        .order_by("ended_at")
        .limit(limit)
        .stream(retry=Retry())
    )


def cleanup_inactive_sessions():
    """Clean up inactive device sessions older than 1 hour.
    Batched deletes with per-room isolation."""
    try:
        db = get_firestore_client()
        cutoff_time = datetime.utcnow() - timedelta(hours=1)
        all_rooms = _ended_rooms_for_cleanup(db)

        cleaned_count = 0
        for room_doc in all_rooms:
            try:
                stale = []
                inactive_docs = (
                    room_doc.reference.collection("device_sessions")
                    .where("is_active", "==", False)
                    .stream(retry=Retry())
                )

                for session_doc in inactive_docs:
                    ended_at = session_doc.to_dict().get("ended_at")
                    if not ended_at:
                        continue
                    if hasattr(ended_at, "tzinfo") and ended_at.tzinfo is not None:
                        ended_at = ended_at.replace(tzinfo=None)
                    if ended_at < cutoff_time:
                        stale.append(session_doc.reference)

                for i in range(0, len(stale), 500):
                    batch = db.batch()
                    for ref in stale[i : i + 500]:
                        batch.delete(ref)
                    batch.commit()
                    cleaned_count += len(stale[i : i + 500])
            except Exception as room_err:
                logging.warning(f"Session cleanup skipped room {room_doc.id}: {room_err}")

        if cleaned_count:
            logging.info(f"Cleaned up {cleaned_count} inactive sessions")
        return cleaned_count

    except Exception as e:
        logging.error(f"Error cleaning up inactive sessions: {str(e)}")
        return 0


def cleanup_signaling_artifacts():
    """Clean up old WebRTC signaling artifacts (offers, answers, candidates).
    Uses batched deletes and per-room isolation so one slow room can't
    timeout the entire sweep."""
    try:
        db = get_firestore_client()
        cutoff_time = datetime.utcnow() - timedelta(minutes=30)

        all_rooms = _ended_rooms_for_cleanup(db)

        cleaned_count = 0
        subcollections = ("webrtc_offers", "webrtc_answers", "webrtc_candidates")

        for room_doc in all_rooms:
            for sub in subcollections:
                try:
                    stale_docs = list(
                        room_doc.reference.collection(sub)
                        .where("timestamp", "<", cutoff_time)
                        .limit(500)
                        .stream(retry=Retry())
                    )
                    if not stale_docs:
                        continue
                    for i in range(0, len(stale_docs), 500):
                        batch = db.batch()
                        for doc in stale_docs[i : i + 500]:
                            batch.delete(doc.reference)
                        batch.commit()
                        cleaned_count += len(stale_docs[i : i + 500])
                except Exception as sub_err:
                    logging.warning(f"Signaling cleanup skipped {sub} in room {room_doc.id}: {sub_err}")

        if cleaned_count:
            logging.info(f"Cleaned up {cleaned_count} signaling artifacts")
        return cleaned_count

    except Exception as e:
        logging.error(f"Error cleaning up signaling artifacts: {str(e)}")
        return 0


def cleanup_old_chat_messages():
    """Clean up old chat messages (keep last 1000 per room).
    Batched deletes with per-room isolation."""
    try:
        db = get_firestore_client()

        all_rooms = _ended_rooms_for_cleanup(db)

        cleaned_count = 0
        for room_doc in all_rooms:
            try:
                messages = list(
                    db.collection("chat_messages")
                    .where("room_id", "==", room_doc.id)
                    .order_by("timestamp", direction="DESCENDING")
                    .stream(retry=Retry())
                )
                if len(messages) <= 1000:
                    continue

                to_delete = messages[1000:]
                for i in range(0, len(to_delete), 500):
                    batch = db.batch()
                    for msg_doc in to_delete[i : i + 500]:
                        batch.delete(msg_doc.reference)
                    batch.commit()
                    cleaned_count += len(to_delete[i : i + 500])
            except Exception as room_err:
                logging.warning(f"Chat cleanup skipped room {room_doc.id}: {room_err}")

        if cleaned_count:
            logging.info(f"Cleaned up {cleaned_count} old chat messages")
        return cleaned_count

    except Exception as e:
        logging.error(f"Error cleaning up old chat messages: {str(e)}")
        return 0
