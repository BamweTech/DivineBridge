#!/usr/bin/env python3
"""
Comprehensive test for the Thanksgiving/Testimony feature
Tests all aspects: submission, moderation, storage, retrieval, display
"""
import os
import sys

# Set environment to use local storage
os.environ["USE_LOCAL_STORAGE"] = "true"

from local_storage import LocalStorageHandler
from content_moderator import get_content_moderator
import uuid
from datetime import datetime


def print_section(title, emoji="🔍"):
    """Print a formatted section header"""
    print(f"\n{'='*70}")
    print(f"{emoji} {title}")
    print(f"{'='*70}\n")


def test_storage_methods():
    """Test 1: Verify LocalStorageHandler has all required methods"""
    print_section("TEST 1: Storage Handler Methods", "🔧")

    storage = LocalStorageHandler()
    required_methods = ["save_testimony", "get_testimony", "get_all_testimonies", "update_testimony"]

    print("Checking for required methods...")
    all_exist = True
    for method in required_methods:
        exists = hasattr(storage, method)
        status = "✅" if exists else "❌"
        print(f"  {status} {method}: {'Found' if exists else 'MISSING'}")
        if not exists:
            all_exist = False

    return all_exist


def test_ai_moderation():
    """Test 2: AI Moderation for testimonies"""
    print_section("TEST 2: AI Content Moderation", "🤖")

    moderator = get_content_moderator()

    test_cases = [
        {
            "type": "Good Testimony",
            "title": "God answered my prayer",
            "content": "My father was sick and we prayed for him. God healed him completely! Praise the Lord!",
            "should_approve": True,
        },
        {
            "type": "Spam",
            "title": "Buy our products",
            "content": "Visit our website to buy miracle products! Only $99.99!",
            "should_approve": False,
        },
    ]

    results = []
    for test in test_cases:
        print(f"Testing: {test['type']}")
        print(f"  Title: {test['title']}")
        print(f"  Content: {test['content'][:60]}...")

        approved, reason, summary = moderator.moderate_content(test["title"], test["content"], "testimony")

        expected = "APPROVE" if test["should_approve"] else "REJECT"
        actual = "APPROVE" if approved else "REJECT"
        success = approved == test["should_approve"]

        status = "✅" if success else "❌"
        print(f"  {status} Expected: {expected}, Got: {actual}")

        if not approved and reason:
            print(f"  Reason: {reason}")
        if summary:
            print(f"  Summary: {summary[:80]}...")

        results.append(success)
        print()

    return all(results)


def test_submission_and_storage():
    """Test 3: Submit and store testimonies"""
    print_section("TEST 3: Testimony Submission & Storage", "💾")

    storage = LocalStorageHandler()

    # Create test testimony
    testimony_id = str(uuid.uuid4())
    testimony = {
        "id": testimony_id,
        "title": "Test Testimony",
        "content": "This is a test testimony to verify storage works correctly.",
        "summary": "Test testimony summary",
        "created_at": datetime.now().isoformat(),
        "approved": True,
        "views": 0,
        "likes": 0,
    }

    print("Saving testimony...")
    saved_path = storage.save_testimony(testimony)

    if saved_path:
        print(f"  ✅ Saved to: {saved_path}")
    else:
        print("  ❌ Failed to save")
        return False

    print("\nRetrieving testimony...")
    retrieved = storage.get_testimony(testimony_id)

    if retrieved:
        print(f"  ✅ Retrieved testimony: {retrieved['title']}")
        print(f"     ID matches: {retrieved['id'] == testimony_id}")
        print(f"     Content preserved: {len(retrieved['content']) == len(testimony['content'])}")
    else:
        print("  ❌ Failed to retrieve")
        return False

    print("\nGetting all testimonies...")
    all_testimonies = storage.get_all_testimonies(approved_only=True)
    print(f"  ✅ Found {len(all_testimonies)} approved testimonies")

    print("\nUpdating testimony (incrementing views)...")
    updated_testimony = retrieved.copy()
    updated_testimony["views"] = 5
    success = storage.update_testimony(testimony_id, updated_testimony)

    if success:
        # Verify update
        updated = storage.get_testimony(testimony_id)
        if updated and updated["views"] == 5:
            print(f"  ✅ Update successful (views: {updated['views']})")
        else:
            print("  ❌ Update verification failed")
            return False
    else:
        print("  ❌ Update failed")
        return False

    return True


def test_approved_filter():
    """Test 4: Approved/unapproved filtering"""
    print_section("TEST 4: Approval Filtering", "🔒")

    storage = LocalStorageHandler()

    # Create approved testimony
    approved_id = str(uuid.uuid4())
    approved = {
        "id": approved_id,
        "title": "Approved Testimony",
        "content": "This is an approved testimony.",
        "created_at": datetime.now().isoformat(),
        "approved": True,
    }
    storage.save_testimony(approved)
    print("✅ Created approved testimony")

    # Create unapproved testimony
    unapproved_id = str(uuid.uuid4())
    unapproved = {
        "id": unapproved_id,
        "title": "Unapproved Testimony",
        "content": "This is an unapproved testimony.",
        "created_at": datetime.now().isoformat(),
        "approved": False,
    }
    storage.save_testimony(unapproved)
    print("✅ Created unapproved testimony")

    # Test filtering
    approved_only = storage.get_all_testimonies(approved_only=True)
    all_testimonies = storage.get_all_testimonies(approved_only=False)

    print("\nFiltering results:")
    print(f"  All testimonies: {len(all_testimonies)}")
    print(f"  Approved only: {len(approved_only)}")

    # Verify approved_id is in approved_only
    approved_ids = [t["id"] for t in approved_only]
    unapproved_ids = [t["id"] for t in all_testimonies if not t.get("approved", False)]

    approved_test = approved_id in approved_ids
    unapproved_test = unapproved_id in unapproved_ids

    status1 = "✅" if approved_test else "❌"
    status2 = "✅" if unapproved_test else "❌"

    print(f"  {status1} Approved testimony in approved list: {approved_test}")
    print(f"  {status2} Unapproved testimony in unapproved list: {unapproved_test}")

    return approved_test and unapproved_test


def test_data_integrity():
    """Test 5: Data integrity and required fields"""
    print_section("TEST 5: Data Integrity", "🔍")

    storage = LocalStorageHandler()

    required_fields = ["id", "title", "content", "created_at", "approved"]

    # Create testimony with all fields
    testimony_id = str(uuid.uuid4())
    testimony = {
        "id": testimony_id,
        "title": "Complete Testimony",
        "content": "This testimony has all required fields.",
        "summary": "Summary here",
        "created_at": datetime.now().isoformat(),
        "approved": True,
        "views": 0,
        "likes": 0,
        "moderation": {"approved": True, "moderated_at": datetime.now().isoformat()},
    }

    storage.save_testimony(testimony)
    retrieved = storage.get_testimony(testimony_id)

    print("Checking required fields...")
    all_present = True
    for field in required_fields:
        present = field in retrieved
        status = "✅" if present else "❌"
        print(f"  {status} {field}: {'Present' if present else 'MISSING'}")
        if not present:
            all_present = False

    print("\nChecking data types...")
    type_checks = [("id", str), ("title", str), ("content", str), ("approved", bool), ("views", int), ("likes", int)]

    all_correct = True
    for field, expected_type in type_checks:
        if field in retrieved:
            actual_type = type(retrieved[field])
            correct = isinstance(retrieved[field], expected_type)
            status = "✅" if correct else "❌"
            print(f"  {status} {field}: {expected_type.__name__} {'✓' if correct else f'(got {actual_type.__name__})'}")
            if not correct:
                all_correct = False

    return all_present and all_correct


def run_all_tests():
    """Run all tests"""
    print("\n" + "=" * 70)
    print("  🧪 THANKSGIVING/TESTIMONY SYSTEM TEST SUITE")
    print("=" * 70)

    tests = [
        ("Storage Methods", test_storage_methods),
        ("AI Moderation", test_ai_moderation),
        ("Submission & Storage", test_submission_and_storage),
        ("Approval Filtering", test_approved_filter),
        ("Data Integrity", test_data_integrity),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n❌ ERROR in {test_name}: {e}")
            import traceback

            traceback.print_exc()
            results.append((test_name, False))

    # Summary
    print_section("📊 TEST SUMMARY", "📊")

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}  {test_name}")

    print(f"\n{'='*70}")
    print(f"  Results: {passed}/{total} tests passed")

    if passed == total:
        print("  🎉 ALL TESTS PASSED! System is working correctly.")
    else:
        print("  ⚠️  Some tests failed. Please review the issues above.")

    print(f"{'='*70}\n")

    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
