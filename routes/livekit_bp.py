"""
LiveKit Integration Blueprint
Handles LiveKit token generation and room management
"""

from flask import Blueprint, request, jsonify, session
from firebase_auth import get_firestore_client
import logging
from datetime import datetime, timedelta
import os

# Try to import LiveKit SDK
try:
    from livekit import api
    LIVEKIT_AVAILABLE = True
except ImportError:
    LIVEKIT_AVAILABLE = False
    logging.warning("LiveKit SDK not installed. Run: pip install livekit")

livekit_bp = Blueprint('livekit', __name__)
logger = logging.getLogger(__name__)

# LiveKit configuration
LIVEKIT_ENABLED = os.getenv('LIVEKIT_ENABLED', 'false').lower() == 'true'
LIVEKIT_API_KEY = os.getenv('LIVEKIT_API_KEY', '')
LIVEKIT_API_SECRET = os.getenv('LIVEKIT_API_SECRET', '')
LIVEKIT_HOST = os.getenv('LIVEKIT_HOST', '')  # e.g., "35.x.x.x:7880"

def get_user_from_session():
    """Get authenticated user from session"""
    if 'user' in session:
        return {
            'user_id': session['user']['uid'],
            'user_name': session['user'].get('name', 'Anonymous'),
            'email': session['user'].get('email', '')
        }
    return None

@livekit_bp.route('/status', methods=['GET'])
def livekit_status():
    """Check if LiveKit is available and configured"""
    return jsonify({
        'enabled': LIVEKIT_ENABLED,
        'available': LIVEKIT_AVAILABLE,
        'configured': bool(LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_HOST),
        'host': LIVEKIT_HOST if LIVEKIT_ENABLED else None
    })

@livekit_bp.route('/token', methods=['POST'])
def get_livekit_token():
    """
    Generate LiveKit access token for a user to join a room
    Enforces speaker/listener roles
    """
    try:
        # Check if LiveKit is enabled
        if not LIVEKIT_ENABLED:
            return jsonify({'error': 'LiveKit is not enabled'}), 503
        
        if not LIVEKIT_AVAILABLE:
            return jsonify({'error': 'LiveKit SDK not installed'}), 500
        
        # Authenticate user
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        # Get request data
        data = request.get_json()
        room_id = data.get('room_id')
        
        if not room_id:
            return jsonify({'error': 'room_id is required'}), 400
        
        # Validate room exists and get participant role
        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        
        if not room_data.get('is_active', False):
            return jsonify({'error': 'Room is not active'}), 400
        
        # Find participant and their role
        participants = room_data.get('participants', [])
        participant = None
        for p in participants:
            if p.get('user_id') == user['user_id']:
                participant = p
                break
        
        if not participant:
            return jsonify({'error': 'User is not in this room'}), 403
        
        # Get role (speaker or listener)
        role = participant.get('role', 'listener')
        is_speaker = role == 'speaker'
        
        # Generate LiveKit token
        token = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        token.with_identity(user['user_id'])
        token.with_name(user['user_name'])
        token.with_metadata(str({
            'email': user.get('email', ''),
            'role': role,
            'room_id': room_id
        }))
        
        # Set permissions based on role
        grants = api.VideoGrants(
            room_join=True,
            room=room_id,
            can_publish=is_speaker,  # Only speakers can publish audio
            can_subscribe=True,       # Everyone can subscribe (listen)
            can_publish_data=True,    # Allow chat/data channel
            hidden=False
        )
        token.with_grants(grants)
        
        # Token expires in 6 hours
        token.with_ttl(timedelta(hours=6))
        
        jwt_token = token.to_jwt()
        
        logger.info(f"Generated LiveKit token for user {user['user_id']} (role: {role}) in room {room_id}")
        
        return jsonify({
            'success': True,
            'token': jwt_token,
            'url': f"ws://{LIVEKIT_HOST}",
            'wss_url': f"wss://{LIVEKIT_HOST}",  # Use WSS if you set up SSL
            'role': role,
            'can_publish': is_speaker,
            'room_id': room_id
        })
        
    except Exception as e:
        logger.error(f"Error generating LiveKit token: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to generate LiveKit token'}), 500

@livekit_bp.route('/refresh-token', methods=['POST'])
def refresh_livekit_token():
    """
    Refresh LiveKit token (e.g., when role changes or token expires)
    """
    try:
        if not LIVEKIT_ENABLED or not LIVEKIT_AVAILABLE:
            return jsonify({'error': 'LiveKit not available'}), 503
        
        # Re-use the same logic as get_livekit_token
        return get_livekit_token()
        
    except Exception as e:
        logger.error(f"Error refreshing LiveKit token: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to refresh token'}), 500

@livekit_bp.route('/webhook', methods=['POST'])
def livekit_webhook():
    """
    Handle LiveKit webhooks for room events
    Optional: Sync LiveKit events back to Firestore
    """
    try:
        if not LIVEKIT_ENABLED:
            return jsonify({'error': 'LiveKit not enabled'}), 503
        
        data = request.get_json()
        event_type = data.get('event')
        
        logger.info(f"LiveKit webhook received: {event_type}")
        
        # Handle different event types
        if event_type == 'participant_joined':
            participant_id = data.get('participant', {}).get('identity')
            room_name = data.get('room', {}).get('name')
            logger.info(f"Participant {participant_id} joined LiveKit room {room_name}")
        
        elif event_type == 'participant_left':
            participant_id = data.get('participant', {}).get('identity')
            room_name = data.get('room', {}).get('name')
            logger.info(f"Participant {participant_id} left LiveKit room {room_name}")
        
        elif event_type == 'track_published':
            participant_id = data.get('participant', {}).get('identity')
            track_sid = data.get('track', {}).get('sid')
            logger.info(f"Participant {participant_id} published track {track_sid}")
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Error handling LiveKit webhook: {str(e)}", exc_info=True)
        return jsonify({'error': 'Webhook processing failed'}), 500

@livekit_bp.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint for LiveKit integration
    """
    return jsonify({
        'status': 'healthy',
        'livekit_enabled': LIVEKIT_ENABLED,
        'livekit_available': LIVEKIT_AVAILABLE,
        'configured': bool(LIVEKIT_API_KEY and LIVEKIT_API_SECRET and LIVEKIT_HOST)
    })

