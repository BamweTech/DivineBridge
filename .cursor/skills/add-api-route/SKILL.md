---
name: add-api-route
description: >-
  Add a new Flask API route to Divine Bridge following the established blueprint
  pattern. Use when creating new API endpoints or backend features.
---

# Add a New API Route

## Step 1: Create or update the blueprint

Create a new file under `backend/api/` (or a package under `backend/api/<domain>/`) or extend an existing blueprint:

```python
"""
Feature description routes.
"""
import logging
from flask import Blueprint, request, jsonify, g
from backend.integrations.firebase_auth import get_firestore_client
from backend.core.auth.helpers import require_auth

logger = logging.getLogger(__name__)
feature_bp = Blueprint('feature', __name__, url_prefix='/api/feature')


@feature_bp.route('', methods=['GET'])
@require_auth
def list_items():
    db = get_firestore_client()
    # Implementation...
    return jsonify({'success': True, 'data': items}), 200


@feature_bp.route('', methods=['POST'])
@require_auth
def create_item():
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400
    # Validate and create...
    return jsonify({'success': True, 'data': new_item}), 201
```

## Step 2: Register in app.py

In `create_app()` inside `app.py`, add the import and registration:

```python
from backend.api.feature_bp import feature_bp

csrf.exempt(feature_bp)
app.register_blueprint(feature_bp)  # url_prefix set on blueprint
```

If the blueprint does NOT define `url_prefix`, pass it in registration:
```python
app.register_blueprint(feature_bp, url_prefix='/api/feature')
```

## Step 3: Add authentication (if needed)

- Use `@require_auth` from `backend.core.auth.helpers` for authenticated endpoints.
- The authenticated user ID is available as `g.user_id`.
- For public endpoints, omit the decorator.

## Step 4: Use standardized response format

- Success: `{'success': True, 'data': ...}`
- Error: `{'success': False, 'error': 'message'}`
- See `.cursor/rules/api-response-format.mdc` for full details.

## Step 5: Add / update contracts and tests

- Add or extend a fixture under `contracts/` when the public URL surface changes.
- Add pytest coverage under `tests/unit/` or `tests/contract/`.
- Run `python -m scripts.maintenance.verify_route_map` if route inventory is affected.

## Step 6: Update docs / agents

- Update `backend/api/AGENTS.md` blueprint table.
- Update `docs/ARCHITECTURE.md` if the feature is architectural.
- Update mobile `services/api.ts` (+ hooks) when the mobile client consumes the endpoint.
