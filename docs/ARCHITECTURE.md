# Divine Bridge — Full application architecture

This document describes how the product is structured across **web**, **mobile**, **backend**, **realtime data**, **live media (WebRTC)**, and **email**. It complements user-facing behavior in [USER_FEATURES_DOCUMENTATION.md](USER_FEATURES_DOCUMENTATION.md) and deployment details under [deployment/](deployment/).

**Last updated:** March 2026

---

## Terminology: “calling” and “texting”

| Term in this doc | What the codebase implements |
|------------------|-------------------------------|
| **Live calling (voice/video)** | **WebRTC** audio/video routed through a **mediasoup** Selective Forwarding Unit (SFU). This is **not** PSTN telephone calling. |
| **Text chat** | **In-app messaging** stored in **Firebase Firestore** and/or delivered with **Firebase Realtime Database (RTDB)** for low-latency live-room UX. |
| **SMS / carrier texting** | **Not implemented** in this repository (no Twilio or similar SMS integration). User profiles may store a **phone number** for display or vCard-style export only. |

A short **Future / not implemented** note: PSTN dial-in or outbound SMS would be new integrations and are not part of the current architecture.

---

## Languages and runtimes

| Layer | Languages / tooling | Primary locations |
|-------|---------------------|-------------------|
| Main API and server-rendered web | Python 3.8+, Flask, Jinja2, CSS, vanilla JavaScript | [app.py](../app.py), [routes/](../routes/), [templates/](../templates/), [static/](../static/) |
| Live media SFU | Node.js (≥18), JavaScript | [media-server/](../media-server/) |
| Browser mediasoup bundle | JavaScript (esbuild) | [web-client/](../web-client/) → [static/js/sfu-bundle.js](../static/js/sfu-bundle.js) |
| Mobile app | TypeScript / TSX, React Native (Expo ~54) | [mobile/](../mobile/) |

---

## High-level system diagram

```mermaid
flowchart TB
  subgraph clients [Clients]
    WebBrowser[Web browser]
    ExpoApp[Expo mobile app]
  end

  subgraph gcp [Google Cloud]
    CloudRun[Cloud Run - Flask container]
    GCS[Cloud Storage]
    SecretMgr[Secret Manager]
  end

  subgraph firebase [Firebase]
    FirebaseAuth[Authentication]
    Firestore[(Firestore)]
    RTDB[(Realtime Database)]
  end

  subgraph media [Media plane]
    SFU[mediasoup SFU - Node]
  end

  subgraph optional [Optional infra]
    Redis[(Redis)]
  end

  WebBrowser -->|HTTPS REST HTML| CloudRun
  ExpoApp -->|HTTPS REST| CloudRun
  WebBrowser --> FirebaseAuth
  WebBrowser --> Firestore
  WebBrowser --> RTDB
  ExpoApp --> FirebaseAuth
  ExpoApp --> Firestore
  ExpoApp --> RTDB

  WebBrowser -->|WSS mediasoup signaling| SFU
  ExpoApp -->|WSS mediasoup signaling| SFU

  CloudRun --> Firestore
  CloudRun --> GCS
  CloudRun --> SecretMgr
  CloudRun -->|optional rate limit backend| Redis

  SFU --> FirebaseAuth
  SFU --> SecretMgr
```

**Traffic summary**

- **Application API and pages:** Browsers and the mobile app call the Flask origin (production: `https://divinebridge.io`) for REST, session-backed pages, and JSON APIs under `/api/...`.
- **Realtime state:** Clients use the **Firebase JS SDK** (web) and **Firebase** package (mobile) for **Firestore** and **RTDB** where features require sync (live rooms, chat, groups, etc.).
- **Media:** WebRTC transports connect to a **separate SFU** process. Production WebSocket URL is configured as `wss://sfu.divinebridge.io/ws` in [mobile/lib/constants.ts](../mobile/lib/constants.ts) and [static/js/sfu-client.js](../static/js/sfu-client.js).

---

## Backend (Flask)

### Entry and cross-cutting concerns

- **Factory and HTTP app:** [app.py](../app.py) builds the Flask app, registers blueprints, configures sessions, CSRF ([Flask-WTF](https://flask-wtf.palletsprojects.com/)), CORS, and security headers (CSP, HSTS in production, `Permissions-Policy` for microphone/camera on prayer experiences).
- **Sessions:** [Flask-Session](https://flask-session.readthedocs.io/) with filesystem storage; production uses secure cookie flags.
- **Rate limiting:** [Flask-Limiter](https://flask-limiter.readthedocs.io/) with **Redis** when `REDIS_HOST` is reachable, otherwise in-memory ([app.py](../app.py)).
- **Firebase Admin:** Initialized at startup ([firebase_auth.py](../firebase_auth.py)); used for Firestore, custom claims, and token verification patterns across routes.

### Realtime over HTTP

- **Flask-SocketIO** is initialized in [app.py](../app.py) (`async_mode='threading'`). The **live prayer room web client** intentionally **prefers Firebase RTDB plus HTTP** for much of its realtime behavior rather than depending on Socket.IO ([static/js/prayer-room.js](../static/js/prayer-room.js)). Socket.IO remains available for other or legacy paths.

### API surface (blueprints)

Registered in [app.py](../app.py) (prefixes as deployed):

| Prefix / area | Blueprint module | Role (summary) |
|---------------|------------------|----------------|
| `/api/auth` | [routes/auth_bp.py](../routes/auth_bp.py) | Login, registration, profile, tokens, OAuth-related flows |
| `/api/prayer` | [routes/prayer_bp.py](../routes/prayer_bp.py) | Prayer requests, daily content interactions |
| `/api` | [routes/verse_bp.py](../routes/verse_bp.py) | Today’s verse, downloads, likes/shares (`/today-verse/...`, etc.) |
| `/api/nonprofit` | [routes/nonprofit_bp.py](../routes/nonprofit_bp.py) | Organization network, location-linked nonprofit features |
| `/api/email` | [routes/email_bp.py](../routes/email_bp.py) | Subscriptions, verification-related email flows |
| `/api/testimony` | [routes/testimony_bp.py](../routes/testimony_bp.py) | Thanksgiving wall / testimonies |
| `/api/prayer-room` | [routes/prayer_room_bp.py](../routes/prayer_room_bp.py) | Live rooms, participants, roles, SFU tokens, scheduled rooms, chat persistence helpers |
| `/api/devotional` | [routes/devotional_bp.py](../routes/devotional_bp.py) | AI-generated devotional plans (Perplexity-backed) |
| `/api/groups` | [routes/groups_bp.py](../routes/groups_bp.py) | Prayer groups CRUD and membership |
| Admin, SEO | [routes/admin_bp.py](../routes/admin_bp.py), [routes/seo_bp.py](../routes/seo_bp.py) | Operations and public SEO/disaster pages |

### Domain services (Python modules)

Business logic lives mainly in root-level modules (non-exhaustive): [prayer_generator.py](../prayer_generator.py), [disaster_prayer_service.py](../disaster_prayer_service.py), [content_moderator.py](../content_moderator.py), [storage_handler.py](../storage_handler.py), [verse_generator.py](../verse_generator.py), [verse_cache.py](../verse_cache.py). Local development can swap storage via `USE_LOCAL_STORAGE=true` and [local_storage.py](../local_storage.py).

### Email

- **SMTP:** [app.py](../app.py) configures Gmail SMTP (`smtp.gmail.com`, port 587) and sender identity; [routes/email_bp.py](../routes/email_bp.py) implements subscription and related endpoints.
- **Scheduled jobs:** Described in [deployment/CLOUD_SCHEDULER_SETUP.md](deployment/CLOUD_SCHEDULER_SETUP.md) (daily prayer generation, reminders, etc.).

---

## Web frontend

### Server-rendered UI

- **Templates:** [templates/](../templates/) (Jinja2) for marketing, prayer room pages, auth pages, and SEO-oriented routes.
- **Static assets:** [static/](../static/) — CSS, images, shared JS.

### Live prayer room (browser)

- **Orchestration:** [static/js/prayer-room.js](../static/js/prayer-room.js) — room UI, participant state, microphone flows, integration with **RTDB** and **Firestore** for chat and signaling-style updates, and REST calls to `/api/prayer-room/...`.
- **SFU client:** [static/js/sfu-client.js](../static/js/sfu-client.js) uses **mediasoup-client** loaded from [static/js/sfu-bundle.js](../static/js/sfu-bundle.js) (built from [web-client/](../web-client/)). The file header states protocol parity with [mobile/lib/sfu.ts](../mobile/lib/sfu.ts).

### Room modes (aligned with mobile)

Constants in [mobile/lib/constants.ts](../mobile/lib/constants.ts): **group call** (small participant cap, full mesh-style media expectations) vs **prayer room** (larger gatherings, speaker caps, spotlight video semantics). Web and mobile are intended to follow the same SFU protocol and caps.

---

## Mobile app (Expo / React Native)

### Navigation

- **expo-router** file-based routes under [mobile/app/](../mobile/app/): tab shell (home, devotional, groups, rooms, profile), auth routes under `(auth)/`, live room `room/[id]`, group `group/[id]`, and [mobile/app/activity.tsx](../mobile/app/activity.tsx).

### Data and auth

- **Firebase:** [mobile/lib/firebase.ts](../mobile/lib/firebase.ts) exposes Firestore (and the app uses other Firebase surfaces as needed).
- **REST API:** [mobile/lib/constants.ts](../mobile/lib/constants.ts) sets `API_BASE_URL` (production `https://divinebridge.io`).
- **Session bridge:** After Firebase signup, [mobile/lib/backendAuth.ts](../mobile/lib/backendAuth.ts) POSTs an **ID token** to `/api/auth/login` so server-side profile creation matches web registration behavior.

### State and UI

- **TanStack Query** and **Zustand** ([mobile/package.json](../mobile/package.json)) for server state and local UI state.
- **Styling:** NativeWind / Tailwind-style utilities.

### Live media

- **react-native-webrtc** and **mediasoup-client** — implementation in [mobile/lib/sfu.ts](../mobile/lib/sfu.ts).
- **Audio routing:** [mobile/lib/liveRoomAudio.ts](../mobile/lib/liveRoomAudio.ts) (e.g. speaker vs earpiece with `react-native-incall-manager`).
- **Hooks:** [mobile/hooks/usePrayerRoom.ts](../mobile/hooks/usePrayerRoom.ts) and related hooks tie UI to Firestore/RTDB and room APIs.

### Groups chat (Firestore)

- [mobile/hooks/useGroups.ts](../mobile/hooks/useGroups.ts) reads/writes subcollections under `group_chat_messages/{groupId}/messages` (see `COLLECTIONS` in [mobile/lib/constants.ts](../mobile/lib/constants.ts)).

---

## Media server (SFU)

- **Stack:** Express HTTP server, **WebSocket** signaling, **mediasoup** workers ([media-server/src/server.js](../media-server/src/server.js)).
- **Rooms:** In-memory registry of mediasoup `Room` / `Peer` objects; JSON request/response protocol over WebSocket (`join`, transports, producers, consumers, etc.).
- **Auth:** [media-server/src/auth.js](../media-server/src/auth.js) verifies **Firebase ID tokens** using the same credential sources as Flask (Secret Manager secret `FIREBASE_CREDENTIALS`, ADC, or local key file). Development can use `DEV_MODE` / base64-encoded JSON “tokens” for local testing.

---

## Data model (conceptual)

Authoritative security rules: [firestore.rules](../firestore.rules). Below is a **conceptual** list of collections and purposes (field-level schemas belong in code and rules).

| Area | Firestore (typical) | Notes |
|------|---------------------|--------|
| Users | `users` | Profile, preferences, admin flags |
| Live rooms | `prayer_rooms`, `scheduled_rooms`, `scheduled_room_rsvps` | Room metadata, scheduling, RSVPs |
| Chat | `chat_messages`, `group_chat_messages/{id}/messages` | Room chat and group chat ([routes/prayer_room_bp.py](../routes/prayer_room_bp.py), [mobile/hooks/useGroups.ts](../mobile/hooks/useGroups.ts)) |
| Community | `prayer_groups`, `group_members` | Small groups ([routes/groups_bp.py](../routes/groups_bp.py)) |
| Content | `prayer_requests`, `testimonies` | Prayer wall and thanksgiving wall |
| Devotionals | `devotional_plans` | Personalized plans ([routes/devotional_bp.py](../routes/devotional_bp.py)) |
| Devotional templates | `devotional_templates` | Pre-generated plans for the 8 suggested themes × 3 durations (7/14/30 days). Backend-only (no client access). Keyed by `{theme-slug}_{duration}` (e.g. `faith-trust_7`). Refreshed monthly via `/admin/api/refresh-devotional-templates` or `scripts/pregen_devotional_templates.py`. |
| Verse devotional context | `verse_contexts` | AI-generated short "sermon" for each daily verse (summary, context / meaning / application paragraphs, 2–4 Hebrew or Greek words with transliteration + gloss, 3 verse-specific reflection questions). Keyed by verse slug derived from the reference (e.g. `1-john-4-11`), **not** by date, because the underlying verse rotation in `static/bible_verses.json` repeats yearly — generate once per unique verse, reuse forever. Public read; writes go through `verse_context_generator.py` from `routes/verse_bp.py` (`/api/today-verse/context`) or `scripts/pregen_verse_contexts.py`. Backfill all verses once, then a nightly Cloud Scheduler call to `POST /api/today-verse/context/generate` pre-warms the next 7 days. |

**Firebase Realtime Database** is used for **low-latency** live-room concerns on the web client (and related mobile hooks) — paths are managed in client code (e.g. [static/js/prayer-room.js](../static/js/prayer-room.js)).

**Object storage:** User-generated and generated assets (e.g. images) via [storage_handler.py](../storage_handler.py) to **Google Cloud Storage**.

---

## Deployment and operations

- **Flask container:** [Dockerfile](../Dockerfile) builds the main app; [cloud-run-config.yaml](../cloud-run-config.yaml) sketches a Cloud Run service (port **8080**, health checks on `/_ah/health`).
- **SFU:** Deployed as a **separate** Node service (not the Flask container); scales and networking differ from the HTTP API.
- **CI/CD:** [.github/workflows/deploy.yml](../.github/workflows/deploy.yml); narrative docs: [deployment/DEPLOYMENT_GUIDE.md](deployment/DEPLOYMENT_GUIDE.md), [deployment/DEPLOY_PIPELINE.md](deployment/DEPLOY_PIPELINE.md).

Follow team process: review changes and deployment history before promoting to production (see repository guidelines).

---

## Feature index (code entry points)

User journeys and screenshots-level detail: **[USER_FEATURES_DOCUMENTATION.md](USER_FEATURES_DOCUMENTATION.md)**.

| Feature area | Main code / doc pointers |
|--------------|---------------------------|
| Daily prayer and AI generation | [prayer_generator.py](../prayer_generator.py), [routes/prayer_bp.py](../routes/prayer_bp.py), scheduler docs [deployment/CLOUD_SCHEDULER_SETUP.md](deployment/CLOUD_SCHEDULER_SETUP.md) |
| Daily verse | [routes/verse_bp.py](../routes/verse_bp.py), [verse_generator.py](../verse_generator.py), [verse_cache.py](../verse_cache.py) |
| Verse devotional context (AI sermon, original-language insights, reflection questions) | [verse_context_generator.py](../verse_context_generator.py), [config/verse_context_prompt.txt](../config/verse_context_prompt.txt), [routes/verse_bp.py](../routes/verse_bp.py) (`/api/today-verse/context`), [scripts/pregen_verse_contexts.py](../scripts/pregen_verse_contexts.py), [mobile/app/verse-reader.tsx](../mobile/app/verse-reader.tsx) |
| Disaster / SEO pages | [routes/seo_bp.py](../routes/seo_bp.py), [disaster_prayer_service.py](../disaster_prayer_service.py) |
| Prayer requests | [routes/prayer_bp.py](../routes/prayer_bp.py), [content_moderator.py](../content_moderator.py) |
| Testimonies | [routes/testimony_bp.py](../routes/testimony_bp.py) |
| Live prayer room (web) | [static/js/prayer-room.js](../static/js/prayer-room.js), [static/js/sfu-client.js](../static/js/sfu-client.js) |
| Live room (mobile) | [mobile/app/room/[id].tsx](../mobile/app/room/[id].tsx), [mobile/lib/sfu.ts](../mobile/lib/sfu.ts), [mobile/hooks/usePrayerRoom.ts](../mobile/hooks/usePrayerRoom.ts) |
| Groups | [routes/groups_bp.py](../routes/groups_bp.py), [mobile/app/(tabs)/groups.tsx](../mobile/app/(tabs)/groups.tsx), [mobile/app/group/[id].tsx](../mobile/app/group/[id].tsx), [mobile/hooks/useGroups.ts](../mobile/hooks/useGroups.ts) |
| Devotional plans | [routes/devotional_bp.py](../routes/devotional_bp.py), [mobile/app/(tabs)/devotional.tsx](../mobile/app/(tabs)/devotional.tsx) |
| Auth and profile | [routes/auth_bp.py](../routes/auth_bp.py), [firebase_auth.py](../firebase_auth.py), [mobile/app/(auth)/](../mobile/app/(auth)/), [mobile/stores/authStore.ts](../mobile/stores/authStore.ts) |
| Email subscriptions | [routes/email_bp.py](../routes/email_bp.py), [guides/EMAIL_CONFIGURATION_GUIDE.md](guides/EMAIL_CONFIGURATION_GUIDE.md) |
| Organizations / nonprofits | [routes/nonprofit_bp.py](../routes/nonprofit_bp.py), [nonprofit_service.py](../nonprofit_service.py) |
| Admin | [routes/admin_bp.py](../routes/admin_bp.py) |
| Media SFU | [media-server/src/server.js](../media-server/src/server.js), [media-server/src/auth.js](../media-server/src/auth.js) |

---

## Related documentation

- [docs/README.md](README.md) — documentation index  
- [deployment/DEPLOYMENT_GUIDE.md](deployment/DEPLOYMENT_GUIDE.md)  
- [guides/QUICKSTART_TESTING.md](guides/QUICKSTART_TESTING.md)  
- [guides/TURN_SERVER_SETUP.md](guides/TURN_SERVER_SETUP.md) — WebRTC TURN (if configured for your environment)  
