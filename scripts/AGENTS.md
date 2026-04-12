# scripts/ — Deploy Scripts, Migrations, and Utilities

Operational scripts for deploying, migrating data, and administering Divine Bridge.

## Deployment

### `deploy.sh`

The primary deployment script. Deploys Firestore rules and/or Cloud Run.

```bash
./scripts/deploy.sh                       # Full deploy (Firestore + Cloud Run)
./scripts/deploy.sh --firestore-only      # Firestore rules + indexes only
./scripts/deploy.sh --cloud-run-only      # Cloud Run only
./scripts/deploy.sh --dry-run             # Preview what would run
./scripts/deploy.sh --cloud-run-method image  # Build container image first
```

Environment config: `scripts/deploy.env` (see `deploy.env.example`).

Key variables: `GCP_PROJECT`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, `FIREBASE_PROJECT`.

### `lib/cloudsdk-python.sh`

Helper to set `CLOUDSDK_PYTHON` for gcloud SDK compatibility.

### Metro VM (Expo bundler on GCE)

After pushing **mobile** (or shared JS) changes to `main`, or when the user asks to refresh the bundler VM:

```bash
./scripts/gcp-metro-update.sh            # git pull main + restart metro.service
./scripts/gcp-metro-update.sh --reinstall # also rm mobile/node_modules && npm install
./scripts/gcp-metro-update.sh --status    # systemd + Metro health
```

Requires `gcloud` auth and access to project `divinebridge`, VM `divinebridge-metro` (default zone `us-central1-a`). See also `gcp-metro-vm.sh`, `gcp-metro-tunnel.sh`, `gcp-metro-allow-my-ip.sh`.

## Migrations

Migration scripts are one-off Python scripts for Firestore data changes. They are not part of a formal migration framework.

Pattern:

```python
from config import get_config
from firebase_auth import initialize_firebase
from firebase_admin import firestore

initialize_firebase()
db = firestore.client()

# Iterate collection, transform documents
for doc in db.collection('users').stream():
    data = doc.to_dict()
    # Transform and update...
    doc.reference.set(updates, merge=True)
```

Example: `migrate_users_to_firestore.py`.

## Admin / GCS utilities

| Script | Purpose |
|--------|---------|
| `delete_production_test_testimonies.py` | Remove QA posts from GCS: `testimonies/` **and** `prayer_requests/` (mobile Community / `/api/prayer/prayers` uses the latter). `--dry-run` to list only. |

## Conventions

- Always use `set -euo pipefail` in bash scripts.
- Use `--dry-run` to preview destructive operations.
- Migration scripts should be idempotent (safe to run multiple times).
- Use `get_config()` and `initialize_firebase()` for Firebase access in Python scripts.
- Log progress and errors clearly.
- Do not commit `deploy.env` (contains secrets); use `deploy.env.example` as template.
