"""prayer_room scheduled routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import request, jsonify
import logging
from datetime import datetime
import uuid
import os
from backend.api.prayer_room.helpers import (
    get_firestore_client,
    get_user_from_session,
    send_email,
)


@prayer_room_bp.route("/schedule", methods=["POST"])
def schedule_room():
    """Schedule a prayer room for a future time"""
    try:
        user = get_user_from_session()

        if not user:
            logging.error("No user found in session for schedule request")
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json()
        logging.info(f"Schedule request data: {data}")

        room_name = data.get("room_name")
        room_description = data.get("room_description", "")
        scheduled_time = data.get("scheduled_time")
        room_privacy = data.get("room_privacy", "public")
        host_name = user.get("user_name", "Anonymous")

        logging.info(f"Parsed data - room_name: {room_name}, scheduled_time: {scheduled_time}")

        if not room_name:
            logging.error("Room name is missing")
            return jsonify({"error": "Room name is required"}), 400

        if not scheduled_time:
            logging.error("Scheduled time is missing")
            return jsonify({"error": "Scheduled time is required"}), 400

        # Validate room name length
        if len(room_name) > 50:
            logging.error(f"Room name too long: {len(room_name)} characters")
            return jsonify({"error": "Room name must be 50 characters or less"}), 400

        # Validate host name length
        if len(host_name) > 30:
            logging.error(f"Host name too long: {len(host_name)} characters")
            return jsonify({"error": "Host name must be 30 characters or less"}), 400

        # Parse scheduled time - handle local timezone
        try:
            # Get timezone offset from request (in minutes, negative for timezones ahead of UTC)
            timezone_offset_minutes = data.get("timezone_offset", 0)

            # The datetime-local input provides local time without timezone info
            # We need to convert it to UTC for storage
            if "T" in scheduled_time and "+" not in scheduled_time and "Z" not in scheduled_time:
                # This is a local datetime from datetime-local input
                # Parse it as naive datetime (no timezone info)
                local_datetime = datetime.fromisoformat(scheduled_time)
                logging.info(f"Parsed scheduled time (local): {local_datetime}")

                # Convert local time to UTC
                # getTimezoneOffset() returns minutes to ADD to local time to get UTC
                # For CST (UTC-6), it returns +360 (6 hours behind UTC)
                # So UTC = local + offset_minutes
                from datetime import timedelta

                offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                scheduled_datetime = local_datetime + offset_timedelta
                logging.info(
                    f"Converted to UTC: {scheduled_datetime} (local: {local_datetime}, offset: {timezone_offset_minutes} minutes = {timezone_offset_minutes/60} hours)"
                )
            else:
                # This has timezone info, parse normally
                scheduled_datetime = datetime.fromisoformat(scheduled_time.replace("Z", "+00:00"))
                logging.info(f"Parsed scheduled time (with timezone): {scheduled_datetime}")
        except ValueError as e:
            logging.error(f"Invalid scheduled time format: {scheduled_time}, error: {e}")
            return jsonify({"error": "Invalid scheduled time format"}), 400

        # Check if scheduled time is in the future (using UTC)
        now_utc = datetime.utcnow()
        if scheduled_datetime <= now_utc:
            logging.error(f"Scheduled time is in the past: {scheduled_datetime} UTC (current time: {now_utc} UTC)")
            return jsonify({"error": "Scheduled time must be in the future"}), 400

        db = get_firestore_client()

        # Get recurring pattern data
        is_recurring = data.get("is_recurring", False)
        recurrence_pattern = data.get("recurrence_pattern")  # 'weekly', 'biweekly', 'monthly'
        recurrence_end_date = data.get("recurrence_end_date")
        recurrence_days = data.get("recurrence_days", [])  # For weekly: [0, 2, 4] = Monday, Wednesday, Friday

        # Create scheduled room data
        scheduled_room_data = {
            "room_name": room_name,
            "room_description": room_description,
            "room_privacy": room_privacy,
            "host_id": user["user_id"],
            "host_name": host_name,
            "scheduled_time": scheduled_datetime,
            "created_at": datetime.utcnow(),
            "status": "scheduled",
            "is_recurring": is_recurring,
        }

        # Add recurring pattern data
        if is_recurring and recurrence_pattern:
            scheduled_room_data["recurrence_pattern"] = recurrence_pattern
            scheduled_room_data["recurrence_days"] = recurrence_days

            # Parse end date if provided (also convert to UTC if it's a date-only input)
            if recurrence_end_date:
                try:
                    # If it's a date-only input (YYYY-MM-DD), treat as local midnight
                    if "T" not in recurrence_end_date:
                        # Date only - set to midnight local time and convert to UTC
                        end_datetime_local = datetime.fromisoformat(recurrence_end_date + "T00:00")
                        offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                        end_datetime = end_datetime_local + offset_timedelta
                    elif (
                        "T" in recurrence_end_date and "+" not in recurrence_end_date and "Z" not in recurrence_end_date
                    ):
                        # datetime-local input - convert to UTC
                        end_datetime_local = datetime.fromisoformat(recurrence_end_date)
                        offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                        end_datetime = end_datetime_local + offset_timedelta
                    else:
                        # Has timezone info
                        end_datetime = datetime.fromisoformat(recurrence_end_date.replace("Z", "+00:00"))
                    scheduled_room_data["recurrence_end_date"] = end_datetime
                except ValueError:
                    logging.warning(f"Invalid recurrence end date: {recurrence_end_date}")

            # If no end date, default to 3 months from now
            if "recurrence_end_date" not in scheduled_room_data:
                scheduled_room_data["recurrence_end_date"] = scheduled_datetime + timedelta(days=90)

        # Generate room code for private rooms
        if room_privacy == "private":
            scheduled_room_data["room_code"] = "".join(
                [chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]]
            )

        # Save the scheduled room
        scheduled_room_ref = db.collection("scheduled_rooms").add(scheduled_room_data)
        scheduled_room_id = scheduled_room_ref[1].id

        logging.info(f"Successfully scheduled room: {scheduled_room_id}")

        return jsonify(
            {
                "success": True,
                "scheduled_room_id": scheduled_room_id,
                "room_code": scheduled_room_data.get("room_code"),
                "message": "Room scheduled successfully",
            }
        )

    except Exception as e:
        logging.error(f"Error scheduling room: {str(e)}")
        return jsonify({"error": "Failed to schedule room"}), 500


@prayer_room_bp.route("/my-scheduled-rooms", methods=["GET"])
def get_my_scheduled_rooms():
    """Get all scheduled rooms created by the current user"""
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get scheduled rooms created by this user (simplified query to avoid composite index)
        scheduled_rooms_ref = db.collection("scheduled_rooms").where("host_id", "==", user["user_id"]).limit(50)

        scheduled_rooms = []
        for doc in scheduled_rooms_ref.stream():
            room_data = doc.to_dict()
            room_data["scheduled_room_id"] = doc.id
            # Convert Firestore timestamps to ISO strings
            if "scheduled_time" in room_data and hasattr(room_data["scheduled_time"], "timestamp"):
                room_data["scheduled_time"] = room_data["scheduled_time"].timestamp()
            if "created_at" in room_data and hasattr(room_data["created_at"], "timestamp"):
                room_data["created_at"] = room_data["created_at"].timestamp()
            scheduled_rooms.append(room_data)

        # Sort by scheduled_time in Python (since we can't order_by in the query)
        scheduled_rooms.sort(key=lambda x: x.get("scheduled_time", 0), reverse=False)

        # Filter out past scheduled meetings and cancelled rooms
        now = datetime.now().timestamp()
        future_scheduled_rooms = [
            room
            for room in scheduled_rooms
            if room.get("scheduled_time", 0) > now and room.get("status") != "cancelled"
        ]

        return jsonify({"scheduled_rooms": future_scheduled_rooms})

    except Exception as e:
        logging.error(f"Error getting scheduled rooms: {str(e)}")
        return jsonify({"error": "Failed to get scheduled rooms"}), 500


@prayer_room_bp.route("/scheduled-room/<scheduled_room_id>", methods=["DELETE"])
def cancel_scheduled_room(scheduled_room_id):
    """Cancel a scheduled room

    Handles both regular scheduled rooms and recurring sessions:
    - If canceling a recurring parent (is_recurring=True), cancels all future instances
    - If canceling a recurring instance (is_recurring_instance=True), can cancel:
      * Just this instance (default)
      * Entire series (if cancel_all=true query parameter)
    """
    try:
        user = get_user_from_session()

        if not user:
            return jsonify({"error": "Authentication required"}), 401

        db = get_firestore_client()

        # Get query parameter for canceling entire series
        cancel_all = request.args.get("cancel_all", "false").lower() == "true"

        # Get the scheduled room
        scheduled_room_ref = db.collection("scheduled_rooms").document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()

        if not scheduled_room_doc.exists:
            return jsonify({"error": "Scheduled room not found"}), 404

        scheduled_room_data = scheduled_room_doc.to_dict()

        # Check if user is the host
        if scheduled_room_data.get("host_id") != user["user_id"]:
            return jsonify({"error": "Only the host can cancel scheduled rooms"}), 403

        is_recurring = scheduled_room_data.get("is_recurring", False)
        is_recurring_instance = scheduled_room_data.get("is_recurring_instance", False)
        parent_recurring_id = scheduled_room_data.get("parent_recurring_id")

        # Import timezone for timezone-aware datetime comparisons
        from datetime import timezone

        # Handle recurring session cancellation
        if is_recurring:
            # This is a recurring parent - cancel all future instances
            logging.info(f"Canceling recurring parent session {scheduled_room_id}")

            # Find all future instances linked to this parent
            # Query by parent_recurring_id only, then filter by status and scheduled_time in Python
            # This avoids needing any composite index
            now = datetime.now(timezone.utc)
            all_instances = (
                db.collection("scheduled_rooms").where("parent_recurring_id", "==", scheduled_room_id).stream()
            )

            instances_canceled = 0
            for instance_doc in all_instances:
                instance_data = instance_doc.to_dict()

                # Filter by status in Python
                if instance_data.get("status") != "scheduled":
                    continue

                instance_time = instance_data.get("scheduled_time")

                # Handle Firestore timestamp conversion
                if instance_time:
                    # Convert Firestore Timestamp to datetime if needed
                    if hasattr(instance_time, "timestamp") and callable(getattr(instance_time, "timestamp", None)):
                        # Firestore Timestamp object
                        instance_time = datetime.fromtimestamp(instance_time.timestamp(), tz=timezone.utc)
                    elif isinstance(instance_time, datetime):
                        # Already a datetime object
                        if instance_time.tzinfo is None:
                            instance_time = instance_time.replace(tzinfo=timezone.utc)
                    else:
                        # Skip if we can't convert
                        logging.warning(
                            f"Could not convert scheduled_time for instance {instance_doc.id}: {type(instance_time)}"
                        )
                        continue

                    # Only delete future instances
                    if instance_time > now:
                        instance_doc.reference.delete()
                        instances_canceled += 1

            # Mark the parent as cancelled (don't delete, so we can track it)
            scheduled_room_ref.update({"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)})

            logging.info(f"Cancelled recurring parent {scheduled_room_id} and {instances_canceled} future instances")
            return jsonify({"success": True, "recurring_parent": True, "instances_canceled": instances_canceled})

        elif is_recurring_instance and cancel_all:
            # Cancel entire recurring series by canceling the parent
            if not parent_recurring_id:
                logging.error(f"Recurring instance {scheduled_room_id} has no parent_recurring_id")
                return jsonify({"error": "Parent recurring session not found"}), 404

            parent_ref = db.collection("scheduled_rooms").document(parent_recurring_id)
            parent_doc = parent_ref.get()

            if not parent_doc.exists:
                logging.error(f"Parent recurring session {parent_recurring_id} not found in database")
                return jsonify({"error": "Parent recurring session not found"}), 404

            parent_data = parent_doc.to_dict()

            # Verify user owns the parent
            if parent_data.get("host_id") != user["user_id"]:
                return jsonify({"error": "Only the host can cancel the entire series"}), 403

            # Cancel all future instances (including the current one if it's in the future)
            now = datetime.now(timezone.utc)
            try:
                # Get current instance's scheduled time to check if it's in the future
                current_instance_time = scheduled_room_data.get("scheduled_time")
                # Handle both timezone-aware and naive datetimes
                if current_instance_time:
                    # If current_instance_time is naive, make it timezone-aware
                    if current_instance_time.tzinfo is None:
                        current_instance_time = current_instance_time.replace(tzinfo=timezone.utc)
                    current_is_future = current_instance_time > now
                else:
                    current_is_future = False

                # Query for all instances by parent_recurring_id only, then filter by status and scheduled_time in Python
                # This avoids needing any composite index
                all_instances_query = (
                    db.collection("scheduled_rooms").where("parent_recurring_id", "==", parent_recurring_id).stream()
                )

                instances_canceled = 0
                instance_ids_to_delete = []
                for instance_doc in all_instances_query:
                    instance_data = instance_doc.to_dict()

                    # Filter by status in Python
                    if instance_data.get("status") != "scheduled":
                        continue

                    instance_time = instance_data.get("scheduled_time")

                    # Handle Firestore timestamp conversion
                    if instance_time:
                        # Convert Firestore Timestamp to datetime if needed
                        if hasattr(instance_time, "timestamp") and callable(getattr(instance_time, "timestamp", None)):
                            # Firestore Timestamp object
                            instance_time = datetime.fromtimestamp(instance_time.timestamp(), tz=timezone.utc)
                        elif isinstance(instance_time, datetime):
                            # Already a datetime object
                            if instance_time.tzinfo is None:
                                instance_time = instance_time.replace(tzinfo=timezone.utc)
                        else:
                            # Skip if we can't convert
                            logging.warning(
                                f"Could not convert scheduled_time for instance {instance_doc.id}: {type(instance_time)}"
                            )
                            continue

                        # Only include future instances
                        if instance_time > now:
                            instance_ids_to_delete.append(instance_doc.id)
                            instances_canceled += 1

                # Delete all future instances
                for instance_id in instance_ids_to_delete:
                    db.collection("scheduled_rooms").document(instance_id).delete()

                # Delete the current instance if it's not already included in future instances
                # (i.e., if it's in the past or present)
                if scheduled_room_id not in instance_ids_to_delete:
                    scheduled_room_ref.delete()
                    # Current instance was separate, so we count it separately
                    # (it's not a "future" instance, but we still canceled it)

                # Mark the parent as cancelled
                parent_ref.update({"status": "cancelled", "cancelled_at": datetime.now(timezone.utc)})

                logging.info(
                    f"Cancelled entire recurring series {parent_recurring_id} and {instances_canceled} future instances (current instance {'included' if current_is_future else 'separate'})"
                )
                return jsonify(
                    {"success": True, "recurring_series_canceled": True, "instances_canceled": instances_canceled}
                )
            except Exception as query_error:
                logging.error(f"Error querying/deleting future instances: {str(query_error)}", exc_info=True)
                raise

        else:
            # Regular scheduled room or single recurring instance
            scheduled_room_ref.delete()
            return jsonify({"success": True})

    except Exception as e:
        import traceback

        error_trace = traceback.format_exc()
        logging.error(f"Error canceling scheduled room {scheduled_room_id}: {str(e)}\n{error_trace}")
        # Include error details in development for debugging
        error_message = "Failed to cancel scheduled room"
        if os.getenv("FLASK_ENV") != "production":
            error_message = f"Failed to cancel scheduled room: {str(e)}"
        return jsonify({"error": error_message}), 500


def notify_subscribers_about_reopened_room(original_room_id, new_room_id, room_name, room_code, host_name):
    """Send email notifications to room subscribers when room is reopened"""
    try:
        db = get_firestore_client()

        # Get all active subscribers for this room
        subscriptions = (
            db.collection("room_subscriptions")
            .where("original_room_id", "==", original_room_id)
            .where("is_active", "==", True)
            .where("notification_preferences.email", "==", True)
            .stream()
        )

        subscriber_count = 0
        base_url = request.url_root.rstrip("/")

        for sub_doc in subscriptions:
            try:
                sub_data = sub_doc.to_dict()
                user_email = sub_data.get("user_email")
                user_name = sub_data.get("user_name", "Friend")

                if not user_email:
                    continue

                # Build join URL
                join_url = f"{base_url}/prayer-room/join?room={new_room_id}"
                if room_code:
                    join_url += f"&code={room_code}"

                # Build unsubscribe URL (using subscription document ID)
                unsubscribe_url = f"{base_url}/prayer-room/unsubscribe-link?sub_id={sub_doc.id}"

                # Email subject
                subject = f"🙏 {room_name} is Live! Join the Prayer Session"

                # Email body
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
                            font-size: 16px;
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
                        .unsubscribe {{
                            color: #999;
                            font-size: 12px;
                        }}
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🙏 Prayer Room is Live!</h1>
                    </div>
                    <div class="content">
                        <div class="card">
                            <h2>Hello {user_name}!</h2>
                            <p><strong>{host_name}</strong> has opened <strong>{room_name}</strong> for prayer.</p>
                            <p>You're receiving this because you subscribed to updates for this prayer room.</p>
                            
                            {"<div class='room-code'>Room Code: " + room_code + "</div>" if room_code else ""}
                            
                            <div style="text-align: center;">
                                <a href="{join_url}" class="button">
                                    Join Prayer Room Now
                                </a>
                            </div>
                            
                            <p style="margin-top: 20px; color: #666; font-size: 14px;">
                                🌟 <em>"For where two or three gather in my name, there am I with them." - Matthew 18:20</em>
                            </p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>Divine Bridge - Connecting Hearts in Prayer</p>
                        <p class="unsubscribe">
                            Don't want these notifications? 
                            <a href="{unsubscribe_url}" style="color: #0f56ff;">Unsubscribe from this room</a>
                        </p>
                    </div>
                </body>
                </html>
                """

                # Send email (non-blocking, log errors but don't fail)
                send_email(user_email, subject, body)
                subscriber_count += 1

            except Exception as e:
                logging.error(f"Error sending notification to subscriber: {str(e)}")
                continue

        logging.info(f"Sent {subscriber_count} email notifications for reopened room {new_room_id}")

    except Exception as e:
        logging.error(f"Error in notify_subscribers_about_reopened_room: {str(e)}")
        # Don't raise - this is a non-critical background task
