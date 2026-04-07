# routes/ — Flask API Blueprints

This directory contains all Flask API route blueprints. Each file defines one blueprint for a feature area.

## Blueprint registration

Blueprints are imported and registered in `app.py` inside `create_app()`:

1. Import the blueprint: `from routes.feature_bp import feature_bp`
2. Exempt from CSRF: `csrf.exempt(feature_bp)`
3. Register with prefix: `app.register_blueprint(feature_bp, url_prefix='/api/feature')`

Some blueprints define `url_prefix` on the Blueprint itself (e.g. `groups_bp`), others receive it at registration time.

## Current blueprints

| File | Blueprint | Prefix | Auth |
|------|-----------|--------|------|
| `auth_bp.py` | `auth_bp` | `/api/auth` | Mixed |
| `prayer_bp.py` | `prayer_bp` | `/api/prayer` | Mixed |
| `verse_bp.py` | `verse_bp` | `/api` | Public |
| `nonprofit_bp.py` | `nonprofit_bp` | `/api/nonprofit` | Mixed |
| `email_bp.py` | `email_bp` | `/api/email` | Mixed |
| `testimony_bp.py` | `testimony_bp` | `/api/testimony` | Mixed |
| `prayer_room_bp.py` | `prayer_room_bp` | `/api/prayer-room` | `@require_auth` |
| `devotional_bp.py` | `devotional_bp` | `/api/devotional` | `@require_auth` |
| `groups_bp.py` | `groups_bp` | `/api/groups` | `@require_auth` |
| `admin_bp.py` | `admin_bp` | root level | Admin only |
| `seo_bp.py` | `seo_bp` | root level | Public |

## Route handler pattern

```python
@bp.route('/endpoint', methods=['GET'])
@require_auth
def handler():
    db = get_firestore_client()
    # Business logic...
    return jsonify({'success': True, 'data': result}), 200
```

## Conventions

- Use `@require_auth` from `auth_helpers` for protected endpoints. User ID is on `g.user_id`.
- Use `get_firestore_client()` from `firebase_auth` for Firestore access.
- Return standardized JSON: `{'success': True/False, 'data'/'error': ...}`.
- Business logic should live in root-level service modules, not in route handlers.
- Prayer room endpoints are exempted from rate limiting in `app.py`.
