from flask import Flask, render_template, request, jsonify, redirect, session
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
from functools import wraps
from firebase_auth import initialize_firebase
from verse_generator import verse_generator

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
    # Determine environment
    is_production = os.getenv('FLASK_ENV') == 'production' or os.getenv('GAE_ENV', '').startswith('standard')
    
    # Load secret key from Secret Manager
    app.config['SECRET_KEY'] = config.session_secret_key
    app.config['SESSION_TYPE'] = 'filesystem'
    app.config['SESSION_PERMANENT'] = True
    app.config['SESSION_USE_SIGNER'] = True
    # Secure session cookies in production
    is_production = os.getenv('FLASK_ENV') == 'production' or os.getenv('GAE_ENV', '').startswith('standard')
    app.config['SESSION_COOKIE_SECURE'] = is_production
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
    app.config['SESSION_FILE_DIR'] = os.path.join(app.root_path, 'flask_session')
    app.config['SESSION_FILE_THRESHOLD'] = 500  # Maximum number of sessions to store
    app.config['SESSION_FILE_MODE'] = 0o600  # Secure file permissions
    app.config['SESSION_REFRESH_EACH_REQUEST'] = False  # Don't refresh session on each request
    app.config['SESSION_COOKIE_NAME'] = 'divinebridge_session'  # Custom session cookie name
    app.config['SESSION_COOKIE_PATH'] = '/'  # Ensure cookie is available for all paths
    app.config['SESSION_COOKIE_DOMAIN'] = None  # Allow cookie for all domains in development
    
    # Create session directory if it doesn't exist
    if not os.path.exists(app.config['SESSION_FILE_DIR']):
        os.makedirs(app.config['SESSION_FILE_DIR'], mode=0o700)
    
    # Initialize Flask-Session before other extensions
    Session(app)
    
    # Initialize CSRF protection
    csrf = CSRFProtect(app)
    
    # Initialize rate limiter
    limiter = Limiter(
        app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"]
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
        
        # Content Security Policy
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.googleapis.com https://apis.google.com https://unpkg.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://www.gstatic.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com; "
            "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        
        # Permissions Policy
        response.headers['Permissions-Policy'] = (
            "geolocation=(), "
            "microphone=*, "
            "camera=(), "
            "payment=(), "
            "usb=()"
        )
        
        return response
    
    # Email configuration
    app.config['SMTP_SERVER'] = 'smtp.gmail.com'
    app.config['SMTP_PORT'] = 587
    app.config['SENDER_EMAIL'] = 'divinebridge.prayer@gmail.com'
    
    # Set host URL for email verification and password reset
    app.config['HOST_URL'] = 'http://localhost:5001'  # Local development URL
    
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
        
        # Exempt auth, prayer, email, testimony, prayer room, and nonprofit blueprints from CSRF protection
        # Auth uses Firebase token auth, Prayer/Email use Cloud Scheduler verification
        csrf.exempt(auth_bp)
        csrf.exempt(prayer_bp)
        csrf.exempt(email_bp)
        csrf.exempt(testimony_bp)
        csrf.exempt(prayer_room_bp)
        csrf.exempt(nonprofit_bp)
        
        app.register_blueprint(auth_bp, url_prefix='/api/auth')
        app.register_blueprint(prayer_bp, url_prefix='/api/prayer')
        app.register_blueprint(verse_bp, url_prefix='/api')
        app.register_blueprint(nonprofit_bp, url_prefix='/api/nonprofit')
        app.register_blueprint(email_bp, url_prefix='/api/email')
        app.register_blueprint(testimony_bp, url_prefix='/api/testimony')
        app.register_blueprint(prayer_room_bp, url_prefix='/api/prayer-room')
        app.register_blueprint(seo_bp)  # SEO routes at root level
        
        # Exempt prayer room polling endpoints from rate limiting
        # These endpoints need high frequency access for WebRTC signaling and chat
        try:
            # Exempt using view function references
            exempt_endpoints = [
                'prayer_room.get_webrtc_offers',
                'prayer_room.get_webrtc_answers',
                'prayer_room.send_webrtc_offer',
                'prayer_room.send_webrtc_answer',
                'prayer_room.send_webrtc_candidate',
                'prayer_room.get_webrtc_candidates',
                'prayer_room.get_chat_messages',
                'prayer_room.send_chat_message',
                'prayer_room.get_room_participants',
                'prayer_room.update_speaking_state'
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
        return render_template('prayer_rooms_standalone.html')

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
    
    return app

# Create the Flask application
app = create_app()

@app.route('/')
def index():
    """Redirect to Prayer Room as main page"""
    return redirect('/prayers')

@app.route('/home')
def home():
    """Serve the original index page (accessible via /home)"""
    return render_template('index.html')

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

@app.route('/unsubscribe')
def unsubscribe():
    """Serve the unsubscribe page"""
    return render_template('unsubscribe.html')

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

if __name__ == '__main__':
    app.run(port=5001) 