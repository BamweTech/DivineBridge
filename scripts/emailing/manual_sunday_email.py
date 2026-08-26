#!/usr/bin/env python3
"""
Manual Monday Email Sender
Sends daily verse + prayer emails to all subscribed users
Use this when the scheduler fails in production
"""

import os
from pathlib import Path
import sys
import logging
from datetime import datetime
import time

# Add the parent directory to the Python path to allow imports from the main app
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.core.config import get_config
from backend.integrations.firebase_auth import initialize_firebase
from backend.services.email.email_service_v2 import EnhancedEmailService
from backend.integrations.storage_handler import StorageHandler
from backend.services.verse.verse_cache import verse_cache
from backend.integrations.firebase_auth import get_firestore_client

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('manual_email_send.log')
    ]
)
logger = logging.getLogger(__name__)

def get_all_subscribers():
    """Get all users who are subscribed to emails from Firestore"""
    try:
        db = get_firestore_client()
        
        # Query users with email_subscribed = True
        users_ref = db.collection('users')
        query = users_ref.where('email_subscribed', '==', True).stream()
        
        subscribers = []
        for doc in query:
            user_data = doc.to_dict()
            if user_data.get('email') and user_data.get('firstName'):
                subscribers.append({
                    'uid': doc.id,
                    'email': user_data.get('email'),
                    'firstName': user_data.get('firstName'),
                    'timezone': user_data.get('timezone', 'America/New_York'),
                    'emailVerified': user_data.get('emailVerified', False)
                })
        
        logger.info(f"Found {len(subscribers)} subscribed users")
        return subscribers
        
    except Exception as e:
        logger.error(f"Error fetching subscribers: {e}")
        return []

def get_today_content():
    """Get today's verse and prayer content"""
    try:
        # Get today's verse
        verse = verse_cache.get_today_verse()
        if not verse:
            logger.error("No verse available for today")
            return None, None
        
        verse_data = {
            'reference': verse.get('reference', ''),
            'text': verse.get('verse', verse.get('text', ''))
        }
        
        logger.info(f"Verse: {verse_data['reference']} - {verse_data['text'][:50]}...")
        
        # Get today's prayer
        today = datetime.now().strftime('%Y-%m-%d')
        storage_handler = StorageHandler()
        prayer = storage_handler.get_prayer(today)
        
        if not prayer:
            logger.warning(f"No prayer found for {today}, attempting to generate one...")
            # Try to generate a prayer
            try:
                from backend.services.prayer.prayer_generator import PrayerGenerator
                prayer_generator = PrayerGenerator()
                prayer = prayer_generator.generate_prayer()
            except Exception as e:
                logger.error(f"Failed to generate prayer: {e}")
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
                logger.info("Using fallback prayer")
        
        if isinstance(prayer, dict):
            from backend.services.prayer.prayer_generator import PrayerGenerator
            pg = PrayerGenerator(storage_handler)
            prayer = pg.merge_email_intro_if_missing(prayer, today, verse)

        prayer_data = {
            'content': prayer.get('content', '') if isinstance(prayer, dict) else prayer,
            'date': today,
        }
        if isinstance(prayer, dict):
            intro = prayer.get('email_intro') or prayer.get('weekly_email_intro')
            if intro:
                prayer_data['email_intro'] = intro
        
        logger.info(f"Prayer: {prayer_data['content'][:50]}...")
        
        return verse_data, prayer_data
        
    except Exception as e:
        logger.error(f"Error getting today's content: {e}")
        return None, None

def send_emails_to_subscribers(subscribers, verse_data, prayer_data, dry_run=False):
    """Send emails to all subscribers"""
    try:
        email_service = EnhancedEmailService()
        sent_count = 0
        failed_count = 0
        skipped_count = 0
        
        logger.info(f"Starting email send to {len(subscribers)} subscribers (dry_run={dry_run})")
        
        for i, subscriber in enumerate(subscribers, 1):
            try:
                # Skip unverified emails in production
                if not subscriber.get('emailVerified', False):
                    logger.warning(f"Skipping unverified email: {subscriber['email']}")
                    skipped_count += 1
                    continue
                
                logger.info(f"[{i}/{len(subscribers)}] Sending to: {subscriber['email']} ({subscriber['firstName']})")
                
                if dry_run:
                    logger.info(f"DRY RUN: Would send to {subscriber['email']}")
                    sent_count += 1
                else:
                    success = email_service.send_daily_content(
                        recipient_email=subscriber['email'],
                        first_name=subscriber['firstName'],
                        verse_data=verse_data,
                        prayer_data=prayer_data,
                        timezone=subscriber.get('timezone', 'America/New_York')
                    )
                    
                    if success:
                        sent_count += 1
                        logger.info(f"✅ Sent to: {subscriber['email']}")
                    else:
                        failed_count += 1
                        logger.error(f"❌ Failed to send to: {subscriber['email']}")
                
                # Add small delay to avoid rate limiting
                if not dry_run:
                    time.sleep(0.5)
                    
            except Exception as e:
                logger.error(f"Error sending to {subscriber['email']}: {e}")
                failed_count += 1
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Email send complete!")
        logger.info(f"Total subscribers: {len(subscribers)}")
        logger.info(f"Sent successfully: {sent_count}")
        logger.info(f"Failed: {failed_count}")
        logger.info(f"Skipped (unverified): {skipped_count}")
        logger.info(f"{'='*60}\n")
        
        return sent_count, failed_count, skipped_count
        
    except Exception as e:
        logger.error(f"Error in email sending process: {e}")
        return 0, len(subscribers), 0

def main():
    """Main function to send Monday emails manually"""
    logger.info("🚀 Starting Manual Monday Email Send")
    logger.info("="*60)
    
    try:
        # Initialize Firebase and config
        logger.info("Initializing Firebase...")
        initialize_firebase()
        config = get_config()
        
        # Set static folder for verse generator
        from backend.services.verse.verse_generator import verse_generator
        verse_generator.set_static_folder('./web/static')
        
        logger.info("✅ Firebase initialized")
        
        # Get all subscribers
        logger.info("Fetching subscribers...")
        subscribers = get_all_subscribers()
        if not subscribers:
            logger.error("No subscribers found!")
            return False
        
        # Get today's content
        logger.info("Getting today's verse and prayer...")
        verse_data, prayer_data = get_today_content()
        if not verse_data or not prayer_data:
            logger.error("Failed to get today's content!")
            return False
        
        # Ask for confirmation
        print(f"\n📧 Ready to send emails to {len(subscribers)} subscribers")
        print(f"📅 Date: {datetime.now().strftime('%A, %B %d, %Y')}")
        print(f"📖 Verse: {verse_data['reference']}")
        print(f"🙏 Prayer preview: {prayer_data['content'][:100]}...")
        
        # Dry run first
        print(f"\n🔍 Running dry run first...")
        dry_sent, dry_failed, dry_skipped = send_emails_to_subscribers(
            subscribers, verse_data, prayer_data, dry_run=True
        )
        
        if dry_sent == 0:
            print("❌ Dry run failed - no emails would be sent")
            return False
        
        # Confirm actual send
        print(f"\n⚠️  DRY RUN COMPLETE:")
        print(f"   Would send to: {dry_sent} subscribers")
        print(f"   Would skip: {dry_skipped} unverified emails")
        print(f"   Would fail: {dry_failed} emails")
        
        confirm = input(f"\n🤔 Proceed with actual email send? (yes/no): ").lower().strip()
        
        if confirm not in ['yes', 'y']:
            print("❌ Email send cancelled by user")
            return False
        
        # Send actual emails
        print(f"\n📤 Sending actual emails...")
        sent_count, failed_count, skipped_count = send_emails_to_subscribers(
            subscribers, verse_data, prayer_data, dry_run=False
        )
        
        if sent_count > 0:
            print(f"\n✅ SUCCESS: {sent_count} emails sent successfully!")
            print(f"📊 Results: {sent_count} sent, {failed_count} failed, {skipped_count} skipped")
            return True
        else:
            print(f"\n❌ FAILED: No emails were sent successfully")
            return False
            
    except Exception as e:
        logger.error(f"Manual email send failed: {e}", exc_info=True)
        print(f"\n❌ ERROR: {e}")
        return False

if __name__ == '__main__':
    print("\n🙏 Divine Bridge - Manual Sunday Email Sender")
    print("="*60)
    
    success = main()
    
    if success:
        print("\n🎉 Manual email send completed successfully!")
        print("📧 Check the logs for detailed results")
    else:
        print("\n💥 Manual email send failed!")
        print("📋 Check the logs for error details")
    
    print("\n" + "="*60)
