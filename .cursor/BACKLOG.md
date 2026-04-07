# DivineBridge — Backlog

Pending implementations and future work, ordered by priority.

---

## High Priority

### Native Call UI (Phase 2 — Background Call Notifications)
**Prerequisite:** Apple Developer account + VoIP push certificate

Full WhatsApp/Telegram incoming call experience using `react-native-callkeep`:

- [ ] Install `react-native-callkeep` (requires native rebuild via EAS)
- [ ] Create `mobile/lib/callKeepService.ts` — setup, displayIncomingCall, endCall, event handlers
- [ ] iOS: Integrate CallKit for native incoming call screen
- [ ] iOS: Install `react-native-voip-push-notification` for PushKit token registration
- [ ] iOS: Server-side APNs VoIP push sending (separate from Expo push)
- [ ] Android: ConnectionService integration for full-screen call UI on lock screen
- [ ] Server: dual-path push — VoIP for iOS, Expo high-priority for Android
- [ ] Register VoIP push token endpoint (extend `POST /api/auth/push-token` or new route)

**Context:** Phase 1 (server-side Expo push on session start) is complete. Phase 2 adds the native call screen overlay that works even when the phone is locked.

---

## Medium Priority

### EAS Update / OTA Support
- [ ] Add `updates` and `runtimeVersion` config to `app.config.js`
- [ ] Configure `eas update` for JS-only OTA updates without full native rebuilds
- [ ] Resolve Sentry config warnings for EAS update compatibility

### iOS Production Build Pipeline
- [ ] Set up Apple Developer account and associate with project
- [ ] Configure distribution certificate for non-interactive iOS builds
- [ ] Automate iOS builds in CI/CD pipeline

### Group Chat Push Notifications (Server-Side)
- [ ] Wire `send_push_to_group()` for new group chat messages (currently local-only via Firestore listener)
- [ ] Rate-limit push sends to avoid spamming during active conversations
- [ ] Add mute/notification preferences per group per user

---

## Low Priority

### Push Notification Enhancements
- [ ] Actionable notification buttons (Accept/Decline for calls, Reply for messages)
- [ ] Notification grouping/stacking for multiple messages from same group
- [ ] Badge count management (clear on app open, increment on new notifications)
- [ ] Silent push for data sync (background fetch)

### Audio/Call Quality
- [ ] Automatic audio quality adjustment based on network conditions
- [ ] Bluetooth headset/AirPods connection handling
- [ ] Call reconnection on network switch (Wi-Fi ↔ cellular)

---

## Completed

### Background Call Notifications — Phase 1 (Apr 2026)
- [x] Enhance `push_service.py` with priority and channel_id support
- [x] Wire `send_push_to_group()` into `ensure_group_prayer_session()` on room creation
- [x] Remove duplicate local notification from `useGroupCallNotifications` hook
- [x] Server sends Expo push to all group members (excl. host) when a live session starts

### Call Ringtone & Vibration (Apr 2026)
- [x] In-app ringtone via `react-native-incall-manager` + vibration patterns
- [x] Group call banner with animated join button
- [x] Android notification channel with MAX importance, bypass DnD

### Background Call Keep-Alive (Apr 2026)
- [x] `staysActiveInBackground` for audio sessions
- [x] Persistent Android notification during active calls
- [x] WebSocket heartbeat to prevent SFU timeout
- [x] WAKE_LOCK permission

### Clickable Links & Previews (Apr 2026)
- [x] LinkifiedText component for inline clickable URLs
- [x] LinkPreviewCard with OG metadata fetching
- [x] YouTube oEmbed API fallback for reliable previews
- [x] Browser-like User-Agent for OG fetch success
