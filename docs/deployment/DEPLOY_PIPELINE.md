# Deployment pipeline (Cloud Run + Firebase / Firestore)

One entry point for production deploys: **`scripts/deploy.sh`**, plus an optional **GitHub Actions** workflow for CI/CD.

## What gets deployed

| Target | Files | Command |
|--------|--------|---------|
| **Firestore** | `firestore.rules`, `firestore.indexes.json` | `firebase deploy --only firestore` |
| **Cloud Run** | Flask app (`Dockerfile`, repo root) | `gcloud run deploy` |

Firebase Hosting, Cloud Functions, and Storage rules are **not** in `firebase.json` today. If you add them later, extend `firebase.json` and `scripts/deploy.sh`.

## Local deploy (fastest for day-to-day)

From the **repository root**:

```bash
# Optional: region / project overrides (see scripts/deploy.env.example)
cp scripts/deploy.env.example scripts/deploy.env
# edit scripts/deploy.env if needed (file is gitignored)

chmod +x scripts/deploy.sh

# Dry run (prints steps)
./scripts/deploy.sh --dry-run

# Full deploy: Firestore + Cloud Run (build from source on Google Cloud Build)
./scripts/deploy.sh

# Firestore only (rules + indexes)
./scripts/deploy.sh --firestore-only

# Cloud Run only — image path (build container in Cloud Build, then deploy)
./scripts/deploy.sh --cloud-run-only --cloud-run-method image

# Cloud Run only — source deploy (same as default Cloud Run path)
./scripts/deploy.sh --cloud-run-only --cloud-run-method source
```

### Prerequisites

1. **gcloud** — `gcloud auth login` and `gcloud config set project divinebridge` (or set `GCP_PROJECT`).
2. **Firestore** — either:
   - `firebase login` on your machine, or  
   - `export FIREBASE_TOKEN=...` from `firebase login:ci`, or  
   - a Google account / SA that has permission to update Firestore rules.

### Region note

Default region is **`us-central1`** (matches most docs in this repo). If your Cloud Run service was created in another region (e.g. `us-east1`), set:

```bash
export GCP_REGION=us-east1
```

or add `GCP_REGION` to `scripts/deploy.env`.

### Port

`Dockerfile` and `cloud-run-config.yaml` use **8080**. The script uses `--port 8080` by default (`CLOUD_RUN_PORT`).

## GitHub Actions (manual workflow)

Workflow: **`.github/workflows/deploy.yml`**

- Trigger: **Actions → Deploy (Cloud Run + Firestore) → Run workflow**
- Never runs on push by default (manual only), so you control when production changes.

### Repository secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `GCP_SA_KEY` | **Yes** | JSON key for GCP: Cloud Build, Cloud Run deploy, push to `gcr.io/divinebridge/...` |
| `FIREBASE_TOKEN` | Recommended | `firebase login:ci` token for `firebase deploy --only firestore` |

Service account permissions (typical):

- Cloud Run Admin, Service Account User  
- Cloud Build Editor  
- Storage Admin (for Container Registry / Artifact Registry as used by your project)  
- For Firestore without `FIREBASE_TOKEN`: roles that allow Firebase rules deployment (or use `FIREBASE_TOKEN` from a maintainer account).

## Firebase project binding

- **`.firebaserc`** — default project `divinebridge`  
- **`firebase.json`** — Firestore rules + indexes only

## SFU / Media server

The Mediasoup SFU on GCE is **not** covered by this script. Deploy that separately (see ops docs / VM procedures).

## Checklist before deploy

- [ ] Tested locally or on staging  
- [ ] No unintended secrets committed  
- [ ] If Firestore indexes changed, confirm queries that need new composites  
- [ ] After deploy: smoke test web app + one critical API path  

---

**Related:** `docs/deployment/DEPLOYMENT_GUIDE.md`, `scripts/deploy/deploy_disaster_prayer.sh` (scheduler-focused), `cloud-run-config.yaml` (reference YAML).
