"""Server-rendered HTML page routes."""
import html
import json
import logging
from datetime import datetime

from firebase_admin import firestore
from flask import Blueprint, current_app, make_response, redirect, render_template, request, send_from_directory

from backend.core.config import get_config
from backend.integrations.firebase_auth import get_firestore_client
from backend.web.daily_prayer import get_daily_prayer_for_date

pages_bp = Blueprint("pages", __name__)
logger = logging.getLogger(__name__)
config = get_config()


@pages_bp.route("/login")
def login():
    """Serve the login page"""
    return render_template("login.html")


@pages_bp.route("/signup")
def signup():
    """Serve the signup page"""
    return render_template("register.html")


@pages_bp.route("/prayers")
def prayers():
    """Serve the prayers page"""
    return render_template("prayers.html")


@pages_bp.route("/prayer-room")
def prayer_room():
    """Serve the Live Prayer Room directory page"""
    logger.info("🔍 DEBUG: Rendering prayer_rooms_standalone.html template")

    firebase_config = config.FIREBASE_CLIENT_CONFIG
    if isinstance(firebase_config, str):
        firebase_config = json.loads(firebase_config)

    return render_template("prayer_rooms_standalone.html", firebase_config=firebase_config)


@pages_bp.route("/prayer-room/join")
def join_prayer_room():
    """Serve the individual prayer room page"""
    room_id = request.args.get("room")
    room_code = request.args.get("code")

    if not room_id:
        return redirect("/prayer-room")

    room_name = "Prayer Room"
    room_privacy = "public"
    try:
        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id).get()

        if room_doc.exists:
            room_data = room_doc.to_dict()
            room_name = room_data.get("room_name", f"Prayer Room {room_id[:6]}")
            room_privacy = room_data.get("room_privacy", "public")
            logger.info(f"Found room name in database: {room_name}, privacy: {room_privacy}")
        else:
            logger.warning(f"Room {room_id} not found in database, using fallback name")
            room_name = f"Prayer Room {room_id[:6]}"
    except Exception as e:
        logger.error(f"Error fetching room name from database: {e}")
        room_name = f"Prayer Room {room_id[:6]}"

    firebase_config = config.FIREBASE_CLIENT_CONFIG
    if isinstance(firebase_config, str):
        firebase_config = json.loads(firebase_config)

    logger.info("🔍 DEBUG: Rendering prayer_room_standalone.html template")
    response = make_response(
        render_template(
            "prayer_room_standalone.html",
            room_id=room_id,
            room_name=room_name,
            room_code=room_code,
            room_privacy=room_privacy,
            firebase_config=firebase_config,
        )
    )
    response.headers["Permissions-Policy"] = "microphone=*"
    return response


@pages_bp.route("/call/<room_id>")
def voice_call_page(room_id):
    """Minimal 1:1 voice call page for shared web links."""
    from backend.api.prayer_room.helpers import (
        _format_expires_at_iso,
        _is_voice_link_expired,
        _voice_link_code_matches,
    )

    room_code = request.args.get("code", "")
    host_name = "Host"
    is_active = False
    is_expired = False
    is_full = False
    link_invalid = True
    expires_at = None

    try:
        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id).get()
        if room_doc.exists:
            room_data = room_doc.to_dict() or {}
            if room_data.get("room_type") == "voice_link":
                if _voice_link_code_matches(room_data, room_code):
                    link_invalid = False
                    host_name = room_data.get("host_name") or host_name
                    is_active = bool(room_data.get("is_active", False))
                    expires_raw = room_data.get("expires_at")
                    if expires_raw:
                        expires_at = _format_expires_at_iso(expires_raw)
                        is_expired = _is_voice_link_expired(room_data)
                    participants = room_data.get("participants") or []
                    active_count = sum(1 for p in participants if p.get("is_active", True) is not False)
                    is_full = active_count >= 2
    except Exception as e:
        logger.error(f"Error loading voice call room {room_id}: {e}")

    firebase_config = config.FIREBASE_CLIENT_CONFIG
    if isinstance(firebase_config, str):
        firebase_config = json.loads(firebase_config)

    response = make_response(
        render_template(
            "voice_call.html",
            room_id=room_id,
            room_code=room_code if not link_invalid else "",
            host_name=host_name if not link_invalid else "",
            is_active=is_active,
            is_expired=is_expired,
            is_full=is_full,
            link_invalid=link_invalid,
            expires_at=expires_at,
            firebase_config=firebase_config,
        )
    )
    response.headers["Permissions-Policy"] = "microphone=*"
    response.headers["Cache-Control"] = "no-store"
    return response


@pages_bp.route("/daily-prayer")
def daily_prayer():
    """Serve the daily prayer page"""
    return render_template("daily_prayer.html")


@pages_bp.route("/about")
def about():
    """Serve the about page"""
    return render_template("about.html")


@pages_bp.route("/contact")
def contact():
    """Serve the contact page"""
    return render_template("contact.html")


@pages_bp.route("/faq")
def faq():
    """Serve the FAQ page"""
    return render_template("faq.html")


@pages_bp.route("/privacy-policy")
def privacy_policy():
    """Serve the privacy policy page"""
    return render_template("privacy_policy.html")


@pages_bp.route("/terms-of-service")
def terms_of_service():
    """Serve the terms of service page"""
    return render_template("terms_of_service.html")


@pages_bp.route("/robots.txt")
def robots_txt():
    """Serve robots.txt for SEO"""
    return send_from_directory(current_app.static_folder, "robots.txt")


@pages_bp.route("/google<path:filename>")
def google_verification(filename):
    """Serve Google Search Console verification file"""
    return send_from_directory(current_app.static_folder, f"google{filename}")


@pages_bp.route("/profile")
def profile():
    """Serve the profile page"""
    return render_template("profile.html")


@pages_bp.route("/edit-profile")
def edit_profile():
    """Serve the edit profile page"""
    return render_template("edit_profile.html")


@pages_bp.route("/change-password")
def change_password():
    """Serve the change password page"""
    return render_template("change_password.html")


@pages_bp.route("/card/<user_id>")
def public_card(user_id):
    """Serve the public business card page"""
    try:
        db = firestore.client()
        user_ref = db.collection("users").document(user_id)
        user_doc = user_ref.get()

        user_name = "Business Card"
        if user_doc.exists:
            user_data = user_doc.to_dict()
            first_name = user_data.get("firstName", "")
            last_name = user_data.get("lastName", "")
            if first_name or last_name:
                user_name = f"{first_name} {last_name}".strip()

        return render_template("public_card.html", user_id=user_id, user_name=user_name)
    except Exception as e:
        logger.error(f"Error loading user data for card page: {e}")
        return render_template("public_card.html", user_id=user_id, user_name="Business Card")


@pages_bp.route("/")
def index():
    """Serve the home page as main landing page with server-side rendered verse and prayer"""
    try:
        client_date = request.args.get("client_date")
        if client_date:
            try:
                datetime.strptime(client_date, "%Y-%m-%d")
                today = client_date
                client_datetime = datetime.strptime(client_date, "%Y-%m-%d")
                day_of_year = client_datetime.timetuple().tm_yday
                logger.info(f"Using client's local date: {today} (day of year: {day_of_year})")
            except ValueError:
                today = datetime.now().strftime("%Y-%m-%d")
                day_of_year = datetime.now().timetuple().tm_yday
                logger.warning(f"Invalid client_date format: {client_date}, using server date: {today}")
        else:
            today = datetime.now().strftime("%Y-%m-%d")
            day_of_year = datetime.now().timetuple().tm_yday
            logger.info(f"No client_date provided, using server date: {today}")

        verse = current_app.verse_cache.get_today_verse(day_of_year=day_of_year)
        daily_prayer = get_daily_prayer_for_date(today)

        verse_data = (
            verse
            if verse
            else {
                "verse": "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
                "reference": "John 3:16",
            }
        )

        prayer_data = None
        if daily_prayer and daily_prayer.get("content"):
            content = daily_prayer.get("content", "")
            content_escaped = html.escape(content)
            content_formatted = content_escaped.replace("\n\n", "<br><br>").replace("\n", "<br>")

            prayer_data = {
                "content": content_formatted,
                "date": daily_prayer.get("date", today),
                "date_iso": daily_prayer.get("date", today),
            }

        return render_template("index.html", verse=verse_data, daily_prayer=prayer_data, today_date=today)
    except Exception as e:
        logger.error(f"Error rendering home page: {e}")
        return render_template(
            "index.html",
            verse={
                "verse": "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
                "reference": "John 3:16",
            },
            daily_prayer=None,
            today_date=datetime.now().strftime("%Y-%m-%d"),
        )


@pages_bp.route("/home")
def home():
    """Serve the home page (alias for /)"""
    return index()


@pages_bp.route("/forgot-password")
def forgot_password():
    """Serve the forgot password page"""
    return render_template("forgot_password.html")


@pages_bp.route("/reset-password")
def reset_password():
    """Serve the reset password page"""
    return render_template("reset_password.html")


@pages_bp.route("/verify-email")
def verify_email():
    """Serve the verify email page"""
    return render_template("verify_email.html")


@pages_bp.route("/unsubscribe", methods=["GET", "POST"])
def unsubscribe():
    """
    Unsubscribe from Divine Bridge daily prayer emails.

    Supports:
    - GET /unsubscribe?email=... (prefill form)
    - POST /unsubscribe (form submit)

    Note: This endpoint is used by email unsubscribe links, so it must work without auth.
    """
    cfg = get_config()
    sender_email = getattr(cfg, "SENDER_EMAIL", None) or current_app.config.get(
        "SENDER_EMAIL", "blessings@divinebridge.io"
    )

    if request.method == "GET":
        email = request.args.get("email", "").strip()
        return render_template("unsubscribe.html", email=email, sender_email=sender_email)

    email = (request.form.get("email") or "").strip()
    if not email or "@" not in email:
        return render_template(
            "unsubscribe.html", email=email, sender_email=sender_email, error="Please enter a valid email address."
        )

    try:
        db = firestore.client()
        users_ref = db.collection("users")
        matches = users_ref.where("email", "==", email).stream()
        updated = 0
        for doc in matches:
            doc.reference.set(
                {"email_subscribed": False, "email_unsubscribed_at": datetime.utcnow().isoformat()}, merge=True
            )
            updated += 1

        logger.info(f"Unsubscribe request processed for {email}. Updated users: {updated}")
    except Exception as e:
        logger.error(f"Error processing unsubscribe for {email}: {e}")

    return render_template("unsubscribe_confirmation.html", sender_email=sender_email)
