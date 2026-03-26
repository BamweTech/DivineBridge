#!/usr/bin/env bash
# Open an SSH tunnel to the VM Metro so a physical device on the same WiFi
# can reach it through the Mac's LAN address. Avoids iOS ATS restrictions
# on HTTP to public IPs.
#
# Flow: iPhone → Mac LAN:8081 → SSH tunnel → VM localhost:8081 (Metro)
#
# Usage:
#   ./scripts/gcp-metro-tunnel.sh            # register IP + open tunnel
#   ./scripts/gcp-metro-tunnel.sh --kill     # close an existing tunnel
#
# Env (optional):
#   GCP_PROJECT        default: divinebridge
#   GCP_ZONE           default: us-central1-a
#   METRO_VM_NAME      default: divinebridge-metro
#   LOCAL_PORT         default: 8081

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"

PROJECT="${GCP_PROJECT:-divinebridge}"
ZONE="${GCP_ZONE:-us-central1-a}"
VM_NAME="${METRO_VM_NAME:-divinebridge-metro}"
LOCAL_PORT="${LOCAL_PORT:-8081}"
FW="allow-divinebridge-metro"

kill_existing() {
  local pids
  pids="$(lsof -ti tcp:"$LOCAL_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "==> Killing process(es) on port $LOCAL_PORT: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

if [[ "${1:-}" == "--kill" ]]; then
  kill_existing
  echo "==> Tunnel closed."
  exit 0
fi

# 1. Register current IP in firewall
IP="$(curl -fsS --max-time 12 https://api.ipify.org)"
echo "==> Updating firewall $FW → source-ranges=${IP}/32"
gcloud compute firewall-rules update "$FW" \
  --project="$PROJECT" \
  --source-ranges="${IP}/32" 2>/dev/null || true

# 2. Get VM external IP
VM_IP="$(gcloud compute instances describe "$VM_NAME" \
  --zone="$ZONE" --project="$PROJECT" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null)"
if [[ -z "$VM_IP" ]]; then
  echo "ERROR: Could not get external IP for $VM_NAME" >&2
  exit 1
fi
echo "==> VM external IP: $VM_IP"

# 3. Verify Metro is running on the VM
echo "==> Checking Metro on VM..."
STATUS="$(curl -fsS --max-time 8 "http://${VM_IP}:8081/status" 2>/dev/null || true)"
if [[ "$STATUS" != *"packager-status:running"* ]]; then
  echo "WARN: Metro may not be running on the VM (got: ${STATUS:-no response})"
  echo "      SSH in and check: gcloud compute ssh ubuntu@$VM_NAME --zone=$ZONE --project=$PROJECT"
fi

# 4. Kill anything already on LOCAL_PORT
kill_existing

# 5. Open SSH tunnel via gcloud (handles GCP auth/keys automatically)
echo "==> Opening SSH tunnel: 0.0.0.0:${LOCAL_PORT} → VM localhost:8081"
gcloud compute ssh "ubuntu@${VM_NAME}" \
  --zone="$ZONE" --project="$PROJECT" \
  -- -f -N -L "0.0.0.0:${LOCAL_PORT}:localhost:8081"

sleep 2

# 6. Verify tunnel is active
if lsof -ti tcp:"$LOCAL_PORT" -sTCP:LISTEN &>/dev/null; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<unknown>')"
  echo ""
  echo "==> Tunnel active!"
  echo "    Mac LAN IP : ${LAN_IP}"
  echo "    Metro URL  : http://${LAN_IP}:${LOCAL_PORT}"
  echo ""
  echo "    Your iPhone will auto-discover Metro on the local network."
  echo "    To close:  ./scripts/gcp-metro-tunnel.sh --kill"
else
  echo "ERROR: Tunnel failed to start. Try manually:"
  echo "  ssh -N -L 0.0.0.0:${LOCAL_PORT}:localhost:8081 ubuntu@${VM_IP}"
  exit 1
fi
