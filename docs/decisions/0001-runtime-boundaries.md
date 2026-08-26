# 0001 — Independent browser and mobile UI boundaries

## Status

Accepted.

## Context

Divine Bridge serves a Jinja/vanilla-JavaScript browser experience and a React
Native Expo application. They use the same backend and real-time media
protocol, but have different rendering, navigation, asset, and deployment
requirements.

## Decision

- The browser UI is owned by `web/`, with Flask page blueprints under `backend/web/`.
- The Expo UI is owned entirely by `mobile/`.
- HTTP API blueprints live under `backend/api/` (no `routes/` compatibility package).
- UI components, styles, assets, and navigation code are not shared across
  browser and mobile.
- Cross-runtime reuse is limited to stable API and SFU protocol contracts under
  `contracts/`, enforced by `tests/contract/`.

## Consequences

The two clients can evolve independently without accidentally introducing
browser dependencies into native builds or native dependencies into Flask
templates. Changes to common API or media behavior require validation in both
clients.
