# backend/api/ — Flask API blueprints

Canonical home for Divine Bridge HTTP API blueprints.

## Layout

| Path | Purpose |
|------|---------|
| `*_bp.py` | Feature blueprints (auth, prayer, verse, groups, …) |
| `prayer_room/` | Live rooms, Voice Link, chat, scheduled sessions |
| `seo/` | Sitemap, disaster pages, group invite landing |

## Adding a route

1. Prefer an existing blueprint under `backend/api/`.
2. Register new blueprints in `app.py` `create_app()` with `csrf.exempt()` and `url_prefix`.
3. Keep JSON response shape `{ "success": bool, ... }` (see `.cursor/rules/api-response-format.mdc`).
4. Add or update a fixture under `contracts/` when the public URL surface changes.
5. Run `USE_LOCAL_STORAGE=true pytest tests/contract/ -q`.

## Imports

```python
from backend.api import auth_bp, prayer_bp, groups_bp
from backend.api.prayer_room import prayer_room_bp
from backend.api.seo import seo_bp
```

Do not add a `routes/` package — that compatibility layer has been removed.
