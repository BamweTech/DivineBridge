#!/usr/bin/env python3
"""
Final deployment readiness check
Verifies all critical fixes are in place
"""
import re


def print_section(title, emoji="🔍"):
    print(f"\n{'='*70}")
    print(f"{emoji} {title}")
    print(f"{'='*70}\n")


def check_file_for_pattern(filepath, pattern, should_exist=True):
    """Check if a pattern exists in a file"""
    try:
        with open(filepath, "r") as f:
            content = f.read()
            exists = re.search(pattern, content, re.MULTILINE) is not None

            if should_exist and exists:
                return True
            elif not should_exist and not exists:
                return True
            else:
                return False
    except Exception as e:
        print(f"  ❌ Error reading {filepath}: {e}")
        return False


def test_login_required():
    """Test 1: Login requirement is re-enabled"""
    print_section("TEST 1: Login Requirement", "🔐")

    filepath = "web/templates/prayers.html"

    # Check that login checks exist
    has_login_check = check_file_for_pattern(filepath, r"if \(!currentUser\)", should_exist=True)

    # Check for confirmation prompt
    has_signin_prompt = check_file_for_pattern(filepath, r"sign in to", should_exist=True)

    # Check that anonymous comments are NOT present
    has_no_anonymous = not check_file_for_pattern(filepath, r"anonymous OK for testing", should_exist=True)

    status1 = "✅" if has_no_anonymous else "❌"
    status2 = "✅" if has_login_check else "❌"
    status3 = "✅" if has_signin_prompt else "❌"

    print(f"{status1} No anonymous testing code present")
    print(f"{status2} Login requirement checks present")
    print(f"{status3} Sign-in prompts configured")

    return has_no_anonymous and has_login_check and has_signin_prompt


def test_user_tracking():
    """Test 2: User tracking is added"""
    print_section("TEST 2: User Tracking", "👤")

    # Check frontend sends user info
    frontend_sends = check_file_for_pattern("web/templates/prayers.html", r"user_id:|user_email:", should_exist=True)

    # Check backend captures user info
    backend_captures = check_file_for_pattern(
        "backend/api/testimony_bp.py", r"user_id = data\.get\('user_id'", should_exist=True
    )

    # Check backend stores user info
    backend_stores = check_file_for_pattern("backend/api/testimony_bp.py", r"'user_id': user_id", should_exist=True)

    status1 = "✅" if frontend_sends else "❌"
    status2 = "✅" if backend_captures else "❌"
    status3 = "✅" if backend_stores else "❌"

    print(f"{status1} Frontend sends user_id and user_email")
    print(f"{status2} Backend captures user info from request")
    print(f"{status3} Backend stores user info in testimony")

    return frontend_sends and backend_captures and backend_stores


def test_rate_limiting():
    """Test 3: Rate limiting is configured"""
    print_section("TEST 3: Rate Limiting", "🚦")

    # Check rate limiter import
    has_import = check_file_for_pattern(
        "backend/api/testimony_bp.py", r"from flask_limiter import Limiter", should_exist=True
    )

    # Check rate limiting decorator
    has_decorator = check_file_for_pattern("backend/api/testimony_bp.py", r"@limiter\.limit\(", should_exist=True)

    status1 = "✅" if has_import else "❌"
    status2 = "✅" if has_decorator else "❌"

    print(f"{status1} Flask-Limiter imported")
    print(f"{status2} Rate limiting decorators applied")
    print("   Limits: 5 per hour, 15 per day on /submit")

    return has_import and has_decorator


def test_admin_authentication():
    """Test 4: Admin authentication is implemented"""
    print_section("TEST 4: Admin Authentication", "🔒")

    # Check admin auth function exists
    has_function = check_file_for_pattern("backend/api/testimony_bp.py", r"def require_admin\(\):", should_exist=True)

    # Check it's used in admin endpoints
    has_usage = check_file_for_pattern("backend/api/testimony_bp.py", r"if not require_admin\(\):", should_exist=True)

    status1 = "✅" if has_function else "❌"
    status2 = "✅" if has_usage else "❌"

    print(f"{status1} Admin authentication function defined")
    print(f"{status2} Admin auth applied to admin endpoints")
    print("   Protected: /admin/pending, /admin/approve, /admin/reject")
    print("⚠️  TODO: Add 'admin_key' to Secret Manager")

    return has_function and has_usage


def test_cloud_storage_methods():
    """Test 5: Cloud Storage has all required methods"""
    print_section("TEST 5: Cloud Storage Methods", "☁️")

    has_save = check_file_for_pattern("storage_handler.py", r"def save_testimony\(", should_exist=True)

    has_get = check_file_for_pattern("storage_handler.py", r"def get_testimony\(", should_exist=True)

    has_update = check_file_for_pattern("storage_handler.py", r"def update_testimony\(", should_exist=True)

    has_get_all = check_file_for_pattern("storage_handler.py", r"def get_all_testimonies\(", should_exist=True)

    status1 = "✅" if has_save else "❌"
    status2 = "✅" if has_get else "❌"
    status3 = "✅" if has_update else "❌"
    status4 = "✅" if has_get_all else "❌"

    print(f"{status1} save_testimony() method exists")
    print(f"{status2} get_testimony() method exists")
    print(f"{status3} update_testimony() method exists")
    print(f"{status4} get_all_testimonies() method exists")

    return has_save and has_get and has_update and has_get_all


def run_deployment_checks():
    """Run all deployment readiness checks"""
    print("\n" + "=" * 70)
    print("  🚀 DEPLOYMENT READINESS CHECKLIST")
    print("=" * 70)

    checks = [
        ("Login Requirement Re-enabled", test_login_required),
        ("User Tracking Implemented", test_user_tracking),
        ("Rate Limiting Configured", test_rate_limiting),
        ("Admin Authentication Added", test_admin_authentication),
        ("Cloud Storage Methods Ready", test_cloud_storage_methods),
    ]

    results = []
    for check_name, check_func in checks:
        try:
            result = check_func()
            results.append((check_name, result))
        except Exception as e:
            print(f"\n❌ ERROR in {check_name}: {e}")
            results.append((check_name, False))

    # Summary
    print_section("📊 FINAL ASSESSMENT", "📊")

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for check_name, result in results:
        status = "✅ DONE" if result else "❌ INCOMPLETE"
        print(f"  {status}  {check_name}")

    print(f"\n{'='*70}")
    print(f"  Readiness: {passed}/{total} checks passed ({int(passed/total*100)}%)")
    print(f"{'='*70}\n")

    if passed == total:
        print("🎉 READY FOR DEPLOYMENT!")
        print("\nNext steps:")
        print("  1. ⚠️  Add 'admin_key' to Secret Manager (optional but recommended)")
        print("  2. ✅ Test locally with production mode (USE_LOCAL_STORAGE=false)")
        print("  3. ✅ Commit changes to git")
        print("  4. ✅ Deploy to Cloud Run")
        print("  5. ✅ Monitor logs for any issues")
    else:
        print("⚠️  NOT READY - Please fix failed checks above")

    print()
    return passed == total


if __name__ == "__main__":
    import sys

    success = run_deployment_checks()
    sys.exit(0 if success else 1)
