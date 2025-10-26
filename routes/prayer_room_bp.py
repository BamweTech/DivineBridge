from flask import Blueprint, request, jsonify, session, render_template
from firebase_auth import get_firestore_client
import logging
from datetime import datetime, timedelta
import uuid
import json
import os
from google.cloud import firestore

prayer_room_bp = Blueprint('prayer_room', __name__)

def get_firestore_client():
    """Get Firestore client instance"""
    from firebase_auth import get_firestore_client as _get_firestore_client
    return _get_firestore_client()

def get_user_from_session():
    """Get user information from session"""
    user = session.get('user')
    if not user:
        return None
    
    # Debug logging to see what's in the session
    logging.info(f"🔍 Session user data: {user}")
    
    # Try multiple possible name fields
    user_name = user.get('name') or user.get('displayName') or user.get('user_name') or 'Anonymous'
    
    return {
        'user_id': user.get('uid'),
        'user_name': user_name,
        'name': user_name,
        'email': user.get('email')
    }

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
                'is_host': True
            }],
            'is_active': True,
            'is_locked': False,
            'settings': {
                'allow_anonymous': room_privacy == 'public',  # Only allow anonymous for public rooms
                'max_participants': 50,
                'auto_mute_new_participants': False
            }
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
            data = request.get_json() or {}
            provided_code = data.get('room_code', '').strip()
            room_code = room_data.get('room_code')
            
            if not provided_code:
                return jsonify({'error': 'Room code is required for private rooms'}), 400
            
            if provided_code != room_code:
                return jsonify({'error': 'Invalid room code'}), 400
        
        # Check if user is already in the room
        participants = room_data.get('participants', [])
        participant_updated = False
        for participant in participants:
            if participant['user_id'] == user_id:
                # Update the participant's name if it's different (fix for Anonymous issue)
                if participant.get('user_name') != user_name:
                    participant['user_name'] = user_name
                    participant_updated = True
                break
        
        # If we updated a participant's name, save it to Firestore
        if participant_updated:
            room_ref.update({
                'participants': participants,
                'last_activity': datetime.utcnow()
            })
        
        # Check again if user is in the room after potential update
        for participant in participants:
            if participant['user_id'] == user_id:
                return jsonify({
                    'success': True,
                    'room_id': room_id,
                    'room_name': room_data.get('room_name'),
                    'host_id': room_data.get('host_id'),
                    'participants': participants,  # Include participants even when already in room
                    'message': 'Already in room'
                })
        
        # Add participant to room
        new_participant = {
            'user_id': user_id,
            'user_name': user_name,
            'joined_at': datetime.utcnow(),
            'is_muted': False,
            'is_host': user_id == room_data.get('host_id')
        }
        
        participants.append(new_participant)
        room_ref.update({
            'participants': participants,
            'last_activity': datetime.utcnow()
        })
        
        return jsonify({
            'success': True,
            'room_id': room_id,
            'room_name': room_data.get('room_name'),
            'host_id': room_data.get('host_id'),
            'participants': participants
        })
        
    except Exception as e:
        logging.error(f"Error joining prayer room: {str(e)}")
        return jsonify({'error': 'Failed to join prayer room'}), 500

@prayer_room_bp.route('/leave/<room_id>', methods=['POST'])
def leave_prayer_room(room_id):
    """Leave a prayer room"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
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
            room_ref.update({
                'participants': participants,
                'last_activity': datetime.utcnow()
            })
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error leaving prayer room: {str(e)}")
        return jsonify({'error': 'Failed to leave prayer room'}), 500

@prayer_room_bp.route('/<room_id>/participants', methods=['GET'])
def get_room_participants(room_id):
    """Get room participants"""
    try:
        # Get current user to update their name if needed
        user = get_user_from_session()
        
        db = get_firestore_client()
        room_doc = db.collection('prayer_rooms').document(room_id).get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])
        
        # Update current user's name if they're in the room and name is different
        if user:
            user_id = user['user_id']
            user_name = user['user_name']
            participant_updated = False
            
            for participant in participants:
                if participant['user_id'] == user_id and participant.get('user_name') != user_name:
                    participant['user_name'] = user_name
                    participant_updated = True
                    break
            
            # Save updated participant data if needed
            if participant_updated:
                room_ref = db.collection('prayer_rooms').document(room_id)
                room_ref.update({
                    'participants': participants,
                    'last_activity': datetime.utcnow()
                })
        
        return jsonify({
            'success': True,
            'participants': participants,
            'room_name': room_data.get('room_name'),
            'is_active': room_data.get('is_active', False)
        })
        
    except Exception as e:
        logging.error(f"Error getting room participants: {str(e)}")
        return jsonify({'error': 'Failed to get participants'}), 500

@prayer_room_bp.route('/<room_id>/mute', methods=['POST'])
def mute_participant(room_id):
    """Mute/unmute a participant"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        is_muted = data.get('is_muted', False)
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
        db = get_firestore_client()
        room_ref = db.collection('prayer_rooms').document(room_id)
        room_doc = room_ref.get()
        
        if not room_doc.exists:
            return jsonify({'error': 'Room not found'}), 404
        
        room_data = room_doc.to_dict()
        participants = room_data.get('participants', [])
        
        # Update participant mute status
        for participant in participants:
            if participant['user_id'] == user_id:
                participant['is_muted'] = is_muted
                break
        
        room_ref.update({
            'participants': participants,
            'last_activity': datetime.utcnow()
        })
        
        return jsonify({'success': True, 'is_muted': is_muted})
        
    except Exception as e:
        logging.error(f"Error muting participant: {str(e)}")
        return jsonify({'error': 'Failed to mute participant'}), 500

@prayer_room_bp.route('/<room_id>/chat', methods=['POST'])
def send_chat_message(room_id):
    """Send a chat message to the room"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        user_name = data.get('user_name', 'Anonymous')
        message = data.get('message', '')
        
        if not user_id or not message:
            return jsonify({'error': 'User ID and message are required'}), 400
        
        db = get_firestore_client()
        
        # Add message to chat collection
        chat_data = {
            'room_id': room_id,
            'user_id': user_id,
            'user_name': user_name,
            'message': message,
            'timestamp': datetime.utcnow(),
            'message_id': str(uuid.uuid4())
        }
        
        db.collection('chat_messages').add(chat_data)
        
        return jsonify({'success': True, 'message_id': chat_data['message_id']})
        
    except Exception as e:
        logging.error(f"Error sending chat message: {str(e)}")
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
                'last_activity': datetime.utcnow()
            }
            participants.append(new_participant)
        
        # Update the room document with the modified participants
        room_ref.update({
            'participants': participants,
            'last_activity': datetime.utcnow()
        })
        
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
        
        db = get_firestore_client()
        
        # Store WebRTC offer
        offer_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_offers').add({
            'from_user': user['user_id'],
            'to_user': to_user,
            'offer': offer,
            'timestamp': firestore.SERVER_TIMESTAMP()
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
        
        db = get_firestore_client()
        
        # Store WebRTC answer
        answer_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('webrtc_answers').add({
            'from_user': user['user_id'],
            'to_user': to_user,
            'answer': answer,
            'timestamp': firestore.SERVER_TIMESTAMP()
        })
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error sending WebRTC answer: {str(e)}")
        return jsonify({'error': 'Failed to send WebRTC answer'}), 500
