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
from verse_cache import verse_cache
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
    app.config.from_object(config)
    
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
        
        # Initialize verse cache
        app.verse_cache = VerseCache()
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

if __name__ == '__main__':
    app.run(debug=config.DEBUG, port=5001) 