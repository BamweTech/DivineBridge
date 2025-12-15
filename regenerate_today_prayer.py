#!/usr/bin/env python3
"""
Script to regenerate today's prayer with citation removal
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime
from prayer_generator import PrayerGenerator
from storage_handler import StorageHandler
import json

def regenerate_today_prayer():
    """Delete today's prayer and regenerate it"""
    today = datetime.now().strftime('%Y-%m-%d')
    
    print(f"🔄 Regenerating prayer for {today}...")
    
    # Initialize
    storage = StorageHandler()
    generator = PrayerGenerator(storage=storage)
    
    # Check if prayer exists
    existing = storage.get_prayer(today)
    if existing:
        print(f"📋 Found existing prayer for {today}")
        if isinstance(existing, dict):
            content = existing.get('content', '')
        else:
            content = str(existing)
        
        has_citations = '[1]' in content or '[2]' in content or '[3]' in content
        has_paragraphs = '\n\n' in content
        print(f"   Has citations: {has_citations}")
        print(f"   Has paragraph breaks: {has_paragraphs}")
        
        print("   🔄 Force regenerating to test new paragraph formatting and image generation changes...")
    
    # Try to delete existing prayer to force regeneration
    try:
        if hasattr(storage, 'bucket'):
            # Delete all blobs with the date prefix (prayers can be stored in subdirectories)
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
        print(f"⚠️  Could not delete existing prayer (will overwrite): {e}")
        import traceback
        traceback.print_exc()
    
    # Generate new prayer (this will overwrite existing one)
    print("🙏 Generating new prayer with paragraph formatting...")
    prayer = generator.generate_prayer()
    
    if prayer:
        content = prayer.get('content', '') if isinstance(prayer, dict) else str(prayer)
        has_citations = '[1]' in content or '[2]' in content or '[3]' in content
        has_paragraphs = '\n\n' in content
        paragraph_count = content.count('\n\n') + 1 if content else 0
        
        print(f"✅ Prayer generated successfully!")
        print(f"   Word count: {len(content.split())}")
        print(f"   Has citations: {has_citations}")
        print(f"   Has paragraph breaks: {has_paragraphs}")
        print(f"   Number of paragraphs: {paragraph_count}")
        
        if has_citations:
            print("   ⚠️  WARNING: Prayer still contains citations!")
        else:
            print("   ✅ Prayer is clean (no citations)")
        
        if has_paragraphs:
            print("   ✅ Prayer has proper paragraph formatting!")
            # Show paragraph preview
            paragraphs = content.split('\n\n')
            print(f"\n   📝 Paragraph preview:")
            for i, para in enumerate(paragraphs[:3], 1):  # Show first 3 paragraphs
                preview = para[:100] + "..." if len(para) > 100 else para
                print(f"      Paragraph {i}: {preview}")
        else:
            print("   ⚠️  WARNING: Prayer does not have paragraph breaks!")
        
        print(f"\n   📄 Full content preview (first 300 chars):")
        print(f"   {content[:300]}...")
        
        return prayer
    else:
        print("❌ Failed to generate prayer")
        return None

if __name__ == '__main__':
    prayer = regenerate_today_prayer()
    if prayer:
        print("\n✅ Done!")
    else:
        print("\n❌ Failed!")
        sys.exit(1)

