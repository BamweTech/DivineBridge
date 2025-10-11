from flask import Blueprint, request, jsonify, current_app
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)
prayer_bp = Blueprint('prayer', __name__)

@prayer_bp.route('/prayer/<date>', methods=['GET'])
def get_prayer(date):
    try:
        prayer = current_app.storage_handler.get_prayer(date)
        if not prayer:
            return jsonify({'error': 'Prayer not found'}), 404
        return jsonify({'prayer': prayer}), 200
    except Exception as e:
        logger.error(f"Error getting prayer: {e}")
        return jsonify({'error': 'Failed to get prayer'}), 500

@prayer_bp.route('/generate-prayer', methods=['POST'])
def generate_prayer():
    try:
        # Check if we already have a prayer for today
        today = datetime.now().strftime('%Y-%m-%d')
        existing_prayer = current_app.storage_handler.get_prayer(today)
        if existing_prayer:
            return jsonify({'prayer': existing_prayer}), 200
            
        # Generate new prayer
        prayer_data = current_app.prayer_generator.generate_prayer()
        if not prayer_data:
            return jsonify({'error': 'Failed to generate prayer'}), 500
            
        return jsonify({'prayer': prayer_data}), 200
    except Exception as e:
        logger.error(f"Error generating prayer: {e}")
        return jsonify({'error': 'Failed to generate prayer'}), 500

@prayer_bp.route('/subscribe', methods=['POST'])
def subscribe():
    try:
        data = request.get_json()
        email = data.get('email')
        first_name = data.get('firstName')
        last_name = data.get('lastName')
        
        if not all([email, first_name, last_name]):
            return jsonify({'error': 'Missing required fields'}), 400
            
        # Add subscriber to sheet
        if not current_app.sheet_handler.add_subscriber(email, first_name, last_name):
            return jsonify({'error': 'Failed to add subscriber'}), 500
            
        # Send welcome email
        if not current_app.email_service.send_welcome_email(email, first_name):
            logger.warning(f"Failed to send welcome email to {email}")
            
        return jsonify({'message': 'Successfully subscribed'}), 200
    except Exception as e:
        logger.error(f"Error subscribing: {e}")
        return jsonify({'error': 'Failed to subscribe'}), 500

@prayer_bp.route('/unsubscribe', methods=['POST'])
def unsubscribe():
    try:
        data = request.get_json()
        email = data.get('email')
        
        if not email:
            return jsonify({'error': 'Email is required'}), 400
            
        # Remove subscriber from sheet
        if not current_app.sheet_handler.remove_subscriber(email):
            return jsonify({'error': 'Failed to remove subscriber'}), 500
            
        # Send unsubscribe confirmation
        if not current_app.email_service.send_unsubscribe_confirmation(email):
            logger.warning(f"Failed to send unsubscribe confirmation to {email}")
            
        return jsonify({'message': 'Successfully unsubscribed'}), 200
    except Exception as e:
        logger.error(f"Error unsubscribing: {e}")
        return jsonify({'error': 'Failed to unsubscribe'}), 500

@prayer_bp.route('/prayers', methods=['GET'])
def get_prayers():
    """Get recent prayers and prayer requests"""
    try:
        from datetime import datetime
        
        # Get client's local date from query parameter (format: YYYY-MM-DD)
        # If not provided, use server's date as fallback
        client_date = request.args.get('client_date')
        if client_date:
            today = client_date
            logger.info(f"Using client's local date: {today}")
        else:
            today = datetime.now().strftime('%Y-%m-%d')
            logger.info(f"Using server date: {today}")
        
        # Get recent prayers (last 20 by default)
        prayers = current_app.storage_handler.get_prayers(limit=20)
        
        # Get recent prayer requests (last 30 by default)
        prayer_requests = current_app.storage_handler.get_prayer_requests(limit=30)
        
        # Filter out any invalid items (must be dicts with get method)
        valid_prayers = [p for p in prayers if isinstance(p, dict)]
        valid_requests = [r for r in prayer_requests if isinstance(r, dict)]
        
        # For daily prayers (AI-generated), only include prayer matching client's local date
        # For prayer requests (user-submitted), include recent ones
        filtered_prayers = []
        for prayer in valid_prayers:
            # Check if it's a daily prayer (source='generated' and no title)
            is_daily_prayer = prayer.get('source') == 'generated' and not prayer.get('title')
            
            if is_daily_prayer:
                # Only include if it matches the client's local date
                if prayer.get('date') == today:
                    filtered_prayers.append(prayer)
                    logger.debug(f"Including daily prayer for date: {today}")
            else:
                # Include all non-daily prayers (shouldn't exist, but just in case)
                filtered_prayers.append(prayer)
        
        # Combine filtered daily prayer with prayer requests and sort
        all_items = filtered_prayers + valid_requests
        all_items.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        return jsonify({'prayers': all_items}), 200
    except Exception as e:
        logger.error(f"Error getting prayers: {e}")
        logger.exception("Full traceback:")
        return jsonify({'error': 'Failed to get prayers'}), 500

@prayer_bp.route('/request', methods=['POST'])
def submit_prayer_request():
    """Submit a prayer request"""
    try:
        data = request.get_json()
        title = data.get('title')
        content = data.get('content')
        
        if not title or not content:
            return jsonify({'error': 'Title and content are required'}), 400
        
        # Generate AI summary
        logger.info(f"Generating summary for prayer request: {title}")
        try:
            from prayer_summary_generator import get_summary_generator
            summary_generator = get_summary_generator()
            summary = summary_generator.generate_summary(title, content)
        except Exception as e:
            logger.error(f"Error generating summary: {e}")
            # Fallback: use first 100 chars of content
            summary = content[:97] + "..." if len(content) > 100 else content
        
        # Create prayer request data with summary and analytics
        prayer_request = {
            'title': title,
            'content': content,
            'summary': summary,
            'user_id': request.headers.get('Authorization', '').replace('Bearer ', ''),
            'created_at': datetime.now().isoformat(),
            'date': datetime.now().strftime('%Y-%m-%d'),
            'analytics': {
                'views': 0,
                'prayers': 0,
                'created_at': datetime.now().isoformat()
            }
        }
        
        # Save prayer request to storage
        if current_app.storage_handler.save_prayer_request(prayer_request):
            return jsonify({'message': 'Prayer request submitted successfully'}), 200
        else:
            return jsonify({'error': 'Failed to save prayer request'}), 500
            
    except Exception as e:
        logger.error(f"Error submitting prayer request: {e}")
        return jsonify({'error': 'Failed to submit prayer request'}), 500

@prayer_bp.route('/request/<request_id>/view', methods=['POST'])
def track_prayer_view(request_id):
    """Track when a prayer request is viewed"""
    try:
        # Get the prayer request
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)
        
        if not prayer_data:
            return jsonify({'error': 'Prayer request not found'}), 404
        
        # Increment view count
        analytics = prayer_data.get('analytics', {'views': 0, 'prayers': 0})
        analytics['views'] = analytics.get('views', 0) + 1
        prayer_data['analytics'] = analytics
        
        # Update in storage
        if current_app.storage_handler.update_prayer_request(request_id, prayer_data):
            return jsonify({
                'message': 'View tracked',
                'views': analytics['views']
            }), 200
        else:
            return jsonify({'error': 'Failed to track view'}), 500
            
    except Exception as e:
        logger.error(f"Error tracking prayer view: {e}")
        return jsonify({'error': 'Failed to track view'}), 500

@prayer_bp.route('/request/<request_id>/pray', methods=['POST'])
def track_prayer_action(request_id):
    """Track when someone prays for a prayer request"""
    try:
        # Get the prayer request
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)
        
        if not prayer_data:
            return jsonify({'error': 'Prayer request not found'}), 404
        
        # Increment prayer count
        analytics = prayer_data.get('analytics', {'views': 0, 'prayers': 0})
        analytics['prayers'] = analytics.get('prayers', 0) + 1
        prayer_data['analytics'] = analytics
        
        # Update in storage
        if current_app.storage_handler.update_prayer_request(request_id, prayer_data):
            return jsonify({
                'message': 'Prayer recorded',
                'prayers': analytics['prayers']
            }), 200
        else:
            return jsonify({'error': 'Failed to record prayer'}), 500
            
    except Exception as e:
        logger.error(f"Error tracking prayer action: {e}")
        return jsonify({'error': 'Failed to record prayer'}), 500

@prayer_bp.route('/user/<user_id>/prayed-prayers', methods=['GET'])
def get_user_prayed_prayers(user_id):
    """Get list of prayer IDs that a user has prayed for (synced across devices)"""
    try:
        prayer_ids = current_app.storage_handler.get_user_prayed_prayers(user_id)
        return jsonify({
            'prayer_ids': prayer_ids,
            'count': len(prayer_ids)
        }), 200
    except Exception as e:
        logger.error(f"Error getting user prayed prayers: {e}")
        return jsonify({'error': 'Failed to get prayed prayers'}), 500

@prayer_bp.route('/user/<user_id>/prayed-prayers', methods=['POST'])
def add_user_prayed_prayer(user_id):
    """Add a prayer to user's prayed-for list (synced across devices)"""
    try:
        data = request.get_json()
        prayer_id = data.get('prayer_id')
        
        if not prayer_id:
            return jsonify({'error': 'prayer_id is required'}), 400
        
        success = current_app.storage_handler.add_user_prayed_prayer(user_id, prayer_id)
        
        if success:
            return jsonify({
                'message': 'Prayer marked as prayed for',
                'prayer_id': prayer_id
            }), 200
        else:
            return jsonify({'error': 'Failed to save'}), 500
            
    except Exception as e:
        logger.error(f"Error adding user prayed prayer: {e}")
        return jsonify({'error': 'Failed to save'}), 500

@prayer_bp.route('/user/<user_id>/stats', methods=['GET'])
def get_user_stats(user_id):
    """Get user statistics (synced across devices)"""
    try:
        stats = current_app.storage_handler.get_user_stats(user_id)
        return jsonify(stats), 200
    except Exception as e:
        logger.error(f"Error getting user stats: {e}")
        return jsonify({'error': 'Failed to get stats'}), 500

@prayer_bp.route('/user/<user_id>/stats/<stat_name>', methods=['POST'])
def increment_user_stat(user_id, stat_name):
    """Increment a user statistic (synced across devices)"""
    try:
        # Validate stat name
        valid_stats = ['prayersRead', 'requestsSubmitted']
        if stat_name not in valid_stats:
            return jsonify({'error': 'Invalid stat name'}), 400
        
        success = current_app.storage_handler.increment_user_stat(user_id, stat_name)
        
        if success:
            # Get updated stats
            stats = current_app.storage_handler.get_user_stats(user_id)
            return jsonify({
                'message': f'{stat_name} incremented',
                'value': stats.get(stat_name, 0),
                'stats': stats
            }), 200
        else:
            return jsonify({'error': 'Failed to increment stat'}), 500
            
    except Exception as e:
        logger.error(f"Error incrementing user stat: {e}")
        return jsonify({'error': 'Failed to increment stat'}), 500 