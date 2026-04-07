# Divine Bridge — Agent Context

Divine Bridge is a multi-stack faith community platform. This file provides top-level context for AI coding agents.

## Tech stack

| Layer | Stack | Entry point |
|-------|-------|-------------|
| Backend API + web | Python 3.8+, Flask, Jinja2 | `app.py` |
| Mobile app | TypeScript, Expo ~54, React Native | `mobile/app/_layout.tsx` |
| Media SFU | Node.js >=18, mediasoup, WebSocket | `media-server/src/server.js` |
| Data | Firebase (Firestore, RTDB, Auth), Google Cloud Storage | `firebase_auth.py`, `firestore.rules` |
| Hosting | Google Cloud Run (Flask), separate Node deploy (SFU) | `Dockerfile`, `cloud-run-config.yaml` |

## Key architectural decisions

- Flask serves both the REST API (`/api/...`) and server-rendered HTML (Jinja2 templates).
- Firebase Auth is the single identity provider across web, mobile, and SFU.
- Firestore is the primary database; RTDB is used for low-latency live room state.
- The SFU is a separate Node.js process, not part of the Flask container.
- Secrets are managed via Google Cloud Secret Manager (see `config.py`).

## Project conventions

- Check existing code before creating new implementations.
- Check for today's prayer in storage before generating a new one.
- No deployments without review and approval.
- Blueprints in `routes/`, business logic in root-level service modules.
- Mobile uses expo-router file-based routing, TanStack Query, Zustand, NativeWind.

## Directory map

- `routes/` — Flask API blueprints
- `templates/` — Jinja2 HTML templates
- `static/` — CSS, JS, images for web
- `mobile/` — Expo React Native app
- `media-server/` — mediasoup SFU
- `tests/` — Pytest test suite
- `scripts/` — Deploy scripts, migrations, admin utilities
- `docs/` — Architecture docs, deployment guides
- `.cursor/rules/` — File-scoped agent rules
- `.cursor/skills/` — Multi-step workflow skills
- `.cursor/agents/` — Custom subagents

## Full architecture reference

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete system diagram, data model, and feature index.
