from flask import Flask, request, session, redirect
import logging
from datetime import datetime, timedelta
import os
from backend.services.prayer.prayer_generator import PrayerGenerator
from backend.core.config import get_config
from backend.services.verse.verse_cache import verse_cache
from flask_session import Session
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect
from backend.core.extensions import limiter
from flask_limiter.util import get_remote_address
import redis

try:
    from flask_socketio import SocketIO, emit, join_room, leave_room
except ImportError:
    print("Warning: Flask-SocketIO not installed. WebSocket features will be disabled.")
    SocketIO = None
    emit = None
    join_room = None
    leave_room = None
from functools import wraps
from backend.integrations.firebase_auth import initialize_firebase
from backend.services.verse.verse_generator import verse_generator

# Initialize Sentry for error tracking and performance monitoring (Phase 3)
try:
    import sentry_sdk
    from sentry_sdk.integrations.flask import FlaskIntegration

    _sentry_dsn = os.getenv("SENTRY_DSN")
    if _sentry_dsn:
        sentry_sdk.init(
            dsn=_sentry_dsn,
            integrations=[FlaskIntegration()],
            traces_sample_rate=0.1,
            profiles_sample_rate=0.1,
            environment=os.getenv("FLASK_ENV", "production"),
        )
except ImportError:
    pass

# gRPC keepalive: prevent VPC NAT / load-balancer from killing idle Firestore
# connections.  Must be set before any gRPC channel is created.
os.environ.setdefault("GRPC_KEEPALIVE_TIME_MS", "30000")  # ping every 30s
os.environ.setdefault("GRPC_KEEPALIVE_TIMEOUT_MS", "10000")  # wait 10s for pong
os.environ.setdefault("GRPC_KEEPALIVE_PERMIT_WITHOUT_CALLS", "1")  # ping even when idle


def get_user_based_key():
    """Get user-based key for rate limiting (preferred over IP)"""
    user = session.get("user")
    if user and user.get("uid"):
        return f"user:{user['uid']}"
    return get_remote_address()


# Import appropriate storage handler based on environment
USE_LOCAL_STORAGE = os.getenv("USE_LOCAL_STORAGE", "false").lower() == "true"
if USE_LOCAL_STORAGE:
    from backend.integrations.local_storage import LocalStorageHandler as StorageHandler

    print("🔧 Using LocalStorageHandler for development")
else:
    from backend.integrations.storage_handler import StorageHandler

    print("☁️  Using CloudStorageHandler for production")

# Configure structured logging (JSON in production for Cloud Run, text locally)
from backend.core.logging import setup_logging

_loggers = setup_logging()
logger = logging.getLogger(__name__)


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user" not in session:
            logger.warning("No user in session, redirecting to login")
            redirect_path = request.path
            return redirect(f"/login?redirect={redirect_path}")
        return f(*args, **kwargs)

    return decorated_function


# Get configuration
config = get_config()


def create_app():
    """Create and configure the Flask application"""
    _repo_root = os.path.dirname(os.path.abspath(__file__))
    app = Flask(
        __name__,
        template_folder=os.path.join(_repo_root, "web", "templates"),
        static_folder=os.path.join(_repo_root, "web", "static"),
        static_url_path="/static",
    )

    # Set the static folder path for the verse generator
    verse_generator.set_static_folder(app.static_folder)

    # Load configuration
    app.config.from_object("backend.core.config.Config")

    # Set request size limits to prevent memory exhaustion attacks
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB limit

    # Session configuration
    is_production = os.getenv("FLASK_ENV") == "production" or os.getenv("GAE_ENV", "").startswith("standard")

    app.config["SECRET_KEY"] = config.session_secret_key
    app.config["SESSION_PERMANENT"] = True
    app.config["SESSION_USE_SIGNER"] = True
    app.config["SESSION_COOKIE_SECURE"] = is_production
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
    app.config["SESSION_REFRESH_EACH_REQUEST"] = False
    app.config["SESSION_COOKIE_NAME"] = "divinebridge_session"
    app.config["SESSION_COOKIE_PATH"] = "/"
    app.config["SESSION_COOKIE_DOMAIN"] = None

    # Use Redis sessions for multi-instance consistency; fall back to filesystem for local dev
    _redis_host = os.getenv("REDIS_HOST")
    if _redis_host:
        try:
            _session_redis = redis.Redis(
                host=_redis_host,
                port=int(os.getenv("REDIS_PORT", 6379)),
                password=os.getenv("REDIS_PASSWORD"),
                decode_responses=False,
                socket_connect_timeout=2,
            )
            _session_redis.ping()
            app.config["SESSION_TYPE"] = "redis"
            app.config["SESSION_REDIS"] = _session_redis
            logger.info("Using Redis for session storage (multi-instance safe)")
        except Exception as e:
            logger.warning(f"Redis session init failed, falling back to filesystem: {e}")
            app.config["SESSION_TYPE"] = "filesystem"
            app.config["SESSION_FILE_DIR"] = os.path.join(app.root_path, "flask_session")
            app.config["SESSION_FILE_THRESHOLD"] = 500
            app.config["SESSION_FILE_MODE"] = 0o600
            if not os.path.exists(app.config["SESSION_FILE_DIR"]):
                os.makedirs(app.config["SESSION_FILE_DIR"], mode=0o700)
    else:
        app.config["SESSION_TYPE"] = "filesystem"
        app.config["SESSION_FILE_DIR"] = os.path.join(app.root_path, "flask_session")
        app.config["SESSION_FILE_THRESHOLD"] = 500
        app.config["SESSION_FILE_MODE"] = 0o600
        if not os.path.exists(app.config["SESSION_FILE_DIR"]):
            os.makedirs(app.config["SESSION_FILE_DIR"], mode=0o700)

    Session(app)

    # Initialize CSRF protection
    csrf = CSRFProtect(app)

    # Initialize SocketIO for real-time communication
    socketio = None
    if SocketIO:
        socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
        logger.info("SocketIO initialized successfully")
    else:
        logger.warning("SocketIO not available, WebSocket features disabled")

    # Expose SocketIO instance on the app for module-level access
    app.socketio = socketio

    # Initialize rate limiter with user-based keys and Redis storage if available
    try:
        # Try to connect to Redis for distributed rate limiting
        redis_client = redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", 6379)),
            password=os.getenv("REDIS_PASSWORD"),
            decode_responses=True,
        )
        redis_client.ping()  # Test connection
        storage_uri = f"redis://{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', 6379)}"
        if os.getenv("REDIS_PASSWORD"):
            storage_uri = f"redis://:{os.getenv('REDIS_PASSWORD')}@{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', 6379)}"
        logger.info("✅ Using Redis for rate limiting storage")
    except Exception as e:
        logger.warning(f"Redis not available, using memory storage: {e}")
        storage_uri = "memory://"

    app.config["RATELIMIT_STORAGE_URI"] = storage_uri
    app.config["RATELIMIT_KEY_FUNC"] = get_user_based_key
    app.config["RATELIMIT_DEFAULT"] = "10000 per day;2000 per hour;100 per minute"
    limiter.init_app(app)

    # Add session middleware
    @app.before_request
    def before_request():
        session.permanent = True
        if "user" in session:
            session.modified = True

    @app.after_request
    def set_security_headers(response):
        # Security headers - always set for all responses
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Cross-Origin-Opener-Policy - Allow popups (needed for OAuth)
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"

        # HSTS (only in production with HTTPS)
        # Check if we're in production
        env = os.getenv("FLASK_ENV", "production")
        if env == "production" or os.getenv("GAE_ENV", "").startswith("standard"):
            if request.is_secure:
                response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # CDN and cache headers — Cloud CDN respects Cache-Control for edge caching
        if request.endpoint == "static" or request.path.startswith("/static/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif request.path.startswith("/api/prayer-room/"):
            response.headers["Cache-Control"] = "private, no-store"
        elif request.path.startswith("/api/prayer/prayer/") or request.path.startswith("/api/today-verse"):
            # Daily content: identical for all users, cache at CDN edge for 5 min
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=300"
        elif response.content_type and "text/html" in response.content_type:
            response.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
        elif response.content_type and (
            "application/json" in response.content_type or "text/javascript" in response.content_type
        ):
            response.headers["Cache-Control"] = "public, max-age=300"

        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.googleapis.com https://apis.google.com https://www.googletagmanager.com https://unpkg.com https://cdn.socket.io https://*.firebaseio.com https://*.firebasedatabase.app; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://www.gstatic.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://www.googletagmanager.com https://*.google-analytics.com https://cdn.socket.io https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://sfu.divinebridge.io wss://sfu.divinebridge.io wss://sfu-us.divinebridge.io wss://sfu-eu.divinebridge.io wss://sfu-ap.divinebridge.io ws://localhost:5001 wss://localhost:5001; "
            "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )

        # Permissions Policy
        response.headers["Permissions-Policy"] = (
            "geolocation=(), " "microphone=*, " "camera=*, " "payment=(), " "usb=()"
        )

        return response

    # Email configuration
    app.config["SMTP_SERVER"] = "smtp.gmail.com"
    app.config["SMTP_PORT"] = 587
    app.config["SENDER_EMAIL"] = "blessings@divinebridge.io"

    # Set host URL for email verification and password reset
    is_cloud_run = os.getenv("K_SERVICE") is not None
    default_host = "https://divinebridge.io" if is_cloud_run else "http://localhost:5001"
    app.config["HOST_URL"] = os.getenv("HOST_URL", default_host)
    logger.info(f"Configured HOST_URL: {app.config['HOST_URL']} (Cloud Run detected: {is_cloud_run})")

    # Configure CORS
    CORS(
        app,
        resources={
            r"/*": {
                "origins": config.CORS_ORIGINS,
                "methods": config.CORS_METHODS,
                "allow_headers": config.CORS_ALLOW_HEADERS,
                "supports_credentials": config.CORS_SUPPORTS_CREDENTIALS,
                "max_age": config.CORS_MAX_AGE,
            }
        },
    )

    # Initialize Firebase
    logger.info("Initializing Firebase...")
    try:
        if initialize_firebase():
            logger.info("Firebase initialized successfully")
            app.firebase_initialized = True
        else:
            error_msg = "Failed to initialize Firebase. Application may not function correctly."
            logger.error(error_msg)
            raise RuntimeError(error_msg)
    except Exception as e:
        error_msg = f"Error initializing Firebase: {str(e)}"
        logger.error(error_msg)
        raise RuntimeError(error_msg)

    # Initialize other components
    try:
        # Initialize storage handler
        app.storage_handler = StorageHandler()
        logger.info("Storage handler initialized")

        # Initialize prayer generator
        app.prayer_generator = PrayerGenerator(app.storage_handler)
        logger.info("Prayer generator initialized")

        # Use the singleton verse cache instance
        app.verse_cache = verse_cache
        logger.info("Verse cache initialized")

        # Initialize nonprofit services at startup to avoid lazy loading during requests
        logger.info("Pre-initializing nonprofit services...")
        from backend.services.community.location_service import get_location_service
        from backend.services.community.nonprofit_service import get_nonprofit_service
        from backend.services.disaster.disaster_extractor import get_disaster_extractor
        from backend.services.prayer.prayer_summary_generator import get_summary_generator

        app.location_service = get_location_service()
        app.nonprofit_service = get_nonprofit_service()
        app.disaster_extractor = get_disaster_extractor()
        app.summary_generator = get_summary_generator()
        logger.info("Nonprofit and prayer services initialized at startup")

        # Register blueprints through the canonical backend API boundary.
        # The routes package remains a compatibility layer during migration.
        from backend.api import (
            admin_bp,
            auth_bp,
            devotional_bp,
            email_bp,
            groups_bp,
            nonprofit_bp,
            prayer_bp,
            prayer_room_bp,
            seo_bp,
            testimony_bp,
            verse_bp,
        )

        # Exempt auth, prayer, verse, email, testimony, prayer room, nonprofit, seo, admin,
        # devotional, and groups blueprints from CSRF protection (all use Firebase token auth)
        csrf.exempt(auth_bp)
        csrf.exempt(prayer_bp)
        csrf.exempt(verse_bp)
        csrf.exempt(email_bp)
        csrf.exempt(testimony_bp)
        csrf.exempt(prayer_room_bp)
        csrf.exempt(nonprofit_bp)
        csrf.exempt(seo_bp)
        csrf.exempt(admin_bp)
        csrf.exempt(devotional_bp)
        csrf.exempt(groups_bp)

        app.register_blueprint(auth_bp, url_prefix="/api/auth")
        app.register_blueprint(prayer_bp, url_prefix="/api/prayer")
        app.register_blueprint(verse_bp, url_prefix="/api")
        app.register_blueprint(nonprofit_bp, url_prefix="/api/nonprofit")
        app.register_blueprint(email_bp, url_prefix="/api/email")
        app.register_blueprint(testimony_bp, url_prefix="/api/testimony")
        app.register_blueprint(prayer_room_bp, url_prefix="/api/prayer-room")
        app.register_blueprint(admin_bp)  # Admin routes at root level
        app.register_blueprint(seo_bp)  # SEO routes at root level
        app.register_blueprint(devotional_bp)  # /api/devotional
        app.register_blueprint(groups_bp)  # /api/groups

        from backend.web import card_bp, health_bp, pages_bp

        app.register_blueprint(pages_bp)
        app.register_blueprint(card_bp)
        app.register_blueprint(health_bp)

        # Exempt prayer room polling endpoints from rate limiting
        # These endpoints need high frequency access for WebRTC signaling and chat
        try:
            # Exempt using view function references
            exempt_endpoints = [
                # WebRTC Signaling (high frequency)
                "prayer_room.get_webrtc_offers",
                "prayer_room.get_webrtc_answers",
                "prayer_room.send_webrtc_offer",
                "prayer_room.send_webrtc_answer",
                "prayer_room.send_webrtc_candidate",
                "prayer_room.get_webrtc_candidates",
                # Chat (real-time messaging)
                "prayer_room.get_chat_messages",
                "prayer_room.send_chat_message",
                # Participants (frequent polling)
                "prayer_room.get_room_participants",
                # Voice activity (very high frequency)
                "prayer_room.update_speaking_state",
                # Room management (frequent checks)
                "prayer_room.join_prayer_room",
                "prayer_room.leave_prayer_room",
                "prayer_room.register_session",
                "prayer_room.disconnect_session",
                "prayer_room.check_session",
                # Mute/unmute (real-time control)
                "prayer_room.mute_participant",
                # ICE/TURN config (frequent during WebRTC setup)
                "prayer_room.get_ice_config",
                # Metrics and cleanup (monitoring)
                "prayer_room.get_metrics",
                "prayer_room.run_cleanup",
            ]

            # Get view functions after blueprint registration
            for endpoint_name in exempt_endpoints:
                view_func = app.view_functions.get(endpoint_name)
                if view_func:
                    limiter.exempt(view_func)
                    logger.info(f"Exempted {endpoint_name} from rate limiting")
                else:
                    logger.warning(f"Could not find view function {endpoint_name} to exempt")
        except Exception as e:
            logger.warning(f"Could not exempt prayer room endpoints: {e}", exc_info=True)

        logger.info("Blueprints registered")

        # WebSocket event handlers for real-time signaling
        if socketio:

            @socketio.on("join_room")
            def handle_join_room(data):
                """Handle user joining a room via WebSocket"""
                try:
                    room_id = data.get("room_id")
                    user = session.get("user")

                    if not user or not room_id:
                        emit("error", {"message": "Authentication required"})
                        return

                    join_room(room_id)
                    emit("joined_room", {"room_id": room_id, "user_id": user["uid"]})
                    logger.info(f"User {user['uid']} joined room {room_id} via WebSocket")

                except Exception as e:
                    logger.error(f"Error in join_room: {e}")
                    emit("error", {"message": "Failed to join room"})

            @socketio.on("leave_room")
            def handle_leave_room(data):
                """Handle user leaving a room via WebSocket"""
                try:
                    room_id = data.get("room_id")
                    user = session.get("user")

                    if not user or not room_id:
                        return

                    leave_room(room_id)
                    emit("left_room", {"room_id": room_id, "user_id": user["uid"]})
                    logger.info(f"User {user['uid']} left room {room_id} via WebSocket")

                except Exception as e:
                    logger.error(f"Error in leave_room: {e}")

            @socketio.on("webrtc_signal")
            def handle_webrtc_signal(data):
                """Handle WebRTC signaling via WebSocket"""
                try:
                    room_id = data.get("room_id")
                    to_user = data.get("to_user")
                    signal_type = data.get("type")  # 'offer', 'answer', 'candidate'
                    signal_data = data.get("data")
                    user = session.get("user")

                    if not user or not room_id or not to_user or not signal_type or not signal_data:
                        emit("error", {"message": "Invalid signal data"})
                        return

                    # Broadcast to specific user in the room
                    emit(
                        "webrtc_signal",
                        {
                            "from_user": user["uid"],
                            "to_user": to_user,
                            "type": signal_type,
                            "data": signal_data,
                            "timestamp": datetime.utcnow().isoformat(),
                        },
                        room=room_id,
                        include_self=False,
                    )

                    logger.info(f"WebRTC {signal_type} signal sent from {user['uid']} to {to_user} in room {room_id}")

                except Exception as e:
                    logger.error(f"Error in webrtc_signal: {e}")
                    emit("error", {"message": "Failed to send signal"})

            @socketio.on("chat_message")
            def handle_chat_message(data):
                """Handle chat messages via WebSocket"""
                try:
                    room_id = data.get("room_id")
                    message = data.get("message")
                    user = session.get("user")

                    if not user or not room_id or not message:
                        emit("error", {"message": "Invalid message data"})
                        return

                    # Broadcast to all users in the room
                    emit(
                        "chat_message",
                        {
                            "user_id": user["uid"],
                            "user_name": user.get("name", "Anonymous"),
                            "message": message,
                            "timestamp": datetime.utcnow().isoformat(),
                        },
                        room=room_id,
                    )

                    logger.info(f"Chat message from {user['uid']} in room {room_id}")

                except Exception as e:
                    logger.error(f"Error in chat_message: {e}")
                    emit("error", {"message": "Failed to send message"})

            @socketio.on("speaking_state")
            def handle_speaking_state(data):
                """Handle speaking state updates via WebSocket"""
                try:
                    room_id = data.get("room_id")
                    is_speaking = data.get("is_speaking", False)
                    user = session.get("user")

                    if not user or not room_id:
                        return

                    # Broadcast to all users in the room except sender
                    emit(
                        "speaking_state",
                        {
                            "user_id": user["uid"],
                            "is_speaking": is_speaking,
                            "timestamp": datetime.utcnow().isoformat(),
                        },
                        room=room_id,
                        include_self=False,
                    )

                except Exception as e:
                    logger.error(f"Error in speaking_state: {e}")

            logger.info("WebSocket handlers registered")

        logger.info("Prayer-room cleanup is run by Cloud Scheduler; no in-process sweep started")

    except Exception as e:
        error_msg = f"Failed to initialize application components: {str(e)}"
        logger.error(error_msg)
        raise RuntimeError(error_msg)

    # Log startup information
    logger.info("Application initialized successfully")
    logger.info(f"Environment: {app.config['ENV']}")
    logger.info(f"Debug mode: {app.debug}")

    return app


# Create the Flask application
app = create_app()


if __name__ == "__main__":
    # Respect PORT env (Cloud Run uses 8080); default to 5001 locally
    run_port = int(os.getenv("PORT", 5001))
    logger.info(f"Starting server on port {run_port}")
    socketio_instance = getattr(app, "socketio", None)
    if socketio_instance:
        # Allow unsafe Werkzeug for local development
        socketio_instance.run(app, port=run_port, debug=False, allow_unsafe_werkzeug=True)
    else:
        app.run(port=run_port, debug=False)
