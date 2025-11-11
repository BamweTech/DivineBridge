#!/bin/bash
# LiveKit Server Setup Script for Google Cloud
# Sets up LiveKit SFU on a Compute Engine VM

set -e

PROJECT_ID="divinebridge"
ZONE="us-central1-a"
INSTANCE_NAME="livekit-server"
MACHINE_TYPE="e2-small"

echo "========================================="
echo "LiveKit Server Setup for Divine Bridge"
echo "========================================="
echo ""

# Step 1: Create VM instance
echo "Step 1: Creating Compute Engine VM..."
gcloud compute instances create ${INSTANCE_NAME} \
  --project=${PROJECT_ID} \
  --zone=${ZONE} \
  --machine-type=${MACHINE_TYPE} \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --boot-disk-type=pd-standard \
  --tags=livekit-server,http-server,https-server \
  --metadata=startup-script='#!/bin/bash
    apt-get update
    apt-get install -y docker.io
    systemctl start docker
    systemctl enable docker
    usermod -aG docker $USER
  '

echo "✅ VM created successfully"
echo ""

# Step 2: Create firewall rules
echo "Step 2: Creating firewall rules..."

# WebRTC media (UDP)
gcloud compute firewall-rules create livekit-media \
  --project=${PROJECT_ID} \
  --allow=udp:50000-60000 \
  --target-tags=livekit-server \
  --description="LiveKit WebRTC media ports" \
  --direction=INGRESS || echo "Firewall rule already exists"

# LiveKit API and WebRTC signaling (TCP)
gcloud compute firewall-rules create livekit-signal \
  --project=${PROJECT_ID} \
  --allow=tcp:7880,tcp:7881,tcp:3478 \
  --target-tags=livekit-server \
  --description="LiveKit signaling and TURN ports" \
  --direction=INGRESS || echo "Firewall rule already exists"

echo "✅ Firewall rules created"
echo ""

# Step 3: Get external IP
echo "Step 3: Getting external IP..."
EXTERNAL_IP=$(gcloud compute instances describe ${INSTANCE_NAME} \
  --zone=${ZONE} \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo "External IP: ${EXTERNAL_IP}"
echo ""

# Step 4: Generate API keys
echo "Step 4: Generating LiveKit API keys..."
API_KEY="APK$(openssl rand -hex 16)"
API_SECRET=$(openssl rand -base64 32)

echo "API Key: ${API_KEY}"
echo "API Secret: ${API_SECRET}"
echo ""

# Step 5: Create LiveKit config
echo "Step 5: Creating LiveKit configuration..."

cat > /tmp/livekit-config.yaml <<EOF
port: 7880
bind_addresses:
  - "0.0.0.0"

rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  tcp_port: 7881
  
keys:
  ${API_KEY}: ${API_SECRET}

turn:
  enabled: true
  domain: ${EXTERNAL_IP}
  tls_port: 5349
  udp_port: 3478
  external_tls: false

logging:
  level: info
  
room:
  auto_create: true
  empty_timeout: 300
  max_participants: 100

EOF

echo "✅ Configuration created"
echo ""

# Step 6: Upload config and start LiveKit
echo "Step 6: Starting LiveKit server..."

gcloud compute scp /tmp/livekit-config.yaml ${INSTANCE_NAME}:/tmp/ --zone=${ZONE}

gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command="
  sudo mkdir -p /opt/livekit
  sudo mv /tmp/livekit-config.yaml /opt/livekit/config.yaml
  
  # Pull LiveKit image
  sudo docker pull livekit/livekit-server:latest
  
  # Run LiveKit
  sudo docker run -d \
    --name livekit \
    --restart=always \
    -p 7880:7880 \
    -p 7881:7881/tcp \
    -p 50000-60000:50000-60000/udp \
    -p 3478:3478/udp \
    -v /opt/livekit:/livekit \
    livekit/livekit-server:latest \
    --config /livekit/config.yaml
    
  echo '✅ LiveKit server started'
  sudo docker logs livekit
"

echo ""
echo "========================================="
echo "LiveKit Setup Complete!"
echo "========================================="
echo ""
echo "Server Details:"
echo "  External IP: ${EXTERNAL_IP}"
echo "  WebSocket URL: ws://${EXTERNAL_IP}:7880"
echo "  API Key: ${API_KEY}"
echo "  API Secret: ${API_SECRET}"
echo ""
echo "Next Steps:"
echo "1. Save API credentials to Secret Manager:"
echo "   gcloud secrets create LIVEKIT_API_KEY --data-file=<(echo '${API_KEY}')"
echo "   gcloud secrets create LIVEKIT_API_SECRET --data-file=<(echo '${API_SECRET}')"
echo "   gcloud secrets create LIVEKIT_HOST --data-file=<(echo '${EXTERNAL_IP}:7880')"
echo ""
echo "2. Test server health:"
echo "   curl http://${EXTERNAL_IP}:7880"
echo ""
echo "3. View logs:"
echo "   gcloud compute ssh ${INSTANCE_NAME} --zone=${ZONE} --command='sudo docker logs -f livekit'"
echo ""

