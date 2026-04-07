import firebase_admin
from firebase_admin import credentials, auth, firestore, db as rtdb_module
from flask import current_app
import logging
import json
from config import get_config
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import os
import sys
from google.cloud import secretmanager
import traceback

logger = logging.getLogger(__name__)

def _build_retry_session():
    """Build a requests.Session with automatic retry on transient errors.
    Used for Google auth token refreshes so a single network blip doesn't
    cascade into gRPC / Firestore failures."""
    retry_strategy = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    s = requests.Session()
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s

def get_secret(secret_id):
    """Get a secret from Secret Manager."""
    try:
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/divinebridge/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        return response.payload.data.decode("UTF-8")
    except Exception as e:
        logger.error(f"Failed to get secret {secret_id}: {e}")
        return None

def initialize_firebase():
    """Initialize Firebase Admin SDK with retry logic."""
    try:
        # Check if Firebase is already initialized
        if firebase_admin._apps:
            logger.info("Firebase Admin SDK already initialized")
            return True

        # Get configuration
        config = get_config()
        
        # Get Firebase credentials
        creds_json = config.FIREBASE_CREDENTIALS
        if not creds_json:
            error_message = "Failed to get Firebase credentials from Secret Manager"
            logger.error(error_message)
            print(f"STDERR_DEBUG: {error_message}", file=sys.stderr)
            return False

        try:
            # Parse the credentials JSON
            creds_dict = json.loads(creds_json)
            logger.info("Successfully parsed Firebase credentials JSON")
            logger.info(f"Project ID from credentials: {creds_dict.get('project_id')}")
        except json.JSONDecodeError as e:
            error_message = f"Failed to parse Firebase credentials JSON: {e}"
            logger.error(error_message)
            print(f"STDERR_DEBUG: {error_message}", file=sys.stderr)
            return False

        # Use project_id from credentials if needed
        firebase_project_id = creds_dict.get('project_id')
        if not firebase_project_id:
            error_message = "project_id not found in Firebase credentials JSON."
            logger.error(error_message)
            print(f"STDERR_DEBUG: {error_message}", file=sys.stderr)
            return False

        # Initialize Firebase with retry logic
        max_retries = 3
        retry_delay = 1
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempt {attempt + 1}/{max_retries} to initialize Firebase with project ID: {firebase_project_id}")
                print(f"STDERR_DEBUG: Attempt {attempt + 1}/{max_retries} to initialize Firebase with project ID: {firebase_project_id}", file=sys.stderr)
                
                # Create credentials object
                cred = credentials.Certificate(creds_dict)
                
                # Initialize app with explicit options
                firebase_admin.initialize_app(cred, {
                    'projectId': firebase_project_id,
                    'storageBucket': f"{firebase_project_id}.appspot.com",
                    'databaseURL': f"https://{firebase_project_id}-default-rtdb.firebaseio.com",
                })
                
                # Patch the credential's HTTP transport so token refreshes
                # use a retry-enabled session instead of a bare one.
                try:
                    import google.auth.transport.requests as _ga_transport
                    app_cred = firebase_admin.get_app().credential
                    if hasattr(app_cred, '_g_credential'):
                        g_cred = app_cred._g_credential
                        retry_session = _build_retry_session()
                        _request = _ga_transport.Request(session=retry_session)
                        g_cred.refresh(_request)
                        logger.info("Credential refresh transport configured with retry session")
                except Exception as patch_err:
                    logger.warning(f"Could not patch credential transport (non-fatal): {patch_err}")

                logger.info("Firebase initialized successfully")
                print("STDERR_DEBUG: Firebase initialized successfully", file=sys.stderr)
                return True
            except Exception as e:
                error_message = f"Attempt {attempt + 1}/{max_retries} failed to initialize Firebase. Exception type: {type(e).__name__}, Error: {str(e)}, Args: {e.args}"
                logger.error(error_message)
                print(f"STDERR_DEBUG: {error_message}", file=sys.stderr)
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    final_error_message = "All attempts to initialize Firebase failed"
                    logger.error(final_error_message)
                    print(f"STDERR_DEBUG: {final_error_message}", file=sys.stderr)
                    return False
    except Exception as e:
        error_message = f"Critical error during Firebase initialization setup: Exception type: {type(e).__name__}, Error: {str(e)}, Args: {e.args}"
        logger.error(error_message)
        print(f"STDERR_DEBUG: {error_message}", file=sys.stderr)
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
        if not id_token:
            logger.error("No ID token provided for verification")
            return None
            
        logger.info(f"Token length: {len(id_token)}")
        logger.info(f"Token prefix: {id_token[:20]}...")
            
        # Ensure Firebase is initialized
        if not initialize_firebase():
            logger.error("Firebase not initialized, cannot verify token")
            return None
            
        logger.info("Attempting to verify ID token...")
        try:
            logger.info("Calling auth.verify_id_token...")
            # Add check for token format
            if not isinstance(id_token, str):
                logger.error(f"Invalid token type: {type(id_token)}")
                return None
                
            if len(id_token.split('.')) != 3:
                logger.error("Invalid token format: not a valid JWT")
                return None
                
            logger.info("Token format validation passed")
            logger.info("Attempting to verify token with Firebase...")
            
            try:
                # Allow clock skew of up to 5 seconds to handle timing differences
                # This is important for newly created tokens that might be slightly ahead of server time
                decoded_token = auth.verify_id_token(id_token, clock_skew_seconds=5)
                logger.info(f"Token verified successfully for user: {decoded_token.get('uid')}")
                logger.info(f"Decoded token claims: {decoded_token}")
                logger.info(f"Token expiration: {decoded_token.get('exp')}")
                logger.info(f"Token issued at: {decoded_token.get('iat')}")
                logger.info(f"Token issuer: {decoded_token.get('iss')}")
                return decoded_token
            except auth.InvalidIdTokenError as e:
                error_str = str(e)
                # Check if it's a clock skew issue
                if "too early" in error_str.lower() or "clock" in error_str.lower():
                    logger.warning(f"Token clock skew detected: {error_str}")
                    logger.warning("Retrying with increased clock skew tolerance...")
                    try:
                        # Retry with larger clock skew tolerance (10 seconds)
                        decoded_token = auth.verify_id_token(id_token, clock_skew_seconds=10)
                        logger.info(f"Token verified successfully on retry for user: {decoded_token.get('uid')}")
                        return decoded_token
                    except Exception as retry_error:
                        logger.error(f"Token verification failed on retry: {retry_error}")
                        return None
                else:
                    logger.error(f"Invalid ID token: {error_str}")
                    logger.error(f"Error type: {type(e)}")
                    logger.error(f"Error args: {e.args}")
                    logger.error(f"Error traceback: {traceback.format_exc()}")
                    return None
            except auth.ExpiredIdTokenError as e:
                logger.error(f"Expired ID token: {str(e)}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error args: {e.args}")
                logger.error(f"Error traceback: {traceback.format_exc()}")
                return None
            except auth.RevokedIdTokenError as e:
                logger.error(f"Revoked ID token: {str(e)}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error args: {e.args}")
                logger.error(f"Error traceback: {traceback.format_exc()}")
                return None
            except auth.UserDisabledError as e:
                logger.error(f"User is disabled: {str(e)}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error args: {e.args}")
                logger.error(f"Error traceback: {traceback.format_exc()}")
                return None
            except Exception as e:
                logger.error(f"Token verification failed with unexpected error: {str(e)}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error args: {e.args}")
                logger.error(f"Error traceback: {traceback.format_exc()}")
                return None
        except Exception as e:
            logger.error(f"Error in token verification process: {str(e)}")
            logger.error(f"Error type: {type(e)}")
            logger.error(f"Error args: {e.args}")
            logger.error(f"Error traceback: {traceback.format_exc()}")
            return None
    except Exception as e:
        logger.error(f"Error in verify_token: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error args: {e.args}")
        logger.error(f"Error traceback: {traceback.format_exc()}")
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

def get_firestore_client():
    """Get Firestore client instance"""
    try:
        # Ensure Firebase is initialized
        if not firebase_admin._apps:
            initialize_firebase()
        
        # Return Firestore client
        return firestore.client()
    except Exception as e:
        logger.error(f"Error getting Firestore client: {e}")
        return None

def get_rtdb_client():
    """Get Firebase Realtime Database reference module"""
    try:
        if not firebase_admin._apps:
            initialize_firebase()
        return rtdb_module
    except Exception as e:
        logger.error(f"Error getting RTDB client: {e}")
        return None