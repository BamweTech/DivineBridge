from flask import Flask, render_template, request, jsonify, redirect, session, send_file, Response
import io
import json as _json
import qrcode
import logging
from datetime import datetime, timedelta
import os
from prayer_generator import PrayerGenerator
from config import get_config
from verse_cache import verse_cache
from flask_session import Session
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
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
from firebase_auth import initialize_firebase
from verse_generator import verse_generator
import threading
import time

# Initialize Sentry for error tracking and performance monitoring (Phase 3)
try:
    import sentry_sdk
    from sentry_sdk.integrations.flask import FlaskIntegration
    _sentry_dsn = os.getenv('SENTRY_DSN')
    if _sentry_dsn:
        sentry_sdk.init(
            dsn=_sentry_dsn,
            integrations=[FlaskIntegration()],
            traces_sample_rate=0.1,
            profiles_sample_rate=0.1,
            environment=os.getenv('FLASK_ENV', 'production'),
        )
except ImportError:
    pass

def get_user_based_key():
    """Get user-based key for rate limiting (preferred over IP)"""
    user = session.get('user')
    if user and user.get('uid'):
        return f"user:{user['uid']}"
    return get_remote_address()

# Import appropriate storage handler based on environment
USE_LOCAL_STORAGE = os.getenv('USE_LOCAL_STORAGE', 'false').lower() == 'true'
if USE_LOCAL_STORAGE:
    from local_storage import LocalStorageHandler as StorageHandler
    print("🔧 Using LocalStorageHandler for development")
else:
    from storage_handler import StorageHandler
    print("☁️  Using CloudStorageHandler for production")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('app.log', mode='a')
    ]
)

# Create logger
logger = logging.getLogger(__name__)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            logger.warning("No user in session, redirecting to login")
            redirect_path = request.path
            return redirect(f'/login?redirect={redirect_path}')
            
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.error(f"Error verifying session: {e}")
            session.clear()
            return redirect('/login')
    return decorated_function

# Get configuration
config = get_config()

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    
    # Set the static folder path for the verse generator
    verse_generator.set_static_folder(app.static_folder)
    
    # Load configuration
    app.config.from_object('config.Config')
    
    # Set request size limits to prevent memory exhaustion attacks
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB limit
    
    # Session configuration
    is_production = os.getenv('FLASK_ENV') == 'production' or os.getenv('GAE_ENV', '').startswith('standard')

    app.config['SECRET_KEY'] = config.session_secret_key
    app.config['SESSION_PERMANENT'] = True
    app.config['SESSION_USE_SIGNER'] = True
    app.config['SESSION_COOKIE_SECURE'] = is_production
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
    app.config['SESSION_REFRESH_EACH_REQUEST'] = False
    app.config['SESSION_COOKIE_NAME'] = 'divinebridge_session'
    app.config['SESSION_COOKIE_PATH'] = '/'
    app.config['SESSION_COOKIE_DOMAIN'] = None

    # Use Redis sessions for multi-instance consistency; fall back to filesystem for local dev
    _redis_host = os.getenv('REDIS_HOST')
    if _redis_host:
        try:
            _session_redis = redis.Redis(
                host=_redis_host,
                port=int(os.getenv('REDIS_PORT', 6379)),
                password=os.getenv('REDIS_PASSWORD'),
                decode_responses=False,
                socket_connect_timeout=2,
            )
            _session_redis.ping()
            app.config['SESSION_TYPE'] = 'redis'
            app.config['SESSION_REDIS'] = _session_redis
            logger.info("Using Redis for session storage (multi-instance safe)")
        except Exception as e:
            logger.warning(f"Redis session init failed, falling back to filesystem: {e}")
            app.config['SESSION_TYPE'] = 'filesystem'
            app.config['SESSION_FILE_DIR'] = os.path.join(app.root_path, 'flask_session')
            app.config['SESSION_FILE_THRESHOLD'] = 500
            app.config['SESSION_FILE_MODE'] = 0o600
            if not os.path.exists(app.config['SESSION_FILE_DIR']):
                os.makedirs(app.config['SESSION_FILE_DIR'], mode=0o700)
    else:
        app.config['SESSION_TYPE'] = 'filesystem'
        app.config['SESSION_FILE_DIR'] = os.path.join(app.root_path, 'flask_session')
        app.config['SESSION_FILE_THRESHOLD'] = 500
        app.config['SESSION_FILE_MODE'] = 0o600
        if not os.path.exists(app.config['SESSION_FILE_DIR']):
            os.makedirs(app.config['SESSION_FILE_DIR'], mode=0o700)

    Session(app)
    
    # Initialize CSRF protection
    csrf = CSRFProtect(app)
    
    # Initialize SocketIO for real-time communication
    socketio = None
    if SocketIO:
        socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
        logger.info("SocketIO initialized successfully")
    else:
        logger.warning("SocketIO not available, WebSocket features disabled")
    
    # Expose SocketIO instance on the app for module-level access
    app.socketio = socketio
    
    # Initialize rate limiter with user-based keys and Redis storage if available
    try:
        # Try to connect to Redis for distributed rate limiting
        redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', 6379)),
            password=os.getenv('REDIS_PASSWORD'),
            decode_responses=True
        )
        redis_client.ping()  # Test connection
        storage_uri = f"redis://{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', 6379)}"
        if os.getenv('REDIS_PASSWORD'):
            storage_uri = f"redis://:{os.getenv('REDIS_PASSWORD')}@{os.getenv('REDIS_HOST', 'localhost')}:{os.getenv('REDIS_PORT', 6379)}"
        logger.info("✅ Using Redis for rate limiting storage")
    except Exception as e:
        logger.warning(f"Redis not available, using memory storage: {e}")
        storage_uri = "memory://"
    
    limiter = Limiter(
        app,
        key_func=get_user_based_key,  # Use user-based keys instead of IP
        default_limits=["10000 per day", "2000 per hour", "100 per minute"],
        storage_uri=storage_uri
    )
    
    # Add session middleware
    @app.before_request
    def before_request():
        session.permanent = True
        if 'user' in session:
            session.modified = True
            logger.info(f"Session contains user: {session['user'].get('uid', 'unknown')}")
        else:
            logger.info("No user in session")
    
    @app.after_request
    def set_security_headers(response):
        # Security headers - always set for all responses
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        
        # Cross-Origin-Opener-Policy - Allow popups (needed for OAuth)
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups'
        
        # HSTS (only in production with HTTPS)
        # Check if we're in production
        env = os.getenv('FLASK_ENV', 'production')
        if env == 'production' or os.getenv('GAE_ENV', '').startswith('standard'):
            if request.is_secure:
                response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
        # CDN and cache headers — Cloud CDN respects Cache-Control for edge caching
        if request.endpoint == 'static' or request.path.startswith('/static/'):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        elif request.path.startswith('/api/prayer-room/'):
            response.headers['Cache-Control'] = 'private, no-store'
        elif request.path.startswith('/api/prayer/prayer/') or request.path.startswith('/api/today-verse'):
            # Daily content: identical for all users, cache at CDN edge for 5 min
            response.headers['Cache-Control'] = 'public, max-age=300, s-maxage=300'
        elif response.content_type and 'text/html' in response.content_type:
            response.headers['Cache-Control'] = 'public, max-age=60, must-revalidate'
        elif response.content_type and ('application/json' in response.content_type or 'text/javascript' in response.content_type):
            response.headers['Cache-Control'] = 'public, max-age=300'
        
        # Content Security Policy
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.googleapis.com https://apis.google.com https://www.googletagmanager.com https://unpkg.com https://cdn.socket.io https://*.firebaseio.com https://*.firebasedatabase.app; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://www.gstatic.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://www.googletagmanager.com https://*.google-analytics.com https://cdn.socket.io https://*.firebaseio.com wss://*.firebaseio.com https://*.firebasedatabase.app wss://*.firebasedatabase.app https://sfu.divinebridge.io wss://sfu.divinebridge.io ws://localhost:5001 wss://localhost:5001; "
            "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        
        # Permissions Policy
        response.headers['Permissions-Policy'] = (
            "geolocation=(), "
            "microphone=*, "
            "camera=*, "
            "payment=(), "
            "usb=()"
        )
        
        return response
    
    # Email configuration
    app.config['SMTP_SERVER'] = 'smtp.gmail.com'
    app.config['SMTP_PORT'] = 587
    app.config['SENDER_EMAIL'] = 'blessings@divinebridge.io'
    
    # Set host URL for email verification and password reset
    is_cloud_run = os.getenv('K_SERVICE') is not None
    default_host = 'https://divinebridge.io' if is_cloud_run else 'http://localhost:5001'
    app.config['HOST_URL'] = os.getenv('HOST_URL', default_host)
    logger.info(f"Configured HOST_URL: {app.config['HOST_URL']} (Cloud Run detected: {is_cloud_run})")
    
    # Configure CORS
    CORS(app, resources={
        r"/*": {
            "origins": config.CORS_ORIGINS,
            "methods": config.CORS_METHODS,
            "allow_headers": config.CORS_ALLOW_HEADERS,
            "supports_credentials": config.CORS_SUPPORTS_CREDENTIALS,
            "max_age": config.CORS_MAX_AGE
        }
    })
    
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
        from location_service import get_location_service
        from nonprofit_service import get_nonprofit_service
        from disaster_extractor import get_disaster_extractor
        from prayer_summary_generator import get_summary_generator
        
        app.location_service = get_location_service()
        app.nonprofit_service = get_nonprofit_service()
        app.disaster_extractor = get_disaster_extractor()
        app.summary_generator = get_summary_generator()
        logger.info("Nonprofit and prayer services initialized at startup")
        
        # Register blueprints
        from routes import auth_bp, prayer_bp, verse_bp
        from routes.nonprofit_bp import nonprofit_bp
        from routes.seo_bp import seo_bp
        from routes.email_bp import email_bp
        from routes.testimony_bp import testimony_bp
        from routes.prayer_room_bp import prayer_room_bp
        from routes.admin_bp import admin_bp
        from routes.devotional_bp import devotional_bp
        from routes.groups_bp import groups_bp

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

        app.register_blueprint(auth_bp, url_prefix='/api/auth')
        app.register_blueprint(prayer_bp, url_prefix='/api/prayer')
        app.register_blueprint(verse_bp, url_prefix='/api')
        app.register_blueprint(nonprofit_bp, url_prefix='/api/nonprofit')
        app.register_blueprint(email_bp, url_prefix='/api/email')
        app.register_blueprint(testimony_bp, url_prefix='/api/testimony')
        app.register_blueprint(prayer_room_bp, url_prefix='/api/prayer-room')
        app.register_blueprint(admin_bp)  # Admin routes at root level
        app.register_blueprint(seo_bp)  # SEO routes at root level
        app.register_blueprint(devotional_bp)  # /api/devotional
        app.register_blueprint(groups_bp)  # /api/groups
        
        # Exempt prayer room polling endpoints from rate limiting
        # These endpoints need high frequency access for WebRTC signaling and chat
        try:
            # Exempt using view function references
            exempt_endpoints = [
                # WebRTC Signaling (high frequency)
                'prayer_room.get_webrtc_offers',
                'prayer_room.get_webrtc_answers',
                'prayer_room.send_webrtc_offer',
                'prayer_room.send_webrtc_answer',
                'prayer_room.send_webrtc_candidate',
                'prayer_room.get_webrtc_candidates',
                
                # Chat (real-time messaging)
                'prayer_room.get_chat_messages',
                'prayer_room.send_chat_message',
                
                # Participants (frequent polling)
                'prayer_room.get_room_participants',
                
                # Voice activity (very high frequency)
                'prayer_room.update_speaking_state',
                
                # Room management (frequent checks)
                'prayer_room.join_prayer_room',
                'prayer_room.leave_prayer_room',
                'prayer_room.register_session',
                'prayer_room.disconnect_session',
                'prayer_room.check_session',
                
                # Mute/unmute (real-time control)
                'prayer_room.mute_participant',
                
                # ICE/TURN config (frequent during WebRTC setup)
                'prayer_room.get_ice_config',
                
                # Metrics and cleanup (monitoring)
                'prayer_room.get_metrics',
                'prayer_room.run_cleanup'
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
            @socketio.on('join_room')
            def handle_join_room(data):
                """Handle user joining a room via WebSocket"""
                try:
                    room_id = data.get('room_id')
                    user = session.get('user')
                    
                    if not user or not room_id:
                        emit('error', {'message': 'Authentication required'})
                        return
                    
                    join_room(room_id)
                    emit('joined_room', {'room_id': room_id, 'user_id': user['uid']})
                    logger.info(f"User {user['uid']} joined room {room_id} via WebSocket")
                    
                except Exception as e:
                    logger.error(f"Error in join_room: {e}")
                    emit('error', {'message': 'Failed to join room'})
            
            @socketio.on('leave_room')
            def handle_leave_room(data):
                """Handle user leaving a room via WebSocket"""
                try:
                    room_id = data.get('room_id')
                    user = session.get('user')
                    
                    if not user or not room_id:
                        return
                    
                    leave_room(room_id)
                    emit('left_room', {'room_id': room_id, 'user_id': user['uid']})
                    logger.info(f"User {user['uid']} left room {room_id} via WebSocket")
                    
                except Exception as e:
                    logger.error(f"Error in leave_room: {e}")
            
            @socketio.on('webrtc_signal')
            def handle_webrtc_signal(data):
                """Handle WebRTC signaling via WebSocket"""
                try:
                    room_id = data.get('room_id')
                    to_user = data.get('to_user')
                    signal_type = data.get('type')  # 'offer', 'answer', 'candidate'
                    signal_data = data.get('data')
                    user = session.get('user')
                    
                    if not user or not room_id or not to_user or not signal_type or not signal_data:
                        emit('error', {'message': 'Invalid signal data'})
                        return
                    
                    # Broadcast to specific user in the room
                    emit('webrtc_signal', {
                        'from_user': user['uid'],
                        'to_user': to_user,
                        'type': signal_type,
                        'data': signal_data,
                        'timestamp': datetime.utcnow().isoformat()
                    }, room=room_id, include_self=False)
                    
                    logger.info(f"WebRTC {signal_type} signal sent from {user['uid']} to {to_user} in room {room_id}")
                    
                except Exception as e:
                    logger.error(f"Error in webrtc_signal: {e}")
                    emit('error', {'message': 'Failed to send signal'})
            
            @socketio.on('chat_message')
            def handle_chat_message(data):
                """Handle chat messages via WebSocket"""
                try:
                    room_id = data.get('room_id')
                    message = data.get('message')
                    user = session.get('user')
                    
                    if not user or not room_id or not message:
                        emit('error', {'message': 'Invalid message data'})
                        return
                    
                    # Broadcast to all users in the room
                    emit('chat_message', {
                        'user_id': user['uid'],
                        'user_name': user.get('name', 'Anonymous'),
                        'message': message,
                        'timestamp': datetime.utcnow().isoformat()
                    }, room=room_id)
                    
                    logger.info(f"Chat message from {user['uid']} in room {room_id}")
                    
                except Exception as e:
                    logger.error(f"Error in chat_message: {e}")
                    emit('error', {'message': 'Failed to send message'})
            
            @socketio.on('speaking_state')
            def handle_speaking_state(data):
                """Handle speaking state updates via WebSocket"""
                try:
                    room_id = data.get('room_id')
                    is_speaking = data.get('is_speaking', False)
                    user = session.get('user')
                    
                    if not user or not room_id:
                        return
                    
                    # Broadcast to all users in the room except sender
                    emit('speaking_state', {
                        'user_id': user['uid'],
                        'is_speaking': is_speaking,
                        'timestamp': datetime.utcnow().isoformat()
                    }, room=room_id, include_self=False)
                    
                except Exception as e:
                    logger.error(f"Error in speaking_state: {e}")
            
            logger.info("WebSocket handlers registered")
        
        # Start background cleanup thread
        def cleanup_worker():
            while True:
                try:
                    time.sleep(300)  # Run every 5 minutes
                    from routes.prayer_room_bp import cleanup_inactive_sessions, cleanup_signaling_artifacts, cleanup_old_chat_messages
                    
                    sessions_cleaned = cleanup_inactive_sessions()
                    signaling_cleaned = cleanup_signaling_artifacts()
                    chat_cleaned = cleanup_old_chat_messages()
                    
                    if sessions_cleaned + signaling_cleaned + chat_cleaned > 0:
                        logger.info(f"Background cleanup: {sessions_cleaned} sessions, {signaling_cleaned} signaling, {chat_cleaned} chat messages")
                        
                except Exception as e:
                    logger.error(f"Background cleanup error: {e}")
        
        cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
        cleanup_thread.start()
        logger.info("Background cleanup thread started")
        
    except Exception as e:
        error_msg = f"Failed to initialize application components: {str(e)}"
        logger.error(error_msg)
        raise RuntimeError(error_msg)
    
    # Log startup information
    logger.info("Application initialized successfully")
    logger.info(f"Environment: {app.config['ENV']}")
    logger.info(f"Debug mode: {app.debug}")
    
    # Add main routes
    @app.route('/login')
    def login():
        """Serve the login page"""
        return render_template('login.html')

    @app.route('/signup')
    def signup():
        """Serve the signup page"""
        return render_template('register.html')

    @app.route('/prayers')
    def prayers():
        """Serve the prayers page"""
        return render_template('prayers.html')

    @app.route('/prayer-room')
    def prayer_room():
        """Serve the Live Prayer Room directory page"""
        logger.info("🔍 DEBUG: Rendering prayer_rooms_standalone.html template")
        
        # Get Firebase configuration for authentication
        firebase_config = config.FIREBASE_CLIENT_CONFIG
        if isinstance(firebase_config, str):
            import json
            firebase_config = json.loads(firebase_config)
        
        return render_template('prayer_rooms_standalone.html', firebase_config=firebase_config)

    @app.route('/prayer-room/join')
    def join_prayer_room():
        """Serve the individual prayer room page"""
        room_id = request.args.get('room')
        room_code = request.args.get('code')  # Room code for private rooms
        
        if not room_id:
            return redirect('/prayer-room')
        
        # Fetch the actual room name from the database
        room_name = 'Prayer Room'  # Default fallback
        room_privacy = 'public'  # Default fallback
        try:
            from firebase_auth import get_firestore_client
            db = get_firestore_client()
            room_doc = db.collection('prayer_rooms').document(room_id).get()
            
            if room_doc.exists:
                room_data = room_doc.to_dict()
                room_name = room_data.get('room_name', f'Prayer Room {room_id[:6]}')
                room_privacy = room_data.get('room_privacy', 'public')
                logger.info(f"Found room name in database: {room_name}, privacy: {room_privacy}")
            else:
                logger.warning(f"Room {room_id} not found in database, using fallback name")
                room_name = f'Prayer Room {room_id[:6]}'
        except Exception as e:
            logger.error(f"Error fetching room name from database: {e}")
            room_name = f'Prayer Room {room_id[:6]}'
        
        # Get Firebase configuration
        firebase_config = config.FIREBASE_CLIENT_CONFIG
        if isinstance(firebase_config, str):
            import json
            firebase_config = json.loads(firebase_config)
        
        logger.info("🔍 DEBUG: Rendering prayer_room_standalone.html template")
        from flask import make_response
        response = make_response(render_template('prayer_room_standalone.html', 
                                                 room_id=room_id, 
                                                 room_name=room_name,
                                                 room_code=room_code,
                                                 room_privacy=room_privacy,
                                                 firebase_config=firebase_config))
        
        # Add permissions policy header to allow microphone access
        response.headers['Permissions-Policy'] = 'microphone=*'
        return response

    @app.route('/daily-prayer')
    def daily_prayer():
        """Serve the daily prayer page"""
        return render_template('daily_prayer.html')

    @app.route('/about')
    def about():
        """Serve the about page"""
        return render_template('about.html')

    @app.route('/contact')
    def contact():
        """Serve the contact page"""
        return render_template('contact.html')

    @app.route('/faq')
    def faq():
        """Serve the FAQ page"""
        return render_template('faq.html')

    @app.route('/privacy-policy')
    def privacy_policy():
        """Serve the privacy policy page"""
        return render_template('privacy_policy.html')

    @app.route('/terms-of-service')
    def terms_of_service():
        """Serve the terms of service page"""
        return render_template('terms_of_service.html')

    @app.route('/robots.txt')
    def robots_txt():
        """Serve robots.txt for SEO"""
        from flask import send_from_directory
        return send_from_directory(app.static_folder, 'robots.txt')

    @app.route('/google<path:filename>')
    def google_verification(filename):
        """Serve Google Search Console verification file"""
        from flask import send_from_directory
        return send_from_directory(app.static_folder, f'google{filename}')

    @app.route('/profile')
    def profile():
        """Serve the profile page"""
        return render_template('profile.html')

    @app.route('/edit-profile')
    def edit_profile():
        """Serve the edit profile page"""
        return render_template('edit_profile.html')

    @app.route('/change-password')
    def change_password():
        """Serve the change password page"""
        return render_template('change_password.html')
    
    @app.route('/card/<user_id>')
    def public_card(user_id):
        """Serve the public business card page"""
        try:
            from firebase_admin import firestore
            db = firestore.client()
            user_ref = db.collection('users').document(user_id)
            user_doc = user_ref.get()
            
            # Get user data for OG meta tags
            user_name = "Business Card"
            if user_doc.exists:
                user_data = user_doc.to_dict()
                first_name = user_data.get('firstName', '')
                last_name = user_data.get('lastName', '')
                if first_name or last_name:
                    user_name = f"{first_name} {last_name}".strip()
            
            return render_template('public_card.html', user_id=user_id, user_name=user_name)
        except Exception as e:
            logger.error(f"Error loading user data for card page: {e}")
            # Fallback to default if error
            return render_template('public_card.html', user_id=user_id, user_name="Business Card")
    
    return app

# Create the Flask application
app = create_app()

# Daily prayer cache: Redis-backed with in-process fallback.
# Ensures all Cloud Run instances serve the same cached prayer.
_daily_prayer_local_cache = {}
_daily_prayer_local_date = None

def _get_prayer_redis():
    """Return a Redis client for prayer caching, or None."""
    try:
        host = os.getenv('REDIS_HOST')
        if not host:
            return None
        client = redis.Redis(
            host=host,
            port=int(os.getenv('REDIS_PORT', 6379)),
            password=os.getenv('REDIS_PASSWORD'),
            decode_responses=True,
            socket_connect_timeout=2,
        )
        client.ping()
        return client
    except Exception:
        return None

_prayer_redis = _get_prayer_redis()

def get_daily_prayer_for_date(date_str):
    """Get daily prayer for a specific date with caching.
    If prayer doesn't exist and it's today's date, attempt to generate it."""
    global _daily_prayer_local_cache, _daily_prayer_local_date

    # Reset local cache on date change
    if _daily_prayer_local_date != date_str:
        _daily_prayer_local_cache = {}
        _daily_prayer_local_date = date_str

    # Fast path: in-process cache
    if date_str in _daily_prayer_local_cache:
        return _daily_prayer_local_cache[date_str]

    # Shared path: Redis cache (available to all instances)
    redis_key = f"divinebridge:prayer:{date_str}"
    if _prayer_redis:
        try:
            raw = _prayer_redis.get(redis_key)
            if raw:
                cached = _json.loads(raw)
                _daily_prayer_local_cache[date_str] = cached
                return cached
        except Exception:
            pass

    try:
        daily_prayer = app.storage_handler.get_prayer(date_str)

        if not daily_prayer:
            today = datetime.now().strftime('%Y-%m-%d')
            if date_str == today:
                logger.info(f"No prayer found for today ({date_str}), attempting to generate one...")
                try:
                    new_prayer = app.prayer_generator.generate_prayer()
                    if new_prayer:
                        logger.info(f"Successfully generated prayer for {date_str}")
                        daily_prayer = new_prayer
                    else:
                        logger.error(f"Failed to generate prayer for {date_str}")
                except Exception as gen_error:
                    logger.error(f"Error generating prayer for {date_str}: {gen_error}", exc_info=True)
            else:
                logger.info(f"No prayer found in storage for date: {date_str} (not today, won't auto-generate)")

        if daily_prayer:
            is_daily_prayer = daily_prayer.get('source') == 'generated' and not daily_prayer.get('title')

            if is_daily_prayer:
                if 'content' in daily_prayer and daily_prayer['content']:
                    import re
                    daily_prayer['content'] = re.sub(r'\[\d+\]', '', daily_prayer['content'])
                    daily_prayer['content'] = re.sub(r'[ \t]+', ' ', daily_prayer['content'])
                    daily_prayer['content'] = daily_prayer['content'].strip()
            else:
                logger.warning(f"Prayer found for {date_str} but it's not a daily prayer (source={daily_prayer.get('source')}, title={daily_prayer.get('title')})")
                daily_prayer = None

        _daily_prayer_local_cache[date_str] = daily_prayer

        # Store in Redis for other instances (TTL: 24 hours)
        if _prayer_redis and daily_prayer:
            try:
                _prayer_redis.setex(redis_key, 86400, _json.dumps(daily_prayer))
            except Exception:
                pass

        return daily_prayer
    except Exception as e:
        logger.error(f"Error fetching daily prayer for {date_str}: {e}", exc_info=True)
        return None

@app.route('/')
def index():
    """Serve the home page as main landing page with server-side rendered verse and prayer"""
    try:
        # Get client's local date from query parameter if provided (for timezone accuracy)
        # Otherwise use server date as fallback
        client_date = request.args.get('client_date')
        if client_date:
            try:
                # Validate date format
                datetime.strptime(client_date, '%Y-%m-%d')
                today = client_date
                # Calculate day of year from client date
                client_datetime = datetime.strptime(client_date, '%Y-%m-%d')
                day_of_year = client_datetime.timetuple().tm_yday
                logger.info(f"Using client's local date: {today} (day of year: {day_of_year})")
            except ValueError:
                # Invalid date format, fall back to server date
                today = datetime.now().strftime('%Y-%m-%d')
                day_of_year = datetime.now().timetuple().tm_yday
                logger.warning(f"Invalid client_date format: {client_date}, using server date: {today}")
        else:
            # No client date provided, use server date (will be corrected client-side)
            today = datetime.now().strftime('%Y-%m-%d')
            day_of_year = datetime.now().timetuple().tm_yday
            logger.info(f"No client_date provided, using server date: {today}")
        
        # Get verse (cached) - use client's day of year if provided
        verse = app.verse_cache.get_today_verse(day_of_year=day_of_year)
        
        # Get daily prayer (cached) - use client's local date if provided
        daily_prayer = get_daily_prayer_for_date(today)
        
        # Format verse for template
        verse_data = verse if verse else {
            'verse': 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
            'reference': 'John 3:16'
        }
        
        # Format prayer for template
        prayer_data = None
        if daily_prayer and daily_prayer.get('content'):
            # Format date for display
            try:
                prayer_date = datetime.strptime(daily_prayer.get('date', today), '%Y-%m-%d')
            except:
                prayer_date = datetime.now()
            
            # Format content: escape HTML, then convert newlines to <br> tags
            import html
            content = daily_prayer.get('content', '')
            # Escape HTML entities first
            content_escaped = html.escape(content)
            # Convert double newlines to paragraph breaks, single newlines to line breaks
            content_formatted = content_escaped.replace('\n\n', '<br><br>').replace('\n', '<br>')
            
            prayer_data = {
                'content': content_formatted,
                'date': daily_prayer.get('date', today),  # Pass ISO date, let client format with local timezone
                'date_iso': daily_prayer.get('date', today)
            }
        
        return render_template('index.html', 
                             verse=verse_data, 
                             daily_prayer=prayer_data,
                             today_date=today)
    except Exception as e:
        logger.error(f"Error rendering home page: {e}")
        # Fallback to basic render if there's an error
        return render_template('index.html', 
                             verse={'verse': 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.', 'reference': 'John 3:16'},
                             daily_prayer=None,
                             today_date=datetime.now().strftime('%Y-%m-%d'))

@app.route('/home')
def home():
    """Serve the home page (alias for /)"""
    return index()

@app.route('/api/og-image')
def og_image():
    """Serve today's prayer image for Open Graph / social media preview"""
    try:
        from flask import send_file
        from io import BytesIO
        
        # Get today's date
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Try to get cached prayer image first
        cached_image = app.storage_handler.get_prayer_image(today)
        if cached_image:
            logger.info(f"Serving cached prayer image for OG preview: {today}")
            return send_file(
                BytesIO(cached_image),
                mimetype='image/jpeg',
                as_attachment=False,
                download_name=f'divine_bridge_og_{today}.jpg'
            )
        
        # If no cached image, generate it
        prayer = app.storage_handler.get_prayer(today)
        if not prayer:
            logger.warning(f"No prayer found for OG image: {today}")
            # Return a default OG image or 404
            return jsonify({'error': 'No prayer available'}), 404
        
        # Extract prayer content
        if isinstance(prayer, dict):
            prayer_content = prayer.get('content', '')
        else:
            prayer_content = prayer
        
        if not prayer_content:
            return jsonify({'error': 'Prayer content is empty'}), 404
        
        # Generate and cache image
        from image_generator import get_image_generator
        generator = get_image_generator()
        date_str = datetime.now().strftime('%B %d, %Y')
        
        image_data = generator.generate_prayer_image(
            prayer_text=prayer_content,
            date=date_str
        )
        
        # Save to cache
        image_bytes = image_data.getvalue()
        app.storage_handler.save_prayer_image(today, image_bytes)
        logger.info(f"Generated and cached prayer image for OG preview: {today}")
        
        # Reset and send
        image_data.seek(0)
        return send_file(
            image_data,
            mimetype='image/jpeg',
            as_attachment=False,
            download_name=f'divine_bridge_og_{today}.jpg'
        )
        
    except Exception as e:
        logger.error(f"Error serving OG image: {e}")
        return jsonify({'error': 'Failed to generate OG image'}), 500


@app.route('/forgot-password')
def forgot_password():
    """Serve the forgot password page"""
    return render_template('forgot_password.html')

@app.route('/reset-password')
def reset_password():
    """Serve the reset password page"""
    return render_template('reset_password.html')

@app.route('/verify-email')
def verify_email():
    """Serve the verify email page"""
    return render_template('verify_email.html')

@app.route('/unsubscribe', methods=['GET', 'POST'])
def unsubscribe():
    """
    Unsubscribe from Divine Bridge daily prayer emails.

    Supports:
    - GET /unsubscribe?email=... (prefill form)
    - POST /unsubscribe (form submit)

    Note: This endpoint is used by email unsubscribe links, so it must work without auth.
    """
    from config import get_config
    cfg = get_config()
    sender_email = getattr(cfg, 'SENDER_EMAIL', None) or app.config.get('SENDER_EMAIL', 'blessings@divinebridge.io')

    if request.method == 'GET':
        email = request.args.get('email', '').strip()
        return render_template('unsubscribe.html', email=email, sender_email=sender_email)

    # POST: process unsubscribe
    email = (request.form.get('email') or '').strip()
    if not email or '@' not in email:
        return render_template('unsubscribe.html', email=email, sender_email=sender_email, error='Please enter a valid email address.')

    try:
        # Update Firestore subscription flag (best-effort)
        from firebase_admin import firestore
        db = firestore.client()

        users_ref = db.collection('users')
        matches = users_ref.where('email', '==', email).stream()
        updated = 0
        for doc in matches:
            doc.reference.set({
                'email_subscribed': False,
                'email_unsubscribed_at': datetime.utcnow().isoformat()
            }, merge=True)
            updated += 1

        logger.info(f"Unsubscribe request processed for {email}. Updated users: {updated}")
    except Exception as e:
        # Do not leak errors to user; unsubscribe should appear successful
        logger.error(f"Error processing unsubscribe for {email}: {e}")

    return render_template('unsubscribe_confirmation.html', sender_email=sender_email)

@app.route('/_ah/health')
def health_check():
    """Health check endpoint for Cloud Run"""
    try:
        status = {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'firebase_initialized': getattr(app, 'firebase_initialized', False)
        }
        return jsonify(status), 200
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({'status': 'unhealthy', 'error': str(e)}), 500

@app.route('/api/card/<user_id>/vcard')
def get_vcard(user_id):
    """Generate and download vCard file for user's business card"""
    try:
        from firebase_admin import firestore
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({'error': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        
        # Check if business card is enabled
        if not user_data.get('businessCardEnabled', False):
            return jsonify({'error': 'Business card not available'}), 404
        
        # Get user data
        first_name = user_data.get('firstName', '')
        last_name = user_data.get('lastName', '')
        email = user_data.get('email', '')
        phone = user_data.get('phoneNumber', '')
        linkedin = user_data.get('linkedin', '')
        
        # Generate vCard
        vcard_lines = ['BEGIN:VCARD', 'VERSION:3.0']
        
        # Name
        if first_name or last_name:
            vcard_lines.append(f'N:{last_name};{first_name};;;')
            vcard_lines.append(f'FN:{first_name} {last_name}'.strip())
        
        # Email
        if email:
            vcard_lines.append(f'EMAIL;TYPE=INTERNET:{email}')
        
        # Phone
        if phone:
            # Normalize phone number (remove formatting)
            phone_clean = ''.join(filter(str.isdigit, phone))
            vcard_lines.append(f'TEL;TYPE=CELL:{phone_clean}')
        
        # URL (LinkedIn)
        if linkedin:
            vcard_lines.append(f'URL:{linkedin}')
        
        # Website
        vcard_lines.append('URL;TYPE=WORK:https://divinebridge.io')
        
        vcard_lines.append('END:VCARD')
        
        vcard_content = '\n'.join(vcard_lines)
        
        # Create response
        response = Response(
            vcard_content,
            mimetype='text/vcard',
            headers={
                'Content-Disposition': f'attachment; filename="{first_name}_{last_name}.vcf"'.replace(' ', '_')
            }
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error generating vCard: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to generate vCard'}), 500

@app.route('/api/card/<user_id>/qr')
def get_qr_code(user_id):
    """Generate QR code image for user's business card"""
    try:
        from firebase_admin import firestore
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            logger.warning(f"QR code requested for non-existent user: {user_id}")
            return jsonify({'error': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        
        # Get the public card URL (generate QR even if not enabled, for preview purposes)
        request_url = request.url_root.rstrip('/')
        card_url = f"{request_url}/card/{user_id}"
        
        # Generate QR code
        try:
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=4,
            )
            qr.add_data(card_url)
            qr.make(fit=True)
            
            # Create image
            img = qr.make_image(fill_color="black", back_color="white")
            
            # Convert to bytes
            img_bytes = io.BytesIO()
            img.save(img_bytes, format='PNG')
            img_bytes.seek(0)
            
            logger.info(f"Successfully generated QR code for user: {user_id}")
            return send_file(
                img_bytes,
                mimetype='image/png',
                as_attachment=False
            )
        except Exception as qr_error:
            logger.error(f"Error in QR code generation: {qr_error}")
            import traceback
            logger.error(traceback.format_exc())
            return jsonify({'error': 'Failed to generate QR code image'}), 500
        
    except Exception as e:
        logger.error(f"Error generating QR code: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to generate QR code'}), 500

@app.route('/api/card/<user_id>')
def get_card_data(user_id):
    """Get public business card data (for API access)"""
    try:
        from firebase_admin import firestore
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({'error': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        
        # Check if business card is enabled
        if not user_data.get('businessCardEnabled', False):
            return jsonify({'error': 'Business card not available'}), 404
        
        # Return card data
        card_data = {
            'firstName': user_data.get('firstName', ''),
            'lastName': user_data.get('lastName', ''),
            'email': user_data.get('email', ''),
            'phoneNumber': user_data.get('phoneNumber', ''),
            'linkedin': user_data.get('linkedin', '')
        }
        
        return jsonify(card_data), 200
        
    except Exception as e:
        logger.error(f"Error getting card data: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to get card data'}), 500

if __name__ == '__main__':
    # Respect PORT env (Cloud Run uses 8080); default to 5001 locally
    run_port = int(os.getenv('PORT', 5001))
    logger.info(f"Starting server on port {run_port}")
    socketio_instance = getattr(app, 'socketio', None)
    if socketio_instance:
        # Allow unsafe Werkzeug for local development
        socketio_instance.run(app, port=run_port, debug=False, allow_unsafe_werkzeug=True)
    else:
        app.run(port=run_port, debug=False)