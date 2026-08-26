"""
One-time migration script to sync existing Firebase Auth users to Firestore
Adds all existing users to Firestore with email_subscribed=True
"""

import logging
from firebase_admin import auth, firestore
from backend.core.config import get_config
from backend.integrations.firebase_auth import initialize_firebase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate_users():
    """Migrate all Firebase Auth users to Firestore"""
    try:
        # Initialize config and Firebase
        config = get_config()
        initialize_firebase()
        
        # Get Firestore client
        db = firestore.client()
        
        # Get all Firebase Auth users
        logger.info("Fetching all Firebase Auth users...")
        page = auth.list_users()
        all_users = []
        
        while page:
            for user in page.users:
                all_users.append(user)
            page = page.get_next_page()
        
        logger.info(f"Found {len(all_users)} Firebase Auth users")
        
        # Migrate each user to Firestore
        migrated_count = 0
        skipped_count = 0
        
        for user in all_users:
            try:
                user_ref = db.collection('users').document(user.uid)
                
                # Check if user already exists in Firestore
                if user_ref.get().exists:
                    logger.info(f"User {user.email} already exists in Firestore, skipping")
                    skipped_count += 1
                    continue
                
                # Parse display name
                display_name = user.display_name or ''
                name_parts = display_name.split(' ', 1)
                first_name = name_parts[0] if name_parts else 'User'
                last_name = name_parts[1] if len(name_parts) > 1 else ''
                
                # Create Firestore document
                user_ref.set({
                    'email': user.email,
                    'firstName': first_name,
                    'lastName': last_name,
                    'email_subscribed': True,  # Subscribe all existing users
                    'timezone': 'America/New_York',  # Default timezone
                    'createdAt': user.user_metadata.creation_timestamp,
                    'emailVerified': user.email_verified,
                    'migratedAt': firestore.SERVER_TIMESTAMP
                })
                
                logger.info(f"✅ Migrated: {user.email} ({first_name} {last_name})")
                migrated_count += 1
                
            except Exception as e:
                logger.error(f"Error migrating user {user.email}: {e}")
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Migration complete!")
        logger.info(f"Total users: {len(all_users)}")
        logger.info(f"Migrated: {migrated_count}")
        logger.info(f"Skipped (already in Firestore): {skipped_count}")
        logger.info(f"{'='*60}\n")
        
        return True
        
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        return False

if __name__ == "__main__":
    migrate_users()

