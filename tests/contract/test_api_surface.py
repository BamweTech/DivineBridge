"""API surface contracts for auth, groups, and prayer-room blueprints."""

from __future__ import annotations

import json
from pathlib import Path

from app import create_app

ROOT = Path(__file__).resolve().parents[2]


def _registered_pairs(app):
    return {(rule.rule, method) for rule in app.url_map.iter_rules() for method in rule.methods - {"HEAD", "OPTIONS"}}


def _fixture_pairs(name: str):
    data = json.loads((ROOT / "contracts" / name).read_text())
    pairs = set()
    for endpoint in data["endpoints"]:
        for method in endpoint["methods"]:
            pairs.add((endpoint["path"], method))
    return pairs


def test_auth_api_contract_endpoints_are_registered():
    app = create_app()
    assert _fixture_pairs("api-auth.json") <= _registered_pairs(app)


def test_groups_api_contract_endpoints_are_registered():
    app = create_app()
    assert _fixture_pairs("api-groups.json") <= _registered_pairs(app)


def test_prayer_room_api_contract_endpoints_are_registered():
    app = create_app()
    assert _fixture_pairs("api-prayer-room.json") <= _registered_pairs(app)


def test_verse_api_contract_endpoints_are_registered():
    app = create_app()
    assert _fixture_pairs("api-verse.json") <= _registered_pairs(app)


def test_canonical_blueprint_package_is_backend_api():
    """Blueprints must live under backend.api — no routes/ compatibility package."""
    import backend.api as api

    assert hasattr(api, "auth_bp")
    assert hasattr(api, "groups_bp")
    assert hasattr(api, "prayer_room_bp")
    assert not (ROOT / "routes").exists()
