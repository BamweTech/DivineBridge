#!/usr/bin/env bash
# Pull latest code on the Metro VM and restart the Metro bundler.
#
# Usage:
#   ./scripts/gcp-metro-update.sh            # pull + restart metro
#   ./scripts/gcp-metro-update.sh --reinstall # also rm node_modules && npm install
#   ./scripts/gcp-metro-update.sh --status    # just check Metro status
#
# Env (optional):
#   GCP_PROJECT      default: divinebridge
#   GCP_ZONE         default: us-central1-a
#   METRO_VM_NAME    default: divinebridge-metro

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"

PROJECT="${GCP_PROJECT:-divinebridge}"
ZONE="${GCP_ZONE:-us-central1-a}"
NAME="${METRO_VM_NAME:-divinebridge-metro}"
REINSTALL=false
STATUS_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reinstall) REINSTALL=true; shift ;;
    --status)    STATUS_ONLY=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SSH_FLAGS="-o ConnectTimeout=20 -o StrictHostKeyChecking=no -o ServerAliveInterval=30"

VM_IP="$(gcloud compute instances describe "$NAME" --zone="$ZONE" --project="$PROJECT" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || true)"

echo "==> VM: $NAME  IP: ${VM_IP:-unknown}  project: $PROJECT"

if $STATUS_ONLY; then
  gcloud compute ssh "ubuntu@$NAME" --zone="$ZONE" --project="$PROJECT" \
    --ssh-flag="$SSH_FLAGS" \
    --command='
      echo "--- Metro service ---"
      systemctl is-active metro.service 2>/dev/null || echo "NOT RUNNING"
      echo ""
      echo "--- Recent logs ---"
      journalctl -u metro.service --no-pager -n 10
      echo ""
      echo "--- Memory ---"
      free -m | head -2
      echo ""
      echo "--- Status endpoint ---"
      curl -sS -m 5 http://localhost:8081/status 2>&1 || echo "(no response)"
    '
  exit 0
fi

REMOTE_CMD='set -e; cd ~/app/divineBridge'
REMOTE_CMD+=' && echo "==> Pulling latest..." && git pull origin main 2>&1 | tail -5'

if $REINSTALL; then
  REMOTE_CMD+=' && echo "==> Reinstalling mobile deps..." && cd mobile && rm -rf node_modules && npm install 2>&1 | tail -10'
else
  REMOTE_CMD+=' && cd mobile'
fi

REMOTE_CMD+=' && echo "==> Restarting Metro..." && sudo systemctl restart metro.service'
REMOTE_CMD+=' && sleep 10'
REMOTE_CMD+=' && echo "==> Metro status:" && systemctl is-active metro.service'
REMOTE_CMD+=' && curl -sS -m 5 http://localhost:8081/status 2>&1 || echo "(waiting...)"'

echo "==> Connecting to $NAME..."
gcloud compute ssh "ubuntu@$NAME" --zone="$ZONE" --project="$PROJECT" \
  --ssh-flag="$SSH_FLAGS" \
  --command="$REMOTE_CMD"

echo ""
if [[ -n "$VM_IP" ]]; then
  echo "==> Done. Metro should be reachable at http://${VM_IP}:8081"
  echo "    Build iOS with: REACT_NATIVE_PACKAGER_HOSTNAME=${VM_IP} npx expo run:ios --device"
fi
