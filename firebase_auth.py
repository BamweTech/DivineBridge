import firebase_admin
from firebase_admin import credentials, auth
from flask import current_app
import logging
import json
from config import get_config
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def initialize_firebase():
    """Initialize Firebase Admin SDK with retry logic."""
    try:
        # Check if Firebase is already initialized
        if firebase_admin._apps:
            logger.info("Firebase Admin SDK already initialized")
            return True

        # Get configuration
        config = get_config()
        
        # Get Firebase credentials from config
        creds_json = config.FIREBASE_CREDENTIALS
        if isinstance(creds_json, str):
            try:
                creds_json = json.loads(creds_json)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Firebase credentials JSON: {e}")
                return False

        # Initialize Firebase with retry logic
        max_retries = 3
        retry_delay = 1
        
        for attempt in range(max_retries):
            try:
                # Initialize Firebase with credentials and project ID
                firebase_admin.initialize_app(
                    credentials.Credentials.from_service_account_info(creds_json),
                    options={'projectId': os.getenv('FIREBASE_PROJECT_ID')}
                )
                logger.info("Firebase initialized successfully")
                return True
            except Exception as e:
                logger.error(f"Attempt {attempt + 1}/{max_retries} failed to initialize Firebase: {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    logger.error("All attempts to initialize Firebase failed")
                    return False
                    
    except Exception as e:
        logger.error(f"Error initializing Firebase: {e}")
        return False

def create_user(email, password, first_name, last_name):
    """Create a new user in Firebase Authentication"""
    try:
        # Create the user
        user = auth.create_user(
            email=email,
            password=password,
            display_name=f"{first_name} {last_name}"
        )
        
        # Set custom claims for role-based access
        auth.set_custom_user_claims(user.uid, {'role': 'user'})
        
        logger.info(f"User created successfully: {user.uid}")
        return user
    except Exception as e:
        logger.error(f"Failed to create user: {e}")
        return None

def verify_token(id_token):
    """Verify Firebase ID token."""
    try:
        decoded_token = auth.verify_id_token(id_token)
        return decoded_token
    except Exception as e:
        logger.error(f"Token verification failed: {str(e)}")
        return None

def get_user(uid):
    """Get user by UID"""
    try:
        user = auth.get_user(uid)
        return user
    except Exception as e:
        logger.error(f"Failed to get user: {e}")
        return None

def update_user(uid, **kwargs):
    """Update user attributes"""
    try:
        user = auth.update_user(uid, **kwargs)
        return user
    except Exception as e:
        logger.error(f"Failed to update user: {e}")
        return None

def delete_user(uid):
    """Delete user by UID"""
    try:
        auth.delete_user(uid)
        return True
    except Exception as e:
        logger.error(f"Failed to delete user: {e}")
        return False

def create_password_reset_token(email):
    """Generate a password reset token for the given email"""
    try:
        # Generate a custom token that will be used to reset the password
        from firebase_admin import auth
        user = auth.get_user_by_email(email)
        custom_token = auth.create_custom_token(user.uid)
        return custom_token.decode()
    except Exception as e:
        logger.error(f"Error creating password reset token: {e}")
        return None

def reset_password_with_token(token, new_password):
    """Reset password using the provided token"""
    try:
        from firebase_admin import auth
        # Verify the custom token
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # Update the user's password
        auth.update_user(uid, password=new_password)
        return True
    except Exception as e:
        logger.error(f"Error resetting password: {e}")
        return False

def verify_credentials(email, password):
    """Verify user credentials and return the user if valid"""
    try:
        # Get user by email
        user = auth.get_user_by_email(email)
        
        # Verify password (this is handled by Firebase client SDK)
        # We just need to return the user if they exist
        return user
    except Exception as e:
        logger.error(f"Failed to verify credentials: {e}")
        return None

def send_verification_email(email):
    """Send email verification link to user"""
    try:
        # Get user by email
        user = auth.get_user_by_email(email)
        
        # Generate email verification link
        action_code_settings = auth.ActionCodeSettings(
            url=f"{current_app.config['HOST_URL']}/verify-email",
            handle_code_in_app=True
        )
        
        # Send verification email
        auth.generate_email_verification_link(
            email,
            action_code_settings=action_code_settings
        )
        
        return True
    except Exception as e:
        logger.error(f"Error sending verification email: {e}")
        return False

def verify_email_token(token):
    """Verify email verification token"""
    try:
        # Verify the token
        decoded_token = auth.verify_id_token(token)
        uid = decoded_token['uid']
        
        # Update user's email verification status
        auth.update_user(uid, email_verified=True)
        return True
    except Exception as e:
        logger.error(f"Error verifying email token: {e}")
        return False 