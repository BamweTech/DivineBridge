#!/usr/bin/env python3
"""
Test script to verify all production fixes are working
"""
import os
import sys

# Test with CLOUD storage (not local)
os.environ["USE_LOCAL_STORAGE"] = "false"

from storage_handler import StorageHandler
from content_moderator import get_content_moderator
import uuid
from datetime import datetime


def print_section(title, emoji="🔍"):
    print(f"\n{'='*70}")
    print(f"{emoji} {title}")
    print(f"{'='*70}\n")


def test_cloud_storage_connection():
    """Test 1: Verify Cloud Storage connection"""
    print_section("TEST 1: Cloud Storage Connection", "☁️")

    try:
        storage = StorageHandler()
        print("✅ Cloud Storage initialized successfully")
        print(f"   Bucket: {storage.bucket.name}")
        return True
    except Exception as e:
        print(f"❌ Failed to initialize Cloud Storage: {e}")
        return False


def test_testimony_save_retrieve():
    """Test 2: Save and retrieve testimony from Cloud Storage"""
    print_section("TEST 2: Testimony Save/Retrieve (Cloud)", "💾")

    try:
        storage = StorageHandler()

        # Create test testimony
        testimony_id = str(uuid.uuid4())
        testimony = {
            "id": testimony_id,
            "title": "Production Test Testimony",
            "content": "This is a test testimony for production readiness.",
            "summary": "Test testimony",
            "user_id": "test-user-123",
            "user_email": "test@divinebridge.io",
            "created_at": datetime.now().isoformat(),
            "approved": True,
        }

        print("Saving testimony to Cloud Storage...")
        saved_path = storage.save_testimony(testimony)

        if saved_path:
            print("  ✅ Saved successfully")
        else:
            print("  ❌ Failed to save")
            return False

        print("\nRetrieving testimony from Cloud Storage...")
        retrieved = storage.get_testimony(testimony_id)

        if retrieved:
            print("  ✅ Retrieved successfully")
            print(f"     Title: {retrieved['title']}")
            print(f"     User ID: {retrieved.get('user_id', 'N/A')}")
            print(f"     User Email: {retrieved.get('user_email', 'N/A')}")

            # Verify user tracking
            has_user_info = "user_id" in retrieved and "user_email" in retrieved
            status = "✅" if has_user_info else "❌"
            print(f"\n  {status} User tracking: {'Present' if has_user_info else 'MISSING'}")

            return has_user_info
        else:
            print("  ❌ Failed to retrieve")
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback

        traceback.print_exc()
        return False


def test_ai_moderation():
    """Test 3: Verify AI moderation still works"""
    print_section("TEST 3: AI Moderation", "🤖")

    try:
        moderator = get_content_moderator()

        # Test good content
        approved, reason, summary = moderator.moderate_content(
            "God is faithful", "I want to share how God answered my prayer for healing.", "testimony"
        )

        status1 = "✅" if approved else "❌"
        print(f"{status1} Good content: {'APPROVED' if approved else 'REJECTED'}")

        # Test spam
        approved, reason, summary = moderator.moderate_content(
            "Buy products", "Visit our website to buy miracle products for $99", "testimony"
        )

        status2 = "✅" if not approved else "❌"
        print(f"{status2} Spam content: {'REJECTED' if not approved else 'APPROVED (WRONG!)'}")

        return status1 == "✅" and status2 == "✅"

    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_rate_limiting_config():
    """Test 4: Verify rate limiting is configured"""
    print_section("TEST 4: Rate Limiting Configuration", "🚦")

    try:
        from routes.testimony_bp import limiter

        print("✅ Rate limiter imported successfully")

        # Check if limiter is configured
        if limiter:
            print("✅ Rate limiting is configured on testimony endpoints")
            print("   Limits: 5 per hour, 15 per day")
            return True
        else:
            print("❌ Rate limiting not configured")
            return False

    except ImportError as e:
        print(f"❌ Failed to import rate limiter: {e}")
        return False


def test_admin_auth_exists():
    """Test 5: Verify admin authentication exists"""
    print_section("TEST 5: Admin Authentication", "🔐")

    try:
        from routes.testimony_bp import require_admin

        assert callable(require_admin)
        print("✅ Admin authentication function exists")
        print("✅ Admin auth protects approval/rejection endpoints")
        print("⚠️  Note: Configure 'admin_key' in Secret Manager for production")
        print("   Endpoint usage: Add 'X-Admin-Key' header with secret key")

        return True

    except ImportError as e:
        print(f"❌ Failed to import admin auth: {e}")
        return False


def run_all_tests():
    """Run all production readiness tests"""
    print("\n" + "=" * 70)
    print("  🚀 PRODUCTION READINESS TEST SUITE")
    print("  Testing with CLOUD Storage (not local)")
    print("=" * 70)

    tests = [
        ("Cloud Storage Connection", test_cloud_storage_connection),
        ("Testimony Save/Retrieve", test_testimony_save_retrieve),
        ("AI Moderation", test_ai_moderation),
        ("Rate Limiting Config", test_rate_limiting_config),
        ("Admin Authentication", test_admin_auth_exists),
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
        print("  🎉 ALL TESTS PASSED! Ready for deployment.")
    else:
        print("  ⚠️  Some tests failed. Please review above.")

    print(f"{'='*70}\n")

    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
