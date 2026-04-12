"""
Testimony Blueprint for Divine Bridge
Handles thanksgiving/testimony submissions and retrieval
"""

from flask import Blueprint, request, jsonify, current_app
import logging
import os
from datetime import datetime
import uuid
from extensions import limiter
from qa_wall_filters import is_hidden_production_test_wall_item

logger = logging.getLogger(__name__)

testimony_bp = Blueprint('testimony', __name__)

# Determine which storage handler to use
USE_LOCAL_STORAGE = os.getenv('USE_LOCAL_STORAGE', 'false').lower() == 'true'
if USE_LOCAL_STORAGE:
    logger.info("Testimony BP: Using local storage for development")
else:
    logger.info("Testimony BP: Using cloud storage for production")


@testimony_bp.route('/submit', methods=['POST'])
@limiter.limit("5 per hour")
@limiter.limit("15 per day")
def submit_testimony():
    """
    Submit a new testimony/thanksgiving
    
    Body:
        {
          "title": "God answered my prayer!",
          "content": "Full testimony story..."
        }
    
    Returns:
        {
          "message": "Testimony submitted",
          "testimony_id": "uuid"
        }
    """
    try:
        data = request.get_json()
        category = data.get('category', '').strip()
        title = data.get('title', '').strip()
        content = data.get('content', '').strip()
        user_id = data.get('user_id', '').strip()
        user_email = data.get('user_email', '').strip()
        
        if not title or not content or not category:
            return jsonify({'error': 'Category, title and content are required'}), 400
        
        # Validate length
        if len(title) > 200:
            return jsonify({'error': 'Title must be less than 200 characters'}), 400
        
        if len(content) < 20:
            return jsonify({'error': 'Please share more details (minimum 20 characters)'}), 400
        
        if len(content) > 2000:
            return jsonify({'error': 'Testimony must be less than 2000 characters'}), 400
        
        # AI Content Moderation + Summary Generation (combined call)
        logger.info(f"Moderating and summarizing testimony: {title}")
        from content_moderator import get_content_moderator
        
        moderator = get_content_moderator()
        approved, rejection_reason, ai_summary = moderator.moderate_content(title, content, "testimony")
        
        # If not approved, return error with reason
        if not approved:
            logger.warning(f"Testimony rejected: {rejection_reason}")
            return jsonify({
                'error': 'Content not approved',
                'reason': rejection_reason,
                'approved': False
            }), 400
        
        # Create testimony object (auto-approved if passes AI moderation)
        testimony_id = str(uuid.uuid4())
        testimony = {
            'id': testimony_id,
            'category': category,
            'title': title,
            'content': content,
            'summary': ai_summary if ai_summary else content[:150] + '...',
            'user_id': user_id,
            'user_email': user_email,
            'created_at': datetime.now().isoformat(),
            'approved': True,  # Auto-approved after AI moderation
            'views': 0,
            'likes': 0,
            'moderation': {
                'approved': approved,
                'moderated_at': datetime.now().isoformat(),
                'ai_moderated': True
            }
        }
        
        # Save to storage (works with both Cloud and Local storage)
        saved_path = current_app.storage_handler.save_testimony(testimony)
        
        if saved_path:
            logger.info(f"Testimony submitted: {testimony_id}")
            return jsonify({
                'message': 'Testimony submitted successfully!',
                'testimony_id': testimony_id
            }), 200
        else:
            return jsonify({'error': 'Failed to save testimony'}), 500
            
    except Exception as e:
        logger.error(f"Error submitting testimony: {e}")
        return jsonify({'error': 'Failed to submit testimony'}), 500


@testimony_bp.route('/testimonies', methods=['GET'])
def get_testimonies():
    """
    Get recent approved testimonies
    
    Query params:
        - limit: Number of testimonies to return (default: 10)
    
    Returns:
        {
          "testimonies": [...]
        }
    """
    try:
        limit = int(request.args.get('limit', 10))
        
        # Get all testimonies from Cloud Storage
        testimonies = current_app.storage_handler.get_all_testimonies(limit=limit)
        
        # Filter for approved only; never surface QA / production-test artifacts
        approved_testimonies = [
            t for t in testimonies
            if t.get('approved', False) and not is_hidden_production_test_wall_item(t)
        ]

        logger.info(f"Returning {len(approved_testimonies)} approved testimonies")

        response = jsonify({
            'testimonies': approved_testimonies[:limit]
        })
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        return response, 200
        
    except Exception as e:
        logger.error(f"Error getting testimonies: {e}")
        return jsonify({'error': 'Failed to get testimonies'}), 500


@testimony_bp.route('/testimony/<testimony_id>', methods=['GET'])
def get_testimony(testimony_id):
    """Get a specific testimony by ID"""
    try:
        testimony = current_app.storage_handler.get_testimony(testimony_id)
        
        if not testimony:
            return jsonify({'error': 'Testimony not found'}), 404

        if is_hidden_production_test_wall_item(testimony):
            return jsonify({'error': 'Testimony not found'}), 404
        
        # Only return if approved
        if not testimony.get('approved', False):
            return jsonify({'error': 'Testimony not available'}), 404
        
        # Increment view count
        testimony['views'] = testimony.get('views', 0) + 1
        current_app.storage_handler.update_testimony(testimony_id, testimony)
        
        return jsonify({'testimony': testimony}), 200
        
    except Exception as e:
        logger.error(f"Error getting testimony {testimony_id}: {e}")
        return jsonify({'error': 'Failed to get testimony'}), 500


@testimony_bp.route('/testimony/<testimony_id>/view', methods=['POST'])
def track_testimony_view(testimony_id):
    """Track when a testimony is viewed (expanded)"""
    try:
        testimony = current_app.storage_handler.get_testimony(testimony_id)
        
        if not testimony:
            return jsonify({'error': 'Testimony not found'}), 404
        
        # Increment view count
        testimony['views'] = testimony.get('views', 0) + 1
        
        if current_app.storage_handler.update_testimony(testimony_id, testimony):
            return jsonify({
                'message': 'View tracked',
                'views': testimony['views']
            }), 200
        else:
            return jsonify({'error': 'Failed to track view'}), 500
        
    except Exception as e:
        logger.error(f"Error tracking testimony view: {e}")
        return jsonify({'error': 'Failed to track view'}), 500


@testimony_bp.route('/testimony/<testimony_id>/like', methods=['POST'])
def like_testimony(testimony_id):
    """Increment like count for a testimony"""
    try:
        testimony = current_app.storage_handler.get_testimony(testimony_id)
        
        if not testimony:
            return jsonify({'error': 'Testimony not found'}), 404
        
        testimony['likes'] = testimony.get('likes', 0) + 1
        current_app.storage_handler.update_testimony(testimony_id, testimony)
        
        return jsonify({
            'message': 'Testimony liked',
            'likes': testimony['likes']
        }), 200
        
    except Exception as e:
        logger.error(f"Error liking testimony {testimony_id}: {e}")
        return jsonify({'error': 'Failed to like testimony'}), 500


# Admin authentication helper
def require_admin():
    """Check for admin authentication"""
    from flask import request, jsonify
    from config import get_config
    
    # Get admin key from header or query param
    admin_key = request.headers.get('X-Admin-Key') or request.args.get('admin_key')
    
    # Get expected admin key from config
    config = get_config()
    expected_key = getattr(config, 'admin_key', None)
    
    if not expected_key:
        # If no admin key is configured, require authentication but allow through
        # In production, you should configure this in Secret Manager
        logger.warning("No admin key configured! Admin endpoints are unsecured.")
        return True
    
    if admin_key != expected_key:
        return False
    
    return True


# Admin Endpoints
@testimony_bp.route('/admin/pending', methods=['GET'])
def get_pending_testimonies():
    """
    Get all pending (unapproved) testimonies for moderation
    
    Requires admin authentication via X-Admin-Key header or admin_key query param
    
    Returns:
        {
          "testimonies": [...],
          "count": 5
        }
    """
    # Check admin authentication
    if not require_admin():
        return jsonify({'error': 'Unauthorized. Admin access required.'}), 401
    
    try:
        # Get all testimonies
        all_testimonies = current_app.storage_handler.get_all_testimonies(limit=100)
        
        # Filter for pending only
        pending = [t for t in all_testimonies if not t.get('approved', False)]
        
        logger.info(f"Found {len(pending)} pending testimonies")
        
        return jsonify({
            'testimonies': pending,
            'count': len(pending)
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting pending testimonies: {e}")
        return jsonify({'error': 'Failed to get pending testimonies'}), 500


@testimony_bp.route('/admin/approve/<testimony_id>', methods=['POST'])
def approve_testimony(testimony_id):
    """
    Approve a testimony for public display
    
    Requires admin authentication via X-Admin-Key header or admin_key query param
    
    Returns:
        {
          "message": "Testimony approved",
          "testimony_id": "..."
        }
    """
    # Check admin authentication
    if not require_admin():
        return jsonify({'error': 'Unauthorized. Admin access required.'}), 401
    
    try:
        
        testimony = current_app.storage_handler.get_testimony(testimony_id)
        
        if not testimony:
            return jsonify({'error': 'Testimony not found'}), 404
        
        testimony['approved'] = True
        testimony['approved_at'] = datetime.now().isoformat()
        
        success = current_app.storage_handler.update_testimony(testimony_id, testimony)
        
        if success:
            logger.info(f"Testimony approved: {testimony_id}")
            return jsonify({
                'message': 'Testimony approved',
                'testimony_id': testimony_id
            }), 200
        else:
            return jsonify({'error': 'Failed to approve testimony'}), 500
            
    except Exception as e:
        logger.error(f"Error approving testimony {testimony_id}: {e}")
        return jsonify({'error': 'Failed to approve testimony'}), 500


@testimony_bp.route('/admin/reject/<testimony_id>', methods=['POST'])
def reject_testimony(testimony_id):
    """
    Reject a testimony (mark as not approved, can add rejection reason)
    
    Requires admin authentication via X-Admin-Key header or admin_key query param
    
    Body (optional):
        {
          "reason": "Inappropriate content"
        }
    
    Returns:
        {
          "message": "Testimony rejected"
        }
    """
    # Check admin authentication
    if not require_admin():
        return jsonify({'error': 'Unauthorized. Admin access required.'}), 401
    
    try:
        testimony = current_app.storage_handler.get_testimony(testimony_id)
        
        if not testimony:
            return jsonify({'error': 'Testimony not found'}), 404
        
        data = request.get_json() or {}
        
        testimony['approved'] = False
        testimony['rejected'] = True
        testimony['rejected_at'] = datetime.now().isoformat()
        testimony['rejection_reason'] = data.get('reason', 'Not specified')
        
        success = current_app.storage_handler.update_testimony(testimony_id, testimony)
        
        if success:
            logger.info(f"Testimony rejected: {testimony_id}")
            return jsonify({
                'message': 'Testimony rejected',
                'testimony_id': testimony_id
            }), 200
        else:
            return jsonify({'error': 'Failed to reject testimony'}), 500
            
    except Exception as e:
        logger.error(f"Error rejecting testimony {testimony_id}: {e}")
        return jsonify({'error': 'Failed to reject testimony'}), 500

