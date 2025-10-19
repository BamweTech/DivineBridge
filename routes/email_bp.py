"""
Email Blueprint - Handle email subscriptions and daily email sending
"""
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
import logging

email_bp = Blueprint('email', __name__)
logger = logging.getLogger(__name__)


@email_bp.route('/send-daily-emails', methods=['POST'])
def send_daily_emails():
    """
    Send daily verse + prayer emails to all Firebase subscribers
    Triggered by Cloud Scheduler at 6 AM ET
    """
    try:
        from firebase_admin import firestore
        db = firestore.client()
        from email_service_v2 import get_email_service
        from verse_cache import verse_cache
        
        # Verify this is from Cloud Scheduler (OIDC token or Cloud Scheduler user agent)
        user_agent = request.headers.get('User-Agent', '')
        is_scheduler = 'Google-Cloud-Scheduler' in user_agent
        
        if not is_scheduler:
            logger.warning(f"Unauthorized email send attempt from: {user_agent}")
            return jsonify({'error': 'Unauthorized'}), 403
        
        logger.info("Starting daily email send job...")
        
        # Get today's verse using verse_cache (same as website)
        verse = current_app.verse_cache.get_today_verse()
        
        if not verse:
            logger.error("No verse available for today")
            return jsonify({'error': 'No verse available'}), 500
        
        verse_data = {
            'reference': verse.get('reference', ''),
            'text': verse.get('verse', verse.get('text', ''))  # verse_cache uses 'verse' key
        }
        
        # Get today's prayer
        prayer = current_app.storage_handler.get_prayer(today_str)
        if not prayer:
            logger.error("No prayer available for today")
            return jsonify({'error': 'No prayer available'}), 500
        
        prayer_data = {
            'content': prayer.get('content', '') if isinstance(prayer, dict) else prayer,
            'date': today_str
        }
        
        # Get all subscribers from Firebase
        # Assuming subscribers are stored in Firestore: users collection with email_subscribed field
        subscribers = []
        try:
            # Get all users who have email_subscribed = True
            users_ref = db.collection('users')
            query = users_ref.where('email_subscribed', '==', True).stream()
            
            for doc in query:
                user_data = doc.to_dict()
                if user_data.get('email') and user_data.get('firstName'):
                    subscribers.append({
                        'email': user_data.get('email'),
                        'firstName': user_data.get('firstName'),
                        'timezone': user_data.get('timezone', 'America/New_York')
                    })
        except Exception as e:
            logger.error(f"Error fetching subscribers from Firebase: {e}")
            return jsonify({'error': 'Failed to fetch subscribers'}), 500
        
        logger.info(f"Found {len(subscribers)} subscribers")
        
        # Send emails
        email_service = get_email_service()
        sent_count = 0
        failed_count = 0
        
        for subscriber in subscribers:
            try:
                success = email_service.send_daily_content(
                    recipient_email=subscriber['email'],
                    first_name=subscriber['firstName'],
                    verse_data=verse_data,
                    prayer_data=prayer_data,
                    timezone=subscriber.get('timezone', 'America/New_York')
                )
                
                if success:
                    sent_count += 1
                else:
                    failed_count += 1
                    
            except Exception as e:
                logger.error(f"Error sending to {subscriber['email']}: {e}")
                failed_count += 1
        
        logger.info(f"Email send job complete: {sent_count} sent, {failed_count} failed")
        
        return jsonify({
            'message': 'Daily emails sent',
            'sent': sent_count,
            'failed': failed_count,
            'total_subscribers': len(subscribers)
        }), 200
        
    except Exception as e:
        logger.error(f"Error in send_daily_emails: {e}")
        return jsonify({'error': str(e)}), 500


@email_bp.route('/test-email', methods=['POST'])
def test_email():
    """
    Test endpoint to send email to a specific address
    For local testing only
    """
    try:
        data = request.get_json()
        email = data.get('email', 'jeancalmere.kubwayo@divinebridge.io')
        first_name = data.get('firstName', 'Jean')
        
        from email_service_v2 import get_email_service
        
        # Get today's verse using verse_cache (same as website)
        verse = current_app.verse_cache.get_today_verse()
        
        verse_data = {
            'reference': verse.get('reference', 'John 3:16') if verse else 'John 3:16',
            'text': verse.get('verse', verse.get('text', 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.')) if verse else 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.'
        }
        
        # Get today's prayer
        today_str = datetime.now().strftime('%Y-%m-%d')
        
        # Get today's prayer
        prayer = current_app.storage_handler.get_prayer(today_str)
        
        prayer_data = {
            'content': prayer.get('content', 'Sample prayer content') if prayer and isinstance(prayer, dict) else (prayer if prayer else 'Sample prayer content'),
            'date': today_str
        }
        
        # Send test email
        email_service = get_email_service()
        success = email_service.send_daily_content(
            recipient_email=email,
            first_name=first_name,
            verse_data=verse_data,
            prayer_data=prayer_data,
            timezone='America/New_York'
        )
        
        if success:
            return jsonify({'message': f'Test email sent successfully to {email}'}), 200
        else:
            return jsonify({'error': 'Failed to send test email'}), 500
            
    except Exception as e:
        logger.error(f"Error in test_email: {e}")
        return jsonify({'error': str(e)}), 500

