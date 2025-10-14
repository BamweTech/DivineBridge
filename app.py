from flask import Flask, render_template, request, jsonify, redirect, session
import logging
from datetime import datetime, timedelta
import os
from prayer_generator import PrayerGenerator
from config import get_config
from verse_cache import verse_cache
from storage_handler import StorageHandler
from flask_session import Session
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect
from functools import wraps
from firebase_auth import initialize_firebase
from verse_generator import verse_generator

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
    
    # Session configuration
    # Determine environment
    is_production = os.getenv('FLASK_ENV') == 'production' or os.getenv('GAE_ENV', '').startswith('standard')
    
    # Load secret key from Secret Manager
    app.config['SECRET_KEY'] = config.session_secret_key
    app.config['SESSION_TYPE'] = 'filesystem'
    app.config['SESSION_PERMANENT'] = True
    app.config['SESSION_USE_SIGNER'] = True
    app.config['SESSION_COOKIE_SECURE'] = is_production  # True in production, False in dev
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)
    app.config['SESSION_FILE_DIR'] = os.path.join(app.root_path, 'flask_session')
    app.config['SESSION_FILE_THRESHOLD'] = 500  # Maximum number of sessions to store
    app.config['SESSION_FILE_MODE'] = 0o600  # Secure file permissions
    app.config['SESSION_REFRESH_EACH_REQUEST'] = True  # Refresh session on each request
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
    
    # Exempt API endpoints from CSRF (they use token auth)
    csrf.exempt('verse_bp')
    csrf.exempt('prayer_bp.get_prayer')
    csrf.exempt('prayer_bp.get_prayers')
    
    # Add session middleware
    @app.before_request
    def before_request():
        session.permanent = True
        if 'user' in session:
            session.modified = True
    
    @app.after_request
    def set_security_headers(response):
        # Security headers - always set for all responses
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        
        # HSTS (only in production with HTTPS)
        # Check if we're in production
        env = os.getenv('FLASK_ENV', 'production')
        if env == 'production' or os.getenv('GAE_ENV', '').startswith('standard'):
            if request.is_secure:
                response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        
        # Content Security Policy
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.googleapis.com https://apis.google.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com; "
            "frame-ancestors 'self'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        
        # Permissions Policy
        response.headers['Permissions-Policy'] = (
            "geolocation=(), "
            "microphone=(), "
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
        app.register_blueprint(auth_bp, url_prefix='/api/auth')
        app.register_blueprint(prayer_bp, url_prefix='/api/prayer')
        app.register_blueprint(verse_bp, url_prefix='/api')
        app.register_blueprint(nonprofit_bp, url_prefix='/api/nonprofit')
        logger.info("Blueprints registered")
        
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

@app.route('/login')
def login():
    """Serve the login page"""
    return render_template('login.html')

@app.route('/signup')
def signup():
    """Serve the signup page"""
    return render_template('signup.html')

@app.route('/prayers')
def prayers():
    """Serve the prayers page"""
    return render_template('prayers.html')

@app.route('/daily-prayer')
def daily_prayer():
    """Serve the daily prayer page"""
    return render_template('daily_prayer.html')

@app.route('/about')
def about():
    """Serve the about page"""
    return render_template('about.html')

@app.route('/profile')
def profile():
    """Serve the profile page"""
    return render_template('profile.html')

@app.route('/test-prayer-debug')
def test_prayer_debug():
    """Debug page to test prayer loading"""
    return render_template('test_prayer_debug.html')

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