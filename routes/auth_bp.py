from flask import Blueprint, request, jsonify, session, redirect, current_app
from firebase_auth import initialize_firebase, verify_token
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from email_service import EmailService
import json
import logging
from firebase_admin import auth

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
        config = current_app.config['FIREBASE_CLIENT_CONFIG']
        logger.info("Serving Firebase configuration")
        return jsonify(config)
    except Exception as e:
        logger.error(f"Error serving Firebase configuration: {e}")
        return jsonify({'error': 'Failed to load Firebase configuration'}), 500

@auth_bp.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        id_token = data.get('idToken')
        
        if not id_token:
            return jsonify({'error': 'No ID token provided'}), 400
            
        # Verify the token
        decoded_token = verify_token(id_token)
        if not decoded_token:
            return jsonify({'error': 'Invalid token'}), 401
            
        # Store user info in session
        session['user'] = {
            'uid': decoded_token['uid'],
            'email': decoded_token.get('email', ''),
            'name': decoded_token.get('name', '')
        }
        
        return jsonify({'message': 'Login successful'}), 200
        
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed'}), 500

@auth_bp.route('/signup', methods=['POST'])
def signup():
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        first_name = data.get('firstName')
        last_name = data.get('lastName')
        
        if not all([email, password, first_name, last_name]):
            return jsonify({'error': 'Missing required fields'}), 400
            
        # Create user in Firebase
        user = create_user(email, password, first_name, last_name)
        if not user:
            return jsonify({'error': 'Failed to create user'}), 500
            
        return jsonify({'message': 'Signup successful'}), 200
        
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
        if 'user' in session:
            return jsonify({
                'authenticated': True,
                'user': {
                    'uid': session['user']['uid'],
                    'email': session['user'].get('email', ''),
                    'name': session['user'].get('name', '')
                }
            }), 200
        return jsonify({'authenticated': False}), 200
    except Exception as e:
        logger.error(f"Error checking auth status: {e}")
        return jsonify({'authenticated': False}), 200 