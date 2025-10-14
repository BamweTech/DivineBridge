from flask import Blueprint, request, jsonify, session, redirect, current_app
from firebase_auth import (
    initialize_firebase, 
    verify_token, 
    create_user, 
    send_verification_email,
    verify_email_token
)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from email_service import EmailService
from config import get_config
import json
import logging
from firebase_admin import auth
import traceback
from datetime import datetime, timedelta
from input_validation import validate_request, validate_email, validate_password_strength, sanitize_string

auth_bp = Blueprint('auth', __name__)

logger = logging.getLogger(__name__)

# Initialize rate limiter
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

@auth_bp.route('/firebase-config')
def get_firebase_config():
    """Serve Firebase configuration securely"""
    try:
        # Get client config from Secret Manager
        config = get_config()
        logger.info("Serving Firebase configuration")
        logger.info(f"Firebase config keys: {list(config.FIREBASE_CLIENT_CONFIG.keys())}")
        return jsonify(config.FIREBASE_CLIENT_CONFIG)
    except Exception as e:
        logger.error(f"Error serving Firebase configuration: {e}")
        return jsonify({'error': 'Failed to load Firebase configuration'}), 500

@auth_bp.route('/login', methods=['POST'])
@limiter.limit("10 per minute")
@limiter.limit("50 per hour")
def login():
    try:
        data = request.get_json()
        logger.info("Login attempt received")
        logger.info(f"Request headers: {dict(request.headers)}")
        logger.info(f"Request data: {data}")
        logger.info(f"Session data before login: {dict(session)}")
        logger.info(f"Session cookie settings: {current_app.config.get('SESSION_COOKIE_SECURE')}, {current_app.config.get('SESSION_COOKIE_HTTPONLY')}, {current_app.config.get('SESSION_COOKIE_SAMESITE')}")
        
        id_token = data.get('idToken')
        if not id_token:
            logger.warning("Login attempt without ID token")
            return jsonify({'error': 'No ID token provided'}), 400
            
        # Verify the token
        try:
            logger.info("Attempting to verify token...")
            # Ensure Firebase is initialized
            if not initialize_firebase():
                logger.error("Firebase not initialized, cannot verify token")
                return jsonify({'error': 'Authentication service unavailable'}), 503
                
            logger.info("Firebase initialized, proceeding with token verification")
            
            # Add token format validation
            if not isinstance(id_token, str):
                logger.error(f"Invalid token type: {type(id_token)}")
                return jsonify({'error': 'Invalid token format'}), 400
                
            if len(id_token.split('.')) != 3:
                logger.error("Invalid token format: not a valid JWT")
                return jsonify({'error': 'Invalid token format'}), 400
                
            logger.info("Token format validation passed")
            decoded_token = verify_token(id_token)
            
            if not decoded_token:
                logger.warning("Token verification failed - no decoded token returned")
                return jsonify({'error': 'Invalid token'}), 401
                
            logger.info(f"Token verified successfully. Decoded token: {decoded_token}")
            
            # Get additional user info from Firebase
            try:
                user = auth.get_user(decoded_token['uid'])
                logger.info(f"Retrieved user data from Firebase: {user.__dict__}")
            except Exception as e:
                logger.error(f"Error getting user info from Firebase: {e}")
                user = None
            
            # Store user info in session
            logger.info("Clearing existing session data...")
            session.clear()  # Clear any existing session data
            
            logger.info("Setting up new session data...")
            session['user'] = {
                'uid': decoded_token['uid'],
                'email': decoded_token.get('email', ''),
                'name': decoded_token.get('name', ''),
                'emailVerified': user.email_verified if user else False,
                'photoURL': user.photo_url if user and hasattr(user, 'photo_url') else None,
                'lastSignIn': user.user_metadata.last_sign_in_timestamp if user and hasattr(user.user_metadata, 'last_sign_in_timestamp') else None
            }
            session.permanent = True
            session.modified = True
            
            # Log session details after login
            logger.info(f"User logged in successfully: {decoded_token['uid']}")
            logger.info(f"Session data after login: {dict(session)}")
            logger.info(f"Session ID: {session.sid if hasattr(session, 'sid') else 'No session ID'}")
            logger.info(f"Session permanent: {session.permanent}")
            logger.info(f"Session modified: {session.modified}")
            logger.info(f"Session cookie settings: {current_app.config.get('SESSION_COOKIE_SECURE')}, {current_app.config.get('SESSION_COOKIE_HTTPONLY')}, {current_app.config.get('SESSION_COOKIE_SAMESITE')}")
            
            # Create response with session cookie
            response = jsonify({
                'message': 'Login successful',
                'user': session['user']
            })
            
            # Set session cookie
            response.set_cookie(
                'divinebridge_session',
                session.sid if hasattr(session, 'sid') else '',
                httponly=True,
                samesite='Lax',
                secure=False,  # Set to False for local development
                path='/',
                max_age=timedelta(days=7).total_seconds()
            )
            
            return response, 200
            
        except auth.InvalidIdTokenError as e:
            logger.warning(f"Invalid ID token provided: {str(e)}")
            logger.warning(f"Token length: {len(id_token) if id_token else 0}")
            return jsonify({'error': 'Invalid token'}), 401
        except auth.ExpiredIdTokenError as e:
            logger.warning(f"Expired ID token provided: {str(e)}")
            return jsonify({'error': 'Token has expired'}), 401
        except auth.RevokedIdTokenError as e:
            logger.warning(f"Revoked ID token provided: {str(e)}")
            return jsonify({'error': 'Token has been revoked'}), 401
        except auth.UserDisabledError as e:
            logger.warning(f"Login attempt for disabled user: {str(e)}")
            return jsonify({'error': 'This account has been disabled'}), 403
        except Exception as e:
            logger.error(f"Token verification error: {str(e)}")
            logger.error(f"Error type: {type(e)}")
            logger.error(f"Error args: {e.args}")
            logger.error(f"Error traceback: {traceback.format_exc()}")
            return jsonify({'error': 'Failed to verify token'}), 500
            
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error args: {e.args}")
        logger.error(f"Error traceback: {traceback.format_exc()}")
        return jsonify({'error': 'Login failed'}), 500

@auth_bp.route('/signup', methods=['POST'])
@limiter.limit("5 per hour")
@limiter.limit("20 per day")
@validate_request('signup')
def signup():
    try:
        data = request.get_json()
        email = sanitize_string(data.get('email'), max_length=255)
        password = data.get('password')
        first_name = sanitize_string(data.get('firstName'), max_length=50)
        last_name = sanitize_string(data.get('lastName'), max_length=50)
        
        # Additional password strength validation
        is_strong, error_msg = validate_password_strength(password)
        if not is_strong:
            return jsonify({'error': error_msg}), 400
        
        if not all([email, password, first_name, last_name]):
            return jsonify({'error': 'Missing required fields'}), 400
            
        # Create user in Firebase
        user = create_user(email, password, first_name, last_name)
        if not user:
            # Check if the error was due to the user already existing
            try:
                auth.get_user_by_email(email)
                return jsonify({'error': 'A user with this email already exists.'}), 400
            except auth.UserNotFoundError:
                return jsonify({'error': 'Failed to create user'}), 500
            
        # Send verification email
        if not send_verification_email(email):
            logger.warning(f"Failed to send verification email to {email}")
            # Don't return error here, as user is created successfully
            
        return jsonify({
            'message': 'Signup successful',
            'user': {
                'uid': user.uid,
                'email': user.email,
                'name': f"{first_name} {last_name}"
            }
        }), 200
        
    except auth.EmailAlreadyExistsError:
        logger.warning(f"Signup attempt with existing email: {email}")
        return jsonify({'error': 'A user with this email already exists.'}), 400
    except auth.WeakPasswordError:
        logger.warning("Signup attempt with weak password")
        return jsonify({'error': 'Password is too weak'}), 400
    except Exception as e:
        logger.error(f"Signup error: {e}")
        return jsonify({'error': 'Signup failed'}), 500

@auth_bp.route('/forgot-password', methods=['POST'])
@limiter.limit("5 per hour")
def forgot_password():
    """Handle forgot password request"""
    try:
        data = request.get_json()
        email = data.get('email')
        
        if not email:
            logger.warning("Forgot password request missing email")
            return jsonify({'error': 'Email is required', 'field': 'email'}), 400
            
        # Check if user exists
        try:
            user = auth.get_user_by_email(email)
        except auth.UserNotFoundError:
            logger.warning(f"Password reset requested for non-existent email: {email}")
            return jsonify({'error': 'If an account exists with this email, a password reset link has been sent', 'field': 'email'}), 200
            
        # Generate password reset link
        try:
            action_code_settings = auth.ActionCodeSettings(
                url=f"{current_app.config['HOST_URL']}/reset-password",
                handle_code_in_app=True
            )
            reset_link = auth.generate_password_reset_link(
                email,
                action_code_settings=action_code_settings
            )
            
            # Send reset email
            email_service = EmailService()
            if not email_service.send_password_reset_email(email, reset_link):
                logger.error(f"Failed to send password reset email to {email}")
                return jsonify({'error': 'Failed to send password reset email'}), 500
                
            logger.info(f"Password reset link generated and email sent to user: {email}")
            return jsonify({'message': 'Password reset instructions have been sent to your email'}), 200
            
        except Exception as e:
            logger.error(f"Error generating password reset link: {e}")
            return jsonify({'error': 'Failed to generate password reset link'}), 500
            
    except Exception as e:
        logger.error(f"Unexpected error in forgot password: {e}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@auth_bp.route('/reset-password', methods=['POST'])
@limiter.limit("3 per hour")
def reset_password():
    """Handle password reset request"""
    try:
        data = request.get_json()
        password = data.get('password')
        confirm_password = data.get('confirmPassword')
        token = data.get('token')
        
        # Validate input
        if not all([password, confirm_password, token]):
            logger.warning("Reset password request missing required fields")
            return jsonify({'error': 'Missing required fields'}), 400
            
        if password != confirm_password:
            logger.warning("Password reset attempt with mismatched passwords")
            return jsonify({'error': 'Passwords do not match', 'field': 'confirmPassword'}), 400
            
        # Verify token and reset password
        try:
            # Verify the token
            decoded_token = auth.verify_id_token(token)
            uid = decoded_token['uid']
            
            # Update password
            auth.update_user(uid, password=password)
            
            logger.info(f"Password successfully reset for user: {uid}")
            return jsonify({'message': 'Password has been reset successfully'}), 200
            
        except auth.InvalidIdTokenError:
            logger.warning("Invalid password reset token")
            return jsonify({'error': 'Invalid or expired reset link'}), 400
        except auth.ExpiredIdTokenError:
            logger.warning("Expired password reset token")
            return jsonify({'error': 'Reset link has expired'}), 400
        except Exception as e:
            logger.error(f"Error resetting password: {e}")
            return jsonify({'error': 'Failed to reset password'}), 500
            
    except Exception as e:
        logger.error(f"Unexpected error in reset password: {e}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@auth_bp.route('/status')
def auth_status():
    """Check if user is authenticated"""
    try:
        # Log the entire session for debugging
        logger.info("Checking auth status...")
        logger.info(f"Full session data: {dict(session)}")
        logger.info(f"Session ID: {session.sid if hasattr(session, 'sid') else 'No session ID'}")
        logger.info(f"Session permanent: {session.permanent}")
        logger.info(f"Session modified: {session.modified}")
        logger.info(f"Session cookie settings: {current_app.config.get('SESSION_COOKIE_SECURE')}, {current_app.config.get('SESSION_COOKIE_HTTPONLY')}, {current_app.config.get('SESSION_COOKIE_SAMESITE')}")
        
        if 'user' in session:
            logger.info(f"User found in session: {session['user']}")
            # Get additional user info from Firebase
            try:
                user = auth.get_user(session['user']['uid'])
                logger.info(f"User authenticated: {session['user']['uid']}")
                logger.info(f"User data from Firebase: {user.__dict__}")
                
                # Update session with latest user data
                logger.info("Updating session with latest user data...")
                session['user'].update({
                    'emailVerified': user.email_verified,
                    'photoURL': user.photo_url if hasattr(user, 'photo_url') else None,
                    'lastSignIn': user.user_metadata.last_sign_in_timestamp if hasattr(user.user_metadata, 'last_sign_in_timestamp') else None
                })
                session.modified = True
                
                # Save session changes
                try:
                    logger.info("Saving updated session...")
                    session.save()
                    logger.info("Session saved successfully")
                    logger.info(f"Updated session data: {dict(session)}")
                except Exception as e:
                    logger.error(f"Failed to save updated session: {str(e)}")
                    logger.error(f"Error type: {type(e)}")
                    logger.error(f"Error args: {e.args}")
                    logger.error(f"Error traceback: {traceback.format_exc()}")
                
                return jsonify({
                    'authenticated': True,
                    'user': {
                        'uid': session['user']['uid'],
                        'email': session['user'].get('email', ''),
                        'name': session['user'].get('name', ''),
                        'photoURL': session['user'].get('photoURL'),
                        'emailVerified': session['user'].get('emailVerified', False),
                        'lastSignIn': session['user'].get('lastSignIn')
                    }
                }), 200
            except Exception as e:
                logger.error(f"Error getting user info from Firebase: {e}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error args: {e.args}")
                logger.error(f"Error traceback: {traceback.format_exc()}")
                # Return session data if Firebase fetch fails
                logger.info(f"Using session data for user: {session['user']}")
                return jsonify({
                    'authenticated': True,
                    'user': session['user']
                }), 200
        logger.info("No user in session")
        return jsonify({'authenticated': False}), 200
    except Exception as e:
        logger.error(f"Error checking auth status: {e}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error args: {e.args}")
        logger.error(f"Error traceback: {traceback.format_exc()}")
        return jsonify({'authenticated': False}), 200

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Handle user logout"""
    try:
        # Clear the session
        session.clear()
        logger.info("User logged out successfully")
        return jsonify({'message': 'Logged out successfully'}), 200
    except Exception as e:
        logger.error(f"Error during logout: {e}")
        return jsonify({'error': 'Failed to logout'}), 500 