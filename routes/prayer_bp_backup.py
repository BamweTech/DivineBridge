from flask import Blueprint, request, jsonify, current_app, send_file
from datetime import datetime, timedelta
import logging
import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from input_validation import validate_request, sanitize_string
from auth_decorators import verify_cloud_scheduler

logger = logging.getLogger(__name__)
prayer_bp = Blueprint('prayer', __name__)

# Determine which storage handler to use
USE_LOCAL_STORAGE = os.getenv('USE_LOCAL_STORAGE', 'false').lower() == 'true'
if USE_LOCAL_STORAGE:
    logger.info("Prayer BP: Using local storage for development")
else:
    logger.info("Prayer BP: Using cloud storage for production")

# Initialize rate limiter
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["1000 per day", "100 per hour"]
)

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

@prayer_bp.route('/test-storage', methods=['GET'])
def test_storage():
    """Test storage functionality"""
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        
        # Test data
        test_prayer = {
            'content': 'Heavenly Father, this is a test prayer. In Jesus-Christ\'s name we pray. Amen!',
            'date': today,
            'created_at': datetime.now().isoformat(),
            'source': 'test'
        }
        
        logger.info(f"Testing storage for date: {today}")
        
        # Try to save
        save_result = current_app.storage_handler.save_prayer(test_prayer, today)
        logger.info(f"Save result: {save_result}")
        
        # Try to retrieve
        retrieved = current_app.storage_handler.get_prayer(today)
        logger.info(f"Retrieved prayer: {retrieved is not None}")
        
        # Try to get all prayers
        all_prayers = current_app.storage_handler.get_prayers(limit=5)
        logger.info(f"Total prayers found: {len(all_prayers)}")
        
        return jsonify({
            'save_result': save_result,
            'retrieved': retrieved is not None,
            'total_prayers': len(all_prayers),
            'test_date': today
        }), 200
        
    except Exception as e:
        logger.error(f"Error testing storage: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': str(e)}), 500

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

@prayer_bp.route('/test-generate-prayer', methods=['POST'])
def test_generate_prayer():
    """Generate a test prayer without saving to database"""
    try:
        logger.info("Generating test prayer (will not be saved)")
        
        # Generate prayer using the client directly (bypassing storage check and save)
        response = current_app.prayer_generator.client.query(current_app.prayer_generator.prompt)
        
        # Validate the response with retry logic
        last_error = None
        for attempt in range(1, 4):
            try:
                logger.info(f"Test prayer attempt {attempt}/3")
                
                if attempt > 1 and last_error:
                    retry_prompt = f"""{current_app.prayer_generator.prompt}

IMPORTANT - Previous attempt was REJECTED: {last_error}
Please regenerate following ALL requirements strictly.
Remember: END with EXACTLY "In Jesus-Christ's name we pray. Amen!" """
                    response = current_app.prayer_generator.client.query(retry_prompt)
                
                response = current_app.prayer_generator._validate_response(response)
                logger.info(f"Test prayer validation passed on attempt {attempt}")
                break
            except ValueError as ve:
                last_error = str(ve)
                if attempt == 3:
                    raise
                continue
        
        # Process the response
        if "<think>" in response:
            import re
            response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL)
        
        response = response.strip()
        word_count = len(response.split())
        
        return jsonify({
            'success': True,
            'prayer': {
                'content': response,
                'word_count': word_count,
                'test_mode': True
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error generating test prayer: {e}")
        return jsonify({'error': str(e)}), 500

@prayer_bp.route('/generate', methods=['POST'])
@verify_cloud_scheduler()
def generate_daily_prayer():
    """
    Generate daily prayer (triggered by Cloud Scheduler)
    Protected by Cloud Scheduler verification
    """
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        logger.info(f"Cloud Scheduler triggered daily prayer generation for {today}")
        
        # Check if prayer already exists
        existing_prayer = current_app.storage_handler.get_prayer(today)
        if existing_prayer:
            logger.info(f"Prayer for {today} already exists")
            return jsonify({
                'success': True,
                'message': 'Prayer already exists',
                'date': today
            }), 200
        
        # Generate new prayer
        prayer_data = current_app.prayer_generator.generate_prayer()
        
        if prayer_data:
            logger.info(f"Successfully generated prayer for {today}")
            return jsonify({
                'success': True,
                'message': 'Prayer generated successfully',
                'date': today,
                'word_count': len(prayer_data.get('content', '').split())
            }), 200
        else:
            logger.error("Failed to generate prayer")
            return jsonify({
                'success': False,
                'message': 'Prayer generation failed'
            }), 500
            
    except Exception as e:
        logger.error(f"Error generating daily prayer: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

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
@limiter.limit("10 per hour")
@limiter.limit("50 per day")
@validate_request('prayer_request')
def submit_prayer_request():
    """Submit a prayer request"""
    try:
        data = request.get_json()
        title = sanitize_string(data.get('title'), max_length=200)
        content = sanitize_string(data.get('content'), max_length=2000)
        
        if not title or not content:
            return jsonify({'error': 'Title and content are required'}), 400
        
        # AI Content Moderation + Summary Generation (combined call)
        logger.info(f"Moderating and summarizing prayer request: {title}")
        from content_moderator import get_content_moderator
        
        moderator = get_content_moderator()
        approved, rejection_reason, ai_summary = moderator.moderate_content(title, content, "prayer request")
        
        # If not approved, return error with reason
        if not approved:
            logger.warning(f"Prayer request rejected: {rejection_reason}")
            return jsonify({
                'error': 'Content not approved',
                'reason': rejection_reason,
                'approved': False
            }), 400
        
        # Get user_id from request body (sent by frontend)
        user_id = data.get('user_id', '')
        
        # Create prayer request data with AI summary
        prayer_request = {
            'title': title,
            'content': content,
            'summary': ai_summary if ai_summary else content[:120] + '...',
            'user_id': user_id,
            'created_at': datetime.now().isoformat(),
            'date': datetime.now().strftime('%Y-%m-%d'),
            'analytics': {
                'views': 0,
                'prayers': 0,
                'created_at': datetime.now().isoformat()
            },
            'moderation': {
                'approved': approved,
                'moderated_at': datetime.now().isoformat(),
                'ai_moderated': True
            }
        }
        
        # Save prayer request to storage with AI-generated summary
        if current_app.storage_handler.save_prayer_request(prayer_request):
            request_id = prayer_request.get('id')
            
            return jsonify({
                'message': 'Prayer request submitted successfully',
                'id': request_id,
                'approved': True
            }), 200
        else:
            return jsonify({'error': 'Failed to save prayer request'}), 500
            
    except Exception as e:
        logger.error(f"Error submitting prayer request: {e}")
        return jsonify({'error': 'Failed to submit prayer request'}), 500

@prayer_bp.route('/request/<request_id>', methods=['DELETE'])
def delete_prayer_request(request_id):
    """Delete a prayer request (only by owner)"""
    try:
        # Get the prayer request to verify ownership
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)
        
        if not prayer_data:
            return jsonify({'error': 'Prayer request not found'}), 404
        
        # Get user_id from request body
        data = request.get_json() or {}
        user_id = data.get('user_id', '')
        
        # Verify ownership
        if prayer_data.get('user_id') != user_id:
            return jsonify({'error': 'Unauthorized - can only delete your own prayers'}), 403
        
        # Delete from storage
        prayer_date = prayer_data.get('date')
        blob_path = f"prayer_requests/{prayer_date}/{request_id}.json"
        blob = current_app.storage_handler.bucket.blob(blob_path)
        
        if blob.exists():
            blob.delete()
            logger.info(f"Deleted prayer request: {request_id} by user: {user_id}")
            return jsonify({'message': 'Prayer request deleted successfully'}), 200
        else:
            return jsonify({'error': 'Prayer request not found in storage'}), 404
            
    except Exception as e:
        logger.error(f"Error deleting prayer request: {e}")
        return jsonify({'error': 'Failed to delete prayer request'}), 500

@prayer_bp.route('/request/<request_id>', methods=['PUT'])
def update_prayer_request(request_id):
    """Update a prayer request (only by owner)"""
    try:
        # Get the prayer request to verify ownership
        prayer_data = current_app.storage_handler.get_prayer_request_by_id(request_id)
        
        if not prayer_data:
            return jsonify({'error': 'Prayer request not found'}), 404
        
        # Get update data
        data = request.get_json()
        user_id = data.get('user_id', '')
        
        # Verify ownership
        if prayer_data.get('user_id') != user_id:
            return jsonify({'error': 'Unauthorized - can only edit your own prayers'}), 403
        
        # Update fields
        if 'title' in data:
            prayer_data['title'] = data['title']
        if 'content' in data:
            prayer_data['content'] = data['content']
            # Regenerate summary
            content = data['content']
            sentences = content.split('.')
            if len(sentences) > 1 and len(sentences[0]) < 120:
                prayer_data['summary'] = '.'.join(sentences[:2]).strip() + '.'
            else:
                prayer_data['summary'] = content[:117] + "..." if len(content) > 120 else content
        
        # Update timestamp
        prayer_data['updated_at'] = datetime.now().isoformat()
        
        # Save updated prayer
        if current_app.storage_handler.update_prayer_request(request_id, prayer_data):
            logger.info(f"Updated prayer request: {request_id} by user: {user_id}")
            return jsonify({
                'message': 'Prayer request updated successfully',
                'prayer': prayer_data
            }), 200
        else:
            return jsonify({'error': 'Failed to update prayer request'}), 500
            
    except Exception as e:
        logger.error(f"Error updating prayer request: {e}")
        return jsonify({'error': 'Failed to update prayer request'}), 500

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

@prayer_bp.route('/prayer/download', methods=['GET'])
def download_prayer_image():
    """Download today's global prayer as a JPEG image (with caching)"""
    try:
        # Get client's local date
        client_date = request.args.get('client_date')
        force_regenerate = request.args.get('force', 'false').lower() == 'true'
        
        if client_date:
            today = client_date
            try:
                client_datetime = datetime.strptime(client_date, '%Y-%m-%d')
                date_str = client_datetime.strftime('%B %d, %Y')
            except ValueError:
                date_str = datetime.now().strftime('%B %d, %Y')
        else:
            today = datetime.now().strftime('%Y-%m-%d')
            date_str = datetime.now().strftime('%B %d, %Y')
        
        # Try to get cached image first (unless force regenerate)
        if not force_regenerate:
            cached_image = current_app.storage_handler.get_prayer_image(today)
            if cached_image:
                logger.info(f"✅ Serving cached prayer image for {today}")
                from io import BytesIO
                image_data = BytesIO(cached_image)
                filename = f"divine_bridge_prayer_{client_date or 'today'}.jpg"
                return send_file(
                    image_data,
                    mimetype='image/jpeg',
                    as_attachment=True,
                    download_name=filename
                )
        
        # Cache miss or force regenerate - get prayer and generate image
        logger.info(f"🎨 Generating new prayer image for {today}")
        
        # Get today's prayer
        prayer = current_app.storage_handler.get_prayer(today)
        
        if not prayer:
            return jsonify({'error': 'No prayer available for today'}), 404
        
        # Extract prayer content (handle both dict and string formats)
        if isinstance(prayer, dict):
            prayer_content = prayer.get('content', '')
        else:
            prayer_content = prayer
        
        if not prayer_content:
            return jsonify({'error': 'Prayer content is empty'}), 404
        
        # Generate image
        from image_generator import get_image_generator
        generator = get_image_generator()
        
        image_data = generator.generate_prayer_image(
            prayer_text=prayer_content,
            date=date_str
        )
        
        # Save to cache for future requests
        image_bytes = image_data.getvalue()
        current_app.storage_handler.save_prayer_image(today, image_bytes)
        logger.info(f"💾 Cached prayer image for {today}")
        
        # Reset BytesIO for sending
        image_data.seek(0)
        
        # Send file
        filename = f"divine_bridge_prayer_{client_date or 'today'}.jpg"
        return send_file(
            image_data,
            mimetype='image/jpeg',
            as_attachment=True,
            download_name=filename
        )
        
    except Exception as e:
        logger.error(f"Error generating prayer image: {e}")
        logger.exception("Full traceback:")
        return jsonify({'error': 'Failed to generate image'}), 500 