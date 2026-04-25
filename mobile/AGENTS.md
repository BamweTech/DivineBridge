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
- Theme colors: `THEME_COLORS` from `lib/constants.ts`.
- Fonts: **Newsreader** (serif — headings, titles, devotional long-form) and **Inter Tight** (sans — UI, chat, labels, forms). Loaded in root layout via `@expo-google-fonts/newsreader` and `@expo-google-fonts/inter-tight`.
  - Tailwind tokens: `font-serif`, `font-serif-medium`, `font-serif-semibold`, `font-serif-bold`, `font-serif-italic` (Newsreader) and `font-sans`, `font-sans-medium`, `font-sans-semibold`, `font-sans-bold` (Inter Tight). Prefer these.
  - Direct `fontFamily: 'Newsreader_XXX'` / `'InterTight_XXX'` strings are also valid when styling via inline style.
  - Legacy `font-jakarta*` / `font-geist*` aliases remain as backwards-compatible shims mapped to Newsreader / Inter Tight; new code should use the semantic `serif` / `sans` tokens.

## Conventions

- All API calls go through `services/api.ts` — never use raw `fetch`.
- Type all API responses explicitly — avoid `any`.
- Use TanStack Query for cacheable server data, Zustand for ephemeral UI state.
- Firestore `onSnapshot` for real-time features (chat, room state, groups).
- Error tracking via Sentry (`@sentry/react-native`).

## Metro VM

Device builds that load JS from the team GCE bundler need the VM on **`main`**. After mobile-related commits land on `main`, run from repo root: `./scripts/gcp-metro-update.sh` (see `scripts/AGENTS.md`).
