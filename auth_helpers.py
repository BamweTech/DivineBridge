"""Shared authentication helpers for handling user sessions across deployments"""
from flask import request, session
from firebase_admin import auth
import logging

logger = logging.getLogger(__name__)

def get_user_from_session():
    """Get user information from session or Firebase ID token
    
    Priority:
    1. Firebase ID token (most reliable, survives deployments)
    2. Flask session (regenerated if Firebase token is valid)
    
    Returns:
        dict: User info with 'user_id', 'user_name', 'name', 'email' keys, or None if not authenticated
    """
    # First, try to get user from Firebase ID token (survives deployments)
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        id_token = auth_header.split('Bearer ')[1]
        try:
            # Verify the Firebase ID token with retry logic
            max_retries = 3
            decoded_token = None
            
            for attempt in range(max_retries):
                try:
                    decoded_token = auth.verify_id_token(id_token)
                    break  # Success
                except Exception as e:
                    error_str = str(e)
                    # Check if it's a transient error (network, timeout, etc.)
                    is_transient = any(keyword in error_str.lower() for keyword in 
                                     ['timeout', 'connection', 'network', 'unavailable', '503', '500'])
                    
                    if is_transient and attempt < max_retries - 1:
                        logger.warning(f"⚠️ Transient Firebase token verification error (attempt {attempt + 1}/{max_retries}): {error_str}")
                        import time
                        time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                        continue
                    else:
                        # Non-transient error or last attempt
                        raise
            
            if decoded_token:
                user_name = decoded_token.get('name') or decoded_token.get('email', '').split('@')[0] or 'Anonymous'
                user_id = decoded_token.get('uid')
                
                logger.info(f"✅ User authenticated via Firebase ID token: {user_id}")
                
                # CRITICAL FIX: Regenerate Flask session if it's missing or invalid
                # This allows session-based auth to work again after deployments
                if not session.get('user') or session.get('user', {}).get('uid') != user_id:
                    logger.info(f"🔄 Regenerating Flask session for user {user_id}")
                    session['user'] = {
                        'uid': user_id,
                        'email': decoded_token.get('email', ''),
                        'name': user_name,
                        'emailVerified': decoded_token.get('email_verified', False)
                    }
                    session.permanent = True
                    session.modified = True
                    logger.info(f"✅ Flask session regenerated successfully")
                
                return {
                    'user_id': user_id,
                    'user_name': user_name,
                    'name': user_name,
                    'email': decoded_token.get('email')
                }
        except auth.ExpiredIdTokenError:
            logger.warning(f"⚠️ Firebase ID token expired - user needs to refresh")
            # Don't fall through - let frontend handle token refresh
            return None
        except auth.InvalidIdTokenError as e:
            logger.warning(f"⚠️ Firebase ID token invalid: {str(e)}")
            # Don't fall through - invalid token means user needs to login
            return None
        except Exception as e:
            # Log full error for debugging
            import traceback
            error_details = traceback.format_exc()
            logger.error(f"❌ Firebase ID token verification failed: {str(e)}\n{error_details}")
            # For other errors (network, etc.), fall through to session check as fallback
    
    # Fallback to session-based authentication
    user = session.get('user')
    if not user:
        logger.info("🔍 No user in session and no valid Firebase token")
        return None
    
    # Debug logging to see what's in the session
    logger.info(f"🔍 Using Flask session for user: {user.get('uid', 'unknown')}")
    
    # Try multiple possible name fields
    user_name = user.get('name') or user.get('displayName') or user.get('user_name') or 'Anonymous'
    
    return {
        'user_id': user.get('uid'),
        'user_name': user_name,
        'name': user_name,
        'email': user.get('email')
    }

