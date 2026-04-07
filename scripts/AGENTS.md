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

## Conventions

- Always use `set -euo pipefail` in bash scripts.
- Use `--dry-run` to preview destructive operations.
- Migration scripts should be idempotent (safe to run multiple times).
- Use `get_config()` and `initialize_firebase()` for Firebase access in Python scripts.
- Log progress and errors clearly.
- Do not commit `deploy.env` (contains secrets); use `deploy.env.example` as template.
