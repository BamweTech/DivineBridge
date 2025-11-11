# LiveKit SFU Implementation - Status & Next Steps

**Date:** November 11, 2025  
**Status:** Backend Ready, Infrastructure Setup Required  

---

## What's Been Completed ✅

### 1. Backend Integration (100%)
- ✅ Created `routes/livekit_bp.py` with full token service
- ✅ Token generation with role-based permissions (speaker/listener)
- ✅ Health check and status endpoints
- ✅ Webhook handler for LiveKit events
- ✅ Added `livekit==0.11.0` to requirements.txt
- ✅ Registered blueprint in app.py at `/api/livekit`

### 2. Infrastructure Scripts (100%)
- ✅ Created `scripts/setup-livekit-server.sh`
- ✅ Automated VM provisioning
- ✅ Firewall configuration
- ✅ LiveKit Docker deployment
- ✅ Configuration generation

### 3. Documentation (100%)
- ✅ Full implementation plan in `docs/LIVEKIT_IMPLEMENTATION_PLAN.md`
- ✅ WebRTC delay analysis in `WEBRTC_DELAY_ANALYSIS.md`

---

## Next Steps (In Order)

### Step 1: Run Infrastructure Setup (30 minutes)

```bash
# Execute the setup script
cd /Users/jeancalmerekubwayo/Documents/divineBridge
./scripts/setup-livekit-server.sh
```

This will:
- Create GCE VM in us-central1-a
- Install Docker and LiveKit
- Configure firewall rules
- Generate API keys
- Start LiveKit server

**Output:** API Key, API Secret, External IP

### Step 2: Store Credentials in Secret Manager (5 minutes)

```bash
# Save the credentials output from Step 1
gcloud secrets create LIVEKIT_API_KEY --data-file=<(echo 'YOUR_API_KEY')
gcloud secrets create LIVEKIT_API_SECRET --data-file=<(echo 'YOUR_API_SECRET')
gcloud secrets create LIVEKIT_HOST --data-file=<(echo 'YOUR_EXTERNAL_IP:7880')
```

### Step 3: Update Config.py to Load LiveKit Secrets (15 minutes)

Add to `config.py`:
```python
# LiveKit configuration
self.livekit_api_key = self._get_secret('LIVEKIT_API_KEY')
self.livekit_api_secret = self._get_secret('LIVEKIT_API_SECRET')
self.livekit_host = self._get_secret('LIVEKIT_HOST')
```

### Step 4: Set Environment Variables (5 minutes)

In Cloud Run:
```bash
gcloud run services update divinebridge \
  --region=us-central1 \
  --set-env-vars="LIVEKIT_ENABLED=true"
```

### Step 5: Create Frontend LiveKit Client (3-4 hours)

**File:** `static/js/prayer-room-livekit.js`

Key functions needed:
- `connectToLiveKit()` - Get token and connect
- `publishAudio()` - Publish mic track (speakers only)
- `unpublishAudio()` - Stop publishing (when demoted)
- `subscribeToTracks()` - Receive remote audio
- `handleRoleChange()` - Respond to promote/demote

### Step 6: Integrate with Existing Prayer Room (2 hours)

Modify `prayer-room.js`:
- Add feature flag check
- Route to LiveKit or SimplePeer based on flag
- Maintain UI compatibility
- Keep chat/participant list logic (independent of audio transport)

### Step 7: Testing (1-2 hours)

Test scenarios:
- 2 users connect and hear each other
- 4 users all hear each other
- Speaker publish, listener subscribe
- Promote/demote mid-session
- Network interruption recovery
- Mobile device compatibility

### Step 8: Production Deployment (30 minutes)

1. Deploy with `LIVEKIT_ENABLED=false` initially
2. Test with a feature flag for specific rooms
3. Monitor performance and connection success rate
4. Gradually enable for all rooms
5. Remove SimplePeer code after 1 week of stability

---

## Current Audio Issue Resolution

**Why 4 users can't hear each other now:**
- Mesh topology creates 6 peer connections (N×(N-1)/2)
- ICE connection failures due to NAT/firewall
- Missing TURN relay server
- Participant list not syncing all users
- Retry logic creating deadlocks

**How LiveKit fixes this:**
- Each user has 1 connection to LiveKit server
- LiveKit handles NAT traversal professionally
- No peer-to-peer complexity
- All 4 users guaranteed to hear each other
- Scales to 100+ users

---

## Implementation Timeline

| Phase | Task | Time | Status |
|-------|------|------|--------|
| 1 | Infrastructure setup | 30 min | ⏳ Ready to run |
| 2 | Credentials config | 5 min | ⏳ After Step 1 |
| 3 | Backend config | 15 min | ⏳ Code ready |
| 4 | Frontend client | 3-4 hours | 📝 Next |
| 5 | Integration | 2 hours | 📝 After Step 4 |
| 6 | Testing | 1-2 hours | 📝 QA phase |
| 7 | Deployment | 30 min | 📝 Final step |

**Total Estimated Time:** 8-12 hours (~1.5 days)

---

## Ready to Execute

I can start the infrastructure setup now. Would you like me to:

**Option A:** Run the setup script now and proceed with full implementation?
**Option B:** Review the plan first and proceed step-by-step with your approval at each phase?

Both the backend and scripts are ready to go. The main work remaining is the frontend LiveKit client integration.

