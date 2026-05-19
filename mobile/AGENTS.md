# mobile/ — Expo React Native App

The Divine Bridge mobile app built with Expo ~54, React Native, and TypeScript.

## Navigation (expo-router)

File-based routing under `app/`:

- `app/_layout.tsx` — Root Stack with auth guard, providers (QueryClient, GroupUnread, LiveRooms).
- `app/(tabs)/_layout.tsx` — Tab bar (home, devotional, groups, rooms, profile).
- `app/(auth)/` — Login, register screens.
- `app/room/[id].tsx` — Live prayer room (dynamic route).
- `app/group/[id].tsx` — Group detail (dynamic route).
- `app/activity.tsx` — Activity feed.

To add a new screen, create a file in `app/` and register in the nearest `_layout.tsx` if custom options are needed.

## Data architecture

| Concern | Tool | Location |
|---------|------|----------|
| REST API calls | `fetch` with auth headers | `services/api.ts` |
| Server state caching | TanStack Query | `hooks/use*.ts` |
| Real-time data | Firebase Firestore `onSnapshot` | `hooks/use*.ts` |
| Local UI state | Zustand | `stores/*.ts` |
| Auth state | Zustand + Firebase Auth | `stores/authStore.ts` |

## Key files

- `services/api.ts` — Centralized HTTP client with Firebase Bearer token auth and 401 retry.
- `lib/constants.ts` — `API_BASE_URL`, `SFU_WS_URL`, `THEME_COLORS`, Firestore collection names.
- `lib/firebase.ts` — Firebase initialization and Firestore export.
- `lib/backendAuth.ts` — Syncs Firebase auth with Flask backend session.
- `lib/sfu.ts` — mediasoup client for WebRTC (protocol parity with `static/js/sfu-client.js`).
- `components/ui/Icon.tsx` — Icon component.

## Styling

- **NativeWind** (Tailwind for RN): Use `className` prop.
- Global CSS in `app/_layout.tsx` via `import '../global.css'`.
- Theme colors: `THEME_COLORS` from `lib/constants.ts` (warm cream palette).

### Typography — iOS type-role system (SF Pro)

The app uses Apple's iOS typography system: **SF Pro** on iOS (via `'System'`) and **Nunito Sans** as the open-source fallback on Android. The canonical source is `lib/typography.ts`.

- **`TYPE`** — nine iOS type roles (`largeTitle`, `title1`, `title2`, `title3`, `headline`, `body`, `callout`, `subheadline`, `footnote`, `caption1`, `caption2`, `capsLabel`) each carrying Apple's exact `fontSize` / `lineHeight` / `letterSpacing` / `fontWeight`. Spread inline:
  ```tsx
  <Text style={{ ...TYPE.headline, color: THEME_COLORS.text }}>Settings</Text>
  ```
- **`<AppText variant="…">`** (`components/ui/AppText.tsx`) — drop-in `Text` wrapper for the same roles; pass `tabular` for monospaced digit runs (streaks, counts, timers).
- **`iosFontStyle('600')`** — `{ fontFamily, fontWeight }` for ad-hoc sizes. Used everywhere as the migration drop-in for legacy `fontFamily: 'InterTight_*'` / `'Newsreader_*'`.
- Tailwind tokens (`font-sans*`, `font-serif*`) map to the SF Pro / Nunito Sans stack; the legacy `font-jakarta*` / `font-geist*` aliases have been removed. New code should prefer `TYPE.*` or `iosFontStyle()` over Tailwind font classes.

### Glassmorphism primitives

Cream-tinted iOS-style glass via `expo-blur`. All four live under `components/ui/`:

- **`GlassCard`** — backdrop blur + cream tint + hairline border + top-edge highlight. Tones: `default | warm | gold | sage | rose`. Intensities: `subtle | card | bar | heavy`.
- **`GlassActionBar`** — bottom-anchored action toolbar (the verse hero's row of Listen / Like / Share).
- **`GlassPill`** — small frosted pill for cap labels, notification bell, status chips.
- **`GlassTabBar`** — slotted into expo-router via `tabBarBackground={() => <GlassTabBar />}` with `tabBarStyle.position: 'absolute'` so content scrolls under it.

## Conventions

- All API calls go through `services/api.ts` — never use raw `fetch`.
- Type all API responses explicitly — avoid `any`.
- Use TanStack Query for cacheable server data, Zustand for ephemeral UI state.
- Firestore `onSnapshot` for real-time features (chat, room state, groups).
- Error tracking via Sentry (`@sentry/react-native`).

## Metro VM

Device builds that load JS from the team GCE bundler need the VM on **`main`**. After mobile-related commits land on `main`, run from repo root: `./scripts/gcp-metro-update.sh` (see `scripts/AGENTS.md`).
