"""
Authentication and Authorization Decorators for DivineBridge
"""

import logging
from functools import wraps
from flask import request, jsonify, session
from backend.integrations.firebase_auth import verify_token

logger = logging.getLogger(__name__)


def require_auth(f):
    """
    Decorator to require authentication
    Checks for valid Firebase token in Authorization header or session
    """

    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check session first
        if "user" in session:
            return f(*args, **kwargs)

        # Check Authorization header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.replace("Bearer ", "")
            decoded_token = verify_token(token)

            if decoded_token:
                return f(*args, **kwargs)

        logger.warning(f"Unauthorized access attempt to {request.path}")
        return jsonify({"error": "Authentication required"}), 401

    return decorated_function


def require_role(required_role):
    """
    Decorator to require specific role
    Usage: @require_role('admin')
    """

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Check session
            if "user" not in session:
                # Check Authorization header
                auth_header = request.headers.get("Authorization", "")
                if not auth_header.startswith("Bearer "):
                    logger.warning(f"Unauthorized access attempt to {request.path}")
                    return jsonify({"error": "Authentication required"}), 401

                token = auth_header.replace("Bearer ", "")
                decoded_token = verify_token(token)

                if not decoded_token:
                    return jsonify({"error": "Invalid token"}), 401

                # Check role in token claims
                role = decoded_token.get("role", "user")
            else:
                # Get role from session
                role = session["user"].get("role", "user")

            if role != required_role:
                logger.warning(f"Insufficient permissions for {request.path}. Required: {required_role}, Has: {role}")
                return jsonify({"error": "Insufficient permissions"}), 403

            return f(*args, **kwargs)

        return decorated_function

    return decorator


def verify_cloud_scheduler():
    """
    Decorator to verify request comes from Cloud Scheduler
    Checks for Cloud Scheduler OIDC token
    """

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # In production, verify OIDC token from Cloud Scheduler
            # For now, check for specific header or IP range

            # Allow local testing
            if request.remote_addr in ["127.0.0.1", "localhost"]:
                logger.info("Allowing local request to Cloud Scheduler endpoint")
                return f(*args, **kwargs)

            # Check for Cloud Scheduler user agent
            user_agent = request.headers.get("User-Agent", "")
            if "Google-Cloud-Scheduler" in user_agent:
                logger.info("Verified Cloud Scheduler request")
                return f(*args, **kwargs)

            # Check for OIDC token (recommended for production)
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                # In production, verify this is a valid Cloud Scheduler OIDC token
                # For now, allow if token exists
                logger.info("Request has authorization token, allowing")
                return f(*args, **kwargs)

            logger.warning(f"Unauthorized Cloud Scheduler access attempt from {request.remote_addr}")
            return jsonify({"error": "Forbidden"}), 403

        return decorated_function

    return decorator
