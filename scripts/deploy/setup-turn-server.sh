#!/bin/bash
# Simple TURN Server Setup Script for Google Cloud (FREE)
# This uses the Google Cloud free tier e2-micro instance

set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/lib/cloudsdk-python.sh"

echo "=========================================="
echo "Divine Bridge - Free TURN Server Setup"
echo "=========================================="
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI not found"
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

echo "✅ gcloud CLI found"
echo ""

# Get project ID
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ No active GCP project. Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "📋 Using project: $PROJECT_ID"
echo ""

# Generate a random password for TURN server
TURN_PASSWORD=$(openssl rand -base64 12 | tr -d /=+ | cut -c -16)

echo "🔐 Generated TURN credentials:"
echo "   Username: divinebridge"
echo "   Password: $TURN_PASSWORD"
echo ""

# Confirm before proceeding
read -p "Create FREE e2-micro TURN server in us-central1? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🚀 Creating compute instance..."

# Create the instance with startup script
gcloud compute instances create divinebridge-turn \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=turn-server \
  --metadata=startup-script="#!/bin/bash
# Install coturn
apt-get update
apt-get install -y coturn

# Configure coturn
cat > /etc/turnserver.conf <<EOF
# Listening ports
listening-port=3478

# External IP will be auto-detected
# Realm
realm=turn.divinebridge.app

# Authentication
lt-cred-mech
user=divinebridge:$TURN_PASSWORD

# Security
fingerprint
no-multicast-peers
no-cli

# Port range for relaying
min-port=49152
max-port=65535

# Logging
log-file=/var/log/turnserver.log
simple-log
EOF

# Enable and start coturn
systemctl enable coturn
systemctl start coturn

echo 'TURN server installed and started' > /var/log/turn-setup-complete.log
"

echo "✅ Instance created"
echo ""

echo "🔥 Creating firewall rules..."

# Create firewall rules
gcloud compute firewall-rules create allow-turn-server \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:3478,udp:3478,tcp:49152-65535,udp:49152-65535 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=turn-server

echo "✅ Firewall rules created"
echo ""

# Wait for instance to be ready
echo "⏳ Waiting for instance to start (30 seconds)..."
sleep 30

# Get external IP
EXTERNAL_IP=$(gcloud compute instances describe divinebridge-turn --zone=us-central1-a --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "=========================================="
echo "✅ TURN Server Setup Complete!"
echo "=========================================="
echo ""
echo "📡 TURN Server Details:"
echo "   IP Address: $EXTERNAL_IP"
echo "   Port: 3478"
echo "   Username: divinebridge"
echo "   Password: $TURN_PASSWORD"
echo ""
echo "🔧 Configure Cloud Run with these environment variables:"
echo ""
echo "TURN_URLS=turn:$EXTERNAL_IP:3478"
echo "TURN_USERNAME=divinebridge"
echo "TURN_PASSWORD=$TURN_PASSWORD"
echo ""
echo "📋 Quick deploy command:"
echo ""
echo "gcloud run services update divinebridge \\"
echo "  --region us-central1 \\"
echo "  --set-env-vars \"TURN_URLS=turn:$EXTERNAL_IP:3478,TURN_USERNAME=divinebridge,TURN_PASSWORD=$TURN_PASSWORD\""
echo ""
echo "💰 Cost: FREE (e2-micro is always-free tier)"
echo ""
echo "✅ Setup complete! Run the deploy command above to enable TURN."
echo ""

# Save credentials to file
cat > turn-credentials.txt <<EOF
TURN Server Credentials for Divine Bridge
==========================================

Server IP: $EXTERNAL_IP
Port: 3478
Username: divinebridge
Password: $TURN_PASSWORD

Environment Variables:
TURN_URLS=turn:$EXTERNAL_IP:3478
TURN_USERNAME=divinebridge
TURN_PASSWORD=$TURN_PASSWORD

Deploy Command:
gcloud run services update divinebridge --region us-central1 --set-env-vars "TURN_URLS=turn:$EXTERNAL_IP:3478,TURN_USERNAME=divinebridge,TURN_PASSWORD=$TURN_PASSWORD"

Created: $(date)
EOF

echo "💾 Credentials saved to: turn-credentials.txt"
echo "⚠️  Keep this file secure and do not commit it to git!"

