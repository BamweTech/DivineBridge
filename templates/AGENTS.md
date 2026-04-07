# templates/ — Jinja2 HTML Templates

Server-rendered HTML templates for the Divine Bridge web interface.

## Template inheritance

All pages extend `base.html` which provides:
- HTML head with meta tags, CSS imports, Firebase JS SDK.
- Navigation and footer.
- JavaScript initialization.

```html
{% extends "base.html" %}
{% block content %}
  <!-- Page content -->
{% endblock %}
```

## Wiring a template to a route

Templates are rendered from route handlers in `app.py` or blueprint files:

```python
@app.route('/page')
def page():
    return render_template('page.html', data=data)
```

For blueprint routes:

```python
@bp.route('/feature')
def feature():
    return render_template('feature.html', items=items)
```

## Key templates

| Template | Route | Purpose |
|----------|-------|---------|
| `index.html` | `/` | Home page with daily verse and prayer |
| `login.html` | `/login` | Login page |
| `register.html` | `/signup` | Registration page |
| `prayers.html` | `/prayers` | Prayer wall |
| `daily_prayer.html` | `/daily-prayer` | Daily prayer page |
| `prayer_rooms_standalone.html` | `/prayer-room` | Prayer room directory |
| `prayer_room_standalone.html` | `/prayer-room/join` | Individual prayer room |
| `profile.html` | `/profile` | User profile |
| `public_card.html` | `/card/<user_id>` | Public business card |

## Static assets

- CSS in `static/css/`
- JavaScript in `static/js/`
- Images in `static/images/`

Reference static files in templates:

```html
<link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}">
<script src="{{ url_for('static', filename='js/app.js') }}"></script>
```

## Firebase in templates

Firebase client config is passed from Flask routes as `firebase_config` template variable. The `FIREBASE_CLIENT_CONFIG` comes from Secret Manager via `config.py`.

## Conventions

- Always extend `base.html` for consistent layout.
- Use `url_for('static', ...)` for asset references.
- Pass data from route handlers via template variables.
- CSP headers are set in `app.py` `set_security_headers()` — update if adding new external script sources.
