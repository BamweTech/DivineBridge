# Quick FREE TURN Server Setup (5 Minutes)

This guide sets up a completely FREE TURN server using Google Cloud's always-free tier.

**Cost: $0/month** ✅

---

## What This Fixes

Without a TURN server:
- ❌ ~20% of users can't connect (behind strict firewalls)
- ❌ Connection errors like "Connection failed"
- ❌ Audio established but not streaming

With a TURN server:
- ✅ 99%+ of users can connect
- ✅ Audio works even behind corporate firewalls
- ✅ Professional-grade reliability

---

## One-Command Setup

```bash
./scripts/deploy/setup-turn-server.sh
```

That's it! The script will:
1. Create a FREE e2-micro VM instance
2. Install and configure coturn TURN server
3. Set up firewall rules
4. Generate secure credentials
5. Give you the exact command to deploy

**Time: ~5 minutes**

---

## Step-by-Step (What the Script Does)

### 1. Run the Setup Script

```bash
cd /Users/jeancalmerekubwayo/Documents/divineBridge
./scripts/deploy/setup-turn-server.sh
```

### 2. Wait for Completion

The script will show:
```
✅ TURN Server Setup Complete!
📡 TURN Server Details:
   IP Address: X.X.X.X
   Port: 3478
   Username: divinebridge
   Password: xxxx

🔧 Deploy command:
gcloud run services update divinebridge \
  --region us-central1 \
  --set-env-vars "TURN_URLS=turn:X.X.X.X:3478,TURN_USERNAME=divinebridge,TURN_PASSWORD=xxxx"
```

### 3. Deploy to Cloud Run

Copy and run the deploy command shown (or use the one below with your credentials):

```bash
gcloud run services update divinebridge \
  --region us-central1 \
  --set-env-vars "TURN_URLS=turn:YOUR_IP:3478,TURN_USERNAME=divinebridge,TURN_PASSWORD=YOUR_PASSWORD"
```

### 4. Test

1. Go to: https://divinebridge-853408757178.us-central1.run.app
2. Join a prayer room
3. Check browser console - you should see:
   ```
   ICE servers loaded: [
     {urls: "stun:stun.l.google.com:19302"},
     {urls: "turn:X.X.X.X:3478", username: "divinebridge", credential: "..."}
   ]
   ```

---

## Verify It's Working

### Check TURN Server Status

```bash
gcloud compute ssh divinebridge-turn --zone=us-central1-a --command="sudo systemctl status coturn"
```

Should show: `Active: active (running)`

### Test TURN Connection

Visit: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

1. Add TURN server:
   - STUN or TURN URI: `turn:YOUR_IP:3478`
   - Username: `divinebridge`
   - Password: `YOUR_PASSWORD`
2. Click "Gather candidates"
3. Look for type `relay` - this means TURN is working!

---

## Credentials Storage

Your credentials are saved to `turn-credentials.txt` (already git ignored).

**⚠️ Important:**
- Keep this file secure
- Don't commit it to git
- Don't share it publicly

---

## Cost Breakdown

| Resource | Cost | Notes |
|----------|------|-------|
| e2-micro VM | **FREE** | Always-free tier (1 per region) |
| Bandwidth | $0.12/GB | After 1GB free/month |
| Storage | **FREE** | 30GB included |

**Expected monthly cost: $0-5** depending on usage

For ~100 users in prayer rooms: ~$0-2/month in bandwidth

---

## Managing Your TURN Server

### View Logs
```bash
gcloud compute ssh divinebridge-turn --zone=us-central1-a --command="sudo tail -f /var/log/turnserver.log"
```

### Stop Server (Save Free Tier)
```bash
gcloud compute instances stop divinebridge-turn --zone=us-central1-a
```

### Start Server
```bash
gcloud compute instances start divinebridge-turn --zone=us-central1-a
```

### Delete Server
```bash
gcloud compute instances delete divinebridge-turn --zone=us-central1-a
gcloud compute firewall-rules delete allow-turn-server
```

---

## Troubleshooting

### Script fails with "permission denied"
```bash
chmod +x scripts/deploy/setup-turn-server.sh
```

### Can't find gcloud command
Install Google Cloud SDK:
https://cloud.google.com/sdk/docs/install

### TURN not working after deploy
1. Check Cloud Run logs for "ICE Servers"
2. Verify environment variables are set
3. Test with Trickle ICE tool (see above)

### Instance won't start
Check quota limits:
```bash
gcloud compute project-info describe --project=YOUR_PROJECT_ID
```

---

## Security Notes

1. **Credentials**: Auto-generated secure password
2. **Firewall**: Only necessary ports opened
3. **Updates**: SSH in monthly and run `sudo apt update && sudo apt upgrade`
4. **Monitoring**: Check logs weekly for abuse

---

## Alternative: Quick Test Server (Not for Production)

If you just want to test quickly without setting up your own:

```bash
gcloud run services update divinebridge \
  --region us-central1 \
  --set-env-vars "TURN_URLS=turn:openrelay.metered.ca:80,TURN_USERNAME=openrelayproject,TURN_PASSWORD=openrelayproject"
```

⚠️ **Warning**: Public TURN servers are unreliable and may have bandwidth limits. Only for testing!

---

## Why This Is Better Than Third-Party Services

| Feature | Self-Hosted (FREE) | Twilio | Xirsys |
|---------|-------------------|--------|--------|
| Cost | **$0-5/month** | $0.0005/request | $10/month |
| Privacy | **Your server** | Third-party | Third-party |
| Control | **Full control** | Limited | Limited |
| Free Tier | **Always free** | 750K requests | 500MB |
| Setup Time | **5 minutes** | 10 minutes | 5 minutes |

---

## Next Steps

1. ✅ Run `./scripts/deploy/setup-turn-server.sh`
2. ✅ Deploy with the provided command
3. ✅ Test audio in prayer rooms
4. ✅ Monitor usage after a week

**That's it! You now have a professional-grade, FREE WebRTC infrastructure.** 🎉

---

## Support

Having issues? Check:
1. The detailed guide: `docs/guides/TURN_SERVER_SETUP.md`
2. Google Cloud Console: https://console.cloud.google.com/compute
3. TURN server logs (see "Managing Your TURN Server" above)

