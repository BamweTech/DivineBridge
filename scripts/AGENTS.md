# scripts/ — Deploy Scripts, Migrations, and Utilities

Operational scripts for deploying, migrating data, and administering Divine Bridge.

Prefer categorized modules (`python -m scripts.<category>.<module>`) over root-level launchers.

## Layout

| Folder | Purpose |
|--------|---------|
| `scripts/content/` | Prayer/verse/disaster content inspection and regeneration |
| `scripts/emailing/` | Manual email sends and subscriber utilities |
| `scripts/admin/` | Organization and admin cleanup utilities |
| `scripts/maintenance/` | Formatting, route-map verification, diagnostics |
| `scripts/deploy/` | Deploy, SFU region, TURN, disaster scheduler tooling |
| `scripts/metro/` | Metro GCE VM update / tunnel / allow-IP helpers |
| `scripts/lib/` | Shared shell helpers (`cloudsdk-python.sh`) |

Stable thin wrappers remain at `scripts/deploy.sh`, `scripts/deploy-sfu-region.sh`, and `scripts/gcp-metro-*.sh` so docs and post-push hooks keep working.

## Deployment

### `deploy.sh` → `deploy/deploy.sh`

```bash
./scripts/deploy.sh                       # Full deploy (Firestore + Cloud Run)
./scripts/deploy.sh --firestore-only      # Firestore rules + indexes only
./scripts/deploy.sh --cloud-run-only      # Cloud Run only
./scripts/deploy.sh --dry-run             # Preview what would run
./scripts/deploy.sh --cloud-run-method image  # Build container image first
```

Environment config: `scripts/deploy.env` (see `deploy.env.example`).

Key variables: `GCP_PROJECT`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, `FIREBASE_PROJECT`.

### Metro VM (Expo bundler on GCE)

```bash
./scripts/gcp-metro-update.sh            # git pull main + restart metro.service
./scripts/gcp-metro-update.sh --reinstall # also rm mobile/node_modules && npm install
./scripts/gcp-metro-update.sh --status    # systemd + Metro health
```

### Regional SFU (Voice Link media)

```bash
./scripts/deploy-sfu-region.sh --bootstrap --region eu
./scripts/deploy-sfu-region.sh --region eu
./scripts/deploy-sfu-region.sh --region us
```

## Common Python commands

```bash
python -m scripts.content.check_today_prayer
python -m scripts.emailing.manual_sunday_email
python -m scripts.maintenance.verify_route_map
python scripts/maintenance/pregen_verse_contexts.py
./scripts/deploy/setup-turn-server.sh
```

## Conventions

- Always use `set -euo pipefail` in bash scripts.
- Use `--dry-run` to preview destructive operations.
- Migration scripts should be idempotent (safe to run multiple times).
- Prefer `backend.core.config` / `backend.integrations.firebase_auth` imports.
- Do not commit `deploy.env` (contains secrets); use `deploy.env.example` as template.
- Avoid `python scripts/*.py` wildcards — `scripts/emailing` must not be shadowed by a package named `email`.
