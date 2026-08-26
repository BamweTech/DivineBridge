#!/usr/bin/env python3
"""
Script to force regenerate today's prayer by deleting existing one first
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from datetime import datetime
from backend.services.prayer.prayer_generator import PrayerGenerator
from backend.integrations.storage_handler import StorageHandler

def force_regenerate_today_prayer():
    """Delete today's prayer and regenerate it"""
    today = datetime.now().strftime('%Y-%m-%d')
    
    print(f"🔄 Force regenerating prayer for {today}...")
    
    # Initialize
    storage = StorageHandler()
    generator = PrayerGenerator(storage=storage)
    
    # Check if prayer exists
    existing = storage.get_prayer(today)
    if existing:
        print(f"📋 Found existing prayer for {today}, deleting it...")
        
        # Try to delete existing prayer
        try:
            if hasattr(storage, 'bucket'):
                # Delete all blobs with the date prefix
                prefix = f"prayers/{today}"
                blobs = list(storage.bucket.list_blobs(prefix=prefix))
                if blobs:
                    print(f"🗑️  Found {len(blobs)} prayer blob(s) to delete...")
                    for blob in blobs:
                        blob.delete()
                        print(f"   ✅ Deleted: {blob.name}")
                else:
                    # Also try the direct path format
                    blob_name = f"prayers/{today}.json"
                    blob = storage.bucket.blob(blob_name)
                    if blob.exists():
                        blob.delete()
                        print(f"🗑️  Deleted existing prayer blob: {blob_name}")
                    else:
                        print("⚠️  No existing prayer blob found to delete")
            else:
                print("⚠️  Storage handler doesn't have bucket attribute")
        except Exception as e:
            print(f"⚠️  Could not delete existing prayer: {e}")
            import traceback
            traceback.print_exc()
    else:
        print("ℹ️  No existing prayer found, will generate new one")
    
    # Generate new prayer
    print("🙏 Generating new prayer with updated prompt...")
    prayer = generator.generate_prayer()
    
    if prayer:
        content = prayer.get('content', '') if isinstance(prayer, dict) else str(prayer)
        word_count = len(content.split())
        
        print(f"✅ Prayer generated successfully!")
        print(f"   Word count: {word_count}")
        print(f"   Date: {today}")
        
        # Check if it mentions mass shootings or wars
        mentions_shootings = 'shooting' in content.lower() or 'gun' in content.lower() or 'mass' in content.lower()
        mentions_wars = 'war' in content.lower() or 'conflict' in content.lower() or 'battle' in content.lower()
        
        if mentions_shootings or mentions_wars:
            print(f"   ✅ Mentions victims of violence/wars: Yes")
        else:
            print(f"   ℹ️  May not explicitly mention shootings/wars (check content)")
        
        print(f"\n   📄 Content preview (first 300 chars):")
        print(f"   {content[:300]}...")
        
        return prayer
    else:
        print("❌ Failed to generate prayer")
        return None

if __name__ == '__main__':
    try:
        prayer = force_regenerate_today_prayer()
        if prayer:
            print("\n✅ Done! Today's prayer has been regenerated.")
        else:
            print("\n❌ Failed to regenerate prayer")
            sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
