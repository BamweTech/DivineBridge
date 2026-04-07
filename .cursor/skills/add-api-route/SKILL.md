---
name: add-api-route
description: >-
  Add a new Flask API route to Divine Bridge following the established blueprint
  pattern. Use when creating new API endpoints or backend features.
---

# Add a New API Route

## Step 1: Create or update the blueprint

Create a new file in `routes/` or add to an existing blueprint:

```python
"""
Feature description routes.
"""
import logging
from flask import Blueprint, request, jsonify, g
from firebase_admin import firestore
from firebase_auth import get_firestore_client
from auth_helpers import require_auth

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
from routes.feature_bp import feature_bp

csrf.exempt(feature_bp)
app.register_blueprint(feature_bp)  # url_prefix set on blueprint
```

If the blueprint does NOT define `url_prefix`, pass it in registration:
```python
app.register_blueprint(feature_bp, url_prefix='/api/feature')
```

## Step 3: Add authentication (if needed)

- Use `@require_auth` decorator from `auth_helpers` for authenticated endpoints.
- The authenticated user ID is available as `g.user_id`.
- For public endpoints, omit the decorator.

## Step 4: Use standardized response format

- Success: `{'success': True, 'data': ...}`
- Error: `{'success': False, 'error': 'message'}`
- See `.cursor/rules/api-response-format.mdc` for full details.

## Step 5: Add tests

Create `tests/test_feature.py`:

```python
import pytest
from app import create_app

@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_list_items(client):
    response = client.get('/api/feature')
    assert response.status_code in (200, 401)
```

## Step 6: Update mobile API client (if needed)

Add the endpoint to `mobile/services/api.ts`:

```typescript
export const featureApi = {
  list: () => request<{ success: boolean; data: Feature[] }>('/api/feature'),
  create: (body: CreateFeatureInput) =>
    request<{ success: boolean; data: Feature }>('/api/feature', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
```

Then create a TanStack Query hook in `mobile/hooks/useFeature.ts` if the data needs caching.
