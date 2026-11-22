# mobile/ — Expo React Native App

The Divine Bridge mobile app built with Expo ~54, React Native, and TypeScript.

## Navigation (expo-router)

File-based routing under `app/`:

- `app/_layout.tsx` — Root Stack with auth guard, providers (QueryClient, GroupUnread, LiveRooms).
- `app/(tabs)/_layout.tsx` — Tab bar: Pray (landing), Groups, Devotional, Profile. Home and Live stay as hidden routes. The Profile tab shows the account photo when one is saved, and the person icon otherwise.
- `app/(tabs)/pray.tsx` — Burning-bush halo. Tap the circle or drag it down to open a two-column prayer dashboard. A full-width card at the top, Enroll as Prayer Warrior, stays pinned while the dashboard cards scroll. Its gold border eases brighter and softer until the person applies. It invites people to apply unless they are already enrolled. The bottom tabs stay visible on that dashboard and on the pages it opens. Switching to another tab and coming back keeps the open prayer page.
- `app/(tabs)/prayer-warrior.tsx` — Application to enroll as a prayer warrior. Languages are English, Spanish, and Kirundi. Church name is optional. Weekly time ranges are required. One range can cover several days, and a day can have more than one range. Matching uses them. Submitting stores a pending application and does not grant access.
- `app/(tabs)/prayer-warrior-review.tsx` — Admin review of pending prayer-warrior applications, opened from Profile. Accept enrolls the person. Decline does not. Visible to `dev@bamwe.com`, `kubjca@gmail.com`, and any account the server has marked `is_admin`.
- `app/(tabs)/devotional.tsx` — Landing is today's scripture and the plan cards. A plan opens on its own reading, without the daily verse.
- `app/(tabs)/groups.tsx` — Prayer Groups tab: your groups, create, and join. Unread badge lives here.
- `app/(tabs)/prayer-wall.tsx` — Public Prayer Wall, opened from the Pray menu.
- `app/(tabs)/request-prayer.tsx` — Chooses a public wall post or a private warrior request.
- `app/(tabs)/prayer-requests.tsx` — Private request form (`mode=compose`) and the requester plus warrior inbox (`mode=inbox`). The inbox title is Prayer Request. The form offers English, Spanish, and Kirundi, with a date selector and a 15-minute time selector. Every request schedules a live call at that time if a warrior is matched. The three-line menu slides the page to the left and lists previous requests. Choosing one slides the page back and opens that request in full. The requester can delete a previous request. The prayer leader inbox stays on the page.
- `app/(tabs)/scheduled-prayer.tsx` — Upcoming private matches. Requesters see their times; warriors see assigned calls.
- `app/(tabs)/todays-prayer.tsx` — The global daily prayer.
- `app/(tabs)/prayer-timer.tsx` — Personal quiet-time timer.
- `app/(tabs)/prayer-reminder.tsx` — Daily local prayer reminder.
- `app/(tabs)/personal-prayer.tsx` — Personal prayer generator. Each prayer is saved for that person and is not editable. The three-line menu slides the page to the left and lists previous prayers there. Choosing one slides the page back and opens that prayer in full. It does not replace today's global prayer. The same generation search names one to three comforting references from any book of the Bible. Their World English Bible text is shown above the prayer.
- `app/(auth)/` — Login, register screens.
- `app/room/[id].tsx` — Live prayer room (dynamic route). Full screen, without the tab bar.
- `app/voice-call/[id].tsx` — 1:1 voice link call (share web URL; mute/speaker/end). Full screen, without the tab bar.
- `app/(tabs)/group/[id].tsx` — Group detail (dynamic route). The bottom tabs stay visible.
- `app/(tabs)/activity.tsx` — Activity feed. The bottom tabs stay visible.
- `app/verse-reader.tsx` — Daily verse explainer (context / meaning / application). Share opens a 4-card image pack.

To add a new screen, create a file in `app/` and register in the nearest `_layout.tsx` if custom options are needed.

## UI wireframe (design reference)

Static HTML prototype at repo root: **`divinebridge-app-v4.html`** (not deployed). When you change user-visible mobile UI, update that file in the same change — use the **`update-mobile-wireframe`** skill in `.cursor/skills/`.

## Data architecture

| Concern | Tool | Location |
|---------|------|----------|
| REST API calls | `fetch` with auth headers | `services/api.ts` |
| Server state caching | TanStack Query | `features/*/hooks`, `hooks/use*.ts` |
| Real-time data | Firebase Firestore `onSnapshot` | feature hooks / contexts |
| Local UI state | Zustand | `stores/*.ts` |
| Auth state | Zustand + Firebase Auth | `stores/authStore.ts` |

## Feature layout

Non-route UI is organized by product area (Expo Router paths under `app/` are unchanged):

| Area | Path |
|------|------|
| Groups / chat / group calls | `features/groups/` |
| Live rooms / Voice Link | `features/rooms/` |
| Home / verse / speech helpers | `features/prayer/` |
| Shared chrome | `components/ui/` |
| HTTP client | `services/` |

Compatibility re-exports remain under `components/group/`, `components/room/`, `hooks/`, and `contexts/` for one migration cycle.

## Key files

- `services/api.ts` — Centralized HTTP client with Firebase Bearer token auth and 401 retry.
- `lib/constants.ts` — `API_BASE_URL`, `SFU_WS_URL`, `THEME_COLORS`, Firestore collection names.
- `lib/firebase.ts` — Firebase initialization and Firestore export.
- `lib/backendAuth.ts` — Syncs Firebase auth with Flask backend session.
- `lib/sfu.ts` — mediasoup client for WebRTC (protocol parity with `web/static/js/sfu-client.js`; fixture `contracts/sfu-protocol.json`).
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
