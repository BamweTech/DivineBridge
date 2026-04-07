---
name: firebase-deploy
description: >-
  Deploy Firebase rules (Firestore, Storage) and indexes safely. Use when
  Firestore rules, storage rules, or indexes need to be deployed.
---

# Firebase Deploy

## Before deploying

1. Review the changes to `firestore.rules`, `firestore.indexes.json`, or `storage.rules`.
2. Ensure changes are committed and the working tree is clean.
3. Use the Firebase MCP server to validate rules if available.

## Deploy Firestore rules and indexes

```bash
./scripts/deploy.sh --firestore-only
```

Or directly:

```bash
npx firebase-tools@latest deploy --only firestore --project divinebridge --non-interactive
```

## Deploy Storage rules

Only if `DEPLOY_FIREBASE_STORAGE=1` is set:

```bash
DEPLOY_FIREBASE_STORAGE=1 ./scripts/deploy.sh --firestore-only
```

Or directly:

```bash
npx firebase-tools@latest deploy --only storage --project divinebridge --non-interactive
```

## Dry run

Preview what would be deployed:

```bash
./scripts/deploy.sh --firestore-only --dry-run
```

## Post-deploy verification

1. Open Firebase Console: `https://console.firebase.google.com/project/divinebridge/firestore/rules`
2. Verify the rules tab shows the updated rules.
3. Check the indexes tab if indexes were changed.
4. Test a sample read/write operation against the affected collections.

## Staging

For the staging project, set `FIREBASE_PROJECT=divinebridge-staging` before deploying:

```bash
FIREBASE_PROJECT=divinebridge-staging ./scripts/deploy.sh --firestore-only
```

## Troubleshooting

- **Auth error**: Run `npx firebase-tools@latest login` or set `FIREBASE_TOKEN`.
- **Index errors**: Firestore may need time to build new indexes. Check the Firebase Console indexes tab.
- **Rules validation error**: Check syntax in `firestore.rules`. Rules must compile before deploy.
