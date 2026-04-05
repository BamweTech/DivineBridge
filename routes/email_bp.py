"""
Email Blueprint - Handle email subscriptions and daily email sending
"""
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
import logging

email_bp = Blueprint('email', __name__)
logger = logging.getLogger(__name__)

def _get_firestore_client():
    """Get Firestore client (lazy import to keep startup stable)."""
    from firebase_admin import firestore
    return firestore.client()

def _require_user():
    """Return (user_dict, response_tuple_or_None)."""
    try:
        from auth_helpers import get_user_from_session
        user = get_user_from_session()
        if not user or not user.get('user_id'):
            return None, (jsonify({'error': 'Authentication required'}), 401)
        return user, None
    except Exception as e:
        logger.error(f"Error reading authenticated user: {e}")
        return None, (jsonify({'error': 'Authentication unavailable'}), 503)


@email_bp.route('/subscription-status', methods=['GET'])
def subscription_status():
    """Return the current user's daily email subscription status."""
    user, err = _require_user()
    if err:
        return err

    try:
        db = _get_firestore_client()
        user_id = user['user_id']
        doc = db.collection('users').document(user_id).get()
        subscribed = False
        if doc.exists:
            subscribed = bool(doc.to_dict().get('email_subscribed', False))
        return jsonify({'subscribed': subscribed}), 200
    except Exception as e:
        logger.error(f"Error getting subscription status: {e}")
        return jsonify({'error': 'Failed to get subscription status'}), 500


@email_bp.route('/subscribe-daily', methods=['POST'])
def subscribe_daily():
    """Opt the current user into daily prayer+verse emails."""
    user, err = _require_user()
    if err:
        return err

    try:
        db = _get_firestore_client()
        user_id = user['user_id']
        db.collection('users').document(user_id).set({
            'email_subscribed': True,
            'email_subscribed_at': datetime.utcnow().isoformat()
        }, merge=True)
        return jsonify({'message': 'Subscribed', 'subscribed': True}), 200
    except Exception as e:
        logger.error(f"Error subscribing user to daily emails: {e}")
        return jsonify({'error': 'Failed to subscribe'}), 500


@email_bp.route('/unsubscribe-daily', methods=['POST'])
def unsubscribe_daily():
    """Opt the current user out of daily prayer+verse emails."""
    user, err = _require_user()
    if err:
        return err

    try:
        db = _get_firestore_client()
        user_id = user['user_id']
        db.collection('users').document(user_id).set({
            'email_subscribed': False,
            'email_unsubscribed_at': datetime.utcnow().isoformat()
        }, merge=True)
        return jsonify({'message': 'Unsubscribed', 'subscribed': False}), 200
    except Exception as e:
        logger.error(f"Error unsubscribing user from daily emails: {e}")
        return jsonify({'error': 'Failed to unsubscribe'}), 500


@email_bp.route('/send-daily-emails', methods=['POST'])
def send_daily_emails():
    """
    Send daily verse + prayer emails to all Firebase subscribers
    Triggered by Cloud Scheduler every Monday at 6 AM ET
    """
    try:
        db = _get_firestore_client()
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
        today_str = datetime.now().strftime('%Y-%m-%d')
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
                        'doc_id': doc.id,
                        'email': user_data.get('email'),
                        'firstName': user_data.get('firstName'),
                        'timezone': user_data.get('timezone', 'America/New_York'),
                        'last_email_sent_date': user_data.get('last_email_sent_date', '')
                    })
        except Exception as e:
            logger.error(f"Error fetching subscribers from Firebase: {e}")
            return jsonify({'error': 'Failed to fetch subscribers'}), 500
        
        logger.info(f"Found {len(subscribers)} subscribers")
        
        # Send emails
        email_service = get_email_service()
        sent_count = 0
        failed_count = 0
        skipped_count = 0
        
        for subscriber in subscribers:
            # Idempotency guard: skip if this subscriber already received today's email.
            # Protects against Cloud Scheduler retries or accidental double-triggers.
            if subscriber['last_email_sent_date'] == today_str:
                logger.info(f"Skipping {subscriber['email']} — already sent today ({today_str})")
                skipped_count += 1
                continue

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
                    # Record the send date so duplicates are skipped if the job re-runs today
                    try:
                        db.collection('users').document(subscriber['doc_id']).set(
                            {'last_email_sent_date': today_str},
                            merge=True
                        )
                    except Exception as update_err:
                        logger.warning(f"Could not update last_email_sent_date for {subscriber['email']}: {update_err}")
                else:
                    failed_count += 1
                    
            except Exception as e:
                logger.error(f"Error sending to {subscriber['email']}: {e}")
                failed_count += 1
        
        logger.info(f"Email send job complete: {sent_count} sent, {skipped_count} skipped (already sent), {failed_count} failed")
        
        return jsonify({
            'message': 'Daily emails sent',
            'sent': sent_count,
            'skipped_already_sent': skipped_count,
            'failed': failed_count,
            'total_subscribers': len(subscribers)
        }), 200
        
    except Exception as e:
        logger.error(f"Error in send_daily_emails: {e}")
        return jsonify({'error': str(e)}), 500


@email_bp.route('/send-easter-email', methods=['POST'])
def send_easter_email():
    """
    Send Easter 2026 email to all subscribers.
    Triggered by Cloud Scheduler at 5 AM CST on April 5, 2026.
    """
    try:
        db = _get_firestore_client()
        from email_service_v2 import get_email_service

        user_agent = request.headers.get('User-Agent', '')
        is_scheduler = 'Google-Cloud-Scheduler' in user_agent
        is_local = request.remote_addr in ['127.0.0.1', 'localhost']
        auth_header = request.headers.get('Authorization', '')
        has_token = auth_header.startswith('Bearer ')

        if not (is_scheduler or is_local or has_token):
            logger.warning(f"Unauthorized Easter email send attempt from: {user_agent}")
            return jsonify({'error': 'Unauthorized'}), 403

        logger.info("Starting Easter 2026 email send job...")

        subscribers = []
        try:
            users_ref = db.collection('users')
            query = users_ref.where('email_subscribed', '==', True).stream()

            for doc in query:
                user_data = doc.to_dict()
                if user_data.get('email') and user_data.get('firstName'):
                    subscribers.append({
                        'doc_id': doc.id,
                        'email': user_data.get('email'),
                        'firstName': user_data.get('firstName'),
                        'easter_2026_email_sent': user_data.get('easter_2026_email_sent', False)
                    })
        except Exception as e:
            logger.error(f"Error fetching subscribers for Easter email: {e}")
            return jsonify({'error': 'Failed to fetch subscribers'}), 500

        logger.info(f"Found {len(subscribers)} subscribers for Easter email")

        email_service = get_email_service()
        sent_count = 0
        failed_count = 0
        skipped_count = 0

        for subscriber in subscribers:
            if subscriber['easter_2026_email_sent']:
                logger.info(f"Skipping {subscriber['email']} — Easter email already sent")
                skipped_count += 1
                continue

            try:
                success = email_service.send_easter_email(
                    recipient_email=subscriber['email'],
                    first_name=subscriber['firstName']
                )

                if success:
                    sent_count += 1
                    try:
                        db.collection('users').document(subscriber['doc_id']).set(
                            {'easter_2026_email_sent': True},
                            merge=True
                        )
                    except Exception as update_err:
                        logger.warning(
                            f"Could not mark Easter email sent for {subscriber['email']}: {update_err}"
                        )
                else:
                    failed_count += 1

            except Exception as e:
                logger.error(f"Error sending Easter email to {subscriber['email']}: {e}")
                failed_count += 1

        logger.info(
            f"Easter email job complete: {sent_count} sent, "
            f"{skipped_count} skipped (already sent), {failed_count} failed"
        )

        return jsonify({
            'message': 'Easter 2026 emails sent',
            'sent': sent_count,
            'skipped_already_sent': skipped_count,
            'failed': failed_count,
            'total_subscribers': len(subscribers)
        }), 200

    except Exception as e:
        logger.error(f"Error in send_easter_email: {e}")
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

