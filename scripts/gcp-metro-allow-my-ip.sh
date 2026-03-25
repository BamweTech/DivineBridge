#!/usr/bin/env bash
# Point allow-divinebridge-metro at your current public IPv4 so /status and devices can reach Metro.
#
#   ./scripts/gcp-metro-allow-my-ip.sh
#   GCP_PROJECT=myproj ./scripts/gcp-metro-allow-my-ip.sh
#
# WARNING: For quick tests only, you can open Metro to the world (insecure):
#   METRO_SOURCE_RANGE=0.0.0.0/0 ./scripts/gcp-metro-allow-my-ip.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"
PROJECT="${GCP_PROJECT:-divinebridge}"
FW="allow-divinebridge-metro"

if [[ -n "${METRO_SOURCE_RANGE:-}" ]]; then
  RANGE="$METRO_SOURCE_RANGE"
else
  IP="$(curl -fsS --max-time 12 https://api.ipify.org)"
  RANGE="${IP}/32"
fi

echo "==> Updating $FW on $PROJECT -> source-ranges=$RANGE"
gcloud compute firewall-rules update "$FW" \
  --project="$PROJECT" \
  --source-ranges="$RANGE"

VM_IP="$(gcloud compute instances describe "${METRO_VM_NAME:-divinebridge-metro}" \
  --zone="${GCP_ZONE:-us-central1-a}" --project="$PROJECT" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || true)"

echo "==> Done."
if [[ -n "$VM_IP" ]]; then
  echo "    Try: curl -sS -m 10 http://${VM_IP}:8081/status"
else
  echo "    Get VM IP: gcloud compute instances describe divinebridge-metro --zone=us-central1-a --format='get(networkInterfaces[0].accessConfigs[0].natIP)'"
fi
