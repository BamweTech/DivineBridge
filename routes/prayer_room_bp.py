from flask import Blueprint, request, jsonify, session, render_template, current_app
from firebase_auth import get_firestore_client
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from input_validation import validate_data, sanitize_string
from auth_decorators import verify_cloud_scheduler
import logging
from datetime import datetime, timedelta
import uuid
import json
import os

def exempt_from_rate_limit(f):
    """Decorator to exempt endpoint from main app rate limiting"""
    def wrapper(*args, **kwargs):
        # Try to exempt from main app limiter if available
        try:
            if 'limiter' in current_app.extensions:
                limiter = current_app.extensions['limiter']
                # This will be handled by the decorator below
                pass
        except:
            pass
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper
from google.cloud import firestore

prayer_room_bp = Blueprint('prayer_room', __name__)

MAX_ACTIVE_SPEAKERS = 20
VALID_PARTICIPANT_ROLES = {'speaker', 'listener'}


def normalize_participants(participants, host_id):
    """Ensure participants have role/request metadata and host is always a speaker."""
    if not participants:
        return [], 0, False

    normalized = []
    speaker_count = 0
    changed = False

    # First ensure host is marked as speaker and count existing speakers
    for participant in participants:
        participant_copy = dict(participant)
        user_id = participant_copy.get('user_id')
        role = participant_copy.get('role')

        if user_id == host_id and role != 'speaker':
            participant_copy['role'] = 'speaker'
            role = 'speaker'
            changed = True

        if role == 'speaker':
            speaker_count += 1

        normalized.append(participant_copy)

    # Second pass to add defaults and fill missing roles within the cap
    for participant in normalized:
        role = participant.get('role')

        if role not in VALID_PARTICIPANT_ROLES:
            if participant.get('user_id') == host_id:
                participant['role'] = 'speaker'
                role = 'speaker'
            elif speaker_count < MAX_ACTIVE_SPEAKERS:
                participant['role'] = 'speaker'
                role = 'speaker'
                speaker_count += 1
            else:
                participant['role'] = 'listener'
                role = 'listener'
            changed = True

        if participant.get('requested_role') not in (None, 'speaker'):
            participant['requested_role'] = None
            changed = True

        if 'requested_role' not in participant:
            participant['requested_role'] = None
            changed = True

        if 'request_timestamp' not in participant:
            participant['request_timestamp'] = None
            changed = True

        if 'is_muted' not in participant:
            participant['is_muted'] = False
            changed = True

    return normalized, speaker_count, changed


def set_participant_role(participants, user_id, new_role):
    """Set a participant's role and clear any outstanding requests."""
    updated = False
    for participant in participants:
        if participant.get('user_id') == user_id:
            if participant.get('role') != new_role:
                participant['role'] = new_role
                updated = True
            if participant.get('requested_role'):
                participant['requested_role'] = None
                updated = True
            if participant.get('request_timestamp'):
                participant['request_timestamp'] = None
                updated = True
            break
    return participants, updated


def find_participant(participants, user_id):
    for participant in participants:
        if participant.get('user_id') == user_id:
            return participant
    return None


def count_speakers(participants):
    return sum(1 for participant in participants if participant.get('role') == 'speaker')


def get_max_speakers(room_data):
    try:
        configured = int(room_data.get('max_speakers', MAX_ACTIVE_SPEAKERS))
    except (TypeError, ValueError):
        configured = MAX_ACTIVE_SPEAKERS
    configured = max(1, configured)
    return min(configured, MAX_ACTIVE_SPEAKERS)

# Rate limiting is now handled centrally in app.py
# Blueprint-level limiter removed to prevent conflicts

def send_email(recipient_email, subject, html_body):
    """
    Helper function to send generic HTML emails.
    Uses the email_sender module to send emails with HTML content.
    
    Args:
        recipient_email: Email address of recipient
        subject: Email subject line
        html_body: HTML content of the email
    """
    try:
        from email_sender import EmailSender
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.utils import formataddr
        import smtplib
        
        # Create EmailSender instance
        sender = EmailSender()
        
        # Create message
        msg = MIMEMultipart('alternative')
        msg['From'] = formataddr(("Divine Bridge", sender.sender_email))
        msg['To'] = recipient_email
        msg['Subject'] = subject
        
        # Add plain text fallback (extract from HTML if needed)
        plain_text = f"Please view this email in an HTML-enabled email client.\n\n{subject}"
        
        # Attach both versions
        msg.attach(MIMEText(plain_text, 'plain'))
        msg.attach(MIMEText(html_body, 'html'))
        
        # Send using SMTP
        with smtplib.SMTP(sender.smtp_server, sender.smtp_port) as server:
            server.starttls()
            server.login(sender.sender_email, sender.sender_password)
            server.send_message(msg)
            
        logging.info(f"Email sent successfully to {recipient_email}")
        return True
        
    except Exception as e:
        logging.error(f"Error sending email to {recipient_email}: {e}")
        return False

def get_firestore_client():
    """Get Firestore client instance"""
    from firebase_auth import get_firestore_client as _get_firestore_client
    return _get_firestore_client()

def get_user_from_session():
    """Get user information from session or Firebase ID token
    
    Priority:
    1. Firebase ID token (most reliable, survives deployments)
    2. Flask session (regenerated if Firebase token is valid)
    """
    from firebase_admin import auth
    from flask import session
    
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
                        logging.warning(f"⚠️ Transient Firebase token verification error (attempt {attempt + 1}/{max_retries}): {error_str}")
                        import time
                        time.sleep(0.5 * (attempt + 1))  # Exponential backoff
                        continue
                    else:
                        # Non-transient error or last attempt
                        raise
            
            if decoded_token:
                user_name = decoded_token.get('name') or decoded_token.get('email', '').split('@')[0] or 'Anonymous'
                user_id = decoded_token.get('uid')
                
                logging.info(f"✅ User authenticated via Firebase ID token: {user_id}")
                
                # CRITICAL FIX: Regenerate Flask session if it's missing or invalid
                # This allows session-based auth to work again after deployments
                if not session.get('user') or session.get('user', {}).get('uid') != user_id:
                    logging.info(f"🔄 Regenerating Flask session for user {user_id}")
                    session['user'] = {
                        'uid': user_id,
                        'email': decoded_token.get('email', ''),
                        'name': user_name,
                        'emailVerified': decoded_token.get('email_verified', False)
                    }
                    session.permanent = True
                    session.modified = True
                    logging.info(f"✅ Flask session regenerated successfully")
                
                return {
                    'user_id': user_id,
                    'user_name': user_name,
                    'name': user_name,
                    'email': decoded_token.get('email')
                }
        except auth.ExpiredIdTokenError:
            logging.warning(f"⚠️ Firebase ID token expired - user needs to refresh")
            # Don't fall through - let frontend handle token refresh
            return None
        except auth.InvalidIdTokenError as e:
            logging.warning(f"⚠️ Firebase ID token invalid: {str(e)}")
            # Don't fall through - invalid token means user needs to login
            return None
        except Exception as e:
            # Log full error for debugging
            import traceback
            error_details = traceback.format_exc()
            logging.error(f"❌ Firebase ID token verification failed: {str(e)}\n{error_details}")
            # For other errors (network, etc.), fall through to session check as fallback
    
    # Fallback to session-based authentication
    user = session.get('user')
    if not user:
        logging.info("🔍 No user in session and no valid Firebase token")
        return None
    
    # Debug logging to see what's in the session
    logging.info(f"🔍 Using Flask session for user: {user.get('uid', 'unknown')}")
    
    # Try multiple possible name fields
    user_name = user.get('name') or user.get('displayName') or user.get('user_name') or 'Anonymous'
    
    return {
        'user_id': user.get('uid'),
        'user_name': user_name,
        'name': user_name,
        'email': user.get('email')
    }

@prayer_room_bp.route('/ice-config', methods=['GET'])
def get_ice_config():
    """Return ICE/TURN server configuration for WebRTC.
    Reads TURN settings from environment variables if present; otherwise returns STUN-only.
    Env vars supported:
      TURN_URLS (comma-separated), TURN_USERNAME, TURN_PASSWORD
      STUN_URLS (optional, comma-separated)
    """
    try:
        # Defaults: public Google STUN
        stun_urls = os.getenv('STUN_URLS', 'stun:stun.l.google.com:19302').split(',')
        turn_urls_env = os.getenv('TURN_URLS', '')
        turn_username = os.getenv('TURN_USERNAME')
        turn_password = os.getenv('TURN_PASSWORD')

        ice_servers = [{'urls': url.strip()} for url in stun_urls if url.strip()]

        # Handle complex, comma-separated TURN URLs
        if turn_urls_env:
            for url in turn_urls_env.split(','):
                url = url.strip()
                if not url:
                    continue
                
                # If username/password are provided as env vars, use them
                if turn_username and turn_password:
                    ice_servers.append({
                        'urls': url,
                        'username': turn_username,
                        'credential': turn_password
                    })
                else:
                    # Otherwise, assume credentials might be in the URL (e.g., Twilio)
                    # or it's a TURN server without authentication.
                    ice_servers.append({'urls': url})

        # If no servers were configured at all, provide a fallback
        if not ice_servers:
             ice_servers.append({'urls': 'stun:stun.l.google.com:19302'})

        logging.info(f"Generated ICE Servers. Count: {len(ice_servers)}")
        return jsonify({'iceServers': ice_servers})
        
    except Exception as e:
        logging.error(f"Error generating ICE config: {str(e)}", exc_info=True)
        # Safe fallback to STUN-only
        fallback_servers = [
            {'urls': 'stun:stun.l.google.com:19302'},
            {'urls': 'stun:stun1.l.google.com:19302'}
        ]
        return jsonify({'iceServers': fallback_servers}), 200

@prayer_room_bp.route('/create', methods=['POST'])
def create_prayer_room():
    """Create a new prayer room"""
    try:
        # Check if user is authenticated
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required to create rooms'}), 401
        
        data = request.get_json()
        room_name = data.get('room_name', 'Prayer Room')
        room_privacy = data.get('room_privacy', 'public')  # 'public' or 'private'
        host_id = user['user_id']  # Use authenticated user's ID
        host_name = user['user_name']  # Use authenticated user's name
        
        # Validate room privacy
        if room_privacy not in ['public', 'private']:
            return jsonify({'error': 'Room privacy must be either "public" or "private"'}), 400
        
        # Validate room name length
        if len(room_name) > 50:
            return jsonify({'error': 'Room name must be 50 characters or less'}), 400
        
        # Validate host name length
        if len(host_name) > 30:
            return jsonify({'error': 'Host name must be 30 characters or less'}), 400
        
        # Generate room ID
        room_id = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        
        # Generate room code for private rooms
        room_code = None
        if room_privacy == 'private':
            room_code = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:8]])
        
        # Create room document
        room_data = {
            'room_id': room_id,
            'room_name': room_name,
            'room_privacy': room_privacy,
            'room_code': room_code,  # Only set for private rooms
            'host_id': host_id,
            'host_name': host_name,
            'created_at': datetime.utcnow(),
            'participants': [{
                'user_id': host_id,
                'user_name': host_name,
                'joined_at': datetime.utcnow(),
                'is_muted': False,
                'is_host': True,
                'role': 'speaker',
                'requested_role': None,
                'request_timestamp': None
            }],
            'is_active': True,
            'is_locked': False,
            'settings': {
                'allow_anonymous': room_privacy == 'public',  # Only allow anonymous for public rooms
                'max_participants': 50,
                'auto_mute_new_participants': False
            },
            'max_speakers': MAX_ACTIVE_SPEAKERS
        }
        
        db = get_firestore_client()
        db.collection('prayer_rooms').document(room_id).set(room_data)
        
        return jsonify({
            'success': True,
            'room_id': room_id,
            'room_name': room_name,
            'room_code': room_code,  # Include room code for private rooms
            'host_id': host_id,
            'message': f'Room "{room_name}" created successfully'
        })
        
    except Exception as e:
        logging.error(f"Error creating prayer room: {str(e)}")
        return jsonify({'error': 'Failed to create prayer room'}), 500

@prayer_room_bp.route('/find-by-code/<room_code>', methods=['GET'])
def find_room_by_code(room_code):
    """Find a room by its room code"""
    try:
        db = get_firestore_client()
        
        # Query rooms by room_code
        rooms_query = db.collection('prayer_rooms')\
            .where('room_code', '==', room_code)\
            .where('is_active', '==', True)\
            .limit(1)
        
        rooms = list(rooms_query.stream())
        
        if not rooms:
            return jsonify({'error': 'Room not found'}), 404
        
        room_doc = rooms[0]
        room_data = room_doc.to_dict()
        
        return jsonify({
            'success': True,
            'room_id': room_data.get('room_id'),
            'room_name': room_data.get('room_name'),
            'room_privacy': room_data.get('room_privacy', 'public')
        })
        
    except Exception as e:
        logging.error(f"Error finding room by code: {str(e)}")
        return jsonify({'error': 'Failed to find room'}), 500

@prayer_room_bp.route('/join/<room_id>', methods=['POST'])
def join_prayer_room(room_id):
    """Join an existing prayer room"""
    try:
        # Get user from session first
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'User not authenticated'}), 401
        
        user_id = user['user_id']
        user_name = user['user_name']
        
        # Validate user name length
        if len(user_name) > 30:
            return jsonify({'error': 'User name must be 30 characters or less'}), 400
        
        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        
        if not room_data.get('is_active', False):
            return jsonify({'error': 'Room is not active'}), 400
        
        if room_data.get('is_locked', False):
            return jsonify({'error': 'Room is locked'}), 400
        
        # Check room privacy and validate room code for private rooms
        room_privacy = room_data.get('room_privacy', 'public')
        if room_privacy == 'private':
            data = request.get_json(silent=True) or {}
            raw_room_code = data.get('room_code', '')
            
            if isinstance(raw_room_code, (list, dict)):
                logging.warning(f"join_prayer_room received non-string room_code payload for room {room_id}: {raw_room_code}")
                provided_code = str(raw_room_code)
            else:
                provided_code = '' if raw_room_code is None else str(raw_room_code)
            
            provided_code = provided_code.strip().upper()
            room_code = room_data.get('room_code')
            
            if not room_code:
                logging.error(f"Private room {room_id} has no room_code set in database")
                return jsonify({'error': 'Room configuration error: missing room code'}), 500
            
            if not provided_code:
                return jsonify({'error': 'Room code is required for private rooms'}), 400
            
            # Normalize both codes to uppercase for comparison
            if provided_code != room_code.upper():
                logging.warning(f"Invalid room code provided for room {room_id}: expected {room_code}, got {provided_code}")
                return jsonify({'error': 'Invalid room code'}), 400
        
        # Normalize participant metadata and check if user is already in the room
        participants = room_data.get('participants', [])
        host_id = room_data.get('host_id')
        max_speakers = get_max_speakers(room_data)

        participants, speaker_count, participants_changed = normalize_participants(participants, host_id)

        participant_updated = False
        existing_participant = None
        for p in participants:
            if p.get('user_id') == user_id:
                # Archive the old session
                p['is_active'] = False
                p['archived_at'] = datetime.utcnow()
                p['reason_archived'] = 'joined_from_new_device'
                participant_updated = True
                break

        # Remove the old participant entry if it was found and marked as inactive
        if participant_updated:
            participants = [p for p in participants if p.get('user_id') != user_id or p.get('is_active')]
        
        # Add participant to room
        new_participant = {
            'user_id': user_id,
            'user_name': user_name,
            'joined_at': datetime.utcnow(),
            'is_muted': False,
            'is_host': user_id == host_id,
            'role': 'speaker' if (user_id == host_id or speaker_count < max_speakers) else 'listener',
            'requested_role': None,
            'request_timestamp': None
        }

        if new_participant['role'] == 'speaker' and user_id != host_id:
            speaker_count += 1

        participants.append(new_participant)
        room_ref.update({
            'participants': participants,
            'last_activity': datetime.utcnow(),
            'max_speakers': max_speakers
        })
        
        return jsonify({
            'success': True,
            'room_id': room_id,
            'room_name': room_data.get('room_name'),
            'host_id': host_id,
            'participants': participants,
            'max_speakers': max_speakers
        })
        
    except Exception as e:
        logging.error(f"Error joining prayer room {room_id}: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to join prayer room'}), 500

@prayer_room_bp.route('/leave/<room_id>', methods=['POST'])
def leave_prayer_room(room_id):
    """Leave a prayer room"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        user_id = user['user_id']
        
        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])
        
        # Remove participant
        participants = [p for p in participants if p['user_id'] != user_id]
        
        # If host leaves, close the room and add notification message
        if room_data.get('host_id') == user_id:
            # Get host name for the notification
            host_name = None
            for participant in participants:
                if participant['user_id'] == user_id:
                    host_name = participant.get('user_name', 'Host')
                    break
            
            # Add notification message to chat
            chat_ref = db.collection('chat_messages')
            notification_message = {
                'room_id': room_id,
                'user_id': 'system',
                'user_name': 'System',
                'message': f"⚠️ {host_name or 'The host'} has left the room. This prayer session will end shortly.",
                'timestamp': datetime.utcnow(),
                'message_type': 'system_notification'
            }
            chat_ref.add(notification_message)
            
            room_ref.update({
                'is_active': False,
                'closed_at': datetime.utcnow(),
                'participants': []
            })
        else:
            normalized_participants, _, changed = normalize_participants(participants, room_data.get('host_id'))
            update_payload = {
                'participants': normalized_participants,
                'last_activity': datetime.utcnow(),
                'max_speakers': get_max_speakers(room_data)
            }
            room_ref.update(update_payload)
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error leaving prayer room: {str(e)}")
        return jsonify({'error': 'Failed to leave prayer room'}), 500

@prayer_room_bp.route('/<room_id>/participants', methods=['GET'])
def get_room_participants(room_id):
    """Get room participants - Optimized for fast loading"""
    try:
        # Get current user to update their name if needed
        user = get_user_from_session()
        
        db = get_firestore_client()
        room_doc = db.collection('prayer_rooms').document(room_id).get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])
        host_id = room_data.get('host_id')
        max_speakers = get_max_speakers(room_data)

        participants, _, participants_changed = normalize_participants(participants, host_id)
        
        # Only update participant name if necessary and user exists
        # This should be rare, so do it asynchronously after returning response
        if user:
            user_id = user['user_id']
            user_name = user.get('user_name') or user.get('name', 'Anonymous')
            
            # Check if update is needed (quick check first)
            participant_needs_update = False
            for participant in participants:
                if participant.get('user_id') == user_id:
                    if participant.get('user_name') != user_name:
                        participant_needs_update = True
                        participant['user_name'] = user_name
                    break
            
            # Only write to Firestore if update is needed
            if participant_needs_update:
                # Firestore update can happen asynchronously
                room_ref = db.collection('prayer_rooms').document(room_id)
                room_ref.update({
                    'participants': participants,
                    'last_activity': datetime.utcnow()
                })

        if participants_changed or room_data.get('max_speakers') != max_speakers:
            room_ref = db.collection('prayer_rooms').document(room_id)
            room_ref.update({
                'participants': participants,
                'last_activity': datetime.utcnow(),
                'max_speakers': max_speakers
            })
        
        return jsonify({
            'success': True,
            'participants': participants,
            'room_name': room_data.get('room_name'),
            'is_active': room_data.get('is_active', False),
            'max_speakers': max_speakers
        })
        
    except Exception as e:
        logging.error(f"Error getting room participants: {str(e)}")
        return jsonify({'error': 'Failed to get participants'}), 500

@prayer_room_bp.route('/<room_id>/mute', methods=['POST'])
def mute_participant(room_id):
    """Mute/unmute a participant (host only)"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        is_muted = data.get('is_muted', False)
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
        # Get the requesting user to check if they're the host
        requesting_user = get_user_from_session()
        if not requesting_user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        
        # Check if requesting user is the host
        if room_data.get('host_id') != requesting_user['user_id']:
            return jsonify({'error': 'Only the host can mute participants'}), 403
        
        participants = room_data.get('participants', [])
        
        # Update participant mute status
        participant_found = False
        for participant in participants:
            if participant['user_id'] == user_id:
                participant['is_muted'] = is_muted
                participant_found = True
                break
        
        if not participant_found:
            return jsonify({'error': 'Participant not found'}), 404
        
        normalized_participants, _, _ = normalize_participants(participants, room_data.get('host_id'))
        room_ref.update({
            'participants': normalized_participants,
            'last_activity': datetime.utcnow(),
            'max_speakers': get_max_speakers(room_data)
        })
        
        return jsonify({'success': True, 'is_muted': is_muted})
        
    except Exception as e:
        logging.error(f"Error muting participant: {str(e)}")
        return jsonify({'error': 'Failed to mute participant'}), 500


@prayer_room_bp.route('/room/<room_id>/request-speaker', methods=['POST'])
def request_speaker_role(room_id):
    """Listener requests or cancels a request to become a speaker."""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401

        data = request.get_json(silent=True) or {}
        action = data.get('action', 'request')

        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404

        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])
        host_id = room_data.get('host_id')
        max_speakers = get_max_speakers(room_data)

        participants, _, changed = normalize_participants(participants, host_id)
        participant = find_participant(participants, user['user_id'])

        if not participant:
            return jsonify({'error': 'Participant not found in room'}), 404

        if participant.get('role') == 'speaker':
            message = 'You are already a speaker.'
        elif action == 'cancel':
            if participant.get('requested_role'):
                participant['requested_role'] = None
                participant['request_timestamp'] = None
                changed = True
            message = 'Speaker request cancelled.'
        else:
            if participant.get('requested_role') == 'speaker':
                message = 'Speaker request already submitted.'
            else:
                participant['requested_role'] = 'speaker'
                participant['request_timestamp'] = datetime.utcnow()
                changed = True
                message = 'Speaker request sent.'

        if changed or room_data.get('max_speakers') != max_speakers:
            room_ref.update({
                'participants': participants,
                'last_activity': datetime.utcnow(),
                'max_speakers': max_speakers
            })

        return jsonify({
            'success': True,
            'participants': participants,
            'max_speakers': max_speakers,
            'message': message
        })

    except Exception as e:
        logging.error(f"Error handling speaker request: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to update speaker request'}), 500


@prayer_room_bp.route('/room/<room_id>/promote-speaker', methods=['POST'])
def promote_speaker(room_id):
    """Host promotes a participant to speaker role (up to cap)."""
    try:
        host = get_user_from_session()
        if not host:
            return jsonify({'error': 'Authentication required'}), 401

        data = request.get_json(silent=True) or {}
        target_user_id = data.get('user_id')
        if not target_user_id:
            return jsonify({'error': 'Target user_id is required'}), 400

        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404

        room_data = room_doc.to_dict()
        if room_data.get('host_id') != host['user_id']:
            return jsonify({'error': 'Only the host can promote speakers'}), 403

        participants = room_data.get('participants', [])
        host_id = room_data.get('host_id')
        max_speakers = get_max_speakers(room_data)

        participants, _, changed = normalize_participants(participants, host_id)
        target = find_participant(participants, target_user_id)

        if not target:
            return jsonify({'error': 'Participant not found'}), 404

        if target.get('role') == 'speaker':
            return jsonify({
                'success': True,
                'participants': participants,
                'max_speakers': max_speakers,
                'message': 'Participant is already a speaker.'
            })

        current_speakers = count_speakers(participants)
        if current_speakers >= max_speakers:
            return jsonify({'error': f'Maximum of {max_speakers} speakers reached.'}), 400

        participants, role_changed = set_participant_role(participants, target_user_id, 'speaker')
        if role_changed:
            changed = True

        if changed or room_data.get('max_speakers') != max_speakers:
            room_ref.update({
                'participants': participants,
                'last_activity': datetime.utcnow(),
                'max_speakers': max_speakers
            })

        return jsonify({
            'success': True,
            'participants': participants,
            'max_speakers': max_speakers,
            'message': 'Participant promoted to speaker.'
        })

    except Exception as e:
        logging.error(f"Error promoting speaker: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to promote participant'}), 500


@prayer_room_bp.route('/room/<room_id>/demote-speaker', methods=['POST'])
def demote_speaker(room_id):
    """Host demotes a speaker to listener role."""
    try:
        host = get_user_from_session()
        if not host:
            return jsonify({'error': 'Authentication required'}), 401

        data = request.get_json(silent=True) or {}
        target_user_id = data.get('user_id')
        if not target_user_id:
            return jsonify({'error': 'Target user_id is required'}), 400

        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404

        room_data = room_doc.to_dict()
        host_id = room_data.get('host_id')
        
        # Allow self-demotion or host demotion
        is_self_demotion = target_user_id == host['user_id']
        is_host = host_id == host['user_id']
        
        if not is_self_demotion and not is_host:
            return jsonify({'error': 'Only the host can demote other speakers'}), 403

        if target_user_id == host_id:
            return jsonify({'error': 'Host cannot be demoted from speaker role'}), 400

        participants = room_data.get('participants', [])
        max_speakers = get_max_speakers(room_data)

        participants, _, changed = normalize_participants(participants, host_id)
        target = find_participant(participants, target_user_id)

        if not target:
            return jsonify({'error': 'Participant not found'}), 404

        if target.get('role') != 'speaker':
            return jsonify({
                'success': True,
                'participants': participants,
                'max_speakers': max_speakers,
                'message': 'Participant is already a listener.'
            })

        participants, role_changed = set_participant_role(participants, target_user_id, 'listener')
        if role_changed:
            target = find_participant(participants, target_user_id)
            if target:
                target['is_muted'] = True
            changed = True

        if changed or room_data.get('max_speakers') != max_speakers:
            room_ref.update({
                'participants': participants,
                'last_activity': datetime.utcnow(),
                'max_speakers': max_speakers
            })

        return jsonify({
            'success': True,
            'participants': participants,
            'max_speakers': max_speakers,
            'message': 'Participant demoted to listener.'
        })

    except Exception as e:
        logging.error(f"Error demoting speaker: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to demote participant'}), 500


@prayer_room_bp.route('/room/<room_id>/speaker-requests', methods=['GET'])
def get_speaker_requests(room_id):
    """Return pending speaker requests for host moderation UI."""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401

        db = get_firestore_client()
        room_doc = db.collection('prayer_rooms').document(room_id).get()

        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404

        room_data = room_doc.to_dict()
        if room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the host can view speaker requests'}), 403

        participants = room_data.get('participants', [])
        participants, _, _ = normalize_participants(participants, room_data.get('host_id'))

        requests = []
        for participant in participants:
            if participant.get('requested_role') == 'speaker':
                timestamp = participant.get('request_timestamp')
                if isinstance(timestamp, datetime):
                    ts_value = timestamp.isoformat()
                else:
                    ts_value = timestamp
                requests.append({
                    'user_id': participant.get('user_id'),
                    'user_name': participant.get('user_name'),
                    'request_timestamp': ts_value
                })

        requests.sort(key=lambda item: item.get('request_timestamp') or '')

        return jsonify({
            'success': True,
            'requests': requests,
            'max_speakers': get_max_speakers(room_data)
        })

    except Exception as e:
        logging.error(f"Error fetching speaker requests: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to fetch speaker requests'}), 500

@prayer_room_bp.route('/<room_id>/remove', methods=['POST'])
def remove_participant(room_id):
    """Remove a participant from the room (host only)"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
        # Get the requesting user to check if they're the host
        requesting_user = get_user_from_session()
        if not requesting_user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        
        # Check if requesting user is the host
        if room_data.get('host_id') != requesting_user['user_id']:
            return jsonify({'error': 'Only the host can remove participants'}), 403
        
        participants = room_data.get('participants', [])
        
        # Find the participant to remove
        participant_to_remove = None
        for participant in participants:
            if participant['user_id'] == user_id:
                participant_to_remove = participant
                break
        
        if not participant_to_remove:
            return jsonify({'error': 'Participant not found'}), 404
        
        # Remove participant
        participants = [p for p in participants if p['user_id'] != user_id]
        
        # Add notification message to chat
        chat_ref = db.collection('chat_messages')
        notification_message = {
            'room_id': room_id,
            'user_id': 'system',
            'user_name': 'System',
            'message': f"👋 {participant_to_remove.get('user_name', 'A participant')} has been removed from the room by the host.",
            'timestamp': datetime.utcnow(),
            'message_type': 'system_notification'
        }
        chat_ref.add(notification_message)
        
        room_ref.update({
            'participants': participants,
            'last_activity': datetime.utcnow()
        })
        
        return jsonify({'success': True, 'removed_user': participant_to_remove.get('user_name', 'Unknown')})
        
    except Exception as e:
        logging.error(f"Error removing participant: {str(e)}")
        return jsonify({'error': 'Failed to remove participant'}), 500

@prayer_room_bp.route('/<room_id>/chat', methods=['POST'])
def send_chat_message(room_id):
    """Send a chat message to the room"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            logging.error("Chat message: No user in session")
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        if not data:
            logging.error("Chat message: No JSON data in request")
            return jsonify({'error': 'Invalid request: JSON data required'}), 400
        
        # Use authenticated user data, not from request body
        user_id = user.get('user_id')
        if not user_id:
            logging.error(f"Chat message: No user_id in session user: {user}")
            return jsonify({'error': 'Invalid user session'}), 401
        
        user_name = user.get('name', 'Anonymous')
        
        # Validate input data
        is_valid, validation_errors = validate_data(data, 'chat_message')
        if not is_valid:
            logging.error(f"Chat message validation failed: {validation_errors}")
            return jsonify({'error': 'Invalid input', 'details': validation_errors}), 400
        
        message = sanitize_string(data['message'], max_length=1000)
        if not message or not message.strip():
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        db = get_firestore_client()
        
        # Add message to chat collection
        chat_data = {
            'room_id': room_id,
            'user_id': user_id,
            'user_name': user_name,
            'message': message,
            'timestamp': firestore.SERVER_TIMESTAMP,
            'message_id': str(uuid.uuid4())
        }
        
        message_ref = db.collection('chat_messages').add(chat_data)
        logging.info(f"Chat message added successfully for room {room_id} by user {user_id}")
        
        return jsonify({'success': True, 'message_id': chat_data['message_id']}), 200
        
    except KeyError as e:
        logging.error(f"Chat message KeyError: {str(e)}", exc_info=True)
        return jsonify({'error': f'Missing required field: {str(e)}'}), 400
    except Exception as e:
        logging.error(f"Error sending chat message: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to send message'}), 500

@prayer_room_bp.route('/<room_id>/chat', methods=['GET'])
def get_chat_messages(room_id):
    """Get chat messages for a room"""
    try:
        db = get_firestore_client()
        
        # Try to get recent messages (last 50)
        try:
            messages_query = db.collection('chat_messages')\
                .where('room_id', '==', room_id)\
                .order_by('timestamp', direction='DESCENDING')\
                .limit(50)
            
            messages = []
            for doc in messages_query.stream():
                message_data = doc.to_dict()
                messages.append({
                    'message_id': message_data.get('message_id'),
                    'user_id': message_data.get('user_id'),
                    'user_name': message_data.get('user_name'),
                    'message': message_data.get('message'),
                    'timestamp': message_data.get('timestamp').isoformat() if message_data.get('timestamp') else None
                })
            
            # Reverse to get chronological order
            messages.reverse()
            
        except Exception as index_error:
            # If index error, return empty messages array
            logging.warning(f"Firestore index error for chat messages: {str(index_error)}")
            messages = []
        
        return jsonify({
            'success': True,
            'messages': messages
        })
        
    except Exception as e:
        logging.error(f"Error getting chat messages: {str(e)}")
        return jsonify({'error': 'Failed to get messages'}), 500

@prayer_room_bp.route('/rooms', methods=['GET'])
def get_active_rooms():
    """Get list of active prayer rooms"""
    try:
        db = get_firestore_client()
        
        # Get active rooms
        rooms_query = db.collection('prayer_rooms')\
            .where('is_active', '==', True)\
            .order_by('created_at', direction='DESCENDING')\
            .limit(20)
        
        rooms = []
        for doc in rooms_query.stream():
            room_data = doc.to_dict()
            # Convert datetime objects to strings for JSON serialization
            if 'created_at' in room_data:
                room_data['created_at'] = room_data['created_at'].isoformat()
            
            # Add participant count
            room_data['participant_count'] = len(room_data.get('participants', []))
            
            # Preserve host_name before removing participants
            host_name = room_data.get('host_name', 'Anonymous')
            room_privacy = room_data.get('room_privacy', 'public')
            
            # Remove sensitive data
            if 'participants' in room_data:
                del room_data['participants']
            
            # Ensure host_name and privacy are included in the response
            room_data['host_name'] = host_name
            room_data['room_privacy'] = room_privacy
            
            rooms.append(room_data)
        
        return jsonify({'rooms': rooms})
        
    except Exception as e:
        logging.error(f"Error getting active rooms: {str(e)}")
        return jsonify({'error': 'Failed to get rooms'}), 500

@prayer_room_bp.route('/room/<room_id>', methods=['GET'])
def get_room_details(room_id):
    """Get details of a specific room"""
    try:
        db = get_firestore_client()
        
        room_doc = db.collection('prayer_rooms').document(room_id).get()
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        
        # Convert datetime objects to strings
        if 'created_at' in room_data:
            room_data['created_at'] = room_data['created_at'].isoformat()
        
        # Add participant count
        room_data['participant_count'] = len(room_data.get('participants', []))
        
        return jsonify({'room': room_data})
        
    except Exception as e:
        logging.error(f"Error getting room details: {str(e)}")
        return jsonify({'error': 'Failed to get room details'}), 500

@prayer_room_bp.route('/room/<room_id>/settings', methods=['PUT'])
def update_room_settings(room_id):
    """Update room settings (host only)"""
    try:
        data = request.get_json()
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        room_doc = db.collection('prayer_rooms').document(room_id)
        room_data = room_doc.get().to_dict()
        
        # Check if user is the host
        if room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the host can update settings'}), 403
        
        # Update settings
        new_settings = data.get('settings', {})
        current_settings = room_data.get('settings', {})
        current_settings.update(new_settings)
        
        room_doc.update({
            'settings': current_settings,
            'updated_at': datetime.utcnow()
        })
        
        return jsonify({'success': True, 'settings': current_settings})
        
    except Exception as e:
        logging.error(f"Error updating room settings: {str(e)}")
        return jsonify({'error': 'Failed to update settings'}), 500

@prayer_room_bp.route('/room/<room_id>/end', methods=['POST'])
def end_room(room_id):
    """End a prayer room (host only)"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        room_doc = db.collection('prayer_rooms').document(room_id)
        room_data = room_doc.get().to_dict()
        
        # Check if user is the host
        if room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the host can end the room'}), 403
        
        # Mark room as inactive
        room_doc.update({
            'is_active': False,
            'ended_at': datetime.utcnow(),
            'ended_by': user['user_id']
        })
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error ending room: {str(e)}")
        return jsonify({'error': 'Failed to end room'}), 500

@prayer_room_bp.route('/room/<room_id>/speaking-state', methods=['POST'])
def update_speaking_state(room_id):
    """Update user's speaking state in the room"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        is_speaking = data.get('is_speaking', False)
        
        db = get_firestore_client()
        
        # Get the room document
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])
        
        # Find and update the participant's speaking state
        participant_found = False
        for participant in participants:
            if participant['user_id'] == user['user_id']:
                participant['is_speaking'] = is_speaking
                participant['last_activity'] = datetime.utcnow()
                participant_found = True
                break
        
        # If participant not found, create a new participant entry
        if not participant_found:
            # Get the actual user name from the session
            user_name = user.get('name', user.get('user_name', 'Anonymous'))
            new_participant = {
                'user_id': user['user_id'],
                'user_name': user_name,
                'joined_at': datetime.utcnow(),
                'is_muted': False,
                'is_host': False,
                'is_speaking': is_speaking,
                'last_activity': datetime.utcnow(),
                'role': 'listener',
                'requested_role': None,
                'request_timestamp': None
            }
            participants.append(new_participant)
        
        participants, _, participants_changed = normalize_participants(participants, room_data.get('host_id'))

        # Update the room document with the modified participants
        update_payload = {
            'participants': participants,
            'last_activity': datetime.utcnow()
        }
        if participants_changed or room_data.get('max_speakers') is None:
            update_payload['max_speakers'] = get_max_speakers(room_data)

        room_ref.update(update_payload)
        
        # Log speaking state for debugging
        user_name = user.get('name', user.get('user_name', 'Anonymous'))
        if is_speaking:
            logging.info(f"🎤 User {user_name} ({user['user_id']}) is speaking in room {room_id}")
        else:
            logging.info(f"🔇 User {user_name} ({user['user_id']}) stopped speaking in room {room_id}")
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error updating speaking state: {str(e)}")
        return jsonify({'error': 'Failed to update speaking state'}), 500

@prayer_room_bp.route('/room/<room_id>/webrtc-offer', methods=['POST'])
def send_webrtc_offer(room_id):
    """Send WebRTC offer to another participant"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        to_user = data.get('to_user')
        offer = data.get('offer')
        
        if not to_user or not offer:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate WebRTC offer data
        if not isinstance(offer, dict) or 'type' not in offer or 'sdp' not in offer:
            return jsonify({'error': 'Invalid offer format'}), 400
        
        if offer['type'] != 'offer':
            return jsonify({'error': 'Invalid offer type'}), 400
        
        # Validate SDP size and content
        sdp = offer.get('sdp', '')
        if len(sdp) > 10000:  # 10KB limit for SDP
            return jsonify({'error': 'SDP too large'}), 400
        
        # Basic SDP validation
        if not sdp.startswith('v=0') or 'm=' not in sdp:
            return jsonify({'error': 'Invalid SDP format'}), 400
        
        db = get_firestore_client()
        
        # Store WebRTC offer
        offer_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_offers').add({
            'from_user': user['user_id'],
            'to_user': to_user,
            'offer': offer,
            'timestamp': firestore.SERVER_TIMESTAMP
        })
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error sending WebRTC offer: {str(e)}")
        return jsonify({'error': 'Failed to send WebRTC offer'}), 500

@prayer_room_bp.route('/room/<room_id>/webrtc-answer', methods=['POST'])
def send_webrtc_answer(room_id):
    """Send WebRTC answer to another participant"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        to_user = data.get('to_user')
        answer = data.get('answer')
        
        if not to_user or not answer:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Validate WebRTC answer data
        if not isinstance(answer, dict) or 'type' not in answer or 'sdp' not in answer:
            return jsonify({'error': 'Invalid answer format'}), 400
        
        if answer['type'] != 'answer':
            return jsonify({'error': 'Invalid answer type'}), 400
        
        # Validate SDP size and content
        sdp = answer.get('sdp', '')
        if len(sdp) > 10000:  # 10KB limit for SDP
            return jsonify({'error': 'SDP too large'}), 400
        
        # Basic SDP validation
        if not sdp.startswith('v=0') or 'm=' not in sdp:
            return jsonify({'error': 'Invalid SDP format'}), 400
        
        db = get_firestore_client()
        
        # Store WebRTC answer
        answer_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_answers').add({
            'from_user': user['user_id'],
            'to_user': to_user,
            'answer': answer,
            'timestamp': firestore.SERVER_TIMESTAMP
        })
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error sending WebRTC answer: {str(e)}")
        return jsonify({'error': 'Failed to send WebRTC answer'}), 500

@prayer_room_bp.route('/room/<room_id>/webrtc-offers', methods=['GET'])
def get_webrtc_offers(room_id):
    """Get WebRTC offers for a room"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get offers for this user (simplified query to avoid composite index requirement)
        offers_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_offers')\
            .where('to_user', '==', user['user_id'])\
            .limit(10)
        
        offers = []
        for doc in offers_ref.stream():
            offer_data = doc.to_dict()
            offer_data['id'] = doc.id
            offers.append(offer_data)
        
        # Sort by timestamp descending (most recent first)
        # Handle Firestore timestamp objects properly
        def get_timestamp_sort_key(item):
            timestamp = item.get('timestamp')
            if hasattr(timestamp, 'timestamp'):
                return timestamp.timestamp()
            elif isinstance(timestamp, dict) and '_seconds' in timestamp:
                return timestamp['_seconds']
            else:
                return 0
        
        offers.sort(key=get_timestamp_sort_key, reverse=True)
        
        return jsonify(offers)
        
    except Exception as e:
        logging.error(f"Error getting WebRTC offers: {str(e)}")
        return jsonify({'error': 'Failed to get WebRTC offers'}), 500

@prayer_room_bp.route('/room/<room_id>/webrtc-answers', methods=['GET'])
def get_webrtc_answers(room_id):
    """Get WebRTC answers for a room"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get answers for this user (simplified query to avoid composite index requirement)
        answers_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_answers')\
            .where('to_user', '==', user['user_id'])\
            .limit(10)
        
        answers = []
        for doc in answers_ref.stream():
            answer_data = doc.to_dict()
            answer_data['id'] = doc.id
            answers.append(answer_data)
        
        # Sort by timestamp descending (most recent first)
        # Handle Firestore timestamp objects properly
        def get_timestamp_sort_key(item):
            timestamp = item.get('timestamp')
            if hasattr(timestamp, 'timestamp'):
                return timestamp.timestamp()
            elif isinstance(timestamp, dict) and '_seconds' in timestamp:
                return timestamp['_seconds']
            else:
                return 0
        
        answers.sort(key=get_timestamp_sort_key, reverse=True)
        
        return jsonify(answers)
        
    except Exception as e:
        logging.error(f"Error getting WebRTC answers: {str(e)}")
        return jsonify({'error': 'Failed to get WebRTC answers'}), 500

@prayer_room_bp.route('/room/<room_id>/webrtc-candidate', methods=['POST'])
def send_webrtc_candidate(room_id):
    """Send WebRTC ICE candidate to another participant"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        to_user = data.get('to_user')
        candidate = data.get('candidate')
        
        if not to_user or not candidate:
            return jsonify({'error': 'Missing required fields: to_user and candidate'}), 400
        
        db = get_firestore_client()
        
        # Store the candidate in Firestore
        candidate_data = {
            'from_user': user['user_id'],
            'to_user': to_user,
            'candidate': candidate,
            'timestamp': datetime.utcnow(),
            'room_id': room_id
        }
        
        db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_candidates').add(candidate_data)
        
        logging.info(f"WebRTC candidate sent from {user['user_id']} to {to_user} in room {room_id}")
        
        return jsonify({'success': True, 'message': 'Candidate sent successfully'}), 200
        
    except Exception as e:
        logging.error(f"Error sending WebRTC candidate: {str(e)}")
        return jsonify({'error': 'Failed to send candidate'}), 500

@prayer_room_bp.route('/room/<room_id>/webrtc-candidates', methods=['GET'])
def get_webrtc_candidates(room_id):
    """Get WebRTC candidates for a room"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get candidates for this user
        candidates_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_candidates')\
            .where('to_user', '==', user['user_id'])\
            .limit(10)
        
        candidates = []
        for doc in candidates_ref.stream():
            candidate_data = doc.to_dict()
            candidate_data['id'] = doc.id
            candidates.append(candidate_data)
        
        # Sort by timestamp descending (most recent first)
        def get_timestamp_sort_key(item):
            timestamp = item.get('timestamp')
            if hasattr(timestamp, 'timestamp'):
                return timestamp.timestamp()
            elif isinstance(timestamp, dict) and '_seconds' in timestamp:
                return timestamp['_seconds']
            else:
                return 0
        
        candidates.sort(key=get_timestamp_sort_key, reverse=True)
        
        return jsonify(candidates)
        
    except Exception as e:
        logging.error(f"Error getting WebRTC candidates: {str(e)}")
        return jsonify({'error': 'Failed to get WebRTC candidates'}), 500

# Multi-Device Session Management Endpoints
@prayer_room_bp.route('/<room_id>/check-session', methods=['POST'])
def check_user_session(room_id):
    try:
        user = get_user_from_session()
        user_id = user.get('user_id') if user else None

        if not user_id:
            return jsonify({'error': 'User not authenticated'}), 401

        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()

        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404

        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])

        session_exists = any(
            p.get('user_id') == user_id and p.get('session_id') and p.get('is_active', True)
            for p in participants
        )

        return jsonify({'session_exists': session_exists})
    except Exception as e:
        logging.error(f"Error checking user session in room {room_id}: {e}", exc_info=True)
        return jsonify({'error': 'Failed to check user session'}), 500

@prayer_room_bp.route('/<room_id>/register-session', methods=['POST'])
def register_user_session(room_id):
    """Register a new device session"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        device_id = data.get('device_id')
        device_info = data.get('device_info', {})
        
        # Use authenticated user ID
        user_id = user['user_id']
        
        if not device_id:
            return jsonify({'error': 'Device ID is required'}), 400
        
        # Sanitize device info to prevent information disclosure
        sanitized_device_info = {
            'user_agent': sanitize_string(device_info.get('user_agent', ''), max_length=200),
            'platform': sanitize_string(device_info.get('platform', ''), max_length=50),
            'language': sanitize_string(device_info.get('language', ''), max_length=10)
        }
        
        db = get_firestore_client()
        
        # Deactivate any existing sessions for this user across ALL rooms
        # This ensures users can only have one active session at a time
        # OPTIMIZED: Use collection group query for better performance
        try:
            sessions_query = db.collection_group('device_sessions')\
                .where('user_id', '==', user_id)\
                .where('is_active', '==', True)\
                .limit(10)
            
            batch = db.batch()
            session_count = 0
            for session_doc in sessions_query.stream():
                batch.update(session_doc.reference, {
                    'is_active': False,
                    'ended_at': datetime.utcnow()
                })
                session_count += 1
            
            if session_count > 0:
                batch.commit()
                logging.info(f"Deactivated {session_count} existing session(s) for user {user_id}")
        except Exception as e:
            logging.warning(f"Collection group query failed, using fallback: {e}")
            try:
                # Fallback: only check current room
                current_room_sessions = db.collection('prayer_rooms').document(room_id)\
                    .collection('device_sessions')\
                    .where('user_id', '==', user_id)\
                    .where('is_active', '==', True)\
                    .stream()
                
                for session_doc in current_room_sessions:
                    session_doc.reference.update({
                        'is_active': False,
                        'ended_at': datetime.utcnow()
                    })
            except Exception as fallback_error:
                logging.error(f"Fallback session deactivation also failed: {fallback_error}")
        
        # Register new session
        session_data = {
            'user_id': user_id,
            'device_id': device_id,
            'device_info': sanitized_device_info,
            'is_active': True,
            'created_at': datetime.utcnow(),
            'last_seen': datetime.utcnow()
        }
        
        db.collection('prayer_rooms').document(room_id)\
            .collection('device_sessions').add(session_data)
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error registering session: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to register session'}), 500

@prayer_room_bp.route('/<room_id>/disconnect-session', methods=['POST'])
def disconnect_session(room_id):
    """Disconnect existing session (for device switching)"""
    try:
        # Get authenticated user from session
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        user_id = user['user_id']
        
        db = get_firestore_client()
        
        # Deactivate all sessions for this user
        sessions_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('device_sessions')\
            .where('user_id', '==', user_id)\
            .where('is_active', '==', True)
        
        for session_doc in sessions_ref.stream():
            session_doc.reference.update({
                'is_active': False,
                'ended_at': datetime.utcnow()
            })
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error disconnecting session: {str(e)}")
        return jsonify({'error': 'Failed to disconnect session'}), 500

@prayer_room_bp.route('/my-rooms', methods=['GET'])
def get_my_rooms():
    """Get all rooms created by the current user"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get rooms created by this user (simplified query to avoid composite index)
        rooms_ref = db.collection('prayer_rooms')\
            .where('host_id', '==', user['user_id'])\
            .limit(50)
        
        rooms = []
        for doc in rooms_ref.stream():
            room_data = doc.to_dict()
            room_data['room_id'] = doc.id
            # Convert Firestore timestamps to ISO strings
            if 'created_at' in room_data and hasattr(room_data['created_at'], 'timestamp'):
                room_data['created_at'] = room_data['created_at'].timestamp()
            if 'last_activity' in room_data and hasattr(room_data['last_activity'], 'timestamp'):
                room_data['last_activity'] = room_data['last_activity'].timestamp()
            rooms.append(room_data)
        
        # Sort by created_at in Python (since we can't order_by in the query)
        rooms.sort(key=lambda x: x.get('created_at', 0), reverse=True)
        
        return jsonify({'rooms': rooms})
        
    except Exception as e:
        logging.error(f"Error getting user rooms: {str(e)}")
        return jsonify({'error': 'Failed to get user rooms'}), 500

@prayer_room_bp.route('/schedule', methods=['POST'])
def schedule_room():
    """Schedule a prayer room for a future time"""
    try:
        user = get_user_from_session()
        
        if not user:
            logging.error("No user found in session for schedule request")
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        logging.info(f"Schedule request data: {data}")
        
        room_name = data.get('room_name')
        room_description = data.get('room_description', '')
        scheduled_time = data.get('scheduled_time')
        room_privacy = data.get('room_privacy', 'public')
        host_name = user.get('user_name', 'Anonymous')
        
        logging.info(f"Parsed data - room_name: {room_name}, scheduled_time: {scheduled_time}")
        
        if not room_name:
            logging.error("Room name is missing")
            return jsonify({'error': 'Room name is required'}), 400
        
        if not scheduled_time:
            logging.error("Scheduled time is missing")
            return jsonify({'error': 'Scheduled time is required'}), 400
        
        # Validate room name length
        if len(room_name) > 50:
            logging.error(f"Room name too long: {len(room_name)} characters")
            return jsonify({'error': 'Room name must be 50 characters or less'}), 400
        
        # Validate host name length
        if len(host_name) > 30:
            logging.error(f"Host name too long: {len(host_name)} characters")
            return jsonify({'error': 'Host name must be 30 characters or less'}), 400
        
        # Parse scheduled time - handle local timezone
        try:
            # Get timezone offset from request (in minutes, negative for timezones ahead of UTC)
            timezone_offset_minutes = data.get('timezone_offset', 0)
            
            # The datetime-local input provides local time without timezone info
            # We need to convert it to UTC for storage
            if 'T' in scheduled_time and '+' not in scheduled_time and 'Z' not in scheduled_time:
                # This is a local datetime from datetime-local input
                # Parse it as naive datetime (no timezone info)
                local_datetime = datetime.fromisoformat(scheduled_time)
                logging.info(f"Parsed scheduled time (local): {local_datetime}")
                
                # Convert local time to UTC
                # getTimezoneOffset() returns minutes to ADD to local time to get UTC
                # For CST (UTC-6), it returns +360 (6 hours behind UTC)
                # So UTC = local + offset_minutes
                from datetime import timezone, timedelta
                offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                scheduled_datetime = local_datetime + offset_timedelta
                logging.info(f"Converted to UTC: {scheduled_datetime} (local: {local_datetime}, offset: {timezone_offset_minutes} minutes = {timezone_offset_minutes/60} hours)")
            else:
                # This has timezone info, parse normally
                scheduled_datetime = datetime.fromisoformat(scheduled_time.replace('Z', '+00:00'))
                logging.info(f"Parsed scheduled time (with timezone): {scheduled_datetime}")
        except ValueError as e:
            logging.error(f"Invalid scheduled time format: {scheduled_time}, error: {e}")
            return jsonify({'error': 'Invalid scheduled time format'}), 400
        
        # Check if scheduled time is in the future (using UTC)
        now_utc = datetime.utcnow()
        if scheduled_datetime <= now_utc:
            logging.error(f"Scheduled time is in the past: {scheduled_datetime} UTC (current time: {now_utc} UTC)")
            return jsonify({'error': 'Scheduled time must be in the future'}), 400
        
        db = get_firestore_client()
        
        # Get recurring pattern data
        is_recurring = data.get('is_recurring', False)
        recurrence_pattern = data.get('recurrence_pattern')  # 'weekly', 'biweekly', 'monthly'
        recurrence_end_date = data.get('recurrence_end_date')
        recurrence_days = data.get('recurrence_days', [])  # For weekly: [0, 2, 4] = Monday, Wednesday, Friday
        
        # Create scheduled room data
        scheduled_room_data = {
            'room_name': room_name,
            'room_description': room_description,
            'room_privacy': room_privacy,
            'host_id': user['user_id'],
            'host_name': host_name,
            'scheduled_time': scheduled_datetime,
            'created_at': datetime.utcnow(),
            'status': 'scheduled',
            'is_recurring': is_recurring
        }
        
        # Add recurring pattern data
        if is_recurring and recurrence_pattern:
            scheduled_room_data['recurrence_pattern'] = recurrence_pattern
            scheduled_room_data['recurrence_days'] = recurrence_days
            
            # Parse end date if provided (also convert to UTC if it's a date-only input)
            if recurrence_end_date:
                try:
                    # If it's a date-only input (YYYY-MM-DD), treat as local midnight
                    if 'T' not in recurrence_end_date:
                        # Date only - set to midnight local time and convert to UTC
                        end_datetime_local = datetime.fromisoformat(recurrence_end_date + 'T00:00')
                        offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                        end_datetime = end_datetime_local + offset_timedelta
                    elif 'T' in recurrence_end_date and '+' not in recurrence_end_date and 'Z' not in recurrence_end_date:
                        # datetime-local input - convert to UTC
                        end_datetime_local = datetime.fromisoformat(recurrence_end_date)
                        offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                        end_datetime = end_datetime_local + offset_timedelta
                    else:
                        # Has timezone info
                        end_datetime = datetime.fromisoformat(recurrence_end_date.replace('Z', '+00:00'))
                    scheduled_room_data['recurrence_end_date'] = end_datetime
                except ValueError:
                    logging.warning(f"Invalid recurrence end date: {recurrence_end_date}")
            
            # If no end date, default to 3 months from now
            if 'recurrence_end_date' not in scheduled_room_data:
                scheduled_room_data['recurrence_end_date'] = scheduled_datetime + timedelta(days=90)
        
        # Generate room code for private rooms
        if room_privacy == 'private':
            scheduled_room_data['room_code'] = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        
        # Save the scheduled room
        scheduled_room_ref = db.collection('scheduled_rooms').add(scheduled_room_data)
        scheduled_room_id = scheduled_room_ref[1].id
        
        logging.info(f"Successfully scheduled room: {scheduled_room_id}")
        
        return jsonify({
            'success': True,
            'scheduled_room_id': scheduled_room_id,
            'room_code': scheduled_room_data.get('room_code'),
            'message': 'Room scheduled successfully'
        })
        
    except Exception as e:
        logging.error(f"Error scheduling room: {str(e)}")
        return jsonify({'error': 'Failed to schedule room'}), 500

@prayer_room_bp.route('/my-scheduled-rooms', methods=['GET'])
def get_my_scheduled_rooms():
    """Get all scheduled rooms created by the current user"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get scheduled rooms created by this user (simplified query to avoid composite index)
        scheduled_rooms_ref = db.collection('scheduled_rooms')\
            .where('host_id', '==', user['user_id'])\
            .limit(50)
        
        scheduled_rooms = []
        for doc in scheduled_rooms_ref.stream():
            room_data = doc.to_dict()
            room_data['scheduled_room_id'] = doc.id
            # Convert Firestore timestamps to ISO strings
            if 'scheduled_time' in room_data and hasattr(room_data['scheduled_time'], 'timestamp'):
                room_data['scheduled_time'] = room_data['scheduled_time'].timestamp()
            if 'created_at' in room_data and hasattr(room_data['created_at'], 'timestamp'):
                room_data['created_at'] = room_data['created_at'].timestamp()
            scheduled_rooms.append(room_data)
        
        # Sort by scheduled_time in Python (since we can't order_by in the query)
        scheduled_rooms.sort(key=lambda x: x.get('scheduled_time', 0), reverse=False)
        
        # Filter out past scheduled meetings
        now = datetime.now().timestamp()
        future_scheduled_rooms = [room for room in scheduled_rooms if room.get('scheduled_time', 0) > now]
        
        return jsonify({'scheduled_rooms': future_scheduled_rooms})
        
    except Exception as e:
        logging.error(f"Error getting scheduled rooms: {str(e)}")
        return jsonify({'error': 'Failed to get scheduled rooms'}), 500

@prayer_room_bp.route('/scheduled-room/<scheduled_room_id>', methods=['DELETE'])
def cancel_scheduled_room(scheduled_room_id):
    """Cancel a scheduled room"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get the scheduled room
        scheduled_room_ref = db.collection('scheduled_rooms').document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()
        
        if not scheduled_room_doc.exists:
            return jsonify({'error': 'Scheduled room not found'}), 404
        
        scheduled_room_data = scheduled_room_doc.to_dict()
        
        # Check if user is the host
        if scheduled_room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the host can cancel scheduled rooms'}), 403
        
        # Delete the scheduled room
        scheduled_room_ref.delete()
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error canceling scheduled room: {str(e)}")
        return jsonify({'error': 'Failed to cancel scheduled room'}), 500

def notify_subscribers_about_reopened_room(original_room_id, new_room_id, room_name, room_code, host_name):
    """Send email notifications to room subscribers when room is reopened"""
    try:
        db = get_firestore_client()
        
        # Get all active subscribers for this room
        subscriptions = db.collection('room_subscriptions')\
            .where('original_room_id', '==', original_room_id)\
            .where('is_active', '==', True)\
            .where('notification_preferences.email', '==', True)\
            .stream()
        
        subscriber_count = 0
        base_url = request.url_root.rstrip('/')
        
        for sub_doc in subscriptions:
            try:
                sub_data = sub_doc.to_dict()
                user_email = sub_data.get('user_email')
                user_name = sub_data.get('user_name', 'Friend')
                
                if not user_email:
                    continue
                
                # Build join URL
                join_url = f"{base_url}/prayer-room/join?room={new_room_id}"
                if room_code:
                    join_url += f"&code={room_code}"
                
                # Build unsubscribe URL (using subscription document ID)
                unsubscribe_url = f"{base_url}/prayer-room/unsubscribe-link?sub_id={sub_doc.id}"
                
                # Email subject
                subject = f"🙏 {room_name} is Live! Join the Prayer Session"
                
                # Email body
                body = f"""
                <html>
                <head>
                    <style>
                        body {{
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            line-height: 1.6;
                            color: #333;
                            max-width: 600px;
                            margin: 0 auto;
                        }}
                        .header {{
                            background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                            padding: 30px;
                            text-align: center;
                            color: white;
                        }}
                        .content {{
                            padding: 30px;
                            background: #f8f9fa;
                        }}
                        .card {{
                            background: white;
                            border-radius: 10px;
                            padding: 25px;
                            margin: 20px 0;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        }}
                        .button {{
                            display: inline-block;
                            padding: 15px 40px;
                            background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                            color: white !important;
                            text-decoration: none;
                            border-radius: 50px;
                            font-weight: 600;
                            font-size: 16px;
                            margin: 20px 0;
                        }}
                        .room-code {{
                            background: rgba(15, 86, 255, 0.1);
                            color: #0f56ff;
                            padding: 15px;
                            border-radius: 8px;
                            text-align: center;
                            font-size: 24px;
                            font-weight: bold;
                            letter-spacing: 3px;
                            margin: 15px 0;
                        }}
                        .footer {{
                            padding: 20px;
                            text-align: center;
                            color: #666;
                            font-size: 14px;
                        }}
                        .unsubscribe {{
                            color: #999;
                            font-size: 12px;
                        }}
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🙏 Prayer Room is Live!</h1>
                    </div>
                    <div class="content">
                        <div class="card">
                            <h2>Hello {user_name}!</h2>
                            <p><strong>{host_name}</strong> has opened <strong>{room_name}</strong> for prayer.</p>
                            <p>You're receiving this because you subscribed to updates for this prayer room.</p>
                            
                            {"<div class='room-code'>Room Code: " + room_code + "</div>" if room_code else ""}
                            
                            <div style="text-align: center;">
                                <a href="{join_url}" class="button">
                                    Join Prayer Room Now
                                </a>
                            </div>
                            
                            <p style="margin-top: 20px; color: #666; font-size: 14px;">
                                🌟 <em>"For where two or three gather in my name, there am I with them." - Matthew 18:20</em>
                            </p>
                        </div>
                    </div>
                    <div class="footer">
                        <p>Divine Bridge - Connecting Hearts in Prayer</p>
                        <p class="unsubscribe">
                            Don't want these notifications? 
                            <a href="{unsubscribe_url}" style="color: #0f56ff;">Unsubscribe from this room</a>
                        </p>
                    </div>
                </body>
                </html>
                """
                
                # Send email (non-blocking, log errors but don't fail)
                send_email(user_email, subject, body)
                subscriber_count += 1
                
            except Exception as e:
                logging.error(f"Error sending notification to subscriber: {str(e)}")
                continue
        
        logging.info(f"Sent {subscriber_count} email notifications for reopened room {new_room_id}")
        
    except Exception as e:
        logging.error(f"Error in notify_subscribers_about_reopened_room: {str(e)}")
        # Don't raise - this is a non-critical background task

@prayer_room_bp.route('/reopen-room', methods=['POST'])
def reopen_room():
    """Reopen a previous room as a live session"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        original_room_id = data.get('original_room_id')
        
        if not original_room_id:
            return jsonify({'error': 'Original room ID is required'}), 400
        
        db = get_firestore_client()
        
        # Get the original room data
        original_room_ref = db.collection('prayer_rooms').document(original_room_id)
        original_room_doc = original_room_ref.get()
        
        if not original_room_doc.exists:
            return jsonify({'error': 'Original room not found'}), 404
        
        original_room_data = original_room_doc.to_dict()
        
        # Check if user is the original host
        if original_room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the original host can reopen rooms'}), 403
        
        # Generate new room ID
        new_room_id = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        
        # Create new room with same settings
        new_room_data = {
            'room_id': new_room_id,
            'room_name': original_room_data.get('room_name', 'Prayer Room'),
            'room_description': original_room_data.get('room_description', ''),
            'room_privacy': original_room_data.get('room_privacy', 'public'),
            'host_id': user['user_id'],
            'host_name': user['user_name'],
            'created_at': datetime.utcnow(),
            'last_activity': datetime.utcnow(),
            'participants': [{
                'user_id': user['user_id'],
                'user_name': user['user_name'],
                'joined_at': datetime.utcnow(),
                'is_muted': False,
                'is_host': True
            }],
            'is_active': True,
            'is_locked': False,
            'settings': {
                'allow_anonymous': original_room_data.get('room_privacy', 'public') == 'public',
                'max_participants': 50,
                'auto_mute_new_participants': False
            },
            'original_room_id': original_room_id  # Track the original room
        }
        
        # Generate room code for private rooms
        if new_room_data['room_privacy'] == 'private':
            new_room_data['room_code'] = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:8]])
        else:
            new_room_data['room_code'] = None
        
        # Deactivate any existing device sessions for this user across ALL rooms
        # This ensures users can only have one active session at a time
        # OPTIMIZED: Use collection group query for better performance
        try:
            sessions_query = db.collection_group('device_sessions')\
                .where('user_id', '==', user['user_id'])\
                .where('is_active', '==', True)\
                .limit(10)
            
            batch = db.batch()
            session_count = 0
            for session_doc in sessions_query.stream():
                batch.update(session_doc.reference, {
                    'is_active': False,
                    'ended_at': datetime.utcnow()
                })
                session_count += 1
            
            if session_count > 0:
                batch.commit()
                logging.info(f"Deactivated {session_count} existing session(s) for user {user['user_id']}")
        except Exception as e:
            logging.warning(f"Collection group query failed, using fallback: {e}")
            # Fallback: skip session deactivation if query fails
        
        # Save the new room
        db.collection('prayer_rooms').document(new_room_id).set(new_room_data)
        
        # Notify subscribers asynchronously (don't block room creation)
        try:
            notify_subscribers_about_reopened_room(
                original_room_id=original_room_id,
                new_room_id=new_room_id,
                room_name=new_room_data['room_name'],
                room_code=new_room_data.get('room_code'),
                host_name=user['user_name']
            )
        except Exception as notify_error:
            logging.error(f"Error sending notifications (non-blocking): {str(notify_error)}")
        
        return jsonify({
            'success': True,
            'room_id': new_room_id,
            'room_code': new_room_data.get('room_code'),
            'room_name': new_room_data['room_name']
        })
        
    except Exception as e:
        logging.error(f"Error reopening room: {str(e)}")
        return jsonify({'error': 'Failed to reopen room'}), 500

@prayer_room_bp.route('/<room_id>/subscribe', methods=['POST'])
def subscribe_to_room(room_id):
    """Subscribe to room notifications"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get room info
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        original_room_id = room_data.get('original_room_id', room_id)
        
        # Check if already subscribed
        existing_subs = db.collection('room_subscriptions')\
            .where('original_room_id', '==', original_room_id)\
            .where('user_id', '==', user['user_id'])\
            .where('is_active', '==', True)\
            .limit(1)\
            .stream()
        
        if list(existing_subs):
            return jsonify({'message': 'Already subscribed', 'subscribed': True}), 200
        
        # Create subscription
        subscription_data = {
            'room_id': room_id,
            'original_room_id': original_room_id,
            'user_id': user['user_id'],
            'user_email': user.get('email', ''),
            'user_name': user['user_name'],
            'room_name': room_data.get('room_name', 'Prayer Room'),
            'host_id': room_data.get('host_id'),
            'host_name': room_data.get('host_name'),
            'subscribed_at': datetime.utcnow(),
            'is_active': True,
            'notification_preferences': {
                'email': True,
                'push': False
            }
        }
        
        db.collection('room_subscriptions').add(subscription_data)
        
        logging.info(f"User {user['user_id']} subscribed to room {room_id}")
        
        return jsonify({
            'success': True,
            'message': 'Successfully subscribed to room notifications',
            'subscribed': True
        })
        
    except Exception as e:
        logging.error(f"Error subscribing to room: {str(e)}")
        return jsonify({'error': 'Failed to subscribe'}), 500

@prayer_room_bp.route('/<room_id>/unsubscribe', methods=['POST'])
def unsubscribe_from_room(room_id):
    """Unsubscribe from room notifications"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get room's original_room_id
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if room_doc.exists:
            original_room_id = room_doc.to_dict().get('original_room_id', room_id)
        else:
            original_room_id = room_id
        
        # Find and deactivate subscriptions
        subscriptions = db.collection('room_subscriptions')\
            .where('original_room_id', '==', original_room_id)\
            .where('user_id', '==', user['user_id'])\
            .where('is_active', '==', True)\
            .stream()
        
        unsubscribed_count = 0
        for sub_doc in subscriptions:
            sub_doc.reference.update({
                'is_active': False,
                'unsubscribed_at': datetime.utcnow()
            })
            unsubscribed_count += 1
        
        logging.info(f"User {user['user_id']} unsubscribed from room {room_id}")
        
        return jsonify({
            'success': True,
            'message': 'Successfully unsubscribed from room notifications',
            'subscribed': False
        })
        
    except Exception as e:
        logging.error(f"Error unsubscribing from room: {str(e)}")
        return jsonify({'error': 'Failed to unsubscribe'}), 500

@prayer_room_bp.route('/<room_id>/subscription-status', methods=['GET'])
def get_subscription_status(room_id):
    """Check if user is subscribed to room"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'subscribed': False})
        
        db = get_firestore_client()
        
        # Get room's original_room_id
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if room_doc.exists:
            original_room_id = room_doc.to_dict().get('original_room_id', room_id)
        else:
            original_room_id = room_id
        
        # Check if subscribed
        subscriptions = db.collection('room_subscriptions')\
            .where('original_room_id', '==', original_room_id)\
            .where('user_id', '==', user['user_id'])\
            .where('is_active', '==', True)\
            .limit(1)\
            .stream()
        
        subscribed = len(list(subscriptions)) > 0
        
        return jsonify({
            'subscribed': subscribed,
            'user_id': user['user_id']
        })
        
    except Exception as e:
        logging.error(f"Error checking subscription status: {str(e)}")
        return jsonify({'subscribed': False}), 500

@prayer_room_bp.route('/unsubscribe-link', methods=['GET'])
def unsubscribe_via_email_link():
    """Unsubscribe from room via email link (no auth required)"""
    try:
        sub_id = request.args.get('sub_id')
        
        if not sub_id:
            return "Invalid unsubscribe link", 400
        
        db = get_firestore_client()
        sub_ref = db.collection('room_subscriptions').document(sub_id)
        sub_doc = sub_ref.get()
        
        if not sub_doc.exists:
            return "Subscription not found", 404
        
        sub_data = sub_doc.to_dict()
        room_name = sub_data.get('room_name', 'Prayer Room')
        
        # Deactivate subscription
        sub_ref.update({
            'is_active': False,
            'unsubscribed_at': datetime.utcnow()
        })
        
        logging.info(f"User unsubscribed via email link: {sub_id}")
        
        # Return a simple HTML page
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Unsubscribed - Divine Bridge</title>
            <style>
                body {{
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                }}
                .container {{
                    background: white;
                    padding: 50px;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.1);
                    text-align: center;
                    max-width: 500px;
                }}
                h1 {{
                    color: #0f56ff;
                    margin-bottom: 20px;
                }}
                p {{
                    color: #666;
                    line-height: 1.6;
                    margin-bottom: 30px;
                }}
                .button {{
                    display: inline-block;
                    padding: 12px 30px;
                    background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 50px;
                    font-weight: 600;
                    margin-top: 20px;
                }}
                .emoji {{
                    font-size: 48px;
                    margin-bottom: 20px;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="emoji">✓</div>
                <h1>Unsubscribed Successfully</h1>
                <p>You've been unsubscribed from <strong>{room_name}</strong> notifications.</p>
                <p>You won't receive any more emails when this room reopens.</p>
                <p>If you change your mind, you can always resubscribe by joining the room and clicking the subscribe button.</p>
                <a href="/" class="button">Return to Divine Bridge</a>
            </div>
        </body>
        </html>
        """, 200
        
    except Exception as e:
        logging.error(f"Error unsubscribing via link: {str(e)}")
        return "An error occurred", 500

def create_active_room_from_scheduled(scheduled_data, scheduled_room_id):
    """
    Create an active prayer room from scheduled room data
    Returns the new room_id
    """
    try:
        db = get_firestore_client()
        
        # Generate new room ID
        room_id = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        
        # Create active room data
        room_data = {
            'room_id': room_id,
            'room_name': scheduled_data.get('room_name', 'Prayer Room'),
            'room_description': scheduled_data.get('room_description', ''),
            'room_privacy': scheduled_data.get('room_privacy', 'public'),
            'room_code': scheduled_data.get('room_code'),
            'host_id': scheduled_data['host_id'],
            'host_name': scheduled_data['host_name'],
            'created_at': datetime.utcnow(),
            'last_activity': datetime.utcnow(),
            'participants': [{
                'user_id': scheduled_data['host_id'],
                'user_name': scheduled_data['host_name'],
                'joined_at': datetime.utcnow(),
                'is_muted': False,
                'is_host': True
            }],
            'is_active': True,
            'is_locked': False,
            'scheduled_room_id': scheduled_room_id,  # Link back to scheduled room
            'settings': {
                'allow_anonymous': scheduled_data.get('room_privacy', 'public') == 'public',
                'max_participants': 50,
                'auto_mute_new_participants': False
            }
        }
        
        # Save the active room
        db.collection('prayer_rooms').document(room_id).set(room_data)
        
        logging.info(f"Created active room {room_id} from scheduled room {scheduled_room_id}")
        
        return room_id
        
    except Exception as e:
        logging.error(f"Error creating active room from scheduled: {str(e)}")
        raise

def send_session_live_notifications(scheduled_data, room_id, scheduled_room_id):
    """
    Send email notifications that scheduled session is now live
    """
    try:
        room_name = scheduled_data.get('room_name', 'Prayer Room')
        host_name = scheduled_data.get('host_name', 'Host')
        room_code = scheduled_data.get('room_code')
        base_url = request.url_root.rstrip('/')
        
        # Build join URL
        join_url = f"{base_url}/prayer-room/join?room={room_id}"
        if room_code:
            join_url += f"&code={room_code}"
        
        # Send notification to host
        host_id = scheduled_data.get('host_id')
        if host_id:
            # Get host email from Firebase Auth
            try:
                import firebase_admin.auth
                host_user = firebase_admin.auth.get_user(host_id)
                host_email = host_user.email
                
                if host_email:
                    subject = f"🙏 {room_name} is Now Live!"
                    body = f"""
                    <html>
                    <head>
                        <style>
                            body {{
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                line-height: 1.6;
                                color: #333;
                                max-width: 600px;
                                margin: 0 auto;
                            }}
                            .header {{
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                padding: 30px;
                                text-align: center;
                                color: white;
                            }}
                            .content {{
                                padding: 30px;
                                background: #f8f9fa;
                            }}
                            .card {{
                                background: white;
                                border-radius: 10px;
                                padding: 25px;
                                margin: 20px 0;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }}
                            .button {{
                                display: inline-block;
                                padding: 15px 40px;
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                color: white !important;
                                text-decoration: none;
                                border-radius: 50px;
                                font-weight: 600;
                                font-size: 18px;
                                margin: 20px 0;
                            }}
                            .room-code {{
                                background: rgba(15, 86, 255, 0.1);
                                color: #0f56ff;
                                padding: 15px;
                                border-radius: 8px;
                                text-align: center;
                                font-size: 24px;
                                font-weight: bold;
                                letter-spacing: 3px;
                                margin: 15px 0;
                            }}
                            .footer {{
                                padding: 20px;
                                text-align: center;
                                color: #666;
                                font-size: 14px;
                            }}
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>🙏 Your Prayer Session is Live!</h1>
                        </div>
                        <div class="content">
                            <div class="card">
                                <h2>Hello {host_name}!</h2>
                                <p>Your scheduled prayer session <strong>{room_name}</strong> is now active and ready for participants.</p>
                                
                                {"<div class='room-code'>Room Code: " + room_code + "</div>" if room_code else ""}
                                
                                <div style="text-align: center;">
                                    <a href="{join_url}" class="button">
                                        Join Your Room Now
                                    </a>
                                </div>
                                
                                <p style="margin-top: 20px; color: #666; font-size: 14px;">
                                    Your participants will be notified that the session is live.
                                </p>
                                
                                <p style="color: #666; font-size: 14px;">
                                    🌟 <em>"For where two or three gather in my name, there am I with them." - Matthew 18:20</em>
                                </p>
                            </div>
                        </div>
                        <div class="footer">
                            <p>Divine Bridge - Connecting Hearts in Prayer</p>
                        </div>
                    </body>
                    </html>
                    """
                    
                    send_email(host_email, subject, body)
                    logging.info(f"Sent session live notification to host {host_email}")
                    
            except Exception as e:
                logging.error(f"Error sending notification to host: {str(e)}")
        
        # Notify RSVPed participants
        try:
            db = get_firestore_client()
            rsvps = db.collection('scheduled_room_rsvps')\
                .where('scheduled_room_id', '==', scheduled_room_id)\
                .where('is_active', '==', True)\
                .stream()
            
            for rsvp_doc in rsvps:
                rsvp_data = rsvp_doc.to_dict()
                
                # Skip if user doesn't want live notifications
                if not rsvp_data.get('reminder_preferences', {}).get('email_live', True):
                    continue
                
                user_email = rsvp_data.get('user_email')
                user_name = rsvp_data.get('user_name', 'Prayer Partner')
                rsvp_status = rsvp_data.get('rsvp_status', 'interested')
                
                if user_email:
                    subject = f"🙏 {room_name} is Live Now!"
                    body = f"""
                    <html>
                    <head>
                        <style>
                            body {{
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                line-height: 1.6;
                                color: #333;
                                max-width: 600px;
                                margin: 0 auto;
                            }}
                            .header {{
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                padding: 30px;
                                text-align: center;
                                color: white;
                            }}
                            .content {{
                                padding: 30px;
                                background: #f8f9fa;
                            }}
                            .card {{
                                background: white;
                                border-radius: 10px;
                                padding: 25px;
                                margin: 20px 0;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            }}
                            .button {{
                                display: inline-block;
                                padding: 15px 40px;
                                background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                color: white !important;
                                text-decoration: none;
                                border-radius: 50px;
                                font-weight: 600;
                                font-size: 18px;
                                margin: 20px 0;
                            }}
                            .badge {{
                                display: inline-block;
                                padding: 8px 16px;
                                background: rgba(15, 86, 255, 0.1);
                                color: #0f56ff;
                                border-radius: 20px;
                                font-size: 14px;
                                font-weight: 600;
                                margin: 10px 0;
                            }}
                            .footer {{
                                padding: 20px;
                                text-align: center;
                                color: #666;
                                font-size: 14px;
                            }}
                            .unsubscribe {{
                                font-size: 12px;
                                color: #999;
                                margin-top: 20px;
                            }}
                        </style>
                    </head>
                    <body>
                        <div class="header">
                            <h1>🙏 Your Prayer Session is Live!</h1>
                        </div>
                        <div class="content">
                            <div class="card">
                                <h2>Hello {user_name}!</h2>
                                <p>The prayer session you RSVPed to is now live and ready to join.</p>
                                
                                <div style="margin: 20px 0;">
                                    <strong style="font-size: 20px; color: #0f56ff;">{room_name}</strong><br>
                                    <span style="color: #666;">Hosted by {host_name}</span>
                                </div>
                                
                                <div class="badge">Your Status: {rsvp_status.title()}</div>
                                
                                <div style="text-align: center;">
                                    <a href="{join_url}" class="button">
                                        Join the Room Now
                                    </a>
                                </div>
                                
                                <p style="margin-top: 20px; color: #666; font-size: 14px;">
                                    Don't keep your prayer partners waiting! Click the button above to join the session.
                                </p>
                                
                                <p style="color: #666; font-size: 14px;">
                                    🌟 <em>"For where two or three gather in my name, there am I with them." - Matthew 18:20</em>
                                </p>
                            </div>
                        </div>
                        <div class="footer">
                            <p>Divine Bridge - Connecting Hearts in Prayer</p>
                            <p class="unsubscribe">
                                You received this email because you RSVPed to this prayer session.
                            </p>
                        </div>
                    </body>
                    </html>
                    """
                    
                    send_email(user_email, subject, body)
                    logging.info(f"Sent session live notification to RSVPed user {user_email}")
                    
        except Exception as rsvp_notify_error:
            logging.error(f"Error notifying RSVPed participants (non-blocking): {str(rsvp_notify_error)}")
        
    except Exception as e:
        logging.error(f"Error in send_session_live_notifications: {str(e)}")
        # Don't raise - this is a non-critical background task

@prayer_room_bp.route('/send-session-reminders', methods=['POST'])
@verify_cloud_scheduler()
def send_session_reminders():
    """
    Send reminder emails to RSVPed users for sessions starting in 1 hour
    Triggered by Cloud Scheduler every 15 minutes
    Protected by Cloud Scheduler verification
    """
    try:
        import firebase_admin.auth
        
        db = get_firestore_client()
        now = datetime.utcnow()
        
        # Find sessions starting in approximately 1 hour (55-65 minutes from now)
        one_hour_from_now = now + timedelta(hours=1)
        window_start = one_hour_from_now - timedelta(minutes=5)
        window_end = one_hour_from_now + timedelta(minutes=5)
        
        logging.info(f"Checking for sessions starting between {window_start} and {window_end}")
        
        scheduled_rooms = db.collection('scheduled_rooms')\
            .where('status', '==', 'scheduled')\
            .where('scheduled_time', '>=', window_start)\
            .where('scheduled_time', '<=', window_end)\
            .stream()
        
        reminded_count = 0
        errors = []
        
        for scheduled_doc in scheduled_rooms:
            try:
                scheduled_data = scheduled_doc.to_dict()
                scheduled_room_id = scheduled_doc.id
                room_name = scheduled_data.get('room_name', 'Prayer Room')
                host_name = scheduled_data.get('host_name', 'Host')
                scheduled_time = scheduled_data.get('scheduled_time')
                room_code = scheduled_data.get('room_code')
                base_url = request.url_root.rstrip('/')
                
                # Check if we already sent reminders for this session
                if scheduled_data.get('reminders_sent'):
                    logging.info(f"Reminders already sent for {scheduled_room_id}")
                    continue
                
                # Build join URL (will work when room activates)
                join_url = f"{base_url}/prayer-room"
                
                # Get all RSVPs
                rsvps = db.collection('scheduled_room_rsvps')\
                    .where('scheduled_room_id', '==', scheduled_room_id)\
                    .where('is_active', '==', True)\
                    .stream()
                
                email_count = 0
                for rsvp_doc in rsvps:
                    rsvp_data = rsvp_doc.to_dict()
                    
                    # Skip if user doesn't want 1-hour reminders
                    if not rsvp_data.get('reminder_preferences', {}).get('email_1hour', True):
                        continue
                    
                    user_email = rsvp_data.get('user_email')
                    user_name = rsvp_data.get('user_name', 'Prayer Partner')
                    rsvp_status = rsvp_data.get('rsvp_status', 'interested')
                    
                    if user_email:
                        subject = f"⏰ Reminder: {room_name} starts in 1 hour"
                        
                        time_display = scheduled_time.strftime('%I:%M %p') if hasattr(scheduled_time, 'strftime') else 'soon'
                        
                        body = f"""
                        <html>
                        <head>
                            <style>
                                body {{
                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                    line-height: 1.6;
                                    color: #333;
                                    max-width: 600px;
                                    margin: 0 auto;
                                }}
                                .header {{
                                    background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                    padding: 30px;
                                    text-align: center;
                                    color: white;
                                }}
                                .content {{
                                    padding: 30px;
                                    background: #f8f9fa;
                                }}
                                .card {{
                                    background: white;
                                    border-radius: 10px;
                                    padding: 25px;
                                    margin: 20px 0;
                                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                                }}
                                .button {{
                                    display: inline-block;
                                    padding: 15px 40px;
                                    background: linear-gradient(135deg, #0f56ff 0%, #1f3c88 100%);
                                    color: white !important;
                                    text-decoration: none;
                                    border-radius: 50px;
                                    font-weight: 600;
                                    font-size: 18px;
                                    margin: 20px 0;
                                }}
                                .time-badge {{
                                    display: inline-block;
                                    padding: 12px 20px;
                                    background: rgba(15, 86, 255, 0.1);
                                    color: #0f56ff;
                                    border-radius: 10px;
                                    font-size: 24px;
                                    font-weight: 700;
                                    margin: 15px 0;
                                }}
                                .status-badge {{
                                    display: inline-block;
                                    padding: 8px 16px;
                                    background: rgba(16, 185, 129, 0.1);
                                    color: #10b981;
                                    border-radius: 20px;
                                    font-size: 14px;
                                    font-weight: 600;
                                    margin: 10px 0;
                                }}
                                .footer {{
                                    padding: 20px;
                                    text-align: center;
                                    color: #666;
                                    font-size: 14px;
                                }}
                            </style>
                        </head>
                        <body>
                            <div class="header">
                                <h1>⏰ Starting Soon!</h1>
                            </div>
                            <div class="content">
                                <div class="card">
                                    <h2>Hello {user_name}!</h2>
                                    <p>Your prayer session is starting in about <strong>1 hour</strong>.</p>
                                    
                                    <div style="margin: 20px 0; text-align: center;">
                                        <strong style="font-size: 20px; color: #0f56ff;">{room_name}</strong><br>
                                        <span style="color: #666;">Hosted by {host_name}</span>
                                        <div class="time-badge">⏰ {time_display}</div>
                                        <div class="status-badge">✓ You're {rsvp_status.title()}</div>
                                    </div>
                                    
                                    <p style="text-align: center; color: #666;">
                                        Get ready to join! The room will be available at the scheduled time.
                                    </p>
                                    
                                    <div style="text-align: center;">
                                        <a href="{join_url}" class="button">
                                            View Prayer Rooms
                                        </a>
                                    </div>
                                    
                                    <p style="margin-top: 20px; color: #666; font-size: 14px; text-align: center;">
                                        We'll send you another notification when the session goes live.
                                    </p>
                                    
                                    <p style="color: #666; font-size: 14px; text-align: center;">
                                        🌟 <em>"Be joyful in hope, patient in affliction, faithful in prayer." - Romans 12:12</em>
                                    </p>
                                </div>
                            </div>
                            <div class="footer">
                                <p>Divine Bridge - Connecting Hearts in Prayer</p>
                            </div>
                        </body>
                        </html>
                        """
                        
                        send_email(user_email, subject, body)
                        email_count += 1
                        logging.info(f"Sent 1-hour reminder to {user_email} for session {scheduled_room_id}")
                
                # Mark this session as having reminders sent
                scheduled_doc.reference.update({
                    'reminders_sent': True,
                    'reminders_sent_at': now
                })
                
                if email_count > 0:
                    reminded_count += 1
                    logging.info(f"Sent {email_count} reminder emails for session {scheduled_room_id}")
                
            except Exception as session_error:
                error_msg = f"Error sending reminders for session {scheduled_doc.id}: {str(session_error)}"
                logging.error(error_msg)
                errors.append(error_msg)
                continue
        
        result = {
            'success': True,
            'timestamp': now.isoformat(),
            'sessions_reminded': reminded_count
        }
        
        if errors:
            result['errors'] = errors
        
        logging.info(f"Reminder check complete: {reminded_count} sessions processed")
        
        return jsonify(result), 200
        
    except Exception as e:
        logging.error(f"Error in send_session_reminders: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@prayer_room_bp.route('/activate-scheduled-rooms', methods=['POST'])
@verify_cloud_scheduler()
def activate_scheduled_rooms():
    """
    Check for scheduled rooms whose time has arrived and activate them
    Triggered by Cloud Scheduler every 5 minutes
    Protected by Cloud Scheduler verification
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()
        
        logging.info(f"Checking for scheduled rooms to activate at {now}")
        
        # Find scheduled rooms whose time has arrived (within last 10 minutes)
        # We check a 10-minute window to catch any that might have been missed
        ten_minutes_ago = now - timedelta(minutes=10)
        
        scheduled_rooms = db.collection('scheduled_rooms')\
            .where('status', '==', 'scheduled')\
            .where('scheduled_time', '<=', now)\
            .where('scheduled_time', '>=', ten_minutes_ago)\
            .stream()
        
        activated_count = 0
        errors = []
        
        for scheduled_doc in scheduled_rooms:
            try:
                scheduled_data = scheduled_doc.to_dict()
                scheduled_room_id = scheduled_doc.id
                room_name = scheduled_data.get('room_name', 'Prayer Room')
                
                logging.info(f"Activating scheduled room: {scheduled_room_id} - {room_name}")
                
                # Create active room
                room_id = create_active_room_from_scheduled(scheduled_data, scheduled_room_id)
                
                # Update scheduled room status
                scheduled_doc.reference.update({
                    'status': 'active',
                    'activated_at': now,
                    'active_room_id': room_id
                })
                
                # Send notifications (non-blocking)
                try:
                    send_session_live_notifications(scheduled_data, room_id, scheduled_room_id)
                except Exception as notify_error:
                    logging.error(f"Error sending notifications (non-blocking): {str(notify_error)}")
                
                activated_count += 1
                logging.info(f"Successfully activated {room_name} as room {room_id}")
                
            except Exception as room_error:
                error_msg = f"Error activating room {scheduled_doc.id}: {str(room_error)}"
                logging.error(error_msg)
                errors.append(error_msg)
                continue
        
        result = {
            'success': True,
            'timestamp': now.isoformat(),
            'activated_count': activated_count,
            'checked_rooms': activated_count + len(errors)
        }
        
        if errors:
            result['errors'] = errors
        
        logging.info(f"Activation check complete: {activated_count} rooms activated")
        
        return jsonify(result), 200
        
    except Exception as e:
        logging.error(f"Error in activate_scheduled_rooms: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@prayer_room_bp.route('/generate-recurring-instances', methods=['POST'])
@verify_cloud_scheduler()
def generate_recurring_instances():
    """
    Generate next instances of recurring sessions
    Triggered by Cloud Scheduler daily
    Protected by Cloud Scheduler verification
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()
        
        # Look ahead 7 days
        look_ahead_days = 7
        check_until = now + timedelta(days=look_ahead_days)
        
        logging.info(f"Generating recurring instances up to {check_until}")
        
        # Find all recurring sessions (both scheduled and active)
        # We need to check both statuses because:
        # - "scheduled" = not yet activated
        # - "active" = currently live (but still need to generate future instances)
        all_recurring = []
        
        # Get scheduled recurring sessions
        scheduled_recurring = db.collection('scheduled_rooms')\
            .where('is_recurring', '==', True)\
            .where('status', '==', 'scheduled')\
            .stream()
        all_recurring.extend(list(scheduled_recurring))
        
        # Get active recurring sessions (parent sessions that are currently live)
        active_recurring = db.collection('scheduled_rooms')\
            .where('is_recurring', '==', True)\
            .where('status', '==', 'active')\
            .stream()
        all_recurring.extend(list(active_recurring))
        
        logging.info(f"Found {len(all_recurring)} recurring sessions (scheduled + active)")
        
        recurring_sessions = all_recurring
        
        generated_count = 0
        errors = []
        
        for rec_doc in recurring_sessions:
            try:
                rec_data = rec_doc.to_dict()
                rec_id = rec_doc.id
                
                recurrence_pattern = rec_data.get('recurrence_pattern')
                recurrence_end_date = rec_data.get('recurrence_end_date')
                last_generated_time = rec_data.get('last_generated_time', rec_data.get('scheduled_time'))
                recurrence_days = rec_data.get('recurrence_days', [])
                
                # Normalize datetimes (remove timezone info for comparison)
                if hasattr(recurrence_end_date, 'replace') and recurrence_end_date.tzinfo:
                    recurrence_end_date = recurrence_end_date.replace(tzinfo=None)
                
                # Stop if we've passed the end date
                if recurrence_end_date and now > recurrence_end_date:
                    logging.info(f"Recurring session {rec_id} has ended, skipping")
                    continue
                
                # Calculate next instance times
                next_times = []
                
                # Ensure current_check is a naive datetime for comparison
                if isinstance(last_generated_time, datetime):
                    current_check = last_generated_time.replace(tzinfo=None) if last_generated_time.tzinfo else last_generated_time
                elif hasattr(last_generated_time, 'replace'):
                    # Firestore timestamp
                    current_check = last_generated_time.replace(tzinfo=None) if hasattr(last_generated_time, 'tzinfo') and last_generated_time.tzinfo else last_generated_time
                else:
                    current_check = last_generated_time
                
                if recurrence_pattern == 'weekly':
                    # Generate instances for next 7 days
                    for day in range(1, look_ahead_days + 1):
                        next_time = current_check + timedelta(days=day)
                        
                        # Check if this day of week matches recurrence_days
                        if not recurrence_days or next_time.weekday() in recurrence_days:
                            # Ensure check_until is naive for comparison
                            check_until_naive = check_until.replace(tzinfo=None) if check_until.tzinfo else check_until
                            recurrence_end_naive = recurrence_end_date.replace(tzinfo=None) if recurrence_end_date and hasattr(recurrence_end_date, 'tzinfo') and recurrence_end_date.tzinfo else recurrence_end_date
                            
                            if next_time <= check_until_naive and (not recurrence_end_naive or next_time <= recurrence_end_naive):
                                # Check if instance doesn't already exist
                                existing = db.collection('scheduled_rooms')\
                                    .where('parent_recurring_id', '==', rec_id)\
                                    .where('scheduled_time', '==', next_time)\
                                    .limit(1)\
                                    .stream()
                                
                                if not list(existing):
                                    next_times.append(next_time)
                
                elif recurrence_pattern == 'biweekly':
                    # Every 2 weeks
                    next_time = current_check + timedelta(weeks=2)
                    while next_time <= check_until and (not recurrence_end_date or next_time <= recurrence_end_date):
                        existing = db.collection('scheduled_rooms')\
                            .where('parent_recurring_id', '==', rec_id)\
                            .where('scheduled_time', '==', next_time)\
                            .limit(1)\
                            .stream()
                        
                        if not list(existing):
                            next_times.append(next_time)
                        next_time += timedelta(weeks=2)
                
                elif recurrence_pattern == 'monthly':
                    # Same day each month
                    next_time = current_check
                    for month in range(1, 4):  # Look ahead 3 months
                        # Add one month
                        if next_time.month == 12:
                            next_time = next_time.replace(year=next_time.year + 1, month=1)
                        else:
                            next_month = next_time.month + 1
                            # Handle day not existing in next month (e.g., Jan 31 -> Feb 28)
                            try:
                                next_time = next_time.replace(month=next_month)
                            except ValueError:
                                # Day doesn't exist, use last day of month
                                if next_month == 2:
                                    next_time = next_time.replace(month=2, day=28)
                                else:
                                    next_time = next_time.replace(month=next_month, day=30)
                        
                        if next_time <= check_until and (not recurrence_end_date or next_time <= recurrence_end_date):
                            existing = db.collection('scheduled_rooms')\
                                .where('parent_recurring_id', '==', rec_id)\
                                .where('scheduled_time', '==', next_time)\
                                .limit(1)\
                                .stream()
                            
                            if not list(existing):
                                next_times.append(next_time)
                
                # Create instances
                for next_time in next_times:
                    instance_data = {
                        'room_name': rec_data['room_name'],
                        'room_description': rec_data.get('room_description', ''),
                        'room_privacy': rec_data.get('room_privacy', 'public'),
                        'room_code': rec_data.get('room_code'),
                        'host_id': rec_data['host_id'],
                        'host_name': rec_data['host_name'],
                        'scheduled_time': next_time,
                        'created_at': now,
                        'status': 'scheduled',
                        'is_recurring': False,  # This is an instance, not the template
                        'parent_recurring_id': rec_id,  # Link back to recurring template
                        'is_recurring_instance': True
                    }
                    
                    db.collection('scheduled_rooms').add(instance_data)
                    generated_count += 1
                    logging.info(f"Generated instance for {rec_data['room_name']} at {next_time}")
                
                # Update last_generated_time
                if next_times:
                    rec_doc.reference.update({
                        'last_generated_time': max(next_times)
                    })
                
            except Exception as session_error:
                error_msg = f"Error generating instances for session {rec_doc.id}: {str(session_error)}"
                logging.error(error_msg)
                errors.append(error_msg)
                continue
        
        result = {
            'success': True,
            'timestamp': now.isoformat(),
            'instances_generated': generated_count
        }
        
        if errors:
            result['errors'] = errors
        
        logging.info(f"Recurring instance generation complete: {generated_count} instances created")
        
        return jsonify(result), 200
        
    except Exception as e:
        logging.error(f"Error in generate_recurring_instances: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500

@prayer_room_bp.route('/public-scheduled-sessions', methods=['GET'])
def get_public_scheduled_sessions():
    """
    Get all upcoming public scheduled sessions
    Available to all users (no auth required)
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()
        
        # Get query parameters
        time_filter = request.args.get('time', 'all')  # today, tomorrow, week, all
        limit = int(request.args.get('limit', 20))
        sort_by = request.args.get('sort', 'soonest')  # soonest, popular
        
        logging.info(f"Fetching public scheduled sessions - filter: {time_filter}, sort: {sort_by}, limit: {limit}")
        
        # Base query - only scheduled (not active/completed), only public
        # Note: This requires a composite index: status, room_privacy, scheduled_time
        try:
            query = db.collection('scheduled_rooms')\
                .where('status', '==', 'scheduled')\
                .where('room_privacy', '==', 'public')\
                .where('scheduled_time', '>=', now)
        except Exception as query_error:
            logging.error(f"Firestore query error (may need composite index): {str(query_error)}")
            # Fallback: Query without scheduled_time filter, filter in Python
            query = db.collection('scheduled_rooms')\
                .where('status', '==', 'scheduled')\
                .where('room_privacy', '==', 'public')
        
        # Get all matching sessions
        sessions = []
        recurring_parents = {}  # Track recurring parent sessions
        
        for doc in query.stream():
            session_data = doc.to_dict()
            session_data['scheduled_room_id'] = doc.id
            
            # Check if this is a child instance of a recurring session
            parent_recurring_id = session_data.get('parent_recurring_id')
            if parent_recurring_id:
                # This is a child instance - convert timestamp before storing
                scheduled_time_obj = session_data.get('scheduled_time')
                scheduled_timestamp = None
                
                if scheduled_time_obj:
                    if hasattr(scheduled_time_obj, 'timestamp'):
                        # Firestore timestamp
                        scheduled_timestamp = scheduled_time_obj.timestamp()
                    elif isinstance(scheduled_time_obj, datetime):
                        # Python datetime
                        if scheduled_time_obj.tzinfo is None:
                            # Naive datetime - assume UTC
                            scheduled_timestamp = (scheduled_time_obj - datetime(1970, 1, 1)).total_seconds()
                        else:
                            scheduled_timestamp = scheduled_time_obj.timestamp()
                    elif isinstance(scheduled_time_obj, (int, float)):
                        # Already a number
                        scheduled_timestamp = scheduled_time_obj
                
                session_data['scheduled_time'] = scheduled_timestamp
                session_data['scheduled_room_id'] = doc.id
                
                # This is a child instance - skip it, we'll show the parent instead
                if parent_recurring_id not in recurring_parents:
                    # Fetch the parent recurring session
                    parent_doc = db.collection('scheduled_rooms').document(parent_recurring_id).get()
                    if parent_doc.exists:
                        recurring_parents[parent_recurring_id] = {
                            'doc': parent_doc,
                            'instances': []
                        }
                
                # Add this instance to the parent's instances list
                if parent_recurring_id in recurring_parents:
                    recurring_parents[parent_recurring_id]['instances'].append(session_data)
                continue  # Skip adding this instance to sessions
            
            session_data['scheduled_room_id'] = doc.id
            
            # Convert timestamp to seconds (Unix timestamp) for JSON
            scheduled_time_obj = session_data.get('scheduled_time')
            scheduled_timestamp = None
            
            if scheduled_time_obj:
                if hasattr(scheduled_time_obj, 'timestamp'):
                    # Firestore timestamp
                    scheduled_timestamp = scheduled_time_obj.timestamp()
                elif isinstance(scheduled_time_obj, datetime):
                    # Python datetime
                    from datetime import timezone
                    if scheduled_time_obj.tzinfo is None:
                        # Naive datetime - assume UTC
                        scheduled_timestamp = (scheduled_time_obj - datetime(1970, 1, 1)).total_seconds()
                    else:
                        scheduled_timestamp = scheduled_time_obj.timestamp()
                elif isinstance(scheduled_time_obj, (int, float)):
                    # Already a number (timestamp)
                    scheduled_timestamp = scheduled_time_obj
                
                # Filter out past sessions if query didn't filter by time
                if scheduled_timestamp and scheduled_timestamp < now.timestamp():
                    continue
                
                session_data['scheduled_time'] = scheduled_timestamp
            
            if hasattr(session_data.get('created_at'), 'timestamp'):
                session_data['created_at'] = session_data['created_at'].timestamp()
            
            # Get RSVP count for this session
            rsvp_count = db.collection('scheduled_room_rsvps')\
                .where('scheduled_room_id', '==', doc.id)\
                .where('is_active', '==', True)\
                .stream()
            
            rsvp_stats = {'going': 0, 'maybe': 0, 'interested': 0}
            for rsvp_doc in rsvp_count:
                rsvp_data = rsvp_doc.to_dict()
                status = rsvp_data.get('rsvp_status', 'interested')
                rsvp_stats[status] = rsvp_stats.get(status, 0) + 1
            
            session_data['rsvp_count'] = rsvp_stats
            session_data['total_rsvps'] = sum(rsvp_stats.values())
            
            # Check if current user has RSVPed
            user = get_user_from_session()
            if user:
                user_rsvp = db.collection('scheduled_room_rsvps')\
                    .where('scheduled_room_id', '==', doc.id)\
                    .where('user_id', '==', user['user_id'])\
                    .where('is_active', '==', True)\
                    .limit(1)\
                    .stream()
                
                user_rsvp_list = list(user_rsvp)
                if user_rsvp_list:
                    session_data['user_rsvp_status'] = user_rsvp_list[0].to_dict().get('rsvp_status')
                else:
                    session_data['user_rsvp_status'] = None
            else:
                session_data['user_rsvp_status'] = None
            
            sessions.append(session_data)
        
        # Add recurring parent sessions with their instances
        for parent_id, parent_info in recurring_parents.items():
            parent_doc = parent_info['doc']
            parent_data = parent_doc.to_dict()
            instances = parent_info['instances']
            
            if not instances:
                continue  # No instances, skip
            
            # Sort instances by time
            instances.sort(key=lambda x: x.get('scheduled_time', 0))
            
            # Get the next (soonest) instance time
            next_instance = instances[0]
            next_instance_time = next_instance.get('scheduled_time')
            
            # Convert parent session data
            parent_session = {
                'scheduled_room_id': parent_id,
                'room_name': parent_data.get('room_name'),
                'room_description': parent_data.get('room_description'),
                'host_name': parent_data.get('host_name'),
                'host_id': parent_data.get('host_id'),
                'room_privacy': parent_data.get('room_privacy'),
                'is_recurring': True,
                'recurrence_pattern': parent_data.get('recurrence_pattern'),
                'recurrence_days': parent_data.get('recurrence_days', []),
                'scheduled_time': next_instance_time,  # Use next instance time for sorting
                'instance_count': len(instances),
                'instances': [{'scheduled_time': inst.get('scheduled_time'), 'scheduled_room_id': inst.get('scheduled_room_id')} for inst in instances]
            }
            
            # Get RSVP count across all instances
            total_rsvps = 0
            for instance in instances:
                instance_id = instance.get('scheduled_room_id')
                if instance_id:
                    rsvp_count = db.collection('scheduled_room_rsvps')\
                        .where('scheduled_room_id', '==', instance_id)\
                        .where('is_active', '==', True)\
                        .stream()
                    total_rsvps += len(list(rsvp_count))
            
            parent_session['total_rsvps'] = total_rsvps
            parent_session['rsvp_count'] = {'going': 0, 'maybe': 0, 'interested': total_rsvps}
            
            # Check if current user has RSVPed to any instance
            user = get_user_from_session()
            if user:
                user_rsvp_status = None
                for instance in instances:
                    instance_id = instance.get('scheduled_room_id')
                    if instance_id:
                        user_rsvp = db.collection('scheduled_room_rsvps')\
                            .where('scheduled_room_id', '==', instance_id)\
                            .where('user_id', '==', user['user_id'])\
                            .where('is_active', '==', True)\
                            .limit(1)\
                            .stream()
                        
                        user_rsvp_list = list(user_rsvp)
                        if user_rsvp_list:
                            user_rsvp_status = user_rsvp_list[0].to_dict().get('rsvp_status')
                            break
                
                parent_session['user_rsvp_status'] = user_rsvp_status
            else:
                parent_session['user_rsvp_status'] = None
            
            sessions.append(parent_session)
        
        # Apply time filter
        if time_filter == 'today':
            end_of_today = datetime.utcnow().replace(hour=23, minute=59, second=59)
            sessions = [s for s in sessions if s['scheduled_time'] <= end_of_today.timestamp()]
        elif time_filter == 'tomorrow':
            start_of_tomorrow = (datetime.utcnow() + timedelta(days=1)).replace(hour=0, minute=0, second=0)
            end_of_tomorrow = start_of_tomorrow.replace(hour=23, minute=59, second=59)
            sessions = [s for s in sessions if start_of_tomorrow.timestamp() <= s['scheduled_time'] <= end_of_tomorrow.timestamp()]
        elif time_filter == 'week':
            end_of_week = datetime.utcnow() + timedelta(days=7)
            sessions = [s for s in sessions if s['scheduled_time'] <= end_of_week.timestamp()]
        
        # Sort
        if sort_by == 'popular':
            sessions.sort(key=lambda x: x['total_rsvps'], reverse=True)
        else:  # soonest
            sessions.sort(key=lambda x: x['scheduled_time'])
        
        # Apply limit
        sessions = sessions[:limit]
        
        return jsonify({
            'success': True,
            'sessions': sessions,
            'total': len(sessions),
            'filters': {
                'time': time_filter,
                'sort': sort_by
            }
        })
        
    except Exception as e:
        logging.error(f"Error getting public scheduled sessions: {str(e)}")
        return jsonify({'error': 'Failed to get sessions'}), 500

@prayer_room_bp.route('/scheduled-session/<scheduled_room_id>/rsvp', methods=['POST'])
def rsvp_to_scheduled_session(scheduled_room_id):
    """RSVP to a scheduled session"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json() or {}
        rsvp_status = data.get('rsvp_status', 'interested')  # going, maybe, interested
        
        # Validate RSVP status
        if rsvp_status not in ['going', 'maybe', 'interested']:
            return jsonify({'error': 'Invalid RSVP status'}), 400
        
        db = get_firestore_client()
        
        # Get the scheduled room
        scheduled_room_ref = db.collection('scheduled_rooms').document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()
        
        if not scheduled_room_doc.exists:
            return jsonify({'error': 'Scheduled session not found'}), 404
        
        scheduled_data = scheduled_room_doc.to_dict()
        
        # Check if already RSVPed
        existing_rsvp = db.collection('scheduled_room_rsvps')\
            .where('scheduled_room_id', '==', scheduled_room_id)\
            .where('user_id', '==', user['user_id'])\
            .limit(1)\
            .stream()
        
        existing_rsvp_list = list(existing_rsvp)
        
        if existing_rsvp_list:
            # Update existing RSVP
            existing_rsvp_list[0].reference.update({
                'rsvp_status': rsvp_status,
                'updated_at': datetime.utcnow(),
                'is_active': True
            })
            logging.info(f"Updated RSVP for user {user['user_id']} to session {scheduled_room_id}")
        else:
            # Create new RSVP
            rsvp_data = {
                'scheduled_room_id': scheduled_room_id,
                'user_id': user['user_id'],
                'user_email': user.get('email', ''),
                'user_name': user['user_name'],
                'room_name': scheduled_data.get('room_name'),
                'rsvp_status': rsvp_status,
                'rsvp_at': datetime.utcnow(),
                'is_active': True,
                'reminder_preferences': {
                    'email_1hour': data.get('reminder_1hour', True),
                    'email_live': data.get('reminder_live', True)
                }
            }
            
            db.collection('scheduled_room_rsvps').add(rsvp_data)
            logging.info(f"Created RSVP for user {user['user_id']} to session {scheduled_room_id}")
        
        # Get updated RSVP counts
        rsvp_count = db.collection('scheduled_room_rsvps')\
            .where('scheduled_room_id', '==', scheduled_room_id)\
            .where('is_active', '==', True)\
            .stream()
        
        rsvp_stats = {'going': 0, 'maybe': 0, 'interested': 0}
        for rsvp_doc in rsvp_count:
            rsvp_data = rsvp_doc.to_dict()
            status = rsvp_data.get('rsvp_status', 'interested')
            rsvp_stats[status] = rsvp_stats.get(status, 0) + 1
        
        return jsonify({
            'success': True,
            'message': 'RSVP confirmed',
            'rsvp_status': rsvp_status,
            'rsvp_count': rsvp_stats,
            'total_rsvps': sum(rsvp_stats.values())
        })
        
    except Exception as e:
        logging.error(f"Error creating RSVP: {str(e)}")
        return jsonify({'error': 'Failed to RSVP'}), 500

@prayer_room_bp.route('/scheduled-session/<scheduled_room_id>/rsvp', methods=['DELETE'])
def remove_rsvp_from_scheduled_session(scheduled_room_id):
    """Remove RSVP from a scheduled session"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Find and deactivate RSVP
        rsvps = db.collection('scheduled_room_rsvps')\
            .where('scheduled_room_id', '==', scheduled_room_id)\
            .where('user_id', '==', user['user_id'])\
            .where('is_active', '==', True)\
            .stream()
        
        removed_count = 0
        for rsvp_doc in rsvps:
            rsvp_doc.reference.update({
                'is_active': False,
                'removed_at': datetime.utcnow()
            })
            removed_count += 1
        
        logging.info(f"Removed RSVP for user {user['user_id']} from session {scheduled_room_id}")
        
        return jsonify({
            'success': True,
            'message': 'RSVP removed',
            'removed': removed_count > 0
        })
        
    except Exception as e:
        logging.error(f"Error removing RSVP: {str(e)}")
        return jsonify({'error': 'Failed to remove RSVP'}), 500

@prayer_room_bp.route('/delete-room/<room_id>', methods=['DELETE'])
def delete_room(room_id):
    """Delete a room created by the current user"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get the room to verify ownership
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        
        # Check if user is the host
        if room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the room creator can delete rooms'}), 403
        
        # Delete the room
        room_ref.delete()
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error deleting room: {str(e)}")
        return jsonify({'error': 'Failed to delete room'}), 500

@prayer_room_bp.route('/update-scheduled-room/<scheduled_room_id>', methods=['PUT'])
def update_scheduled_room(scheduled_room_id):
    """Update a scheduled room"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        data = request.get_json()
        room_name = data.get('room_name')
        room_description = data.get('room_description', '')
        scheduled_time = data.get('scheduled_time')
        room_privacy = data.get('room_privacy', 'public')
        
        if not room_name:
            return jsonify({'error': 'Room name is required'}), 400
        
        if not scheduled_time:
            return jsonify({'error': 'Scheduled time is required'}), 400
        
        # Validate room name length
        if len(room_name) > 50:
            return jsonify({'error': 'Room name must be 50 characters or less'}), 400
        
        # Parse scheduled time - handle local timezone (same logic as schedule_room)
        try:
            # Get timezone offset from request (in minutes)
            timezone_offset_minutes = data.get('timezone_offset', 0)
            
            if 'T' in scheduled_time and '+' not in scheduled_time and 'Z' not in scheduled_time:
                # Parse as local datetime and convert to UTC
                # getTimezoneOffset() returns minutes to ADD to local time to get UTC
                local_datetime = datetime.fromisoformat(scheduled_time)
                from datetime import timezone, timedelta
                offset_timedelta = timedelta(minutes=timezone_offset_minutes)
                scheduled_datetime = local_datetime + offset_timedelta
                logging.info(f"Updated scheduled time - converted to UTC: {scheduled_datetime} (local: {local_datetime}, offset: {timezone_offset_minutes} minutes)")
            else:
                # This has timezone info, parse normally
                scheduled_datetime = datetime.fromisoformat(scheduled_time.replace('Z', '+00:00'))
        except ValueError as e:
            logging.error(f"Invalid scheduled time format: {scheduled_time}, error: {e}")
            return jsonify({'error': 'Invalid scheduled time format'}), 400
        
        # Check if scheduled time is in the future (using UTC)
        now_utc = datetime.utcnow()
        if scheduled_datetime <= now_utc:
            return jsonify({'error': 'Scheduled time must be in the future'}), 400
        
        db = get_firestore_client()
        
        # Get the scheduled room to verify ownership
        scheduled_room_ref = db.collection('scheduled_rooms').document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()
        
        if not scheduled_room_doc.exists:
            return jsonify({'error': 'Scheduled room not found'}), 404
        
        scheduled_room_data = scheduled_room_doc.to_dict()
        
        # Check if user is the host
        if scheduled_room_data.get('host_id') != user['user_id']:
            return jsonify({'error': 'Only the room creator can update scheduled rooms'}), 403
        
        # Update the scheduled room
        update_data = {
            'room_name': room_name,
            'room_description': room_description,
            'room_privacy': room_privacy,
            'scheduled_time': scheduled_datetime,
            'updated_at': datetime.utcnow()
        }
        
        # Generate new room code for private rooms if privacy changed
        if room_privacy == 'private' and scheduled_room_data.get('room_privacy') != 'private':
            update_data['room_code'] = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        
        scheduled_room_ref.update(update_data)
        
        return jsonify({
            'success': True,
            'room_code': update_data.get('room_code', scheduled_room_data.get('room_code')),
            'message': 'Scheduled room updated successfully'
        })
        
    except Exception as e:
        logging.error(f"Error updating scheduled room: {str(e)}")
        return jsonify({'error': 'Failed to update scheduled room'}), 500

@prayer_room_bp.route('/join-scheduled/<scheduled_room_id>', methods=['GET'])
def join_scheduled_room(scheduled_room_id):
    """Join a scheduled room by its scheduled room ID"""
    try:
        user = get_user_from_session()
        
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        db = get_firestore_client()
        
        # Get the scheduled room
        scheduled_room_ref = db.collection('scheduled_rooms').document(scheduled_room_id)
        scheduled_room_doc = scheduled_room_ref.get()
        
        if not scheduled_room_doc.exists:
            return jsonify({'error': 'Scheduled room not found'}), 404
        
        scheduled_room_data = scheduled_room_doc.to_dict()
        
        # Check if the scheduled time has passed
        scheduled_time = scheduled_room_data.get('scheduled_time')
        if scheduled_time:
            # Convert Firestore timestamp to datetime if needed
            if hasattr(scheduled_time, 'timestamp'):
                scheduled_datetime = datetime.fromtimestamp(scheduled_time.timestamp())
            elif isinstance(scheduled_time, dict) and '_seconds' in scheduled_time:
                scheduled_datetime = datetime.fromtimestamp(scheduled_time['_seconds'])
            else:
                scheduled_datetime = scheduled_time
            
            if scheduled_datetime <= datetime.now():
                return jsonify({'error': 'This scheduled session has already passed'}), 400
        
        # Redirect to the prayer room join page with the scheduled room info
        room_name = scheduled_room_data.get('room_name', 'Scheduled Prayer Room')
        room_privacy = scheduled_room_data.get('room_privacy', 'public')
        room_code = scheduled_room_data.get('room_code', '')
        
        # Create a redirect URL with the scheduled room information
        redirect_url = f"/prayer-room/join?room={scheduled_room_id}&name={room_name}&privacy={room_privacy}"
        if room_code:
            redirect_url += f"&code={room_code}"
        
        return jsonify({
            'success': True,
            'redirect_url': redirect_url,
            'room_name': room_name,
            'scheduled_time': scheduled_room_data.get('scheduled_time'),
            'room_privacy': room_privacy,
            'room_code': room_code
        })
        
    except Exception as e:
        logging.error(f"Error joining scheduled room: {str(e)}")
        return jsonify({'error': 'Failed to join scheduled room'}), 500

@prayer_room_bp.route('/cleanup', methods=['POST'])
def run_cleanup():
    """Run cleanup tasks for signaling artifacts and old data"""
    try:
        # Run all cleanup functions
        sessions_cleaned = cleanup_inactive_sessions()
        signaling_cleaned = cleanup_signaling_artifacts()
        chat_cleaned = cleanup_old_chat_messages()
        
        total_cleaned = sessions_cleaned + signaling_cleaned + chat_cleaned
        
        return jsonify({
            'success': True,
            'sessions_cleaned': sessions_cleaned,
            'signaling_cleaned': signaling_cleaned,
            'chat_cleaned': chat_cleaned,
            'total_cleaned': total_cleaned
        })
        
    except Exception as e:
        logging.error(f"Error running cleanup: {str(e)}")
        return jsonify({'error': 'Failed to run cleanup'}), 500

@prayer_room_bp.route('/metrics', methods=['GET'])
def get_metrics():
    """Get basic metrics for monitoring"""
    try:
        db = get_firestore_client()
        
        # Count active rooms
        active_rooms = db.collection('prayer_rooms')\
            .where('is_active', '==', True)\
            .limit(1000)\
            .stream()
        active_room_count = len(list(active_rooms))
        
        # Count total participants across all active rooms
        total_participants = 0
        for room_doc in db.collection('prayer_rooms').where('is_active', '==', True).stream():
            room_data = room_doc.to_dict()
            participants = room_data.get('participants', [])
            total_participants += len(participants)
        
        # Count recent chat messages (last hour)
        from datetime import datetime, timedelta
        recent_cutoff = datetime.utcnow() - timedelta(hours=1)
        recent_messages = db.collection('chat_messages')\
            .where('timestamp', '>', recent_cutoff)\
            .limit(1000)\
            .stream()
        recent_message_count = len(list(recent_messages))
        
        return jsonify({
            'active_rooms': active_room_count,
            'total_participants': total_participants,
            'recent_messages': recent_message_count,
            'timestamp': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logging.error(f"Error getting metrics: {str(e)}")
        return jsonify({'error': 'Failed to get metrics'}), 500

def cleanup_inactive_sessions():
    """Clean up inactive sessions older than 1 hour"""
    try:
        db = get_firestore_client()
        cutoff_time = datetime.utcnow() - timedelta(hours=1)
        
        # Get all rooms
        all_rooms_ref = db.collection('prayer_rooms')
        all_rooms = all_rooms_ref.stream()
        
        cleaned_count = 0
        for room_doc in all_rooms:
            # Get all inactive sessions and filter by timestamp in Python
            inactive_sessions_ref = room_doc.reference\
                .collection('device_sessions')\
                .where('is_active', '==', False)
            
            for session_doc in inactive_sessions_ref.stream():
                session_data = session_doc.to_dict()
                ended_at = session_data.get('ended_at')
                if ended_at:
                    try:
                        ended = ended_at
                        if hasattr(ended_at, 'tzinfo') and ended_at.tzinfo is not None:
                            ended = ended_at.replace(tzinfo=None)
                        if ended < cutoff_time:
                            session_doc.reference.delete()
                            cleaned_count += 1
                    except Exception:
                        continue
        
        logging.info(f"Cleaned up {cleaned_count} inactive sessions")
        return cleaned_count
        
    except Exception as e:
        logging.error(f"Error cleaning up inactive sessions: {str(e)}")
        return 0

def cleanup_signaling_artifacts():
    """Clean up old WebRTC signaling artifacts (offers, answers, candidates)"""
    try:
        db = get_firestore_client()
        cutoff_time = datetime.utcnow() - timedelta(minutes=30)  # 30 minutes TTL
        
        # Get all rooms
        all_rooms_ref = db.collection('prayer_rooms')
        all_rooms = all_rooms_ref.stream()
        
        cleaned_count = 0
        
        for room_doc in all_rooms:
            room_id = room_doc.id
            
            # Clean up old offers
            offers_ref = room_doc.reference.collection('webrtc_offers')\
                .where('timestamp', '<', cutoff_time)
            for offer_doc in offers_ref.stream():
                offer_doc.reference.delete()
                cleaned_count += 1
            
            # Clean up old answers
            answers_ref = room_doc.reference.collection('webrtc_answers')\
                .where('timestamp', '<', cutoff_time)
            for answer_doc in answers_ref.stream():
                answer_doc.reference.delete()
                cleaned_count += 1
            
            # Clean up old candidates
            candidates_ref = room_doc.reference.collection('webrtc_candidates')\
                .where('timestamp', '<', cutoff_time)
            for candidate_doc in candidates_ref.stream():
                candidate_doc.reference.delete()
                cleaned_count += 1
        
        logging.info(f"Cleaned up {cleaned_count} signaling artifacts")
        return cleaned_count
        
    except Exception as e:
        logging.error(f"Error cleaning up signaling artifacts: {str(e)}")
        return 0

def cleanup_old_chat_messages():
    """Clean up old chat messages (keep last 1000 per room)"""
    try:
        db = get_firestore_client()
        
        # Get all rooms
        all_rooms_ref = db.collection('prayer_rooms')
        all_rooms = all_rooms_ref.stream()
        
        cleaned_count = 0
        
        for room_doc in all_rooms:
            room_id = room_doc.id
            
            # Get chat messages for this room, ordered by timestamp
            chat_messages_ref = db.collection('chat_messages')\
                .where('room_id', '==', room_id)\
                .order_by('timestamp', direction='DESCENDING')
            
            messages = list(chat_messages_ref.stream())
            
            # Keep only the last 1000 messages
            if len(messages) > 1000:
                messages_to_delete = messages[1000:]
                for message_doc in messages_to_delete:
                    message_doc.reference.delete()
                    cleaned_count += 1
        
        logging.info(f"Cleaned up {cleaned_count} old chat messages")
        return cleaned_count
        
    except Exception as e:
        logging.error(f"Error cleaning up old chat messages: {str(e)}")
        return 0
