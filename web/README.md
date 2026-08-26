# Web runtime boundary

This directory owns the browser implementation:

- `templates/` — Jinja2 HTML templates
- `static/` — CSS, JavaScript, images, and generated SFU bundle
- `client/` — browser mediasoup-client esbuild source

Flask is configured in `app.py` to serve these folders while preserving the
public `/static/...` URL prefix. Do not place Expo or React Native UI here;
mobile UI belongs exclusively in `mobile/`.

Build the browser SFU bundle from `web/client`:

```bash
cd web/client && npm run build
```

Output: `web/static/js/sfu-bundle.js`.
