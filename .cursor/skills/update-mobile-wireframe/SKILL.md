---
name: update-mobile-wireframe
description: >-
  Keeps the mobile UI wireframe at divinebridge-app-v4.html in sync with Expo
  app changes. Use when adding or changing mobile screens, tab navigation, auth
  flows, layouts, labels, or visual design in mobile/ or when the user mentions
  wireframes, UI prototype, or divinebridge-app-v4.html.
---

# Update Mobile Wireframe

The repo maintains a **local-only** HTML wireframe for the Expo app:

| Item | Value |
|------|--------|
| File | `divinebridge-app-v4.html` (repo root) |
| Deploy | Excluded via `.gcloudignore` — design reference only |
| Preview | `open divinebridge-app-v4.html` |

## When to update (required)

Update the wireframe in the **same PR / task** as the UI change when any of these apply:

- New or removed file under `mobile/app/`
- Tab bar changes in `mobile/app/(tabs)/_layout.tsx` (order, labels, icons)
- Auth screens under `mobile/app/(auth)/`
- Stack screens: `activity.tsx`, `verse-reader.tsx`, `group/[id].tsx`, `room/[id].tsx`
- Major layout or copy on an existing tab (home, pray/groups, rooms, devotional, profile)
- New global patterns (glass cards, hero verse, prayer wall, stats strip)

**Skip** wireframe updates for: backend-only changes, bug fixes with no visible UI difference, refactors that do not change what users see.

## Source of truth (read before editing)

1. **Colors** — `mobile/lib/constants.ts` → `THEME_COLORS`
2. **Tabs** — `mobile/app/(tabs)/_layout.tsx` → `TABS` (Home, Pray, Live, Devotional, Profile)
3. **Navigation map** — `mobile/AGENTS.md`
4. **Typography** — `mobile/lib/typography.ts` (iOS roles; wireframe uses system sans)

## Wireframe structure

- **Left**: side-nav buttons — one per screen (`show('s-<id>', this)`)
- **Center**: phone mockup — `.phone-screen` blocks, one `active` at a time
- **Right**: short feature blurbs (optional; keep aligned with current screens)
- **Bottom nav** (tab screens only): five items matching `TABS`; use `ic-pray-bridge` for Pray tab

### Screen IDs (keep in sync)

| Side nav label | `id` | Mobile route / file |
|----------------|------|---------------------|
| Login | `s-login` | `(auth)/login.tsx` |
| Home | `s-home` | `(tabs)/home.tsx` |
| Pray · Groups | `s-pray` | `(tabs)/groups.tsx` (mine tab) |
| Prayer Wall | `s-wall` | `(tabs)/groups.tsx` (prayer-wall tab) |
| Prayer Rooms | `s-rooms` | `(tabs)/rooms.tsx` |
| In Room | `s-room` | `room/[id].tsx` |
| Group Chat | `s-chat` | `group/[id].tsx` |
| Devotional | `s-devo` | `(tabs)/devotional.tsx` |
| Activity | `s-activity` | `activity.tsx` |
| Profile | `s-profile` | `(tabs)/profile.tsx` |
| Verse Reader | `s-verse-reader` | `verse-reader.tsx` |

When adding a screen: add side-nav button, new `.phone-screen` block, CSS if needed, and fix any `onclick` / `show(..., document.querySelectorAll('.side-btn')[n])` indices.

## Workflow

### A. New mobile screen

1. Implement the screen in `mobile/app/` (use `add-mobile-screen` skill).
2. Add a wireframe panel:
   - Copy structure from the closest existing screen (glass card, header row, tab switch, etc.).
   - Use placeholder copy that reflects real labels from the TSX file.
3. Register in side nav and update the right-hand feature list if present.
4. Wire cross-links (e.g. home bell → `s-activity`) if navigation exists in app.

### B. Change existing screen

1. Diff the TSX layout (sections, titles, CTAs, tabs).
2. Edit the matching `#s-*` block only — avoid unrelated screens.
3. Update all bottom-nav instances on tab screens if tab labels/order changed.

### C. Tab bar change

1. Update every `.bottom-nav` in the file (five items, correct active state per screen).
2. Rename side-nav / labels to match `_layout.tsx` (`Pray` not `Groups`).

## Checklist before finishing

```
- [ ] divinebridge-app-v4.html reflects visible UI change
- [ ] THEME_COLORS tokens unchanged or updated in :root CSS
- [ ] Tab order/labels match (tabs)/_layout.tsx
- [ ] New screen has side-nav entry + phone-screen block
- [ ] side-btn array indices still correct after nav edits
- [ ] mobile/AGENTS.md navigation section updated if routes changed
```

## Do not

- Deploy or move the file into `static/` without an explicit request.
- Duplicate full app logic — wireframe is static HTML for design review.
- Use outdated fonts/branding (Syne/Lora stack); use system UI font + Georgia for verse quotes.

## Related skills

- `add-mobile-screen` — implement route first, then run this skill.
- `maintain-agentic-infra` — update `mobile/AGENTS.md` when navigation changes.
