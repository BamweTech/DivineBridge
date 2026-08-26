#!/usr/bin/env bash
# Deploy or update a regional Divine Bridge SFU (mediasoup) on GCE.
#
# Usage:
#   ./scripts/deploy-sfu-region.sh --region eu          # update EU SFU VM
#   ./scripts/deploy-sfu-region.sh --region us          # update US SFU VM
#   ./scripts/deploy-sfu-region.sh --region eu --bootstrap  # first-time setup hints
#
# Prerequisites:
#   - gcloud authenticated, project divinebridge
#   - DNS: sfu-eu.divinebridge.io → EU VM external IP (A record)
#   - GCP firewall: allow tcp:443,3000 and udp/tcp:10000-10999 to SFU tag
#
# Env overrides:
#   GCP_PROJECT
#   SFU_US_ZONE / SFU_US_VM_NAME
#   SFU_EU_ZONE / SFU_EU_VM_NAME
#   SFU_AP_ZONE / SFU_AP_VM_NAME

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"

PROJECT="${GCP_PROJECT:-divinebridge}"
REGION="${SFU_DEPLOY_REGION:-eu}"
BOOTSTRAP=false

SFU_US_ZONE="${SFU_US_ZONE:-us-east1-b}"
SFU_US_VM="${SFU_US_VM_NAME:-divinebridge-sfu}"
SFU_EU_ZONE="${SFU_EU_ZONE:-europe-west1-b}"
SFU_EU_VM="${SFU_EU_VM_NAME:-divinebridge-sfu-eu}"
SFU_AP_ZONE="${SFU_AP_ZONE:-asia-southeast1-b}"
SFU_AP_VM="${SFU_AP_VM_NAME:-divinebridge-sfu-ap}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="${2:?}"; shift 2 ;;
    --bootstrap) BOOTSTRAP=true; shift ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

case "$REGION" in
  us) ZONE="$SFU_US_ZONE"; VM="$SFU_US_VM"; HOST="sfu.divinebridge.io" ;;
  eu) ZONE="$SFU_EU_ZONE"; VM="$SFU_EU_VM"; HOST="sfu-eu.divinebridge.io" ;;
  ap) ZONE="$SFU_AP_ZONE"; VM="$SFU_AP_VM"; HOST="sfu-ap.divinebridge.io" ;;
  *) echo "REGION must be us, eu, or ap" >&2; exit 1 ;;
esac

SSH_FLAGS="-o ConnectTimeout=25 -o StrictHostKeyChecking=no -o ServerAliveInterval=30"

if $BOOTSTRAP; then
  cat <<EOF
==> Bootstrap checklist for SFU region: $REGION

1. Create GCE VM (e2-medium+) in $ZONE:
   gcloud compute instances create $VM \\
     --project=$PROJECT --zone=$ZONE \\
     --machine-type=e2-medium \\
     --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \\
     --tags=divinebridge-sfu \\
     --boot-disk-size=20GB

2. Firewall (if not already on tag divinebridge-sfu):
   - TCP 443 (nginx TLS proxy to Node :3000)
   - TCP 3000 (optional direct)
   - UDP+TCP 10000-10999 (WebRTC)

3. DNS A record: $HOST → VM external IP

4. On VM: install node 18+, pm2, nginx, clone repo, npm ci in media-server/

5. Cloud Run env (after EU VM is live):
   SFU_URL_EU=wss://$HOST/ws

6. Re-deploy Flask: ./scripts/deploy.sh --cloud-run-only

EOF
  exit 0
fi

echo "==> SFU deploy: region=$REGION vm=$VM zone=$ZONE project=$PROJECT"

gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" --ssh-flag="$SSH_FLAGS" --command="
  set -e
  cd ~/divineBridge 2>/dev/null || cd ~/divinebridge 2>/dev/null || { echo 'Repo not found on VM — run --bootstrap'; exit 1; }
  git pull origin main
  cd media-server
  npm ci --omit=dev
  pm2 restart divinebridge-sfu || pm2 start src/server.js --name divinebridge-sfu
  pm2 save
  curl -fsS http://127.0.0.1:3000/health | head -c 200
  echo
"

echo "==> Done. Verify: curl -s https://$HOST/health"
