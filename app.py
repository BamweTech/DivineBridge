from flask import Flask, render_template, request, jsonify, redirect, session
from sheet_handler import SheetHandler
from email_sender import EmailSender, EmailService
from scheduler import PrayerScheduler
from email_templates import get_welcome_email_template
import logging
import json
import random
from datetime import datetime, timedelta
import os
import atexit
import threading
from prayer_generator import PrayerGenerator
from logging_config import setup_logging
from config import get_config
from verse_cache import verse_cache  # Import the singleton instance
from dotenv import load_dotenv
from storage_handler import StorageHandler
from welcome_email import send_welcome_email
import time
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_session import Session
from flask_cors import CORS
from functools import wraps
import re
from firebase_auth import initialize_firebase
from verse_generator import verse_generator

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect('/login?redirect=' + request.path)
        return f(*args, **kwargs)
    return decorated_function

# Set up logging
loggers = setup_logging()
logger = loggers['app']

# Load environment variables
load_dotenv()

# Get configuration
config = get_config()

def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    
    # Load configuration
    app.config.from_object('config.Config')
    
    # Email configuration
    app.config['SMTP_SERVER'] = 'smtp.gmail.com'
    app.config['SMTP_PORT'] = 587
    app.config['SENDER_EMAIL'] = 'noreply@divinebridge.com'
    
    # Validate required environment variables
    required_vars = [
        'GOOGLE_CLOUD_PROJECT'
    ]
    
    # Add Firebase variables if Firebase is being initialized
    if app.config.get('ENV') == 'production':
        required_vars.extend(['FIREBASE_PROJECT_ID'])
    
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars and app.config['ENV'] == 'production':
        raise RuntimeError(f"Missing required environment variables: {', '.join(missing_vars)}")
    elif missing_vars:
        logger.warning(f"Missing environment variables in development: {', '.join(missing_vars)}")
    
    # Initialize logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    
    # Configure CORS
    if app.config['ENV'] == 'production':
        # In production, use configured origins
        CORS(app, resources={
            r"/*": {
                "origins": app.config['CORS_ORIGINS'],
                "methods": app.config['CORS_METHODS'],
                "allow_headers": app.config['CORS_ALLOW_HEADERS'],
                "supports_credentials": app.config['CORS_SUPPORTS_CREDENTIALS'],
                "max_age": app.config['CORS_MAX_AGE']
            }
        })
    else:
        # In development, allow all origins
        CORS(app, resources={r"/*": {"origins": "*"}})
    
    # Initialize Firebase
    logger.info("Initializing Firebase...")
    if not initialize_firebase():
        logger.error("Failed to initialize Firebase. Application may not function correctly.")
        # Don't raise an exception here to allow the app to start in development mode
        if app.config['ENV'] != 'development':
            raise RuntimeError("Firebase initialization failed")
    else:
        logger.info("Firebase initialized successfully")
        app.firebase_initialized = True
    
    # Initialize other components
    try:
        # Initialize storage handler
        app.storage_handler = StorageHandler()
        logger.info("Storage handler initialized")
        
        # Set static folder for verse generator
        verse_generator.set_static_folder(app.static_folder)
        
        # Use the singleton verse cache instance
        app.verse_cache = verse_cache
        logger.info("Verse cache initialized")
        
        # Register blueprints
        from routes import auth_bp, prayer_bp, verse_bp
        app.register_blueprint(auth_bp)
        app.register_blueprint(prayer_bp)
        app.register_blueprint(verse_bp)
        logger.info("Blueprints registered")
        
    except Exception as e:
        logger.error(f"Failed to initialize application components: {e}")
        if app.config['ENV'] != 'development':
            raise
    
    return app

# Create the Flask application
app = create_app()

@app.route('/')
def index():
    """Serve the main index page"""
    return render_template('index.html')

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

@app.route('/about')
def about():
    """Serve the about page"""
    return render_template('about.html')

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
    status = {
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'firebase_initialized': getattr(app, 'firebase_initialized', False)
    }
    return jsonify(status), 200

if __name__ == '__main__':
    app.run(debug=config.DEBUG, port=5001) 