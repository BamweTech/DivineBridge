from flask import Blueprint, request, jsonify, current_app
from datetime import datetime

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