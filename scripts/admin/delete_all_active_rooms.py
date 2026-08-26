#!/usr/bin/env python3
"""
Delete All Active Prayer Rooms Script
Deletes all active prayer rooms from Firestore
USE WITH CAUTION - This will end all active prayer sessions!
"""

import sys
import os
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.integrations.firebase_auth import get_firestore_client
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def delete_all_active_rooms():
    """Delete all active prayer rooms"""
    try:
        db = get_firestore_client()
        
        # Get all active rooms
        active_rooms = db.collection('prayer_rooms')\
            .where('is_active', '==', True)\
            .stream()
        
        deleted_count = 0
        room_list = []
        
        # First, collect all rooms
        for room_doc in active_rooms:
            room_data = room_doc.to_dict()
            room_list.append({
                'id': room_doc.id,
                'name': room_data.get('room_name', 'Unknown'),
                'host': room_data.get('host_name', 'Unknown'),
                'participants': len(room_data.get('participants', []))
            })
        
        if not room_list:
            logger.info("No active prayer rooms found.")
            return 0
        
        # Display rooms to be deleted
        logger.info(f"\n{'='*60}")
        logger.info(f"Found {len(room_list)} active prayer rooms:")
        logger.info(f"{'='*60}")
        for room in room_list:
            logger.info(f"  • {room['name']} (Host: {room['host']}, {room['participants']} participants)")
        logger.info(f"{'='*60}\n")
        
        # Confirm deletion
        response = input("⚠️  Are you sure you want to delete ALL these rooms? (yes/no): ")
        if response.lower() != 'yes':
            logger.info("❌ Deletion cancelled.")
            return 0
        
        # Delete each room
        for room_info in room_list:
            room_id = room_info['id']
            room_ref = db.collection('prayer_rooms').document(room_id)
            
            # Mark as inactive instead of deleting
            room_ref.update({
                'is_active': False,
                'ended_at': datetime.utcnow(),
                'ended_by': 'admin_script',
                'participants': []  # Clear participants
            })
            
            logger.info(f"  ✓ Ended room: {room_info['name']}")
            deleted_count += 1
        
        logger.info(f"\n{'='*60}")
        logger.info(f"✅ Successfully ended {deleted_count} prayer rooms!")
        logger.info(f"{'='*60}\n")
        
        return deleted_count
        
    except Exception as e:
        logger.error(f"❌ Error deleting rooms: {str(e)}")
        import traceback
        traceback.print_exc()
        return 0


def delete_all_rooms_permanently():
    """PERMANENT DELETE - Remove rooms from database completely"""
    try:
        db = get_firestore_client()
        
        # Get all prayer rooms (active or inactive)
        all_rooms = db.collection('prayer_rooms').stream()
        
        deleted_count = 0
        room_list = []
        
        # Collect all rooms
        for room_doc in all_rooms:
            room_data = room_doc.to_dict()
            room_list.append({
                'id': room_doc.id,
                'name': room_data.get('room_name', 'Unknown'),
                'active': room_data.get('is_active', False)
            })
        
        if not room_list:
            logger.info("No prayer rooms found.")
            return 0
        
        logger.info(f"\n{'='*60}")
        logger.info(f"⚠️  PERMANENT DELETE MODE ⚠️")
        logger.info(f"Found {len(room_list)} total prayer rooms:")
        logger.info(f"{'='*60}")
        for room in room_list:
            status = "🟢 Active" if room['active'] else "⚪ Inactive"
            logger.info(f"  • {room['name']} ({status})")
        logger.info(f"{'='*60}\n")
        
        # Triple confirm permanent deletion
        response1 = input("⚠️  This will PERMANENTLY DELETE all rooms from database. Type 'DELETE' to confirm: ")
        if response1 != 'DELETE':
            logger.info("❌ Deletion cancelled.")
            return 0
        
        response2 = input("⚠️  Are you absolutely sure? Type 'YES I AM SURE': ")
        if response2 != 'YES I AM SURE':
            logger.info("❌ Deletion cancelled.")
            return 0
        
        # Delete each room permanently
        for room_info in room_list:
            room_id = room_info['id']
            room_ref = db.collection('prayer_rooms').document(room_id)
            
            # Delete all subcollections first
            # Delete device sessions
            sessions = room_ref.collection('device_sessions').stream()
            for session in sessions:
                session.reference.delete()
            
            # Delete webrtc offers
            offers = room_ref.collection('webrtc_offers').stream()
            for offer in offers:
                offer.reference.delete()
            
            # Delete webrtc answers
            answers = room_ref.collection('webrtc_answers').stream()
            for answer in answers:
                answer.reference.delete()
            
            # Delete webrtc candidates
            candidates = room_ref.collection('webrtc_candidates').stream()
            for candidate in candidates:
                candidate.reference.delete()
            
            # Delete the room document itself
            room_ref.delete()
            
            logger.info(f"  🗑️  Permanently deleted: {room_info['name']}")
            deleted_count += 1
        
        # Also delete associated chat messages
        logger.info("\nDeleting associated chat messages...")
        chat_messages = db.collection('chat_messages').stream()
        chat_deleted = 0
        for msg in chat_messages:
            msg.reference.delete()
            chat_deleted += 1
        
        logger.info(f"\n{'='*60}")
        logger.info(f"✅ Permanently deleted {deleted_count} rooms and {chat_deleted} chat messages!")
        logger.info(f"{'='*60}\n")
        
        return deleted_count
        
    except Exception as e:
        logger.error(f"❌ Error permanently deleting rooms: {str(e)}")
        import traceback
        traceback.print_exc()
        return 0


if __name__ == '__main__':
    logger.info("\n" + "="*60)
    logger.info("🧹 Prayer Room Cleanup Script")
    logger.info("="*60 + "\n")
    logger.info("Select an option:")
    logger.info("  1) End all active rooms (mark as inactive)")
    logger.info("  2) Permanently delete ALL rooms (⚠️  USE WITH CAUTION)")
    logger.info("  3) Cancel")
    print()
    
    choice = input("Enter your choice (1/2/3): ")
    
    if choice == '1':
        logger.info("\n🔸 Ending all active rooms...\n")
        delete_all_active_rooms()
    elif choice == '2':
        logger.info("\n🔸 PERMANENT DELETE MODE...\n")
        delete_all_rooms_permanently()
    else:
        logger.info("\n❌ Cancelled.\n")

