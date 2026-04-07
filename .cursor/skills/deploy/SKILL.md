---
name: deploy
description: >-
  Deploy Divine Bridge to staging or production. Runs pre-deploy checks, deploys
  Firestore rules and/or Cloud Run, and verifies health. Use when asked to deploy,
  ship, or push to production.
---

# Deploy Divine Bridge

## Pre-deploy checks

1. Run `git status` to confirm the working tree is clean.
2. Run `git log --oneline -5` to review recent changes.
3. Run the test suite to verify nothing is broken:
   - `USE_LOCAL_STORAGE=true pytest tests/ -v --tb=short`
   - `cd mobile && npx tsc --noEmit`

If any check fails, stop and report the issue. Do not proceed with deployment.

## Deployment options

Ask the user which deployment target:

### Option A: Full deploy (Firestore + Cloud Run)

```bash
./scripts/deploy.sh
```

### Option B: Firestore rules only

```bash
./scripts/deploy.sh --firestore-only
```

### Option C: Cloud Run only

```bash
./scripts/deploy.sh --cloud-run-only
```

### Option D: Dry run (preview)

```bash
./scripts/deploy.sh --dry-run
```

## Post-deploy verification

1. Check the health endpoint: `curl -s https://divinebridge.io/_ah/health`
2. Verify the response is `{"status": "healthy", ...}`.
3. If deploying Firestore rules, verify in Firebase Console that rules are updated.
4. Report the Cloud Run URL and deployment status.

## Staging deploy

For staging, push to the `develop` branch. The `deploy-staging.yml` workflow handles it automatically.

```bash
git push origin develop
```

Then verify staging at the staging URL from `gcloud run services describe divinebridge-staging`.

## Environment

Key env vars are documented in `scripts/deploy.env.example`. The deploy script reads `scripts/deploy.env` if it exists. Required: `GCP_PROJECT`, `GCP_REGION`, `FIREBASE_PROJECT`.
