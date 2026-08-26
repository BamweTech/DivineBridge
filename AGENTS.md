# Divine Bridge — Agent Context

Divine Bridge is a multi-stack faith community platform. This file provides top-level context for AI coding agents.

## Tech stack

| Layer | Stack | Entry point |
|-------|-------|-------------|
| Backend API + web | Python 3.8+, Flask, Jinja2 | `app.py` |
| Mobile app | TypeScript, Expo ~54, React Native | `mobile/app/_layout.tsx` |
| Media SFU | Node.js >=18, mediasoup, WebSocket | `media-server/src/server.js` |
| Data | Firebase (Firestore, RTDB, Auth), Google Cloud Storage | `backend/integrations/firebase_auth.py`, `firestore.rules` |
| Hosting | Google Cloud Run (Flask), separate Node deploy (SFU) | `Dockerfile`, `cloud-run-config.yaml` |

## Key architectural decisions

- Flask serves both the REST API (`/api/...`) and server-rendered HTML (Jinja2 templates).
- Firebase Auth is the single identity provider across web, mobile, and SFU.
- Firestore is the primary database; RTDB is used for low-latency live room state.
- The SFU is a separate Node.js process, not part of the Flask container.
- Secrets are managed via Google Cloud Secret Manager (see `backend/core/config.py`).

## Project conventions

- Check existing code before creating new implementations.
- Check for today's prayer in storage before generating a new one.
- No deployments without review and approval.
- `backend/` is the canonical backend package. Public API/SFU contracts live in `contracts/` with tests under `tests/contract/`.
- Mobile uses expo-router file-based routing, TanStack Query, Zustand, NativeWind.

## Directory map

- `backend/` — canonical Flask package (`api/`, `core/`, `integrations/`, `services/`, `jobs/`, `web/`, `wsgi.py`)
- `web/` — browser UI (`templates/`, `static/`, `client/`); do not place Expo UI here
- `mobile/` — Expo React Native app (`app/` routes, `features/`, `components/ui/`, `services/`)
- `media-server/` — mediasoup SFU
- `contracts/` — runtime-neutral API/SFU protocol fixtures
- `tests/` — Pytest suite (`unit/`, `contract/`, `integration/`, `load/`)
- `scripts/` — Operational scripts (`content/`, `emailing/`, `admin/`, `maintenance/`, `deploy/`, `metro/`)
- `infra/` — infrastructure ownership notes (tool-required files stay at repo root)
- `docs/` — Architecture docs, deployment guides
- `.cursor/rules/` — File-scoped agent rules
- `.cursor/skills/` — Multi-step workflow skills (e.g. `update-mobile-wireframe` for `divinebridge-app-v4.html`)
- `divinebridge-app-v4.html` — Local mobile UI wireframe (not deployed; keep in sync with `mobile/app/`)
- `.cursor/agents/` — Custom subagents

## Full architecture reference

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete system diagram, data model, and feature index.
