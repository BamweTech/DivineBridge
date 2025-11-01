# TURN Server Setup Guide

This guide explains how to set up TURN servers for the Divine Bridge prayer room to handle WebRTC connections when direct peer-to-peer connections fail due to firewalls or restrictive NAT.

## Why TURN Servers are Needed

**STUN vs TURN:**
- **STUN** (Session Traversal Utilities for NAT): Helps discover your public IP address. Already configured with Google's free STUN servers.
- **TURN** (Traversal Using Relays around NAT): Relays media traffic when direct P2P connections fail. Required for users behind restrictive firewalls/NAT.

**Connection failure symptoms:**
```
Error: Connection failed.
Connection failure with [user-id], will retry...
```

This happens when both users are behind restrictive NAT or firewalls and can't establish direct peer-to-peer connections.

---

## Option 1: Free TURN Servers (For Testing)

### Open Relay Project (Limited, Public)

**⚠️ Warning**: Public TURN servers have bandwidth limits and may be unreliable. Only for development/testing.

```bash
# In your .env file or Cloud Run environment variables
TURN_URLS=turn:openrelay.metered.ca:80
TURN_USERNAME=openrelayproject
TURN_PASSWORD=openrelayproject
```

### Twilio Network Traversal Service (Free Tier)

Twilio offers a free TURN service with better reliability:

1. **Sign up**: https://www.twilio.com/console/voice/runtime/network-traversal-service
2. **Get credentials**: Create a service and get your Account SID and Auth Token
3. **Add to environment**:
```bash
TURN_URLS=turn:global.turn.twilio.com:3478?transport=udp,turn:global.turn.twilio.com:3478?transport=tcp,turn:global.turn.twilio.com:443?transport=tcp
TURN_USERNAME=your_twilio_account_sid
TURN_PASSWORD=your_twilio_auth_token
```

---

## Option 2: Self-Hosted TURN Server (Recommended for Production)

### Using coturn (Most Popular)

**1. Install coturn on a server with public IP**

On Ubuntu/Debian:
```bash
sudo apt update
sudo apt install coturn
```

On CentOS/RHEL:
```bash
sudo yum install coturn
```

**2. Configure coturn**

Edit `/etc/turnserver.conf`:
```ini
# External IP (your server's public IP)
external-ip=YOUR_PUBLIC_IP

# Listening port
listening-port=3478
tls-listening-port=5349

# Realm (your domain)
realm=turn.yourdomain.com

# Authentication
lt-cred-mech
user=username:password

# Fingerprint
fingerprint

# Range of ports for media relay
min-port=49152
max-port=65535

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
no-multicast-peers
no-cli
```

**3. Open firewall ports**
```bash
# UDP and TCP for TURN
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp

# Media relay ports
sudo ufw allow 49152:65535/tcp
sudo ufw allow 49152:65535/udp
```

**4. Start the service**
```bash
sudo systemctl enable coturn
sudo systemctl start coturn
sudo systemctl status coturn
```

**5. Configure in Divine Bridge**
```bash
TURN_URLS=turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349
TURN_USERNAME=username
TURN_PASSWORD=password
```

---

## Option 3: Google Cloud Run + coturn on Compute Engine

**1. Create a Compute Engine instance**
```bash
gcloud compute instances create turn-server \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=turn-server
```

**2. Create firewall rules**
```bash
gcloud compute firewall-rules create allow-turn \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:3478,udp:3478,tcp:5349,udp:5349,tcp:49152-65535,udp:49152-65535 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=turn-server
```

**3. SSH into the instance and install coturn**
```bash
gcloud compute ssh turn-server --zone=us-central1-a

# Install coturn
sudo apt update
sudo apt install -y coturn

# Follow configuration steps from Option 2
```

**4. Set environment variables in Cloud Run**
```bash
gcloud run services update divinebridge \
  --region us-central1 \
  --set-env-vars "TURN_URLS=turn:YOUR_TURN_SERVER_IP:3478,turns:YOUR_TURN_SERVER_IP:5349,TURN_USERNAME=username,TURN_PASSWORD=password"
```

---

## Option 4: Xirsys (Commercial, Easiest)

Xirsys provides managed TURN servers with a free tier.

**1. Sign up**: https://xirsys.com/

**2. Create a channel**

**3. Get credentials** from your dashboard

**4. Configure in Divine Bridge**
```bash
TURN_URLS=turn:your-channel.xirsys.com:80?transport=udp,turn:your-channel.xirsys.com:3478?transport=udp,turn:your-channel.xirsys.com:80?transport=tcp,turn:your-channel.xirsys.com:3478?transport=tcp
TURN_USERNAME=your_xirsys_username
TURN_PASSWORD=your_xirsys_credential
```

---

## Testing Your TURN Server

Use Trickle ICE test: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

1. Add your TURN server URL, username, and password
2. Click "Gather candidates"
3. Look for candidates of type `relay` - these indicate TURN is working

---

## Configuring in Cloud Run

### Using gcloud CLI
```bash
gcloud run services update divinebridge \
  --region us-central1 \
  --set-env-vars "TURN_URLS=turn:your.turn.server:3478,TURN_USERNAME=username,TURN_PASSWORD=password"
```

### Using Google Cloud Console
1. Go to Cloud Run console
2. Select your service `divinebridge`
3. Click "Edit & Deploy New Revision"
4. Go to "Variables & Secrets" tab
5. Add environment variables:
   - `TURN_URLS`: Your TURN server URLs (comma-separated)
   - `TURN_USERNAME`: Your TURN username
   - `TURN_PASSWORD`: Your TURN password
6. Deploy

---

## Verifying Configuration

After deploying with TURN servers:

1. **Check server logs**:
```bash
gcloud run logs read divinebridge --region us-central1 --limit 100 | grep "ICE Servers"
```

You should see:
```
Generated ICE Servers. Count: [number > 1]
```

2. **Browser console**: Join a prayer room and check console for:
```javascript
ICE servers loaded: [
  {urls: "stun:stun.l.google.com:19302"},
  {urls: "turn:your.turn.server:3478", username: "...", credential: "..."}
]
```

3. **Connection quality**: WebRTC connections should succeed even behind restrictive firewalls.

---

## Cost Estimates

### Self-Hosted (Compute Engine e2-micro)
- **Cost**: ~$5-7/month
- **Bandwidth**: 1GB egress free, then $0.12/GB
- **Best for**: Small to medium usage

### Twilio Network Traversal
- **Free tier**: 750,000 STUN/TURN API requests
- **Paid**: $0.0005 per request after free tier
- **Best for**: Production with moderate usage

### Xirsys
- **Free tier**: 500MB/month bandwidth
- **Paid**: Starting at $10/month for 10GB
- **Best for**: Production without managing infrastructure

---

## Recommended Approach

1. **Development**: Use Twilio's free tier
2. **Production (low usage)**: Self-hosted coturn on e2-micro ($5/month)
3. **Production (high usage)**: Xirsys or Twilio paid tier

---

## Troubleshooting

### TURN server not being used
- Check environment variables are set correctly
- Verify firewall rules allow TURN ports
- Test with Trickle ICE tool

### High bandwidth usage
- TURN should only be used as fallback
- Ensure STUN is working for direct P2P when possible
- Consider limiting relay bandwidth in coturn config

### Connection still fails
- Check both users' network restrictions
- Verify TURN credentials are correct
- Check TURN server logs for authentication errors

---

## Security Notes

1. **Never commit TURN credentials** to git
2. **Use strong passwords** for TURN authentication
3. **Limit TURN access** by IP if possible
4. **Monitor bandwidth** to prevent abuse
5. **Rotate credentials** regularly

---

## Current Status

**✅ Implemented:**
- STUN server configuration (Google STUN servers)
- Environment variable support for TURN servers
- Automatic retry logic with exponential backoff

**🔄 Todo:**
- Set up TURN servers for production
- Configure environment variables in Cloud Run
- Test connection success rate improvement

