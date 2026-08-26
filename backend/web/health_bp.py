"""Health check endpoint for Cloud Run."""
import logging
from datetime import datetime

from flask import Blueprint, current_app, jsonify

health_bp = Blueprint("health", __name__)
logger = logging.getLogger(__name__)


@health_bp.route("/_ah/health")
def health_check():
    """Health check endpoint for Cloud Run"""
    try:
        status = {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "firebase_initialized": getattr(current_app, "firebase_initialized", False),
        }
        return jsonify(status), 200
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return jsonify({"status": "unhealthy", "error": str(e)}), 500
