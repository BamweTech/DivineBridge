from flask import Flask, render_template, request, jsonify, redirect
from sheet_handler import SheetHandler
from email_sender import EmailSender
from scheduler import PrayerScheduler
from email_templates import get_welcome_email_template
import logging
import json
import random
from datetime import datetime
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
    app.config.from_object(get_config())
    
    # Initialize rate limiter
    limiter = Limiter(
        app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://"  # Use in-memory storage for now
    )
    
    # Initialize services with error handling
    try:
        app.storage = StorageHandler()
        app.prayer_generator = PrayerGenerator(storage=app.storage)
        app.email_service = EmailSender()
        
        # Initialize sheet handler with error handling
        try:
            app.sheet_handler = SheetHandler()
            logger.info("Successfully initialized SheetHandler")
        except Exception as e:
            logger.error(f"Failed to initialize SheetHandler: {e}")
            app.sheet_handler = None
        
        # Initialize scheduler
        app.scheduler = PrayerScheduler(app.prayer_generator, app.email_service)
        
        # Start scheduler in a separate thread
        scheduler_thread = threading.Thread(target=app.scheduler.run)
        scheduler_thread.daemon = True
        scheduler_thread.start()
        
        logger.info("Successfully initialized core services")
    except Exception as e:
        logger.error(f"Error initializing services: {e}")
        # Don't raise the exception, allow the app to start with degraded functionality
        pass
    
    # Register routes
    @app.route('/')
    @limiter.exempt  # Exempt index route from rate limiting
    def index():
        return render_template('index.html')
    
    @app.route('/health')
    @limiter.exempt  # Exempt health check from rate limiting
    def health_check():
        """Health check endpoint"""
        try:
            # Check storage
            app.storage._get_or_create_bucket()
            
            # Check sheet access if available
            if app.sheet_handler:
                app.sheet_handler.service.spreadsheets().get(spreadsheetId=app.sheet_handler.sheet_id).execute()
                return jsonify({'status': 'healthy', 'sheet_access': 'available'}), 200
            else:
                return jsonify({'status': 'healthy', 'sheet_access': 'unavailable'}), 200
        except Exception as e:
            return jsonify({'status': 'unhealthy', 'error': str(e)}), 500
    
    @app.route('/subscribe', methods=['POST'])
    @limiter.limit("10 per minute")  # More restrictive limit for subscription endpoint
    def subscribe():
        try:
            data = request.get_json()
            email = data.get('email')
            first_name = data.get('firstName')
            last_name = data.get('lastName', '')
            
            if not email or not first_name:
                return jsonify({'error': 'Email and first name are required'}), 400
            
            # Try to add subscriber to sheet if available
            sheet_success = True
            if app.sheet_handler:
                sheet_success = app.sheet_handler.add_subscriber(email, first_name, last_name)
                if not sheet_success:
                    logger.error(f"Failed to add subscriber to sheet: {email}")
                    # Continue with email sending even if sheet update fails
            else:
                logger.warning("Sheet handler not available, skipping sheet update")
            
            # Send welcome email
            try:
                email_success = send_welcome_email(email, first_name, app.email_service, app.storage)
                if not email_success:
                    logger.error(f"Failed to send welcome email to {email}")
                    if not sheet_success:
                        return jsonify({'error': 'Failed to complete subscription process'}), 500
                    return jsonify({'error': 'Failed to send welcome email'}), 500
            except Exception as e:
                logger.error(f"Error sending welcome email to {email}: {e}")
                if not sheet_success:
                    return jsonify({'error': 'Failed to complete subscription process'}), 500
                return jsonify({'error': 'Failed to send welcome email'}), 500
            
            if sheet_success:
                return jsonify({'message': 'Subscription successful'}), 200
            else:
                return jsonify({
                    'message': 'Subscription partially successful',
                    'warning': 'Could not update subscription database'
                }), 200
            
        except Exception as e:
            logger.error(f"Error in subscribe route: {e}")
            return jsonify({'error': 'Internal server error'}), 500
    
    @app.route('/unsubscribe', methods=['POST'])
    @limiter.limit("10 per minute")  # Same limit as subscribe
    def unsubscribe():
        try:
            if not app.sheet_handler:
                return jsonify({'error': 'Unsubscription service temporarily unavailable'}), 503
                
            data = request.get_json()
            email = data.get('email')
            
            if not email:
                return jsonify({'error': 'Email is required'}), 400
            
            # Remove subscriber from sheet
            success = app.sheet_handler.remove_subscriber(email)
            if not success:
                return jsonify({'error': 'Failed to remove subscriber'}), 500
            
            return jsonify({'message': 'Unsubscription successful'}), 200
        except Exception as e:
            logger.error(f"Error in unsubscribe route: {e}")
            return jsonify({'error': 'Internal server error'}), 500
    
    @app.route('/prayer')
    @limiter.limit("30 per minute")  # More generous limit for prayer retrieval
    def get_prayer():
        try:
            # Get today's prayer from Cloud Storage
            today = datetime.now().strftime('%Y-%m-%d')
            prayer = app.storage.get_prayer(today)
            
            if not prayer:
                logger.error(f"Prayer not found for today ({today})")
                return jsonify({
                    'success': False,
                    'message': 'Prayer not found'
                }), 404
            
            return jsonify({
                'success': True,
                'prayer': prayer
            })
        except Exception as e:
            logger.error(f"Error getting prayer: {e}")
            return jsonify({
                'success': False,
                'message': str(e)
            }), 500
    
    @app.route('/generate', methods=['POST'])
    @limiter.limit("5 per minute")  # Most restrictive limit for prayer generation
    def generate_prayer():
        try:
            # Generate new prayer
            prayer = app.prayer_generator.generate_prayer()
            if not prayer:
                return jsonify({
                    'success': False,
                    'message': 'Failed to generate prayer'
                }), 500
            
            # Save prayer to Cloud Storage
            today = datetime.now().strftime('%Y-%m-%d')
            if not app.storage.save_prayer(prayer, today):
                return jsonify({
                    'success': False,
                    'message': 'Failed to save prayer'
                }), 500
            
            return jsonify({
                'success': True,
                'prayer': prayer
            })
        except Exception as e:
            logger.error(f"Error generating prayer: {e}")
            return jsonify({
                'success': False,
                'message': str(e)
            }), 500
    
    @app.route('/api/today-verse')
    @limiter.exempt  # Exempt verse endpoint from rate limiting
    def get_today_verse():
        """Get today's verse from the verse cache"""
        try:
            verse = verse_cache.get_today_verse()
            if verse:
                return jsonify({
                    'verse': verse['text'],
                    'reference': verse['reference']
                })
            else:
                logger.error("No verse available")
                return jsonify({
                    'error': 'No verse available'
                }), 404
        except Exception as e:
            logger.error(f"Error getting today's verse: {e}")
            return jsonify({
                'error': str(e)
            }), 500
    
    return app

# Create the Flask application
app = create_app()

if __name__ == '__main__':
    app.run(debug=config.DEBUG, port=5001) 