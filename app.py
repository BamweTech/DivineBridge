from flask import Flask, render_template, request, jsonify, redirect, session
from sheet_handler import SheetHandler
from email_sender import EmailSender
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
from functools import wraps
import re

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
    app.config.from_object(get_config())
    
    # Initialize Firebase
    from firebase_auth import initialize_firebase
    if not initialize_firebase():
        logger.error("Failed to initialize Firebase Admin SDK")
        # Don't raise an exception, allow the app to start with degraded functionality
        app.firebase_initialized = False
    else:
        app.firebase_initialized = True
    
    # Configure session
    app.config['SESSION_TYPE'] = 'filesystem'
    app.config['SESSION_PERMANENT'] = False
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)  # 7 days for "remember me"
    Session(app)
    
    # Configure static files and templates
    app.static_folder = 'static'
    app.template_folder = 'templates'
    
    # Initialize rate limiter
    limiter = Limiter(
        app,
        key_func=get_remote_address,
        default_limits=["200 per day", "50 per hour"],
        storage_uri="memory://"  # Use in-memory storage for now
    )
    
    # Initialize services as None by default
    app.storage = None
    app.prayer_generator = None
    app.email_service = None
    app.sheet_handler = None
    app.scheduler = None
    
    # Only initialize services if not in development mode
    if app.config['ENV'] != 'development':
        try:
            app.storage = StorageHandler()
            app.prayer_generator = PrayerGenerator(storage=app.storage)
            app.email_service = EmailSender()
            
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
    else:
        logger.info("Running in development mode - skipping backend service initialization")

    # Register routes
    @app.route('/')
    @limiter.exempt  # Exempt index route from rate limiting
    def index():
        return render_template('index.html')
    
    @app.route('/signup', methods=['GET', 'POST'])
    def signup_page():
        if request.method == 'POST':
            try:
                # Check if request is JSON
                if not request.is_json:
                    logger.error("Signup request is not JSON")
                    return jsonify({'error': 'Our systems are experiencing some issues, please try again later', 'field': 'email'}), 400
                
                data = request.get_json()
                if not data:
                    logger.error("Signup request has no JSON data")
                    return jsonify({'error': 'Our systems are experiencing some issues, please try again later', 'field': 'email'}), 400
                
                email = data.get('email')
                password = data.get('password')
                first_name = data.get('firstName')
                last_name = data.get('lastName')
                
                # Validate required fields
                if not all([email, password, first_name, last_name]):
                    missing_fields = []
                    if not email: missing_fields.append('email')
                    if not password: missing_fields.append('password')
                    if not first_name: missing_fields.append('firstName')
                    if not last_name: missing_fields.append('lastName')
                    logger.error(f"Missing required fields: {', '.join(missing_fields)}")
                    return jsonify({'error': 'All fields are required', 'field': missing_fields[0]}), 400
                
                # Validate email format
                if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
                    logger.error(f"Invalid email format: {email}")
                    return jsonify({'error': 'Please enter a valid email address', 'field': 'email'}), 400
                
                # Validate password strength
                if not (len(password) >= 8 and 
                        any(c.isupper() for c in password) and 
                        any(c.islower() for c in password) and 
                        any(c.isdigit() for c in password) and 
                        any(c in '!@#$%^&*(),.?":{}|<>' for c in password)):
                    logger.error("Password does not meet strength requirements")
                    return jsonify({'error': 'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character', 'field': 'password'}), 400
                
                # Check if Firebase is initialized
                if not app.firebase_initialized:
                    logger.error("Firebase not initialized")
                    return jsonify({'error': 'Our systems are experiencing some issues, please try again later', 'field': 'email'}), 503
                
                # Create user in Firebase
                from firebase_auth import create_user
                user = create_user(email, password, first_name, last_name)
                
                if not user:
                    logger.error(f"Failed to create Firebase user for email: {email}")
                    return jsonify({'error': 'Our systems are experiencing some issues, please try again later', 'field': 'email'}), 500
                
                # Add user to subscribers sheet
                try:
                    sheet_success = app.sheet_handler.add_subscriber(email, first_name, last_name)
                    if not sheet_success:
                        logger.warning(f"Failed to add user {email} to subscribers sheet")
                    else:
                        logger.info(f"Successfully added user {email} to subscribers sheet")
                except Exception as e:
                    logger.error(f"Error adding user to subscribers sheet: {e}")
                    # Don't fail signup if subscriber addition fails
                
                # Send verification email
                from firebase_auth import send_verification_email
                verification_sent = send_verification_email(email)
                if not verification_sent:
                    logger.warning(f"Failed to send verification email to {email}")
                
                # Send welcome email to new subscriber
                try:
                    if sheet_success:
                        from welcome_email import send_welcome_email
                        welcome_sent = send_welcome_email(email, first_name)
                        if not welcome_sent:
                            logger.warning(f"Failed to send welcome email to {email}")
                except Exception as e:
                    logger.error(f"Error sending welcome email: {e}")
                
                logger.info(f"Successfully created account for user: {email}")
                return jsonify({
                    'message': 'Account created successfully',
                    'user': {
                        'uid': user.uid,
                        'email': user.email,
                        'name': f"{first_name} {last_name}"
                    }
                }), 201
            except Exception as e:
                logger.error(f"Error in signup route: {str(e)}", exc_info=True)
                return jsonify({'error': 'Our systems are experiencing some issues, please try again later', 'field': 'email'}), 500
        return render_template('signup.html')
    
    @app.route('/prayers')
    @login_required
    def prayers():
        return render_template('prayers.html')
    
    @app.route('/about')
    def about():
        return render_template('about.html')
    
    @app.route('/health')
    def health_check():
        """Health check endpoint for monitoring"""
        try:
            # Basic app health check
            health_status = {
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'version': '1.0.0',
                'services': {}
            }
            
            # Check Firebase
            if app.firebase_initialized:
                health_status['services']['firebase'] = 'healthy'
            else:
                health_status['services']['firebase'] = 'not_initialized'
            
            # Check Storage (if available)
            try:
                if hasattr(app, 'storage_handler') and app.storage_handler:
                    app.storage_handler.get_bucket()
                    health_status['services']['storage'] = 'healthy'
                else:
                    health_status['services']['storage'] = 'not_initialized'
            except Exception as e:
                logger.warning(f"Storage health check failed: {e}")
                health_status['services']['storage'] = 'unhealthy'
            
            # Check Sheets (if available)
            try:
                if hasattr(app, 'sheet_handler') and app.sheet_handler:
                    app.sheet_handler.verify_access()
                    health_status['services']['sheets'] = 'healthy'
                else:
                    health_status['services']['sheets'] = 'not_initialized'
            except Exception as e:
                logger.warning(f"Sheets health check failed: {e}")
                health_status['services']['sheets'] = 'unhealthy'
            
            # Check Secret Manager (if available)
            try:
                if hasattr(app, 'secret_manager') and app.secret_manager:
                    app.secret_manager.get_secret('GOOGLE_CLOUD_CREDENTIALS')
                    health_status['services']['secret_manager'] = 'healthy'
                else:
                    health_status['services']['secret_manager'] = 'not_initialized'
            except Exception as e:
                logger.warning(f"Secret Manager health check failed: {e}")
                health_status['services']['secret_manager'] = 'unhealthy'
            
            # Overall health is considered healthy if core services are up
            if health_status['services'].get('firebase') == 'healthy':
                return jsonify(health_status), 200
            else:
                health_status['status'] = 'degraded'
                return jsonify(health_status), 503
            
        except Exception as e:
            logger.error(f"Health check failed: {e}", exc_info=True)
            return jsonify({
                'status': 'unhealthy',
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }), 500
    
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
                response = {
                    'success': True,
                    'data': {
                        'verse': verse['text'],
                        'reference': verse['reference'],
                        'date': datetime.now().strftime('%Y-%m-%d'),
                        'version': '1.0.0'
                    },
                    'metadata': {
                        'generated_at': datetime.now().isoformat(),
                        'source': 'bible_verses.json'
                    }
                }
                return jsonify(response)
            else:
                logger.error("No verse available")
                return jsonify({
                    'success': False,
                    'error': 'No verse available',
                    'message': 'Unable to retrieve today\'s verse'
                }), 404
        except Exception as e:
            logger.error(f"Error getting today's verse: {e}")
            return jsonify({
                'success': False,
                'error': str(e),
                'message': 'An error occurred while retrieving the verse'
            }), 500
    
    @app.route('/api/auth/reset-password', methods=['POST'])
    @limiter.limit("5 per minute")  # Limit password reset attempts
    def reset_password():
        try:
            data = request.get_json()
            password = data.get('password')
            confirm_password = data.get('confirmPassword')
            token = data.get('token')
            
            if not all([password, confirm_password, token]):
                return jsonify({'error': 'All fields are required', 'field': 'password'}), 400
            
            if password != confirm_password:
                return jsonify({'error': 'Passwords do not match', 'field': 'confirmPassword'}), 400
            
            # Verify password requirements
            if not (len(password) >= 8 and 
                    any(c.isupper() for c in password) and 
                    any(c.islower() for c in password) and 
                    any(c.isdigit() for c in password) and 
                    any(c in '!@#$%^&*(),.?":{}|<>' for c in password)):
                return jsonify({'error': 'Password does not meet requirements', 'field': 'password'}), 400
            
            # Reset password using Firebase
            from firebase_auth import reset_password_with_token
            success = reset_password_with_token(token, password)
            
            if not success:
                return jsonify({'error': 'Invalid or expired reset token', 'field': 'token'}), 400
            
            return jsonify({'message': 'Password reset successful'}), 200
        except Exception as e:
            logger.error(f"Error in reset password route: {e}")
            return jsonify({'error': 'Internal server error'}), 500

    @app.route('/api/auth/forgot-password', methods=['POST'])
    @limiter.limit("5 per minute")  # Limit password reset requests
    def forgot_password():
        try:
            data = request.get_json()
            email = data.get('email')
            
            if not email:
                return jsonify({'error': 'Email is required', 'field': 'email'}), 400
            
            # Generate password reset token
            from firebase_auth import create_password_reset_token
            reset_token = create_password_reset_token(email)
            
            if not reset_token:
                return jsonify({'error': 'Failed to generate reset token', 'field': 'email'}), 500
            
            # Send password reset email
            reset_link = f"{request.host_url}reset-password?token={reset_token}"
            email_success = app.email_service.send_password_reset_email(email, reset_link)
            
            if not email_success:
                return jsonify({'error': 'Failed to send reset email', 'field': 'email'}), 500
            
            return jsonify({'message': 'Password reset instructions sent'}), 200
        except Exception as e:
            logger.error(f"Error in forgot password route: {e}")
            return jsonify({'error': 'Internal server error'}), 500

    @app.route('/api/auth/verify-email', methods=['POST'])
    @limiter.limit("5 per minute")
    def verify_email():
        try:
            data = request.get_json()
            email = data.get('email')
            
            if not email:
                return jsonify({'error': 'Email is required', 'field': 'email'}), 400
            
            # Send verification email
            from firebase_auth import send_verification_email
            success = send_verification_email(email)
            
            if not success:
                return jsonify({'error': 'Failed to send verification email', 'field': 'email'}), 500
            
            return jsonify({'message': 'Verification email sent'}), 200
        except Exception as e:
            logger.error(f"Error in verify email route: {e}")
            return jsonify({'error': 'Internal server error'}), 500

    @app.route('/api/auth/status', methods=['GET'])
    @login_required
    def auth_status():
        try:
            user = session.get('user')
            if not user:
                return jsonify({'authenticated': False}), 401
            return jsonify({
                'authenticated': True,
                'user': {
                    'email': user.get('email'),
                    'name': user.get('name')
                }
            }), 200
        except Exception as e:
            logger.error(f"Error in auth status route: {e}")
            return jsonify({'error': 'Internal server error'}), 500

    @app.route('/login', methods=['GET', 'POST'])
    @limiter.limit("10 per minute")  # Limit login attempts
    def login():
        """Handle user login"""
        if request.method == 'GET':
            redirect_url = request.args.get('redirect', '/')
            return render_template('login.html', redirect_url=redirect_url)
        
        try:
            # Check if Firebase is initialized
            if not app.firebase_initialized:
                logger.error("Firebase not initialized")
                return jsonify({
                    'success': False,
                    'error': 'Authentication service temporarily unavailable. Please try again later.'
                }), 503

            data = request.get_json()
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400

            email = data.get('email', '').strip().lower()
            password = data.get('password', '')
            remember_me = data.get('rememberMe', False)

            if not email or not password:
                return jsonify({
                    'success': False,
                    'error': 'Email and password are required'
                }), 400

            # Verify credentials
            from firebase_auth import verify_credentials
            user = verify_credentials(email, password)
            
            if not user:
                return jsonify({
                    'success': False,
                    'error': 'Invalid email or password'
                }), 401

            # Set session
            session['user'] = {
                'uid': user.uid,
                'email': user.email,
                'displayName': user.display_name,
                'emailVerified': user.email_verified
            }
            
            # Set session expiration based on remember me
            session.permanent = remember_me
            if remember_me:
                session.permanent_session_lifetime = timedelta(days=7)

            # Update last login in Firestore
            try:
                from firebase_admin import firestore
                db = firestore.client()
                user_ref = db.collection('users').document(user.uid)
                user_ref.update({
                    'lastLogin': firestore.SERVER_TIMESTAMP
                })
            except Exception as e:
                logger.error(f"Failed to update last login: {e}")

            return jsonify({
                'success': True,
                'message': 'Login successful',
                'user': session['user']
            })

        except Exception as e:
            logger.error(f"Login error: {e}")
            return jsonify({
                'success': False,
                'error': 'An unexpected error occurred'
            }), 500

    @app.route('/logout')
    def logout():
        session.clear()
        return redirect('/login')

    @app.route('/api/auth/signup', methods=['POST'])
    @limiter.limit("5 per minute")
    def signup():
        """Handle user signup"""
        try:
            # Check if Firebase is initialized
            if not app.firebase_initialized:
                logger.error("Firebase not initialized")
                return jsonify({
                    'success': False,
                    'error': 'Authentication service temporarily unavailable. Please try again later.'
                }), 503

            data = request.get_json()
            if not data:
                return jsonify({
                    'success': False,
                    'error': 'No data provided'
                }), 400

            # Validate required fields
            required_fields = ['email', 'password', 'firstName', 'lastName']
            missing_fields = [field for field in required_fields if field not in data]
            if missing_fields:
                return jsonify({
                    'success': False,
                    'error': f'Missing required fields: {", ".join(missing_fields)}'
                }), 400

            email = data['email'].strip().lower()
            password = data['password']
            first_name = data['firstName'].strip()
            last_name = data['lastName'].strip()

            # Validate email format
            if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', email):
                return jsonify({
                    'success': False,
                    'error': 'Invalid email format'
                }), 400

            # Validate password strength
            if len(password) < 8:
                return jsonify({
                    'success': False,
                    'error': 'Password must be at least 8 characters long'
                }), 400

            # Create Firebase user
            from firebase_auth import create_user
            user = create_user(email, password, first_name, last_name)
            
            if not user:
                return jsonify({
                    'success': False,
                    'error': 'Failed to create user account'
                }), 500

            # Store additional user data in Firestore
            try:
                from firebase_admin import firestore
                db = firestore.client()
                user_ref = db.collection('users').document(user.uid)
                user_ref.set({
                    'email': email,
                    'firstName': first_name,
                    'lastName': last_name,
                    'createdAt': firestore.SERVER_TIMESTAMP,
                    'lastLogin': firestore.SERVER_TIMESTAMP,
                    'emailVerified': False,
                    'role': 'user'
                })
            except Exception as e:
                logger.error(f"Failed to store user data in Firestore: {e}")
                # Don't fail the signup if Firestore fails, but log the error

            # Send welcome email
            try:
                send_welcome_email(email, first_name)
            except Exception as e:
                logger.error(f"Failed to send welcome email: {e}")
                # Don't fail the signup if email fails, but log the error

            return jsonify({
                'success': True,
                'message': 'Account created successfully',
                'user': {
                    'uid': user.uid,
                    'email': user.email,
                    'displayName': user.display_name
                }
            })

        except Exception as e:
            logger.error(f"Signup error: {e}")
            return jsonify({
                'success': False,
                'error': 'An unexpected error occurred'
            }), 500

    @app.route('/api/prayers', methods=['POST'])
    @login_required
    @limiter.limit("10 per minute")  # Limit prayer submissions
    def submit_prayer():
        try:
            # Get prayer data from request
            data = request.get_json()
            if not data or 'content' not in data:
                return jsonify({
                    'success': False,
                    'message': 'Prayer content is required'
                }), 400

            # Validate prayer content
            content = data['content'].strip()
            if len(content) < 10:
                return jsonify({
                    'success': False,
                    'message': 'Prayer must be at least 10 characters long'
                }), 400

            if len(content) > 1000:
                return jsonify({
                    'success': False,
                    'message': 'Prayer must not exceed 1000 characters'
                }), 400

            # Get user info from session
            user_id = session['user']['uid']
            user_name = session['user'].get('display_name', 'Anonymous')

            # Generate summary using Perplexity
            summary_prompt = f"""
            Please provide a one-sentence summary of this prayer request:
            {content}
            
            Requirements:
            - Keep it under 20 words
            - Focus on the main request or concern
            - Make it clear and concise
            - Do not include any personal information
            """
            
            try:
                summary = app.prayer_generator.client.query(summary_prompt)
                # Clean up the response
                summary = summary.strip()
                if summary.endswith('.'):
                    summary = summary[:-1]
            except Exception as e:
                logger.error(f"Error generating summary: {e}")
                # Fallback to simple truncation if Perplexity fails
                summary = content.split('.')[0][:100] + '...'

            # Save prayer to storage
            prayer_data = {
                'content': content,
                'summary': summary,
                'user_id': user_id,
                'user_name': user_name,
                'timestamp': datetime.now().isoformat(),
                'prayer_count': 0
            }

            # Save to storage
            if not app.storage.save_prayer(prayer_data):
                return jsonify({
                    'success': False,
                    'message': 'Failed to save prayer'
                }), 500

            return jsonify({
                'success': True,
                'message': 'Prayer submitted successfully',
                'prayer': prayer_data
            })

        except Exception as e:
            logger.error(f"Error submitting prayer: {e}")
            return jsonify({
                'success': False,
                'message': str(e)
            }), 500

    @app.route('/api/prayers', methods=['GET'])
    @login_required
    @limiter.limit("30 per minute")  # Limit prayer retrieval
    def get_prayers():
        try:
            # Get recent prayers from storage
            prayers = app.storage.get_prayers()
            
            return jsonify({
                'success': True,
                'prayers': prayers
            })
        except Exception as e:
            logger.error(f"Error getting prayers: {e}")
            return jsonify({
                'success': False,
                'message': str(e)
            }), 500

    return app

# Create the Flask application
app = create_app()

if __name__ == '__main__':
    app.run(debug=config.DEBUG, port=5001) 