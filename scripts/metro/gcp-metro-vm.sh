#!/usr/bin/env bash
# Provision a Google Compute Engine VM to run Expo / Metro for Divine Bridge.
#
# Usage:
#   ./scripts/gcp-metro-vm.sh
#   METRO_SOURCE_RANGE=203.0.113.5/32 ./scripts/gcp-metro-vm.sh
#
# Env (optional):
#   GCP_PROJECT          default: divinebridge
#   GCP_ZONE             default: us-central1-a
#   METRO_VM_NAME        default: divinebridge-metro
#   METRO_MACHINE_TYPE   default: e2-medium
#   METRO_DISK_GB        default: 30
#   METRO_SOURCE_RANGE   default: your IPv4/32 from api.ipify.org
#
# After VM exists, clone + npm ci + systemd are usually done via SSH; see docs or
# ~/finish-metro-setup.sh on the VM. Metro must use: npx expo start --host lan --port 8081
# (Expo rejects --host 0.0.0.0.)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"
PROJECT="${GCP_PROJECT:-divinebridge}"
ZONE="${GCP_ZONE:-us-central1-a}"
NAME="${METRO_VM_NAME:-divinebridge-metro}"
MTYPE="${METRO_MACHINE_TYPE:-e2-medium}"
DISK_GB="${METRO_DISK_GB:-30}"
FW_NAME="allow-divinebridge-metro"

if [[ -z "${METRO_SOURCE_RANGE:-}" ]]; then
  echo "==> Detecting your public IPv4 for firewall..."
  PUB_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  if [[ -z "$PUB_IP" ]]; then
    echo "Set METRO_SOURCE_RANGE, e.g. METRO_SOURCE_RANGE=203.0.113.10/32 $0" >&2
    exit 1
  fi
  METRO_SOURCE_RANGE="${PUB_IP}/32"
fi

echo "==> project=$PROJECT zone=$ZONE vm=$NAME type=$MTYPE source=$METRO_SOURCE_RANGE"

if ! gcloud compute firewall-rules describe "$FW_NAME" --project="$PROJECT" &>/dev/null; then
  gcloud compute firewall-rules create "$FW_NAME" \
    --project="$PROJECT" \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:8081,tcp:19000,tcp:19001 \
    --source-ranges="$METRO_SOURCE_RANGE" \
    --target-tags=divinebridge-metro \
    --description="Expo/Metro dev (update source range if your IP changes)"
else
  echo "==> Firewall $FW_NAME already exists."
fi

STARTUP="$(mktemp)"
trap 'rm -f "$STARTUP"' EXIT
cat >"$STARTUP" <<'STARTUP_EOF'
#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
grep -q max_user_watches /etc/sysctl.conf || echo fs.inotify.max_user_watches=524288 >> /etc/sysctl.conf
sysctl -p || true
mkdir -p /home/ubuntu/app
chown ubuntu:ubuntu /home/ubuntu/app
STARTUP_EOF

if gcloud compute instances describe "$NAME" --zone="$ZONE" --project="$PROJECT" &>/dev/null; then
  echo "==> VM $NAME already exists."
  EXT_IP="$(gcloud compute instances describe "$NAME" --zone="$ZONE" --project="$PROJECT" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
  echo "    External IP: ${EXT_IP:-n/a}"
  echo "    SSH: gcloud compute ssh ubuntu@$NAME --zone=$ZONE --project=$PROJECT"
  exit 0
fi

gcloud compute instances create "$NAME" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MTYPE" \
  --boot-disk-size="${DISK_GB}GB" \
  --boot-disk-type=pd-balanced \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=divinebridge-metro \
  --metadata-from-file=startup-script="$STARTUP" \
  --scopes=https://www.googleapis.com/auth/cloud-platform

sleep 5
EXT_IP="$(gcloud compute instances describe "$NAME" --zone="$ZONE" --project="$PROJECT" --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"
echo "==> Created. IP=$EXT_IP"
echo "    Add GitHub deploy key, then run ~/finish-metro-setup.sh on the VM (or see team runbook)."
echo "    Update firewall if IP changes:"
echo "    gcloud compute firewall-rules update $FW_NAME --source-ranges=NEW/32 --project=$PROJECT"
