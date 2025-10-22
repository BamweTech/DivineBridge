#!/usr/bin/env python3
"""
Final comprehensive deployment check
Verifies all systems are ready for production deployment
"""
import os
import sys
import re

def print_header(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}\n")

def check_file_exists(filepath):
    """Check if a file exists"""
    return os.path.exists(filepath)

def check_pattern_in_file(filepath, pattern, description):
    """Check if a pattern exists in a file"""
    try:
        with open(filepath, 'r') as f:
            content = f.read()
            exists = re.search(pattern, content, re.MULTILINE | re.DOTALL) is not None
            status = "✅" if exists else "❌"
            print(f"  {status} {description}")
            return exists
    except Exception as e:
        print(f"  ❌ Error checking {filepath}: {e}")
        return False

def check_no_pattern_in_file(filepath, pattern, description):
    """Check that a pattern does NOT exist in a file"""
    try:
        with open(filepath, 'r') as f:
            content = f.read()
            not_exists = re.search(pattern, content, re.MULTILINE) is None
            status = "✅" if not_exists else "❌"
            print(f"  {status} {description}")
            return not_exists
    except Exception as e:
        print(f"  ❌ Error checking {filepath}: {e}")
        return False

print_header("🚀 FINAL DEPLOYMENT READINESS CHECK")

all_checks = []

# Check 1: Critical Security Features
print_header("🔒 SECURITY FEATURES")
checks = [
    check_pattern_in_file('templates/prayers.html', r'if \(!currentUser\)', 
                         'Login requirement for submissions'),
    check_pattern_in_file('routes/testimony_bp.py', r"user_id = data\.get\('user_id'",
                         'User tracking in testimonies'),
    check_pattern_in_file('routes/testimony_bp.py', r'@limiter\.limit',
                         'Rate limiting on testimonies'),
    check_pattern_in_file('routes/testimony_bp.py', r'def require_admin',
                         'Admin authentication function'),
    check_pattern_in_file('routes/testimony_bp.py', r'if not require_admin',
                         'Admin auth applied to endpoints'),
]
all_checks.extend(checks)

# Check 2: AI Moderation
print_header("🤖 AI MODERATION")
checks = [
    check_file_exists('content_moderator.py'),
    check_pattern_in_file('routes/prayer_bp.py', r'get_content_moderator',
                         'Prayer moderation integrated'),
    check_pattern_in_file('routes/testimony_bp.py', r'get_content_moderator',
                         'Testimony moderation integrated'),
]
for check in checks:
    print(f"  {'✅' if check else '❌'} {'Found' if check else 'Missing'}")
all_checks.extend(checks)

# Check 3: Storage Methods
print_header("💾 CLOUD STORAGE METHODS")
checks = [
    check_pattern_in_file('storage_handler.py', r'def save_testimony\(',
                         'save_testimony() method exists'),
    check_pattern_in_file('storage_handler.py', r'def get_testimony\(',
                         'get_testimony() method exists'),
    check_pattern_in_file('storage_handler.py', r'def get_all_testimonies\(',
                         'get_all_testimonies() method exists'),
    check_pattern_in_file('storage_handler.py', r'def update_testimony\(',
                         'update_testimony() method exists'),
]
all_checks.extend(checks)

# Check 4: UX Features
print_header("✨ UX ENHANCEMENTS")
checks = [
    check_pattern_in_file('templates/prayers.html', r'class="spinner"',
                         'Loading spinners'),
    check_pattern_in_file('templates/prayers.html', r'char-counter',
                         'Character counters'),
    check_pattern_in_file('templates/prayers.html', r'testimony-category',
                         'Testimony categories'),
    check_pattern_in_file('templates/prayers.html', r'sharePrayerRequest|shareTestimony',
                         'Share functionality'),
    check_pattern_in_file('templates/prayers.html', r'min-height: 44px',
                         'Mobile optimization (44px touch targets)'),
]
all_checks.extend(checks)

# Check 5: No Test/Debug Code
print_header("🧹 CLEANUP CHECK")
checks = [
    check_no_pattern_in_file('templates/prayers.html', r'Allow anonymous.*testing',
                            'No anonymous testing code'),
    check_no_pattern_in_file('templates/prayers.html', r'console\.log.*TEST',
                            'No test console logs'),
]
all_checks.extend(checks)

# Check 6: Required Files
print_header("📁 REQUIRED FILES")
required_files = [
    'app.py',
    'routes/testimony_bp.py',
    'routes/prayer_bp.py',
    'storage_handler.py',
    'content_moderator.py',
    'templates/prayers.html',
    'templates/profile.html',
    'Dockerfile',
    'requirements.txt',
]

for filepath in required_files:
    exists = check_file_exists(filepath)
    status = "✅" if exists else "❌"
    print(f"  {status} {filepath}")
    all_checks.append(exists)

# Check 7: Environment Configuration
print_header("⚙️  CONFIGURATION")
checks = [
    check_pattern_in_file('app.py', r'USE_LOCAL_STORAGE.*getenv',
                         'Environment-based storage selection'),
    check_pattern_in_file('routes/testimony_bp.py', r'USE_LOCAL_STORAGE',
                         'Testimony BP uses env config'),
    check_pattern_in_file('routes/prayer_bp.py', r'USE_LOCAL_STORAGE',
                         'Prayer BP uses env config'),
]
all_checks.extend(checks)

# Check 8: Profile Page Update
print_header("👤 PROFILE PAGE")
checks = [
    check_pattern_in_file('templates/profile.html', r'testimonies-shared',
                         'Testimonies Shared stat card'),
    check_pattern_in_file('templates/profile.html', r'filter\(t => t\.user_id === userId\)',
                         'User-specific testimony count'),
    check_no_pattern_in_file('templates/profile.html', r'days-active',
                            'Days Active removed'),
]
all_checks.extend(checks)

# Summary
print_header("📊 FINAL SUMMARY")

passed = sum(1 for check in all_checks if check)
total = len(all_checks)
percentage = int((passed / total) * 100)

print(f"  Total Checks: {total}")
print(f"  Passed: {passed}")
print(f"  Failed: {total - passed}")
print(f"  Success Rate: {percentage}%")
print()

if passed == total:
    print("  🎉 ALL CHECKS PASSED!")
    print()
    print("  ✅ Security features implemented")
    print("  ✅ AI moderation integrated")
    print("  ✅ Storage methods complete")
    print("  ✅ UX enhancements added")
    print("  ✅ No debug code present")
    print("  ✅ All required files present")
    print("  ✅ Configuration ready")
    print("  ✅ Profile page updated")
    print()
    print("  🚀 READY FOR DEPLOYMENT!")
    print()
    sys.exit(0)
else:
    print(f"  ⚠️  {total - passed} CHECK(S) FAILED")
    print()
    print("  Please review failed checks above before deploying.")
    print()
    sys.exit(1)

