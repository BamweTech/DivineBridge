from flask import Blueprint, request, jsonify, session, redirect, current_app
from firebase_auth import (
    initialize_firebase, 
    verify_token, 
    create_user, 
    send_verification_email,
    verify_email_token
)
from email_service import EmailService
from config import get_config
from extensions import limiter
import json
import logging
import os
from firebase_admin import auth
import traceback
from datetime import datetime, timedelta
from input_validation import validate_request, validate_email, validate_password_strength, sanitize_string

auth_bp = Blueprint('auth', __name__)

logger = logging.getLogger(__name__)


@auth_bp.route('/firebase-config')
def get_firebase_config():
    """Serve Firebase configuration securely"""
    try:
        # Get client config from Secret Manager
        config = get_config()
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
        
        id_token = data.get('idToken')
        if not id_token:
            logger.warning("Login attempt without ID token")
            return jsonify({'error': 'No ID token provided'}), 400
            
        # Verify the token
        try:
            if not initialize_firebase():
                logger.error("Firebase not initialized, cannot verify token")
                return jsonify({'error': 'Authentication service unavailable'}), 503
            
            if not isinstance(id_token, str):
                logger.error("Invalid token type received")
                return jsonify({'error': 'Invalid token format'}), 400
                
            if len(id_token.split('.')) != 3:
                logger.error("Invalid token format: not a valid JWT")
                return jsonify({'error': 'Invalid token format'}), 400
            
            decoded_token = verify_token(id_token)
            
            if not decoded_token:
                logger.warning("Token verification failed")
                return jsonify({'error': 'Token verification failed. Please try signing in again.'}), 401
            
            try:
                user = auth.get_user(decoded_token['uid'])
            except Exception as e:
                logger.error(f"Error getting user info from Firebase: {e}")
                user = None
            
            session.clear()
            
            # Check if this is an OAuth signup or email/password signup (create Firestore profile if needed)
            is_oauth_signup = data.get('isOAuthSignup', False)
            if is_oauth_signup and user:
                try:
                    from firebase_admin import firestore
                    db = firestore.client()
                    user_ref = db.collection('users').document(user.uid)
                    
                    # Check if profile exists
                    if not user_ref.get().exists:
                        # Get first/last name from request data if provided (email/password signup)
                        # Otherwise parse from display name (OAuth signup)
                        first_name = data.get('firstName')
                        last_name = data.get('lastName')
                        
                        if not first_name or not last_name:
                            # Parse display name for first/last name (OAuth flow)
                            display_name = user.display_name or user.email.split('@')[0]
                            name_parts = display_name.split(' ', 1)
                            first_name = name_parts[0] if name_parts else 'User'
                            last_name = name_parts[1] if len(name_parts) > 1 else ''
                        else:
                            # Sanitize the provided names
                            first_name = sanitize_string(first_name, max_length=50)
                            last_name = sanitize_string(last_name, max_length=50)
                        
                        # Create Firestore profile for new user
                        auth_provider = 'google' if 'google' in str(user.provider_data).lower() else 'email'
                        user_ref.set({
                            'email': user.email,
                            'firstName': first_name,
                            'lastName': last_name,
                            'email_subscribed': False,  # Opt-in after a “win” moment
                            'timezone': 'America/New_York',
                            'createdAt': firestore.SERVER_TIMESTAMP,
                            'emailVerified': user.email_verified,
                            'authProvider': auth_provider
                        })
                        logger.info(f"Created Firestore profile for user: {user.uid} (provider: {auth_provider})")
                        
                        # Send notification email to admin about new user signup
                        try:
                            from email_service_v2 import get_email_service
                            signup_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')
                            user_name = f"{first_name} {last_name}"
                            
                            email_service = get_email_service()
                            success = email_service.send_new_user_notification(
                                admin_email='jeancalmere.kubwayo@divinebridge.io',
                                user_name=user_name,
                                user_email=user.email,
                                user_id=user.uid,
                                signup_date=signup_date,
                                auth_provider=auth_provider
                            )
                            
                            if success:
                                logger.info(f"Sent new user notification email for: {user.email}")
                            else:
                                logger.warning(f"Failed to send new user notification email for: {user.email}")
                        except Exception as e:
                            logger.error(f"Error sending new user notification email: {e}")
                            # Don't fail signup if email notification fails
                except Exception as e:
                    logger.error(f"Error creating OAuth Firestore profile: {e}")
            
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
            
            logger.info(f"User logged in successfully: {decoded_token['uid']}")
            
            # Create response with session cookie
            response = jsonify({
                'message': 'Login successful',
                'user': session['user']
            })
            
            # Set session cookie with proper configuration
            is_prod = os.getenv('FLASK_ENV') == 'production' or os.getenv('K_SERVICE') is not None
            response.set_cookie(
                'divinebridge_session',
                session.sid if hasattr(session, 'sid') else '',
                httponly=True,
                samesite='Lax',
                secure=is_prod,
                path='/',
                max_age=timedelta(days=7).total_seconds(),
                domain=None
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
def signup():
    try:
        data = request.get_json()
        id_token = data.get('idToken')
        
        # Handle case where user is already created in Firebase Auth (frontend flow)
        if id_token:
            # Ensure Firebase is initialized
            if not initialize_firebase():
                logger.error("Firebase not initialized, cannot verify token")
                return jsonify({'error': 'Authentication service unavailable'}), 503
            
            # Verify the token to get user info
            try:
                decoded_token = verify_token(id_token)
                if not decoded_token:
                    logger.warning(f"Token verification failed for signup attempt - token: {id_token[:20] if id_token else 'None'}...")
                    return jsonify({'error': 'Invalid or expired token. Please try signing up again.'}), 401
            except Exception as e:
                logger.error(f"Error during token verification in signup: {e}")
                return jsonify({'error': 'Token verification failed. Please try again.'}), 401
            
            # Get user from Firebase
            try:
                user = auth.get_user(decoded_token['uid'])
                email = user.email
                first_name = sanitize_string(data.get('firstName'), max_length=50)
                last_name = sanitize_string(data.get('lastName'), max_length=50)
                
                if not all([email, first_name, last_name]):
                    logger.warning(f"Missing required fields for signup - email: {email}, firstName: {first_name}, lastName: {last_name}")
                    return jsonify({'error': 'Missing required fields'}), 400
            except Exception as e:
                logger.error(f"Error getting user from Firebase: {e}")
                return jsonify({'error': 'Failed to retrieve user information. Please try again.'}), 500
        else:
            # Legacy flow: create user with email/password
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
        
        # Create user profile in Firestore with email subscription enabled by default
        try:
            from firebase_admin import firestore
            db = firestore.client()
            user_ref = db.collection('users').document(user.uid)
            
            # Check if profile already exists
            is_new_user = not user_ref.get().exists
            if is_new_user:
                user_ref.set({
                    'email': email,
                    'firstName': first_name,
                    'lastName': last_name,
                    'email_subscribed': False,  # Opt-in after a “win” moment
                    'timezone': 'America/New_York',  # Default timezone
                    'createdAt': firestore.SERVER_TIMESTAMP,
                    'emailVerified': user.email_verified if hasattr(user, 'email_verified') else False
                })
                logger.info(f"Created Firestore profile for user: {user.uid}")
            else:
                logger.info(f"Firestore profile already exists for user: {user.uid}, skipping creation")
            
            # Send notification email to admin about new user signup (only for new users)
            if is_new_user:
                try:
                    from email_service_v2 import get_email_service
                    signup_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')
                    user_name = f"{first_name} {last_name}"
                    
                    email_service = get_email_service()
                    success = email_service.send_new_user_notification(
                        admin_email='jeancalmere.kubwayo@divinebridge.io',
                        user_name=user_name,
                        user_email=email,
                        user_id=user.uid,
                        signup_date=signup_date,
                        auth_provider='email'
                    )
                    
                    if success:
                        logger.info(f"Sent new user notification email for: {email}")
                    else:
                        logger.warning(f"Failed to send new user notification email for: {email}")
                except Exception as e:
                    logger.error(f"Error sending new user notification email: {e}")
                    # Don't fail signup if email notification fails
        except Exception as e:
            logger.error(f"Error creating Firestore profile: {e}")
            # Don't fail signup if Firestore write fails
            
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
        data = request.get_json(silent=True)
        if not data:
            logger.warning("Forgot password request with invalid or missing JSON body")
            return jsonify({'error': 'Invalid request format'}), 400
        
        email = data.get('email')
        
        if not email:
            logger.warning("Forgot password request missing email")
            return jsonify({'error': 'Email is required', 'field': 'email'}), 400
        
        # Validate email format
        if not validate_email(email):
            logger.warning(f"Forgot password request with invalid email format: {email}")
            return jsonify({'error': 'Invalid email format', 'field': 'email'}), 400
            
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

@auth_bp.route('/debug-session')
def debug_session():
    """Debug session information - disabled in production"""
    is_prod = os.getenv('FLASK_ENV') == 'production' or os.getenv('K_SERVICE') is not None
    if is_prod:
        return jsonify({'error': 'Not available'}), 404
    try:
        return jsonify({
            'session_data': dict(session),
            'session_id': session.sid if hasattr(session, 'sid') else 'No session ID',
            'session_permanent': session.permanent,
            'session_modified': session.modified,
            'cookie_secure': current_app.config.get('SESSION_COOKIE_SECURE'),
            'cookie_httponly': current_app.config.get('SESSION_COOKIE_HTTPONLY'),
            'cookie_samesite': current_app.config.get('SESSION_COOKIE_SAMESITE'),
            'has_user': 'user' in session,
            'user_data': session.get('user') if 'user' in session else None
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/status')
def auth_status():
    """Check if user is authenticated"""
    try:
        if 'user' in session:
            try:
                user = auth.get_user(session['user']['uid'])
                session['user'].update({
                    'emailVerified': user.email_verified,
                    'photoURL': user.photo_url if hasattr(user, 'photo_url') else None,
                    'lastSignIn': user.user_metadata.last_sign_in_timestamp if hasattr(user.user_metadata, 'last_sign_in_timestamp') else None
                })
                session.modified = True
                
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
                return jsonify({
                    'authenticated': True,
                    'user': session['user']
                }), 200
        return jsonify({'authenticated': False}), 200
    except Exception as e:
        logger.error(f"Error checking auth status: {e}")
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

@auth_bp.route('/profile/business-card', methods=['GET'])
@limiter.limit("30 per minute")
def get_business_card():
    """Get user's business card data"""
    try:
        # Use shared authentication helper that handles Firebase tokens and session regeneration
        from auth_helpers import get_user_from_session
        user_info = get_user_from_session()
        
        if not user_info:
            return jsonify({'error': 'Not authenticated'}), 401
        
        user_id = user_info['user_id']
        
        # Get user data from Firestore
        from firebase_admin import firestore
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({'error': 'User profile not found'}), 404
        
        user_data = user_doc.to_dict()
        
        # Return business card data
        business_card = {
            'firstName': user_data.get('firstName', ''),
            'lastName': user_data.get('lastName', ''),
            'email': user_data.get('email', ''),
            'phoneNumber': user_data.get('phoneNumber', ''),
            'linkedin': user_data.get('linkedin', ''),
            'businessCardEnabled': user_data.get('businessCardEnabled', False)
        }
        
        return jsonify(business_card), 200
        
    except Exception as e:
        logger.error(f"Error getting business card: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to get business card'}), 500

@auth_bp.route('/profile/business-card', methods=['POST'])
@limiter.limit("10 per minute")
def update_business_card():
    """Update user's business card data"""
    try:
        # Use shared authentication helper that handles Firebase tokens and session regeneration
        from auth_helpers import get_user_from_session
        user_info = get_user_from_session()
        
        if not user_info:
            return jsonify({'error': 'Not authenticated'}), 401
        
        data = request.get_json()
        user_id = user_info['user_id']
        
        # Validate and sanitize input
        phone_number = data.get('phoneNumber', '').strip()
        linkedin = data.get('linkedin', '').strip()
        business_card_enabled = data.get('businessCardEnabled', False)
        
        # Validate phone number format (optional, but if provided should be valid)
        if phone_number:
            # Remove common formatting characters for validation
            phone_digits = ''.join(filter(str.isdigit, phone_number))
            if len(phone_digits) < 10:
                return jsonify({'error': 'Invalid phone number format'}), 400
        
        # Validate LinkedIn URL (optional)
        if linkedin:
            # Normalize LinkedIn URL
            if not linkedin.startswith('http'):
                if linkedin.startswith('linkedin.com') or linkedin.startswith('www.linkedin.com'):
                    linkedin = 'https://' + linkedin
                elif '/' not in linkedin:
                    linkedin = f'https://linkedin.com/in/{linkedin}'
                else:
                    linkedin = f'https://{linkedin}'
            
            if 'linkedin.com' not in linkedin:
                return jsonify({'error': 'Invalid LinkedIn URL'}), 400
        
        # Update Firestore
        from firebase_admin import firestore
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        
        update_data = {}
        if 'phoneNumber' in data:
            update_data['phoneNumber'] = phone_number if phone_number else None
        if 'linkedin' in data:
            update_data['linkedin'] = linkedin if linkedin else None
        if 'businessCardEnabled' in data:
            update_data['businessCardEnabled'] = bool(business_card_enabled)
        
        user_ref.update(update_data)
        
        logger.info(f"Updated business card for user: {user_id}")
        
        return jsonify({'message': 'Business card updated successfully'}), 200
        
    except Exception as e:
        logger.error(f"Error updating business card: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to update business card'}), 500


# ─── Push Token Registration (Phase 2D) ─────────────────────────────────────

@auth_bp.route('/push-token', methods=['POST'])
def register_push_token():
    """Register an Expo push token for the authenticated user."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Authentication required'}), 401

        token = auth_header.split('Bearer ')[1]
        decoded = verify_token(token)
        if not decoded:
            return jsonify({'error': 'Invalid token'}), 401
        user_id = decoded.get('uid')

        data = request.get_json()
        push_token = data.get('pushToken', '').strip()
        platform = data.get('platform', 'unknown')

        if not push_token:
            return jsonify({'error': 'pushToken is required'}), 400

        from firebase_admin import firestore
        db = firestore.client()
        db.collection('users').document(user_id).set({
            'pushToken': push_token,
            'pushPlatform': platform,
            'pushTokenUpdatedAt': datetime.utcnow().isoformat(),
        }, merge=True)

        logger.info(f"Push token registered for user {user_id}")
        return jsonify({'message': 'Push token registered'}), 200

    except Exception as e:
        logger.error(f"Error registering push token: {e}")
        return jsonify({'error': 'Failed to register push token'}), 500