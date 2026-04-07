# media-server/ — mediasoup SFU

The Selective Forwarding Unit for live voice/video in Divine Bridge prayer rooms.

## Stack

- Node.js >=18, Express, WebSocket (`ws`), mediasoup.
- Entry: `src/server.js`.
- Deployed as a **separate** process from the Flask container.

## Architecture

```
Client (web/mobile) --WSS--> server.js --mediasoup--> Worker pool
                                |
                          Room registry (in-memory)
                                |
                          Firebase Admin (token verification)
```

### Worker pool
- Multiple mediasoup workers created at startup (`config.numWorkers`).
- Round-robin worker assignment via `getNextWorker()`.
- Workers auto-restart on crash (2s delay).

### Room lifecycle
- `getOrCreateRoom(roomId)` — creates Room with a mediasoup Router.
- `cleanupRoomIfEmpty(roomId)` — closes and deletes empty rooms.
- Rooms are in-memory Map objects, not persisted.

### WebSocket protocol
JSON request/response over WebSocket. Key messages:
- `join` — authenticate and join a room.
- `createTransport` — create WebRTC send/receive transport.
- `produce` — start sending media (audio/video).
- `consume` — start receiving media from a peer.
- `leave` — disconnect from room.

## Key files

| File | Purpose |
|------|---------|
| `src/server.js` | Express + WebSocket server, worker pool, room management |
| `src/Room.js` | Room and Peer classes, mediasoup Router management |
| `src/auth.js` | Firebase ID token verification |
| `src/config.js` | Worker settings, codec parameters, transport options |
| `src/roomRegistry.js` | Tracks active rooms for monitoring |

## Auth

- Production: `verifyToken()` in `auth.js` validates Firebase ID tokens.
- Credentials: `FIREBASE_CREDENTIALS` secret from Google Secret Manager, ADC, or local key file.
- Development: `DEV_MODE=true` accepts base64-encoded JSON tokens for local testing.

## Room modes

Defined in `mobile/lib/constants.ts`:
- **Group call**: Small participant cap, full media exchange.
- **Prayer room**: Larger gatherings, speaker caps, spotlight video.

Web (`static/js/sfu-client.js`) and mobile (`mobile/lib/sfu.ts`) must maintain protocol parity.

## Redis

Used for room registry pub/sub in multi-instance deployments. Optional for single-instance dev.
