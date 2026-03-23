#!/usr/bin/env bash
# Divine Bridge — unified deployment: Firestore (rules + indexes) + Cloud Run.
# Usage:
#   ./scripts/deploy.sh                    # everything (Firestore + Cloud Run from source)
#   ./scripts/deploy.sh --firestore-only
#   ./scripts/deploy.sh --cloud-run-only --cloud-run-method image
#   ./scripts/deploy.sh --dry-run          # print what would run
#
# Optional: create scripts/deploy.env from deploy.env.example and uncomment the source line below.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Defaults (override with env or scripts/deploy.env)
GCP_PROJECT="${GCP_PROJECT:-divinebridge}"
GCP_REGION="${GCP_REGION:-us-central1}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:-divinebridge}"
CLOUD_RUN_PORT="${CLOUD_RUN_PORT:-8080}"
CONTAINER_IMAGE="${CONTAINER_IMAGE:-gcr.io/${GCP_PROJECT}/${CLOUD_RUN_SERVICE}}"
FIREBASE_PROJECT="${FIREBASE_PROJECT:-$GCP_PROJECT}"

DO_FIRESTORE=true
DO_CLOUD_RUN=true
CLOUD_RUN_METHOD="source" # source | image
DRY_RUN=false

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}WARN:${NC} $*"; }
err() { echo -e "${RED}ERROR:${NC} $*" >&2; }

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

Options:
  --all                 Deploy Firestore + Cloud Run (default)
  --firestore-only      Deploy only firestore.rules + firestore.indexes.json
  --cloud-run-only      Deploy only Cloud Run
  --cloud-run-method X  source (gcloud --source .) or image (Cloud Build + deploy image)
  --dry-run             Print commands; do not execute

Environment (see scripts/deploy.env.example):
  GCP_PROJECT, GCP_REGION, CLOUD_RUN_SERVICE, CLOUD_RUN_PORT, CONTAINER_IMAGE, FIREBASE_PROJECT, CLOUDSDK_PYTHON (optional)

Prerequisites:
  - gcloud CLI authenticated (gcloud auth login && gcloud config set project \$GCP_PROJECT); Python 3.10+ on PATH or set CLOUDSDK_PYTHON (avoids SDK 3.9 deprecation warning)
  - firebase-tools via npx (no global install required)
  - Firestore deploy: firebase login, or set FIREBASE_TOKEN (firebase login:ci), or GCP SA with Firebase deploy roles
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --all) DO_FIRESTORE=true; DO_CLOUD_RUN=true; shift ;;
    --firestore-only) DO_FIRESTORE=true; DO_CLOUD_RUN=false; shift ;;
    --cloud-run-only) DO_FIRESTORE=false; DO_CLOUD_RUN=true; shift ;;
    --cloud-run-method)
      CLOUD_RUN_METHOD="${2:?}"
      shift 2
      ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -f "$ROOT/scripts/deploy.env" ]]; then
  # shellcheck source=/dev/null
  source "$ROOT/scripts/deploy.env"
fi

# gcloud SDK requires Python 3.10+ (bundled 3.9 is deprecated)
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "Missing command: $1"
    exit 1
  fi
}

deploy_firestore() {
  log "Deploying Firestore (rules + indexes) → project ${FIREBASE_PROJECT}"
  if $DRY_RUN; then
    echo "[dry-run] npx firebase-tools@latest deploy --only firestore --project ${FIREBASE_PROJECT} --non-interactive"
    return
  fi
  npx --yes firebase-tools@latest deploy --only firestore --project "${FIREBASE_PROJECT}" --non-interactive
}

# Optional: set DEPLOY_FIREBASE_STORAGE=1 after enabling Storage in Firebase Console (Project → Storage → Get started).
deploy_storage_rules() {
  log "Deploying Storage rules → project ${FIREBASE_PROJECT}"
  if $DRY_RUN; then
    echo "[dry-run] npx firebase-tools@latest deploy --only storage --project ${FIREBASE_PROJECT} --non-interactive"
    return
  fi
  npx --yes firebase-tools@latest deploy --only storage --project "${FIREBASE_PROJECT}" --non-interactive
}

deploy_cloud_run_source() {
  log "Cloud Run deploy from source (region ${GCP_REGION}, port ${CLOUD_RUN_PORT})"
  if $DRY_RUN; then
    echo "[dry-run] gcloud config set project ${GCP_PROJECT}"
    echo "[dry-run] gcloud run deploy ${CLOUD_RUN_SERVICE} --source . --region ${GCP_REGION} ... --port ${CLOUD_RUN_PORT}"
    return
  fi
  gcloud config set project "${GCP_PROJECT}"
  gcloud run deploy "${CLOUD_RUN_SERVICE}" \
    --source . \
    --region "${GCP_REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --max-instances 10 \
    --min-instances 0 \
    --port "${CLOUD_RUN_PORT}"
}

deploy_cloud_run_image() {
  log "Cloud Build image → ${CONTAINER_IMAGE}"
  if $DRY_RUN; then
    echo "[dry-run] gcloud config set project ${GCP_PROJECT}"
    echo "[dry-run] gcloud builds submit --tag ${CONTAINER_IMAGE} --timeout=600 ."
    echo "[dry-run] gcloud run deploy ${CLOUD_RUN_SERVICE} --image ${CONTAINER_IMAGE} --region ${GCP_REGION} ... --port ${CLOUD_RUN_PORT}"
    return
  fi
  gcloud config set project "${GCP_PROJECT}"
  gcloud builds submit --tag "${CONTAINER_IMAGE}" --timeout=600 .
  gcloud run deploy "${CLOUD_RUN_SERVICE}" \
    --image "${CONTAINER_IMAGE}" \
    --region "${GCP_REGION}" \
    --platform managed \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --max-instances 10 \
    --min-instances 0 \
    --port "${CLOUD_RUN_PORT}"
}

deploy_cloud_run() {
  case "$CLOUD_RUN_METHOD" in
    source) deploy_cloud_run_source ;;
    image)  deploy_cloud_run_image ;;
    *) err "Invalid --cloud-run-method (use source or image)"; exit 1 ;;
  esac
}

if ! $DRY_RUN; then
  require_cmd gcloud
fi

if $DO_FIRESTORE; then
  deploy_firestore
  if [[ "${DEPLOY_FIREBASE_STORAGE:-}" == "1" ]]; then
    deploy_storage_rules
  fi
fi

if $DO_CLOUD_RUN; then
  deploy_cloud_run
fi

if ! $DRY_RUN; then
  log "Done."
  if $DO_CLOUD_RUN; then
    url="$(gcloud run services describe "$CLOUD_RUN_SERVICE" --region="$GCP_REGION" --format='value(status.url)' 2>/dev/null || true)"
    [[ -n "$url" ]] && echo "Cloud Run URL: $url"
  fi
  echo "Firebase console: https://console.firebase.google.com/project/${FIREBASE_PROJECT}/overview"
fi
