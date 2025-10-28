#!/usr/bin/env python3
"""
Quick Manual Email Sender
Simple script to send Sunday emails to all users
Usage: python3 quick_email_send.py [--dry-run] [--test-email EMAIL]
"""

import os
import sys
import logging
import argparse
from datetime import datetime

# Add the parent directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

def quick_send(dry_run=False, test_email=None):
    """Quick email send function"""
    try:
        from firebase_auth import initialize_firebase
        from email_service_v2 import EnhancedEmailService
        from storage_handler import StorageHandler
        from verse_cache import verse_cache
        from firebase_auth import get_firestore_client
        
        # Initialize
        initialize_firebase()
        email_service = EnhancedEmailService()
        storage_handler = StorageHandler()
        
        # Set static folder for verse generator
        from verse_generator import verse_generator
        verse_generator.set_static_folder('./static')
        
        # Get content
        verse = verse_cache.get_today_verse()
        if not verse:
            print("❌ No verse available")
            return False
        
        today = datetime.now().strftime('%Y-%m-%d')
        prayer = storage_handler.get_prayer(today)
        if not prayer:
            print(f"⚠️  No prayer found for {today}, using fallback prayer")
            # Use fallback prayer
            prayer = {
                'content': """Heavenly Father,

We come before You with grateful hearts, thanking You for this beautiful day and all the blessings You have bestowed upon us. We pray for Your guidance and wisdom as we navigate through life's challenges and opportunities.

Help us to be instruments of Your love and peace in this world. Grant us strength to face difficulties with faith, courage to stand for what is right, and compassion to serve others in need.

We lift up our families, friends, and communities to You, asking for Your protection and provision. May Your grace be evident in all our relationships and endeavors.

In Jesus-Christ's name we pray. Amen.""",
                'date': today,
                'source': 'fallback'
            }
        
        verse_data = {
            'reference': verse.get('reference', ''),
            'text': verse.get('verse', verse.get('text', ''))
        }
        
        prayer_data = {
            'content': prayer.get('content', '') if isinstance(prayer, dict) else prayer,
            'date': today
        }
        
        print(f"📅 Date: {datetime.now().strftime('%A, %B %d, %Y')}")
        print(f"📖 Verse: {verse_data['reference']}")
        print(f"🙏 Prayer: {prayer_data['content'][:100]}...")
        
        if test_email:
            # Send to test email only
            print(f"\n🧪 Sending test email to: {test_email}")
            if dry_run:
                print("DRY RUN: Would send test email")
                return True
            
            success = email_service.send_daily_content(
                recipient_email=test_email,
                first_name="Test",
                verse_data=verse_data,
                prayer_data=prayer_data,
                timezone='America/New_York'
            )
            
            if success:
                print("✅ Test email sent successfully!")
                return True
            else:
                print("❌ Test email failed!")
                return False
        
        else:
            # Send to all subscribers
            db = get_firestore_client()
            users_ref = db.collection('users')
            query = users_ref.where('email_subscribed', '==', True).stream()
            
            subscribers = []
            for doc in query:
                user_data = doc.to_dict()
                if user_data.get('email') and user_data.get('firstName'):
                    subscribers.append({
                        'email': user_data.get('email'),
                        'firstName': user_data.get('firstName'),
                        'timezone': user_data.get('timezone', 'America/New_York')
                    })
            
            print(f"\n📧 Found {len(subscribers)} subscribers")
            
            if dry_run:
                print("DRY RUN: Would send to all subscribers")
                for sub in subscribers[:5]:  # Show first 5
                    print(f"  - {sub['email']} ({sub['firstName']})")
                if len(subscribers) > 5:
                    print(f"  ... and {len(subscribers) - 5} more")
                return True
            
            # Send to all
            sent = 0
            failed = 0
            
            for i, sub in enumerate(subscribers, 1):
                print(f"[{i}/{len(subscribers)}] Sending to {sub['email']}...")
                
                success = email_service.send_daily_content(
                    recipient_email=sub['email'],
                    first_name=sub['firstName'],
                    verse_data=verse_data,
                    prayer_data=prayer_data,
                    timezone=sub['timezone']
                )
                
                if success:
                    sent += 1
                    print(f"  ✅ Sent")
                else:
                    failed += 1
                    print(f"  ❌ Failed")
            
            print(f"\n📊 Results: {sent} sent, {failed} failed")
            return sent > 0
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Send Sunday emails manually')
    parser.add_argument('--dry-run', action='store_true', help='Dry run only')
    parser.add_argument('--test-email', help='Send test email to specific address')
    
    args = parser.parse_args()
    
    print("🙏 Divine Bridge - Quick Email Sender")
    print("="*50)
    
    success = quick_send(dry_run=args.dry_run, test_email=args.test_email)
    
    if success:
        print("\n✅ Email send completed!")
    else:
        print("\n❌ Email send failed!")

if __name__ == '__main__':
    main()
