# LiveKit Migration & Speaker Role Implementation Plan

## 1. Objectives
- Support 20 simultaneous speakers with any number of listeners without degrading audio quality.
- Introduce listener/speaker roles with a request-to-speak workflow and host moderation tools.
- Transition WebRTC transport from browser full-mesh to a self-hosted LiveKit SFU on Google Cloud, preserving existing authentication and prayer-room UX.

## 2. High-Level Architecture
- **Clients** (web, mobile web) connect to Firebase for auth/data and to LiveKit for audio.
- **Backend (Flask)** issues LiveKit access tokens, manages room metadata (Firestore), and enforces role caps.
- **LiveKit Server** (self-hosted on Compute Engine or GKE) handles SFU forwarding.
- **TURN Server** (existing coturn instance) continues to service NAT traversal; optional co-location on same VM as LiveKit.
- **Firestore** remains the source of truth for prayer-room state, including participant roles, requests, and room settings.

## 3. Google Cloud Deployment Plan
1. **Provision Compute Engine VM**
   - Region: `us-central1` (match Cloud Run).
   - Machine type: `e2-small` (2 vCPU, 2 GB RAM) for pilot; scale to `e2-medium` as concurrency grows.
   - OS: Container-Optimized OS or Ubuntu LTS.
   - Firewall: open UDP `50000-60000`, TCP `7880` (API), `7881` (WebRTC over TCP fallback), optional `3443` for Web UI; allow internal access from Cloud Run and clients.
2. **Install LiveKit**
   - Use Docker (`docker run livekit/livekit-server:latest` with mounted config) or binary.
   - Configure `internalIPs` (GCP internal address) and `externalIPs` (static public IP).
   - Point to existing TURN server credentials; otherwise run coturn alongside using the existing `setup-turn-server.sh` script.
3. **Infrastructure Automation (optional)**
   - Create Terraform or Deployment Manager scripts for reproducibility.
   - Use Cloud Scheduler to stop/start VM outside broadcast hours to reduce cost.

## 4. Backend Changes (Flask)
- **Configuration**
  - Store LiveKit API key/secret in Secret Manager or environment variables (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_HOST`, `LIVEKIT_PORT`).
- **Token Service**
  - Add endpoint (`/api/prayer-room/livekit-token`) that validates Firebase/Flask session, checks room membership and role, and issues JWT via `livekit` Python SDK.
  - Include participant metadata (`user_id`, `role`) in token claims for server-side hooks.
- **Role Management APIs**
  - Update participant schema to include `role`, `requested_role`, `role_updated_at`.
  - New endpoints:
    - `POST /api/prayer-room/rooms/<room_id>/request-role` (listener requests speaker).
    - `POST /api/prayer-room/rooms/<room_id>/promote` (host promotes up to cap).
    - `POST /api/prayer-room/rooms/<room_id>/demote` (host demotes to listener).
    - `GET /api/prayer-room/rooms/<room_id>/requests` for host UI queue.
  - Enforce `max_speakers` (default: 20) and update Firestore transactionally.
- **Webhook Handling (optional)**
  - Expose endpoint for LiveKit webhooks (participant joined/left) to sync real-time state with Firestore if needed.

## 5. Frontend Changes (prayer-room.js)
- **LiveKit Integration**
  - Replace SimplePeer logic with LiveKit Web SDK (`@livekit/client`).
  - On join: fetch LiveKit token via new API, connect to room, publish local audio only if role === `speaker`.
  - Subscribe to remote tracks with adaptive policies (Auto-track or manual once we cap speakers).
- **Role UX**
  - Display current role (`Speaker`, `Listener`, `Request pending`).
  - Listeners: “Join Audio” becomes “Listen Only”, microphone disabled; add “Request to Speak” button.
  - Speakers: existing mute/unmute controls remain.
  - Host view: queue component with approve/deny, ability to demote any speaker, indicator of speaker count vs cap.
- **State Sync**
  - Listen to Firestore updates for participant roles; toggle LiveKit publish/unpublish accordingly (e.g., if demoted, stop publishing).
  - Show toast when request accepted/denied.

## 6. Data Model Updates (Firestore)
- `prayer_rooms/{roomId}` document:
  - Add `max_speakers` (int), `auto_approve_requests` (bool, default false).
- `prayer_rooms/{roomId}/participants/{userId}`:
  - Fields: `role`, `requested_role`, `request_timestamp`, `is_muted`, `joined_at`.
- Optional `speaker_requests` subcollection for request history and auditing.
- Ensure Firestore security rules allow hosts to modify roles while listeners can only create/cancel requests.

## 7. Migration Strategy
1. **Phase 0 – Role Cap in Current Mesh (this PR)**
   - Implement role metadata and cap logic using existing SimplePeer to validate UX while SFU is staged.
2. **Phase 1 – LiveKit Pilot**
   - Deploy LiveKit, integrate SDK in QA environment, run internal load tests (e.g., 5 speakers, 20 listeners).
3. **Phase 2 – Production Cutover**
   - Toggle feature flag to route WebRTC to LiveKit for all rooms.
   - Keep SimplePeer path as fallback for a controlled rollback window.
4. **Phase 3 – Enhancements**
   - Add recordings, transcription, broadcast mixers as needed.
   - Explore mobile native SDKs once web flow is stable.

## 8. Testing Plan
- **Unit & Integration**
  - Backend role transitions, token issuance, Firestore transactions.
- **Load Tests**
  - Use LiveKit load testing tool (`lk load`) or Selenium-driven clients to simulate 20 speakers + 80 listeners.
- **Manual QA Cases**
  - Promotion/demotion under cap and at cap.
  - Request queue flow (approve/deny, auto timeout).
  - Network interruptions (LiveKit auto-reconnect).
  - TURN fallback (restrict UDP outbound to force TCP).
- **Monitoring**
  - Enable LiveKit Prometheus metrics (latency, packet loss).
  - Cloud Logging dashboards for token issuance, role changes, errors.

## 9. Rollout & Operations
- Document VM maintenance (patching, backups).
- Set up uptime checks and alerts (VM health, LiveKit API availability).
- Provide on-call runbook: restart LiveKit service, rotate API keys, inspect participant stats.
- Educate moderators/hosts on new speaker management UI.

## 10. Timeline Estimate
1. Role-cap groundwork & API scaffolding – 2-3 dev days.
2. LiveKit infrastructure deployment – 0.5 day.
3. Frontend LiveKit integration + testing – 3-4 dev days.
4. QA and staged rollout – 1-2 days.
5. Buffer for feedback iterations – 1 day.

_Total: ~1.5 weeks with one engineer, overlapping infrastructure work where possible._
