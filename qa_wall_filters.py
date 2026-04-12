"""
Fingerprints for QA / production-readiness content that must not appear on public walls.

Used by API routes, the cleanup script, and (mirrored in JS) the prayers page client.
"""

PRODUCTION_TEST_TESTIMONY_TITLE = "Production Test Testimony"
PRODUCTION_TEST_TESTIMONY_MARKER = "test testimony for production readiness."
PRODUCTION_TEST_USER_ID = "test-user-123"


def is_hidden_production_test_wall_item(obj: dict) -> bool:
    """True if this testimony or prayer-request dict should never be shown publicly."""
    if not isinstance(obj, dict):
        return False
    title = (obj.get("title") or "").strip()
    title_l = title.lower()
    content = (obj.get("content") or "").lower()
    if title == PRODUCTION_TEST_TESTIMONY_TITLE:
        return True
    if "production test testimony" in title_l:
        return True
    if PRODUCTION_TEST_TESTIMONY_MARKER in content:
        return True
    uid = (obj.get("user_id") or "").strip()
    if uid == PRODUCTION_TEST_USER_ID:
        return True
    return False
