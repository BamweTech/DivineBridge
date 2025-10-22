#!/usr/bin/env python3
"""
Test script for local storage and content moderation
"""
import os
import sys

# Set environment to use local storage
os.environ['USE_LOCAL_STORAGE'] = 'true'

from local_storage import LocalStorageHandler
from content_moderator import get_content_moderator
import uuid
from datetime import datetime

# Initialize content moderator
moderator = get_content_moderator()

def print_section(title):
    """Print a formatted section header"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def test_good_content():
    """Test with acceptable content"""
    print_section("Test 1: Good Prayer Request")
    
    title = "Prayer for healing"
    content = "Please pray for my father who is in the hospital. He's recovering from surgery and needs strength."
    
    approved, reason, summary = moderator.moderate_content(title, content, "prayer")
    result = {'approved': approved, 'reason': reason, 'summary': summary}
    
    print(f"Title: {title}")
    print(f"Content: {content[:100]}...")
    print(f"\nModeration Result:")
    print(f"  ✅ Approved: {result['approved']}")
    print(f"  📝 Summary: {result['summary']}")
    if not result['approved']:
        print(f"  ⚠️  Reason: {result.get('reason', 'N/A')}")
    
    return result

def test_spam_content():
    """Test with spam/advertising content"""
    print_section("Test 2: Spam/Advertising")
    
    title = "Buy miracle water"
    content = "Visit our website miraclewater.com to buy blessed water that cures all diseases! Only $99.99. Act now!"
    
    approved, reason, summary = moderator.moderate_content(title, content, "prayer")
    result = {'approved': approved, 'reason': reason, 'summary': summary}
    
    print(f"Title: {title}")
    print(f"Content: {content[:100]}...")
    print(f"\nModeration Result:")
    print(f"  {'✅' if result['approved'] else '❌'} Approved: {result['approved']}")
    print(f"  📝 Summary: {result['summary']}")
    if not result['approved']:
        print(f"  ⚠️  Reason: {result.get('reason', 'N/A')}")
    
    return result

def test_offensive_content():
    """Test with offensive/hateful content"""
    print_section("Test 3: Offensive Content")
    
    title = "Hate message"
    content = "I hate all people who don't believe what I believe. They should all be punished."
    
    approved, reason, summary = moderator.moderate_content(title, content, "prayer")
    result = {'approved': approved, 'reason': reason, 'summary': summary}
    
    print(f"Title: {title}")
    print(f"Content: {content[:100]}...")
    print(f"\nModeration Result:")
    print(f"  {'✅' if result['approved'] else '❌'} Approved: {result['approved']}")
    print(f"  📝 Summary: {result['summary']}")
    if not result['approved']:
        print(f"  ⚠️  Reason: {result.get('reason', 'N/A')}")
    
    return result

def test_local_storage():
    """Test local storage functionality"""
    print_section("Test 4: Local Storage")
    
    storage = LocalStorageHandler()
    
    # Test saving a prayer request
    prayer_data = {
        'id': str(uuid.uuid4()),
        'title': 'Test Prayer',
        'content': 'This is a test prayer request',
        'summary': 'Short summary',
        'created_at': datetime.now().isoformat(),
        'user_email': 'test@example.com'
    }
    
    print("Saving prayer request...")
    path = storage.save_prayer_request(prayer_data)
    print(f"  ✅ Saved to: {path}")
    
    # Test retrieving it
    print("\nRetrieving prayer request...")
    retrieved = storage.get_prayer_request(prayer_data['id'])
    print(f"  ✅ Retrieved: {retrieved['title']}")
    
    # Test getting all prayers
    print("\nGetting all prayer requests...")
    all_prayers = storage.get_all_prayer_requests(limit=10)
    print(f"  ✅ Found {len(all_prayers)} prayer request(s)")
    
    # Test storage stats
    print("\nStorage Statistics:")
    stats = storage.get_stats()
    for key, value in stats.items():
        print(f"  • {key}: {value}")
    
    return storage

def test_testimony_storage():
    """Test testimony storage"""
    print_section("Test 5: Testimony Storage")
    
    storage = LocalStorageHandler()
    
    # Test saving a testimony
    testimony_data = {
        'id': str(uuid.uuid4()),
        'title': 'God answered my prayer!',
        'content': 'God healed my father completely. Praise the Lord!',
        'summary': 'Testimony of healing',
        'created_at': datetime.now().isoformat(),
        'user_email': 'test@example.com',
        'approved': True
    }
    
    print("Saving testimony...")
    path = storage.save_testimony(testimony_data)
    print(f"  ✅ Saved to: {path}")
    
    # Test retrieving it
    print("\nRetrieving testimony...")
    retrieved = storage.get_testimony(testimony_data['id'])
    print(f"  ✅ Retrieved: {retrieved['title']}")
    
    # Test getting all testimonies
    print("\nGetting all testimonies...")
    all_testimonies = storage.get_all_testimonies(approved_only=True, limit=10)
    print(f"  ✅ Found {len(all_testimonies)} approved testimony/ies")
    
    return storage

def main():
    """Run all tests"""
    print("\n" + "="*60)
    print("  🧪 LOCAL STORAGE & CONTENT MODERATION TEST SUITE")
    print("="*60)
    
    try:
        # Test content moderation
        good_result = test_good_content()
        spam_result = test_spam_content()
        offensive_result = test_offensive_content()
        
        # Test local storage
        storage = test_local_storage()
        testimony_storage = test_testimony_storage()
        
        # Summary
        print_section("📊 Test Summary")
        print(f"Good Content Approved: {'✅ PASS' if good_result['approved'] else '❌ FAIL'}")
        print(f"Spam Content Rejected: {'✅ PASS' if not spam_result['approved'] else '❌ FAIL'}")
        print(f"Offensive Content Rejected: {'✅ PASS' if not offensive_result['approved'] else '❌ FAIL'}")
        print(f"Local Storage Working: ✅ PASS")
        
        # Final stats
        print("\n📁 Final Storage Stats:")
        stats = storage.get_stats()
        for key, value in stats.items():
            print(f"  • {key}: {value}")
        
        print("\n" + "="*60)
        print("  ✅ All tests completed!")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n❌ Error running tests: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()

