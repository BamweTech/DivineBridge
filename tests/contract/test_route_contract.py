"""Public HTTP contract checks for repository-structure migrations.

These checks deliberately assert URL and endpoint identity rather than an
implementation detail, so modules can move without silently changing the
deployed Flask surface.
"""

from app import create_app


EXPECTED_PUBLIC_RULES = {
    ("/api/auth/login", "POST"),
    ("/api/prayer/prayer/<date>", "GET"),
    ("/api/today-verse", "GET"),
    ("/api/groups", "GET"),
    ("/api/prayer-room/rooms", "GET"),
}


def test_public_api_endpoints_remain_registered():
    """Structural moves must preserve the existing public URL and method pairs."""
    app = create_app()
    registered_rules = {
        (rule.rule, method) for rule in app.url_map.iter_rules() for method in rule.methods - {"HEAD", "OPTIONS"}
    }

    assert EXPECTED_PUBLIC_RULES <= registered_rules


def test_static_assets_keep_their_public_url_prefix():
    """Web asset relocation must not change template-facing /static URLs."""
    app = create_app()
    static_rule = next(rule for rule in app.url_map.iter_rules() if rule.endpoint == "static")

    assert static_rule.rule == "/static/<path:filename>"


def test_canonical_wsgi_entry_uses_the_compatibility_application():
    """The new package entry point must expose the established Flask app."""
    from backend.wsgi import app as canonical_app

    from app import app as compatibility_app

    assert canonical_app is compatibility_app
