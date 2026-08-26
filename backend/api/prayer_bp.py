from flask import Blueprint, request, jsonify, current_app, send_file, g
from datetime import datetime
import logging
import os
from backend.core.extensions import limiter
from backend.core.input_validation import validate_request, sanitize_string
from backend.core.auth.decorators import verify_cloud_scheduler
from backend.core.auth.helpers import get_user_from_session, require_auth
from backend.integrations.firebase_auth import get_firestore_client
from backend.services.prayer.qa_wall_filters import is_hidden_production_test_wall_item
from backend.services.prayer.private_prayer_request_service import (
    cancel_request,
    claim_request,
    create_request,
    expire_requests,
    list_for_user,
    open_scheduled_call,
    record_prayer,
    send_due_call_reminders,
)

logger = logging.getLogger(__name__)
prayer_bp = Blueprint("prayer", __name__)

# Determine which storage handler to use
USE_LOCAL_STORAGE = os.getenv("USE_LOCAL_STORAGE", "false").lower() == "true"
if USE_LOCAL_STORAGE:
    logger.info("Prayer BP: Using local storage for development")
else:
    logger.info("Prayer BP: Using cloud storage for production")


@prayer_bp.route("/prayer/<date>", methods=["GET"])
def get_prayer(date):
    try:
        prayer = current_app.storage_handler.get_prayer(date)
        if not prayer:
            return jsonify({"error": "Prayer not found"}), 404
        return jsonify({"prayer": prayer}), 200
    except Exception as e:
        logger.error(f"Error getting prayer: {e}")
        return jsonify({"error": "Failed to get prayer"}), 500


@prayer_bp.route("/generate-prayer", methods=["POST"])
def generate_prayer():
    try:
        # Force generation of new prayer (ignore existing ones)
        datetime.now().strftime("%Y-%m-%d")

        # Generate new prayer
        prayer_data = current_app.prayer_generator.generate_prayer()
        if not prayer_data:
            return jsonify({"error": "Failed to generate prayer"}), 500

        return jsonify({"prayer": prayer_data}), 200
    except Exception as e:
        logger.error(f"Error generating prayer: {e}")
        return jsonify({"error": "Failed to generate prayer"}), 500


@prayer_bp.route("/generate", methods=["POST"])
@verify_cloud_scheduler()
def generate_daily_prayer():
    """
    Generate daily prayer (triggered by Cloud Scheduler)
    Protected by Cloud Scheduler verification
    """
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"Cloud Scheduler triggered daily prayer generation for {today}")

        # Check if prayer already exists
        existing_prayer = current_app.storage_handler.get_prayer(today)
        if existing_prayer:
            logger.info(f"Prayer for {today} already exists")
            return jsonify({"success": True, "message": "Prayer already exists", "date": today}), 200

        # Generate new prayer
        prayer_data = current_app.prayer_generator.generate_prayer()

        if prayer_data:
            logger.info(f"Successfully generated prayer for {today}")
            return (
                jsonify(
                    {
                        "success": True,
                        "message": "Prayer generated successfully",
                        "date": today,
                        "word_count": len(prayer_data.get("content", "").split()),
                    }
                ),
                200,
            )
        else:
            logger.error("Failed to generate prayer")
            return jsonify({"success": False, "message": "Prayer generation failed"}), 500

    except Exception as e:
        logger.error(f"Error generating daily prayer: {e}", exc_info=True)
        return jsonify({"success": False, "message": str(e)}), 500


@prayer_bp.route("/subscribe", methods=["POST"])
def subscribe():
    try:
        data = request.get_json()
        email = data.get("email")
        first_name = data.get("firstName")
        last_name = data.get("lastName")

        if not all([email, first_name, last_name]):
            return jsonify({"error": "Missing required fields"}), 400

        # Add subscriber to sheet
        if not current_app.sheet_handler.add_subscriber(email, first_name, last_name):
            return jsonify({"error": "Failed to add subscriber"}), 500

        # Send welcome email
        if not current_app.email_service.send_welcome_email(email, first_name):
            logger.warning(f"Failed to send welcome email to {email}")

        return jsonify({"message": "Successfully subscribed"}), 200
    except Exception as e:
        logger.error(f"Error subscribing: {e}")
        return jsonify({"error": "Failed to subscribe"}), 500


@prayer_bp.route("/unsubscribe", methods=["POST"])
def unsubscribe():
    try:
        data = request.get_json()
        email = data.get("email")

        if not email:
            return jsonify({"error": "Email is required"}), 400

        # Remove subscriber from sheet
        if not current_app.sheet_handler.remove_subscriber(email):
            return jsonify({"error": "Failed to remove subscriber"}), 500

        # Send unsubscribe confirmation
        if not current_app.email_service.send_unsubscribe_confirmation(email):
            logger.warning(f"Failed to send unsubscribe confirmation to {email}")

        return jsonify({"message": "Successfully unsubscribed"}), 200
    except Exception as e:
        logger.error(f"Error unsubscribing: {e}")
        return jsonify({"error": "Failed to unsubscribe"}), 500


@prayer_bp.route("/prayers", methods=["GET"])
def get_prayers():
    """Get recent prayers and prayer requests"""
    try:
        from datetime import datetime

        # Get client's local date from query parameter (format: YYYY-MM-DD)
        # If not provided, use server's date as fallback
        client_date = request.args.get("client_date")
        if client_date:
            today = client_date
            logger.info(f"Using client's local date: {today}")
        else:
            today = datetime.now().strftime("%Y-%m-%d")
            logger.info(f"Using server date: {today}")

        # Get recent prayers (last 20 by default)
        prayers = current_app.storage_handler.get_prayers(limit=20)

        # Get recent prayer requests (last 30 by default)
        prayer_requests = current_app.storage_handler.get_prayer_requests(limit=30)

        # Filter out any invalid items (must be dicts with get method)
        valid_prayers = [p for p in prayers if isinstance(p, dict)]
        valid_requests = [
            r for r in prayer_requests if isinstance(r, dict) and not is_hidden_production_test_wall_item(r)
        ]

        # For daily prayers (AI-generated), only include prayer matching client's local date
        # For prayer requests (user-submitted), include recent ones
        filtered_prayers = []
        for prayer in valid_prayers:
            # Check if it's a daily prayer (source='generated' and no title)
            is_daily_prayer = prayer.get("source") == "generated" and not prayer.get("title")

            if is_daily_prayer:
                # Only include if it matches the client's local date
                if prayer.get("date") == today:
                    # Remove citations from prayer content
                    if "content" in prayer and prayer["content"]:
                        import re

                        prayer["content"] = re.sub(r"\[\d+\]", "", prayer["content"])
                        # Preserve paragraph breaks (newlines) - only normalize spaces and tabs
                        prayer["content"] = re.sub(r"[ \t]+", " ", prayer["content"])
                        prayer["content"] = prayer["content"].strip()
                    filtered_prayers.append(prayer)
                    logger.debug(f"Including daily prayer for date: {today}")
            else:
                # Include all non-daily prayers (shouldn't exist, but just in case)
                filtered_prayers.append(prayer)

        # Combine filtered daily prayer with prayer requests and sort
        all_items = filtered_prayers + valid_requests
        all_items.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        response = jsonify({"prayers": all_items})
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        return response, 200
    except Exception as e:
        logger.error(f"Error getting prayers: {e}")
        logger.exception("Full traceback:")
        return jsonify({"error": "Failed to get prayers"}), 500


@prayer_bp.route("/request", methods=["POST"])
@limiter.limit("10 per hour")
@limiter.limit("50 per day")
@validate_request("prayer_request")
def submit_prayer_request():
    """Submit a prayer request"""
    try:
        data = request.get_json()
        content = sanitize_string(data.get("content"), max_length=2000)

        if not content:
            return jsonify({"error": "Content is required"}), 400

        # Server-side label for moderation / storage (clients do not send title)
        first_line = content.strip().split("\n", 1)[0].strip()
        title = (first_line[:200] if first_line else "") or "Prayer request"
        if len(title) < 5:
            title = "Prayer request"

        # AI Content Moderation + Summary Generation (combined call)
        logger.info("Moderating and summarizing prayer request (content-only)")
        from backend.services.prayer.content_moderator import get_content_moderator

        moderator = get_content_moderator()
        approved, rejection_reason, ai_summary = moderator.moderate_content(title, content, "prayer wall")

        # If not approved, return error with reason
        if not approved:
            logger.warning(f"Prayer request rejected: {rejection_reason}")
            return jsonify({"error": "Content not approved", "reason": rejection_reason, "approved": False}), 400

        is_anonymous = bool(data.get("is_anonymous", False))
        auth_user = get_user_from_session()
        auth_uid = (auth_user or {}).get("user_id")

        if is_anonymous:
            user_id = ""
        elif auth_uid:
            user_id = auth_uid
        else:
            user_id = (data.get("user_id") or "").strip()

        # Create prayer request data with AI summary
        prayer_request = {
            "title": title,
            "content": content,
            "summary": ai_summary if ai_summary else content[:120] + "...",
            "user_id": user_id,
            "is_anonymous": is_anonymous,
            "created_at": datetime.now().isoformat(),
            "date": datetime.now().strftime("%Y-%m-%d"),
            "analytics": {"views": 0, "prayers": 0, "created_at": datetime.now().isoformat()},
            "moderation": {"approved": approved, "moderated_at": datetime.now().isoformat(), "ai_moderated": True},
        }

        # Save prayer request to storage with AI-generated summary
        if current_app.storage_handler.save_prayer_request(prayer_request):
            request_id = prayer_request.get("id")

            return (
                jsonify({"message": "Prayer request submitted successfully", "id": request_id, "approved": True}),
                200,
            )
        else:
            return jsonify({"error": "Failed to save prayer request"}), 500

    except Exception as e:
        logger.error(f"Error submitting prayer request: {e}")
        return jsonify({"error": "Failed to submit prayer request"}), 500


@prayer_bp.route("/private-request", methods=["POST"])
@limiter.limit("5 per hour")
@require_auth
def submit_private_prayer_request():
    """Create a private, leader-matched request. Public Prayer Wall records are not used."""
    try:
        data = request.get_json(silent=True) or {}
        description = sanitize_string(data.get("description"), max_length=500)
        if len(description) < 10:
            return jsonify({"success": False, "error": "Describe your request in 10 to 500 characters"}), 400
        from backend.services.prayer.content_moderator import get_content_moderator

        approved, reason, _ = get_content_moderator().moderate_content(
            "Private prayer request", description, "private prayer request"
        )
        if not approved:
            return jsonify({"success": False, "error": "Content not approved", "reason": reason}), 400
        result = create_request(
            get_firestore_client(),
            g.user,
            description,
            data.get("preferred_language"),
            bool(data.get("wants_live_call")),
            data.get("availability", []),
        )
        return jsonify({"success": True, "data": result}), 201
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    except Exception:
        logger.error("Failed to create private prayer request", exc_info=True)
        return jsonify({"success": False, "error": "Failed to submit prayer request"}), 500


@prayer_bp.route("/private-requests", methods=["GET"])
@require_auth
def get_private_prayer_requests():
    """Return a requester's own requests plus compatible requests for approved leaders."""
    try:
        db = get_firestore_client()
        requests, is_leader = list_for_user(db, g.user_id)
        return jsonify({"success": True, "data": requests, "is_prayer_leader": is_leader}), 200
    except Exception:
        logger.error("Failed to list private prayer requests", exc_info=True)
        return jsonify({"success": False, "error": "Failed to load prayer requests"}), 500


@prayer_bp.route("/private-request/<request_id>/claim", methods=["POST"])
@require_auth
def claim_private_prayer_request(request_id):
    """Atomically assign the request to the first eligible leader."""
    try:
        data = request.get_json(silent=True) or {}
        result = claim_request(get_firestore_client(), request_id, g.user, data.get("slot_start"))
        return jsonify({"success": True, "data": result}), 200
    except LookupError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    except (ValueError, RuntimeError) as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception:
        logger.error("Failed to claim private prayer request", exc_info=True)
        return jsonify({"success": False, "error": "Failed to claim prayer request"}), 500


@prayer_bp.route("/private-request/<request_id>/call", methods=["POST"])
@require_auth
def open_private_prayer_call(request_id):
    """Return the private call credentials shortly before the scheduled time."""
    try:
        if g.user.get("is_anonymous"):
            return jsonify({"success": False, "error": "Sign in is required to join private prayer"}), 403
        result = open_scheduled_call(get_firestore_client(), request_id, g.user_id)
        return jsonify({"success": True, "data": result}), 200
    except LookupError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception:
        logger.error("Failed to open private prayer call", exc_info=True)
        return jsonify({"success": False, "error": "Failed to open prayer call"}), 500


@prayer_bp.route("/private-request/<request_id>/cancel", methods=["POST"])
@require_auth
def cancel_private_prayer_request(request_id):
    """Allow the requester to cancel an active, claimed, or scheduled request."""
    try:
        result = cancel_request(get_firestore_client(), request_id, g.user_id)
        return jsonify({"success": True, "data": result}), 200
    except LookupError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception:
        logger.error("Failed to cancel private prayer request", exc_info=True)
        return jsonify({"success": False, "error": "Failed to cancel prayer request"}), 500


@prayer_bp.route("/private-request/<request_id>/pray", methods=["POST"])
@require_auth
def pray_for_private_request(request_id):
    """Record an anonymous/count-only prayer from an authorized request participant."""
    try:
        count = record_prayer(get_firestore_client(), request_id, g.user_id)
        return jsonify({"success": True, "data": {"prayer_count": count}}), 200
    except LookupError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except PermissionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 403
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception:
        logger.error("Failed to record private prayer", exc_info=True)
        return jsonify({"success": False, "error": "Failed to record prayer"}), 500


@prayer_bp.route("/private-request/maintenance", methods=["POST"])
@verify_cloud_scheduler()
def maintain_private_prayer_requests():
    """Expire unclaimed requests and deliver scheduled-call reminders."""
    try:
        db = get_firestore_client()
        return (
            jsonify(
                {
                    "success": True,
                    "data": {
                        "expired_requests": expire_requests(db),
                        "reminders_sent": send_due_call_reminders(db),
                    },
                }
            ),
            200,
        )
    except Exception:
        logger.error("Private prayer request maintenance failed", exc_info=True)
        return jsonify({"success": False, "error": "Maintenance failed"}), 500


@prayer_bp.route("/request/<request_id>", methods=["DELETE"])
def delete_prayer_request(request_id):
    """Delete a prayer request (only by owner)"""
    try:
        # Get the prayer request to verify ownership
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)

        if not prayer_data:
            return jsonify({"error": "Prayer request not found"}), 404

        auth_user = get_user_from_session()
        user_id = (auth_user or {}).get("user_id")
        if not user_id:
            return jsonify({"error": "Authentication required"}), 401

        # Verify ownership
        if prayer_data.get("user_id") != user_id:
            return jsonify({"error": "Unauthorized - can only delete your own prayers"}), 403

        # Delete from storage
        prayer_date = prayer_data.get("date")
        blob_path = f"prayer_requests/{prayer_date}/{request_id}.json"
        blob = current_app.storage_handler.bucket.blob(blob_path)

        if blob.exists():
            blob.delete()
            logger.info(f"Deleted prayer request: {request_id} by user: {user_id}")
            return jsonify({"message": "Prayer request deleted successfully"}), 200
        else:
            return jsonify({"error": "Prayer request not found in storage"}), 404

    except Exception as e:
        logger.error(f"Error deleting prayer request: {e}")
        return jsonify({"error": "Failed to delete prayer request"}), 500


@prayer_bp.route("/request/<request_id>", methods=["PUT"])
def update_prayer_request(request_id):
    """Update a prayer request (only by owner)"""
    try:
        # Get the prayer request to verify ownership
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)

        if not prayer_data:
            return jsonify({"error": "Prayer request not found"}), 404

        data = request.get_json() or {}
        auth_user = get_user_from_session()
        user_id = (auth_user or {}).get("user_id")
        if not user_id:
            return jsonify({"error": "Authentication required"}), 401

        # Verify ownership
        if prayer_data.get("user_id") != user_id:
            return jsonify({"error": "Unauthorized - can only edit your own prayers"}), 403

        # Update fields
        if "title" in data:
            prayer_data["title"] = data["title"]
        if "content" in data:
            prayer_data["content"] = data["content"]
            # Regenerate summary
            content = data["content"]
            sentences = content.split(".")
            if len(sentences) > 1 and len(sentences[0]) < 120:
                prayer_data["summary"] = ".".join(sentences[:2]).strip() + "."
            else:
                prayer_data["summary"] = content[:117] + "..." if len(content) > 120 else content

        # Update timestamp
        prayer_data["updated_at"] = datetime.now().isoformat()

        # Save updated prayer
        if current_app.storage_handler.update_prayer_request(request_id, prayer_data):
            logger.info(f"Updated prayer request: {request_id} by user: {user_id}")
            return jsonify({"message": "Prayer request updated successfully", "prayer": prayer_data}), 200
        else:
            return jsonify({"error": "Failed to update prayer request"}), 500

    except Exception as e:
        logger.error(f"Error updating prayer request: {e}")
        return jsonify({"error": "Failed to update prayer request"}), 500


@prayer_bp.route("/request/<request_id>/view", methods=["POST"])
def track_prayer_view(request_id):
    """Track when a prayer request is viewed"""
    try:
        # Get the prayer request
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)

        if not prayer_data:
            return jsonify({"error": "Prayer request not found"}), 404

        # Increment view count
        analytics = prayer_data.get("analytics", {"views": 0, "prayers": 0})
        analytics["views"] = analytics.get("views", 0) + 1
        prayer_data["analytics"] = analytics

        # Update in storage
        if current_app.storage_handler.update_prayer_request(request_id, prayer_data):
            return jsonify({"message": "View tracked", "views": analytics["views"]}), 200
        else:
            return jsonify({"error": "Failed to track view"}), 500

    except Exception as e:
        logger.error(f"Error tracking prayer view: {e}")
        return jsonify({"error": "Failed to track view"}), 500


@prayer_bp.route("/request/<request_id>/pray", methods=["POST"])
def track_prayer_action(request_id):
    """Track when someone prays for a prayer request"""
    try:
        # Get the prayer request
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)

        if not prayer_data:
            return jsonify({"error": "Prayer request not found"}), 404

        # Increment prayer count
        analytics = prayer_data.get("analytics", {"views": 0, "prayers": 0})
        analytics["prayers"] = analytics.get("prayers", 0) + 1
        prayer_data["analytics"] = analytics

        # Update in storage
        if current_app.storage_handler.update_prayer_request(request_id, prayer_data):
            # Per-user Prayer Wall metrics (weekly count, streak) when client sends Bearer token
            try:
                user = get_user_from_session()
                uid = user.get("user_id") if user else None
                if uid:
                    current_app.storage_handler.record_wall_pray_event(uid, request_id)
            except Exception as log_err:
                logger.warning(f"Wall pray event not recorded: {log_err}")

            return jsonify({"message": "Prayer recorded", "prayers": analytics["prayers"]}), 200
        else:
            return jsonify({"error": "Failed to record prayer"}), 500

    except Exception as e:
        logger.error(f"Error tracking prayer action: {e}")
        return jsonify({"error": "Failed to record prayer"}), 500


@prayer_bp.route("/my/home-prayer-metrics", methods=["GET"])
def get_my_home_prayer_metrics():
    """Authenticated: wall pray count (rolling 7d) + consecutive-day wall streak for home stats."""
    try:
        user = get_user_from_session()
        if not user or not user.get("user_id"):
            return jsonify({"error": "Unauthorized"}), 401
        uid = user["user_id"]
        handler = current_app.storage_handler
        last_7 = handler.count_wall_pray_events_last_days(uid, 7)
        wall_streak = handler.get_wall_pray_streak_days(uid)
        return (
            jsonify(
                {
                    "wall_pray_last_7_days": last_7,
                    "wall_pray_streak_days": wall_streak,
                }
            ),
            200,
        )
    except Exception as e:
        logger.error(f"Error in home prayer metrics: {e}")
        return jsonify({"error": "Failed to load metrics"}), 500


@prayer_bp.route("/user/<user_id>/prayed-prayers", methods=["GET"])
def get_user_prayed_prayers(user_id):
    """Get list of prayer IDs that a user has prayed for (synced across devices)"""
    try:
        prayer_ids = current_app.storage_handler.get_user_prayed_prayers(user_id)
        return jsonify({"prayer_ids": prayer_ids, "count": len(prayer_ids)}), 200
    except Exception as e:
        logger.error(f"Error getting user prayed prayers: {e}")
        return jsonify({"error": "Failed to get prayed prayers"}), 500


@prayer_bp.route("/user/<user_id>/prayed-prayers", methods=["POST"])
def add_user_prayed_prayer(user_id):
    """Add a prayer to user's prayed-for list (synced across devices)"""
    try:
        data = request.get_json()
        prayer_id = data.get("prayer_id")

        if not prayer_id:
            return jsonify({"error": "prayer_id is required"}), 400

        success = current_app.storage_handler.add_user_prayed_prayer(user_id, prayer_id)

        if success:
            return jsonify({"message": "Prayer marked as prayed for", "prayer_id": prayer_id}), 200
        else:
            return jsonify({"error": "Failed to save"}), 500

    except Exception as e:
        logger.error(f"Error adding user prayed prayer: {e}")
        return jsonify({"error": "Failed to save"}), 500


@prayer_bp.route("/user/<user_id>/stats", methods=["GET"])
def get_user_stats(user_id):
    """Get user statistics (synced across devices)"""
    try:
        stats = current_app.storage_handler.get_user_stats(user_id)
        return jsonify(stats), 200
    except Exception as e:
        logger.error(f"Error getting user stats: {e}")
        return jsonify({"error": "Failed to get stats"}), 500


@prayer_bp.route("/user/<user_id>/stats/<stat_name>", methods=["POST"])
def increment_user_stat(user_id, stat_name):
    """Increment a user statistic (synced across devices)"""
    try:
        # Validate stat name
        valid_stats = ["prayersRead", "requestsSubmitted"]
        if stat_name not in valid_stats:
            return jsonify({"error": "Invalid stat name"}), 400

        success = current_app.storage_handler.increment_user_stat(user_id, stat_name)

        if success:
            # Get updated stats
            stats = current_app.storage_handler.get_user_stats(user_id)
            return (
                jsonify({"message": f"{stat_name} incremented", "value": stats.get(stat_name, 0), "stats": stats}),
                200,
            )
        else:
            return jsonify({"error": "Failed to increment stat"}), 500

    except Exception as e:
        logger.error(f"Error incrementing user stat: {e}")
        return jsonify({"error": "Failed to increment stat"}), 500


@prayer_bp.route("/prayer/download", methods=["GET"])
def download_prayer_image():
    """Download today's global prayer as a JPEG image (with caching)"""
    try:
        # Get client's local date
        client_date = request.args.get("client_date")
        force_regenerate = request.args.get("force", "false").lower() == "true"

        if client_date:
            today = client_date
            try:
                client_datetime = datetime.strptime(client_date, "%Y-%m-%d")
                date_str = client_datetime.strftime("%B %d, %Y")
            except ValueError:
                date_str = datetime.now().strftime("%B %d, %Y")
        else:
            today = datetime.now().strftime("%Y-%m-%d")
            date_str = datetime.now().strftime("%B %d, %Y")

        # Try to get cached image first (unless force regenerate)
        if not force_regenerate:
            cached_image = current_app.storage_handler.get_prayer_image(today)
            if cached_image:
                logger.info(f"✅ Serving cached prayer image for {today}")
                from io import BytesIO

                image_data = BytesIO(cached_image)
                filename = f"divine_bridge_prayer_{client_date or 'today'}.jpg"
                return send_file(image_data, mimetype="image/jpeg", as_attachment=True, download_name=filename)

        # Cache miss or force regenerate - get prayer and generate image
        logger.info(f"🎨 Generating new prayer image for {today}")

        # Get today's prayer
        prayer = current_app.storage_handler.get_prayer(today)

        if not prayer:
            return jsonify({"error": "No prayer available for today"}), 404

        # Extract prayer content (handle both dict and string formats)
        if isinstance(prayer, dict):
            prayer_content = prayer.get("content", "")
        else:
            prayer_content = prayer

        if not prayer_content:
            return jsonify({"error": "Prayer content is empty"}), 404

        # Generate image
        from backend.services.prayer.image_generator import get_image_generator

        generator = get_image_generator()

        image_data = generator.generate_prayer_image(prayer_text=prayer_content, date=date_str)

        # Save to cache for future requests
        image_bytes = image_data.getvalue()
        current_app.storage_handler.save_prayer_image(today, image_bytes)
        logger.info(f"💾 Cached prayer image for {today}")

        # Reset BytesIO for sending
        image_data.seek(0)

        # Send file
        filename = f"divine_bridge_prayer_{client_date or 'today'}.jpg"
        return send_file(image_data, mimetype="image/jpeg", as_attachment=True, download_name=filename)

    except Exception as e:
        logger.error(f"Error generating prayer image: {e}")
        logger.exception("Full traceback:")
        return jsonify({"error": "Failed to generate image"}), 500


@prayer_bp.route("/daily-prayer/<date>/image", methods=["GET"])
def get_daily_prayer_image(date):
    """Serve daily prayer image for sharing (not download)"""
    try:
        # Try to get cached image first
        cached_image = current_app.storage_handler.get_prayer_image(date)
        if cached_image:
            logger.info(f"Serving prayer image for sharing: {date}")
            from io import BytesIO

            image_data = BytesIO(cached_image)
            return send_file(image_data, mimetype="image/jpeg", as_attachment=False)

        # If no cached image, generate it
        prayer = current_app.storage_handler.get_prayer(date)
        if not prayer:
            return jsonify({"error": "No prayer available"}), 404

        # Extract prayer content
        if isinstance(prayer, dict):
            prayer_content = prayer.get("content", "")
        else:
            prayer_content = prayer

        if not prayer_content:
            return jsonify({"error": "Prayer content is empty"}), 404

        # Generate image
        from backend.services.prayer.image_generator import get_image_generator

        generator = get_image_generator()
        try:
            client_datetime = datetime.strptime(date, "%Y-%m-%d")
            date_str = client_datetime.strftime("%B %d, %Y")
        except ValueError:
            date_str = datetime.now().strftime("%B %d, %Y")

        image_data = generator.generate_prayer_image(prayer_text=prayer_content, date=date_str)

        # Save to cache
        image_bytes = image_data.getvalue()
        current_app.storage_handler.save_prayer_image(date, image_bytes)

        # Reset and send
        image_data.seek(0)
        return send_file(image_data, mimetype="image/jpeg", as_attachment=False)

    except Exception as e:
        logger.error(f"Error serving prayer image: {e}")
        return jsonify({"error": "Failed to generate image"}), 500


# Daily Prayer Interactions Endpoints
@prayer_bp.route("/daily-prayer/<date>/like", methods=["POST", "DELETE"])
def toggle_daily_prayer_like(date):
    """Like or unlike a daily prayer"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        user_id = user.get("user_id")
        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)
        likes_ref = prayer_ref.collection("likes").document(user_id)

        if request.method == "POST":
            # Like the prayer
            likes_ref.set(
                {
                    "user_id": user_id,
                    "user_name": user.get("user_name", "Anonymous"),
                    "created_at": datetime.now().isoformat(),
                }
            )
            logger.info(f"User {user_id} liked daily prayer for {date}")
            return jsonify({"message": "Prayer liked", "liked": True}), 200
        else:
            # Unlike the prayer
            likes_ref.delete()
            logger.info(f"User {user_id} unliked daily prayer for {date}")
            return jsonify({"message": "Prayer unliked", "liked": False}), 200

    except Exception as e:
        logger.error(f"Error toggling like: {e}")
        logger.exception("Full traceback for like error:")
        return jsonify({"error": "Failed to update like"}), 500


@prayer_bp.route("/daily-prayer/<date>/likes", methods=["GET"])
def get_daily_prayer_likes(date):
    """Get likes count and check if current user has liked"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)
        likes = prayer_ref.collection("likes").stream()

        likes_list = [like.to_dict() for like in likes]
        likes_count = len(likes_list)

        # Check if current user has liked
        user = get_user_from_session()
        user_liked = False
        if user:
            user_id = user.get("user_id")
            user_liked = any(like.get("user_id") == user_id for like in likes_list)

        return jsonify({"count": likes_count, "liked": user_liked}), 200

    except Exception as e:
        logger.error(f"Error getting likes: {e}")
        return jsonify({"error": "Failed to get likes", "count": 0, "liked": False}), 500


@prayer_bp.route("/daily-prayer/<date>/comment", methods=["POST"])
def add_daily_prayer_comment(date):
    """Add a comment to a daily prayer"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        data = request.get_json()
        comment_text = sanitize_string(data.get("comment", ""), max_length=500)

        if not comment_text:
            return jsonify({"error": "Comment text is required"}), 400

        user_id = user.get("user_id")
        user_name = user.get("user_name", "Anonymous")

        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)
        comment_ref = prayer_ref.collection("comments").document()

        comment_data = {
            "user_id": user_id,
            "user_name": user_name,
            "comment": comment_text,
            "created_at": datetime.now().isoformat(),
        }

        comment_ref.set(comment_data)
        comment_data["id"] = comment_ref.id

        logger.info(f"User {user_id} commented on daily prayer for {date}")
        return jsonify({"message": "Comment added", "comment": comment_data}), 200

    except Exception as e:
        logger.error(f"Error adding comment: {e}")
        return jsonify({"error": "Failed to add comment"}), 500


@prayer_bp.route("/daily-prayer/<date>/comments", methods=["GET"])
def get_daily_prayer_comments(date):
    """Get comments count for a daily prayer"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)
        comments = prayer_ref.collection("comments").order_by("created_at", direction="DESCENDING").limit(100).stream()

        comments_list = []
        for comment in comments:
            comment_data = comment.to_dict()
            comment_data["id"] = comment.id
            comments_list.append(comment_data)

        return jsonify({"count": len(comments_list), "comments": comments_list}), 200

    except Exception as e:
        logger.error(f"Error getting comments: {e}")
        return jsonify({"error": "Failed to get comments", "count": 0, "comments": []}), 500


@prayer_bp.route("/daily-prayer/<date>/share", methods=["POST"])
def track_daily_prayer_share(date):
    """Track a share of a daily prayer"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        user_id = user.get("user_id")
        data = request.get_json() or {}
        platform = data.get("platform", "unknown")  # e.g., 'facebook', 'twitter', 'copy_link'

        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)
        share_ref = prayer_ref.collection("shares").document()

        share_ref.set(
            {
                "user_id": user_id,
                "user_name": user.get("user_name", "Anonymous"),
                "platform": platform,
                "created_at": datetime.now().isoformat(),
            }
        )

        logger.info(f"User {user_id} shared daily prayer for {date} on {platform}")
        return jsonify({"message": "Share tracked"}), 200

    except Exception as e:
        logger.error(f"Error tracking share: {e}")
        return jsonify({"error": "Failed to track share"}), 500


@prayer_bp.route("/daily-prayer/<date>/shares", methods=["GET"])
def get_daily_prayer_shares(date):
    """Get shares count for a daily prayer"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)
        shares = prayer_ref.collection("shares").stream()

        shares_count = len(list(shares))

        return jsonify({"count": shares_count}), 200

    except Exception as e:
        logger.error(f"Error getting shares: {e}")
        return jsonify({"error": "Failed to get shares", "count": 0}), 500


@prayer_bp.route("/daily-prayer/<date>/interactions", methods=["GET"])
def get_daily_prayer_interactions(date):
    """Get all interaction counts for a daily prayer (likes, comments, shares)"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({"error": "Database unavailable"}), 500

        prayer_ref = db.collection("daily_prayers").document(date)

        # Get likes
        likes = list(prayer_ref.collection("likes").stream())
        likes_count = len(likes)

        # Get comments count
        comments = list(prayer_ref.collection("comments").stream())
        comments_count = len(comments)

        # Get shares count
        shares = list(prayer_ref.collection("shares").stream())
        shares_count = len(shares)

        # Check if current user has liked
        user = get_user_from_session()
        user_liked = False
        if user:
            user_id = user.get("user_id")
            user_liked = any(like.to_dict().get("user_id") == user_id for like in likes)

        return (
            jsonify(
                {
                    "likes": {"count": likes_count, "liked": user_liked},
                    "comments": {"count": comments_count},
                    "shares": {"count": shares_count},
                }
            ),
            200,
        )

    except Exception as e:
        logger.error(f"Error getting interactions: {e}")
        return (
            jsonify(
                {
                    "error": "Failed to get interactions",
                    "likes": {"count": 0, "liked": False},
                    "comments": {"count": 0},
                    "shares": {"count": 0},
                }
            ),
            500,
        )


@prayer_bp.route("/global-watch/pray", methods=["POST"])
def track_global_watch_pray():
    """Record authenticated user's Global Prayer Watch \"I prayed\" for home metrics.

    Expects JSON: {\"prayer_id\": \"...\"}. Body avoids URL-encoding issues with ids
    that contain colons (ISO timestamps) or other reserved characters.
    """
    try:
        data = request.get_json() or {}
        pid = (data.get("prayer_id") or "").strip()
        if not pid:
            return jsonify({"error": "prayer_id is required"}), 400
        user = get_user_from_session()
        if not user or not user.get("user_id"):
            return jsonify({"error": "Unauthorized"}), 401
        uid = user["user_id"]
        ref_id = f"global-watch:{pid}"
        current_app.storage_handler.record_wall_pray_event(uid, ref_id)
        return jsonify({"message": "Prayer recorded", "reference": ref_id}), 200
    except Exception as e:
        logger.error(f"Error recording global watch pray: {e}")
        return jsonify({"error": "Failed to record prayer"}), 500


@prayer_bp.route("/global-watch", methods=["GET"])
def get_global_watch_prayers():
    """Return active Global Prayer Watch disaster prayers for the mobile feed.

    Each entry represents a grouped disaster prayer for a specific event type
    affecting one or more countries (sourced from DisasterPrayerService).
    Returns empty list gracefully on any error so the mobile feed degrades safely.
    """
    try:
        from backend.services.disaster.disaster_prayer_service import get_disaster_prayer_service

        service = get_disaster_prayer_service(current_app.storage_handler)
        raw_prayers = service.get_active_disaster_prayers()

        result = []
        for p in raw_prayers:
            # Only include grouped prayers (the ones shown on globalprayerwatch page).
            # Individual legacy prayers lack affected_countries.
            if not p.get("is_grouped") and not p.get("affected_countries"):
                continue
            full_prayer = p.get("prayer", "")
            wall_prayer = p.get("wall_prayer", "")

            # Backward-compat: if older record has no wall_prayer, derive one from the
            # first two sentences of the full prayer (until the next hourly run regenerates it).
            if not wall_prayer and full_prayer:
                import re as _re

                sentences = _re.findall(r"[^.!?]+[.!?]+", full_prayer)
                wall_prayer = " ".join(sentences[:2]).strip()

            result.append(
                {
                    "id": p.get("id", ""),
                    "disaster_type": p.get("disaster_type", ""),
                    "disaster_type_display": (
                        p.get("disaster_type_display") or p.get("disaster_type", "").replace("_", " ").title()
                    ),
                    "affected_countries": p.get("affected_countries", []),
                    "summary": p.get("summary", ""),
                    "wall_prayer": wall_prayer,
                    "created_at": p.get("created_at", ""),
                    "updated_at": p.get("updated_at", ""),
                }
            )

        # Most recent first (prefer latest content refresh on the same event)
        def _gw_recency(row):
            return row.get("updated_at") or row.get("created_at") or ""

        result.sort(key=_gw_recency, reverse=True)

        return jsonify({"success": True, "prayers": result}), 200

    except Exception as e:
        logger.error(f"Error fetching global watch prayers: {e}")
        # Return empty gracefully — the mobile feed should still show community prayers
        return jsonify({"success": True, "prayers": []}), 200
