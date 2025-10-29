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
        
        room_ref.update({
            'participants': participants,
            'last_activity': datetime.utcnow()
        })
        
        # Add notification message to chat
        action = "muted" if is_muted else "unmuted"
        participant_name = next((p.get('user_name', 'A participant') for p in participants if p['user_id'] == user_id), 'A participant')
        
        chat_ref = db.collection('chat_messages')
        notification_message = {
            'room_id': room_id,
            'user_id': 'system',
            'user_name': 'System',
            'message': f"🔇 {participant_name} has been {action} by the host.",
            'timestamp': datetime.utcnow(),
            'message_type': 'system_notification'
        }
        chat_ref.add(notification_message)
        
        return jsonify({'success': True, 'is_muted': is_muted})
        
    except Exception as e:
        logging.error(f"Error muting participant: {str(e)}")
        return jsonify({'error': 'Failed to mute participant'}), 500

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

# Multi-Device Session Management Endpoints
@prayer_room_bp.route('/<room_id>/check-session', methods=['POST'])
def check_session(room_id):
    """Check if user already has an active session on another device"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        device_id = data.get('device_id')
        device_info = data.get('device_info', {})
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
        db = get_firestore_client()
        
        # Check for existing active sessions for this user
        sessions_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('device_sessions')\
            .where('user_id', '==', user_id)\
            .where('is_active', '==', True)\
            .limit(1)
        
        existing_sessions = list(sessions_ref.stream())
        
        if existing_sessions:
            existing_session = existing_sessions[0].to_dict()
            return jsonify({
                'has_existing_session': True,
                'existing_device_info': existing_session.get('device_info', {})
            })
        
        return jsonify({'has_existing_session': False})
        
    except Exception as e:
        logging.error(f"Error checking session: {str(e)}")
        return jsonify({'error': 'Failed to check session'}), 500

@prayer_room_bp.route('/<room_id>/register-session', methods=['POST'])
def register_session(room_id):
    """Register a new device session"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        device_id = data.get('device_id')
        device_info = data.get('device_info', {})
        
        if not user_id or not device_id:
            return jsonify({'error': 'User ID and Device ID are required'}), 400
        
        db = get_firestore_client()
        
        # Deactivate any existing sessions for this user
        existing_sessions_ref = db.collection('prayer_rooms').document(room_id)\
            .collection('device_sessions')\
            .where('user_id', '==', user_id)\
            .where('is_active', '==', True)
        
        for session_doc in existing_sessions_ref.stream():
            session_doc.reference.update({
                'is_active': False,
                'ended_at': datetime.utcnow()
            })
        
        # Register new session
        session_data = {
            'user_id': user_id,
            'device_id': device_id,
            'device_info': device_info,
            'is_active': True,
            'created_at': datetime.utcnow(),
            'last_seen': datetime.utcnow()
        }
        
        db.collection('prayer_rooms').document(room_id)\
            .collection('device_sessions').add(session_data)
        
        return jsonify({'success': True})
        
    except Exception as e:
        logging.error(f"Error registering session: {str(e)}")
        return jsonify({'error': 'Failed to register session'}), 500

@prayer_room_bp.route('/<room_id>/disconnect-session', methods=['POST'])
def disconnect_session(room_id):
    """Disconnect existing session (for device switching)"""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'error': 'User ID is required'}), 400
        
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
            # The datetime-local input provides local time without timezone info
            # We need to treat it as local time, not UTC
            if 'T' in scheduled_time and '+' not in scheduled_time and 'Z' not in scheduled_time:
                # This is a local datetime from datetime-local input
                # Parse it as naive datetime (no timezone info)
                scheduled_datetime = datetime.fromisoformat(scheduled_time)
                logging.info(f"Parsed scheduled time (local): {scheduled_datetime}")
            else:
                # This has timezone info, parse normally
                scheduled_datetime = datetime.fromisoformat(scheduled_time.replace('Z', '+00:00'))
                logging.info(f"Parsed scheduled time (with timezone): {scheduled_datetime}")
        except ValueError as e:
            logging.error(f"Invalid scheduled time format: {scheduled_time}, error: {e}")
            return jsonify({'error': 'Invalid scheduled time format'}), 400
        
        # Check if scheduled time is in the future
        # For local datetime, compare with local time
        now = datetime.now()
        if scheduled_datetime <= now:
            logging.error(f"Scheduled time is in the past: {scheduled_datetime} (current time: {now})")
            return jsonify({'error': 'Scheduled time must be in the future'}), 400
        
        db = get_firestore_client()
        
        # Create scheduled room data
        scheduled_room_data = {
            'room_name': room_name,
            'room_description': room_description,
            'room_privacy': room_privacy,
            'host_id': user['user_id'],
            'host_name': host_name,
            'scheduled_time': scheduled_datetime,
            'created_at': datetime.utcnow(),
            'status': 'scheduled'
        }
        
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
            'room_name': original_room_data.get('room_name', 'Prayer Room'),
            'room_description': original_room_data.get('room_description', ''),
            'room_privacy': original_room_data.get('room_privacy', 'public'),
            'host_id': user['user_id'],
            'host_name': user['user_name'],
            'is_active': True,
            'created_at': datetime.utcnow(),
            'last_activity': datetime.utcnow(),
            'participants': [],
            'original_room_id': original_room_id  # Track the original room
        }
        
        # Generate room code for private rooms
        if new_room_data['room_privacy'] == 'private':
            new_room_data['room_code'] = ''.join([chr(65 + (ord(c) - 48) % 26) for c in str(uuid.uuid4().int)[:6]])
        
        # Save the new room
        db.collection('prayer_rooms').document(new_room_id).set(new_room_data)
        
        return jsonify({
            'success': True,
            'room_id': new_room_id,
            'room_code': new_room_data.get('room_code'),
            'room_name': new_room_data['room_name']
        })
        
    except Exception as e:
        logging.error(f"Error reopening room: {str(e)}")
        return jsonify({'error': 'Failed to reopen room'}), 500

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
        
        # Parse scheduled time - handle local timezone
        try:
            if 'T' in scheduled_time and '+' not in scheduled_time and 'Z' not in scheduled_time:
                # Parse it as naive datetime (no timezone info)
                scheduled_datetime = datetime.fromisoformat(scheduled_time)
            else:
                # This has timezone info, parse normally
                scheduled_datetime = datetime.fromisoformat(scheduled_time.replace('Z', '+00:00'))
        except ValueError as e:
            return jsonify({'error': 'Invalid scheduled time format'}), 400
        
        # Check if scheduled time is in the future
        now = datetime.now()
        if scheduled_datetime <= now:
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
