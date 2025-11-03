#!/usr/bin/env python3
"""
Test script for scheduled room auto-activation

This script helps you test the scheduled session activation system locally:
1. Creates a test scheduled room set to activate in 1 minute
2. Waits for the scheduled time
3. Manually triggers the activation endpoint
4. Verifies the active room was created

Usage:
    python test_scheduled_activation.py
"""

import sys
import time
import requests
from datetime import datetime, timedelta
from firebase_auth import get_firestore_client
import uuid

def create_test_scheduled_room():
    """Create a test scheduled room that should activate in 1 minute"""
    print("\n=== Creating Test Scheduled Room ===\n")
    
    db = get_firestore_client()
    
    # Schedule for 1 minute from now
    scheduled_time = datetime.utcnow() + timedelta(minutes=1)
    
    # Test room data
    scheduled_room_data = {
        'room_name': 'Test Auto-Activation Room',
        'room_description': 'This is a test room for auto-activation',
        'room_privacy': 'public',
        'host_id': 'test_host_id_123',
        'host_name': 'Test Host',
        'scheduled_time': scheduled_time,
        'created_at': datetime.utcnow(),
        'status': 'scheduled'
    }
    
    # Save the scheduled room
    scheduled_room_ref = db.collection('scheduled_rooms').add(scheduled_room_data)
    scheduled_room_id = scheduled_room_ref[1].id
    
    print(f"✅ Created scheduled room: {scheduled_room_id}")
    print(f"   Room Name: {scheduled_room_data['room_name']}")
    print(f"   Scheduled Time: {scheduled_time} UTC")
    print(f"   Current Time: {datetime.utcnow()} UTC")
    print(f"   Will activate in: 1 minute")
    
    return scheduled_room_id, scheduled_time

def wait_for_scheduled_time(scheduled_time):
    """Wait until the scheduled time arrives"""
    print("\n=== Waiting for Scheduled Time ===\n")
    
    while datetime.utcnow() < scheduled_time:
        remaining = (scheduled_time - datetime.utcnow()).total_seconds()
        if remaining > 0:
            print(f"⏳ Time until activation: {int(remaining)} seconds", end='\r')
            time.sleep(1)
    
    print("\n✅ Scheduled time reached!")
    
    # Wait an extra 5 seconds to ensure we're past the time
    print("⏳ Waiting 5 more seconds to be safe...")
    time.sleep(5)

def trigger_activation(base_url='http://localhost:8080'):
    """Manually trigger the activation endpoint"""
    print("\n=== Triggering Activation Endpoint ===\n")
    
    url = f"{base_url}/api/prayer-room/activate-scheduled-rooms"
    
    print(f"📡 Calling: POST {url}")
    
    try:
        # Set a header to bypass Cloud Scheduler verification in local mode
        headers = {
            'User-Agent': 'Test-Script',
            'X-Local-Dev': 'true'
        }
        
        response = requests.post(url, headers=headers, timeout=30)
        
        print(f"📨 Response Status: {response.status_code}")
        print(f"📝 Response Body:")
        print(response.json())
        
        if response.status_code == 200:
            result = response.json()
            if result.get('activated_count', 0) > 0:
                print("\n✅ SUCCESS! Room(s) activated")
                return True
            else:
                print("\n⚠️  No rooms were activated")
                return False
        else:
            print("\n❌ Activation failed")
            return False
            
    except Exception as e:
        print(f"\n❌ Error calling endpoint: {e}")
        return False

def verify_activation(scheduled_room_id):
    """Verify that the scheduled room was activated"""
    print("\n=== Verifying Activation ===\n")
    
    db = get_firestore_client()
    
    # Check scheduled room status
    scheduled_room_ref = db.collection('scheduled_rooms').document(scheduled_room_id)
    scheduled_room_doc = scheduled_room_ref.get()
    
    if not scheduled_room_doc.exists:
        print("❌ Scheduled room not found!")
        return False
    
    scheduled_data = scheduled_room_doc.to_dict()
    status = scheduled_data.get('status')
    active_room_id = scheduled_data.get('active_room_id')
    
    print(f"📋 Scheduled Room Status: {status}")
    
    if status == 'active' and active_room_id:
        print(f"✅ Status updated to 'active'")
        print(f"✅ Active room ID: {active_room_id}")
        
        # Verify active room was created
        active_room_ref = db.collection('prayer_rooms').document(active_room_id)
        active_room_doc = active_room_ref.get()
        
        if active_room_doc.exists:
            active_data = active_room_doc.to_dict()
            print(f"\n🎉 Active room created successfully!")
            print(f"   Room Name: {active_data.get('room_name')}")
            print(f"   Host: {active_data.get('host_name')}")
            print(f"   Participants: {len(active_data.get('participants', []))}")
            print(f"   Is Active: {active_data.get('is_active')}")
            
            # Clean up test data
            cleanup = input("\n🗑️  Delete test data? (y/n): ")
            if cleanup.lower() == 'y':
                scheduled_room_ref.delete()
                active_room_ref.delete()
                print("✅ Test data cleaned up")
            
            return True
        else:
            print("❌ Active room not found in database!")
            return False
    else:
        print(f"❌ Room status is still '{status}'")
        if not active_room_id:
            print("❌ No active_room_id set")
        return False

def main():
    """Main test flow"""
    print("\n" + "="*60)
    print("  SCHEDULED ROOM AUTO-ACTIVATION TEST")
    print("="*60)
    
    print("\n⚙️  Make sure your Flask app is running locally on port 8080")
    print("   (Run: python app.py or flask run)")
    
    input("\nPress Enter when ready to start the test...")
    
    # Step 1: Create test scheduled room
    try:
        scheduled_room_id, scheduled_time = create_test_scheduled_room()
    except Exception as e:
        print(f"\n❌ Error creating scheduled room: {e}")
        sys.exit(1)
    
    # Step 2: Wait for scheduled time
    wait_for_scheduled_time(scheduled_time)
    
    # Step 3: Trigger activation
    success = trigger_activation()
    
    if not success:
        print("\n❌ Test failed - activation endpoint did not succeed")
        
        cleanup = input("\n🗑️  Delete test scheduled room? (y/n): ")
        if cleanup.lower() == 'y':
            db = get_firestore_client()
            db.collection('scheduled_rooms').document(scheduled_room_id).delete()
            print("✅ Test data cleaned up")
        
        sys.exit(1)
    
    # Step 4: Verify activation
    time.sleep(2)  # Give Firestore a moment to update
    verification_success = verify_activation(scheduled_room_id)
    
    if verification_success:
        print("\n" + "="*60)
        print("  ✅ TEST PASSED - AUTO-ACTIVATION WORKS!")
        print("="*60 + "\n")
    else:
        print("\n" + "="*60)
        print("  ❌ TEST FAILED - CHECK LOGS FOR ERRORS")
        print("="*60 + "\n")
        sys.exit(1)

if __name__ == "__main__":
    main()

