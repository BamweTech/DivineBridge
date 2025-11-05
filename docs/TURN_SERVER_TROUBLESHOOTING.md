# 🔧 TURN Server Troubleshooting Guide

## 🚨 **Critical Issue: Audio Problems After TURN Setup**

**Symptom:** Audio was working before TURN server, stopped working after TURN server was configured.

**Your TURN Configuration:**
```
Server: turn:35.192.126.89:3478
Username: divinebridge  
Password: XKPfmLmNHq1pz
Status: Port 3478 is OPEN ✅
```

---

## 🔍 **Immediate Diagnosis Steps**

### **Step 1: Check Browser Console** (Most Important!)

Ask users to open browser console (F12) and look for:

```javascript
// Good signs:
✅ ICE servers loaded: [{urls: "stun:..."}, {urls: "turn:...", username: "..."}]
✅ [WebRTC] Connection state: connected
✅ [WebRTC] ICE state: connected

// Bad signs:
❌ Failed to set remote offer: InvalidState
❌ ICE connection failed
❌ TURN server unreachable
❌ 401 Unauthorized (wrong credentials)
❌ 403 Forbidden (wrong credentials)
```

### **Step 2: Test TURN Server Connectivity**

**Option A: Use Online Trickle ICE Test**
1. Go to: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Add your TURN server:
   ```
   turn:35.192.126.89:3478
   Username: divinebridge
   Password: XKPfmLmNHq1pz
   ```
3. Click "Gather candidates"
4. Look for candidates with `typ relay` - these are TURN

**Expected Result:**
```
✅ relay 35.192.126.89 typ relay
```

**If you see:**
```
❌ No relay candidates
❌ 401 Unauthorized
❌ Timeout
```
→ TURN server is misconfigured

### **Step 3: Check TURN Server Logs**

SSH into your TURN server (35.192.126.89):
```bash
# Check if coturn is running
sudo systemctl status coturn

# View recent logs
sudo journalctl -u coturn -n 100 --no-pager

# Look for:
✅ "session ... allocated"
✅ "client authorized"
❌ "401 Unauthorized"
❌ "user not found"
```

---

## 🛠️ **Quick Fixes**

### **Fix 1: Temporarily Disable TURN (Immediate Test)**

This will tell us if TURN is the problem:

```bash
# Remove TURN environment variables from Cloud Run
gcloud run services update divinebridge \
  --region=us-central1 \
  --remove-env-vars=TURN_URLS,TURN_USERNAME,TURN_PASSWORD

# Redeploy
gcloud run deploy divinebridge --source . --region us-central1
```

**Then test audio:**
- If audio works → TURN server is the problem
- If audio still broken → Different issue

### **Fix 2: Add TCP TURN** (Many firewalls block UDP)

Your current config only uses UDP. Add TCP:

```bash
# Update TURN URLs to include both UDP and TCP
gcloud run services update divinebridge \
  --region=us-central1 \
  --update-env-vars=TURN_URLS="turn:35.192.126.89:3478,turn:35.192.126.89:3478?transport=tcp"
```

### **Fix 3: Verify TURN Credentials**

Check coturn configuration on your TURN server:

```bash
# SSH to TURN server
ssh user@35.192.126.89

# Check turnserver.conf
sudo cat /etc/turnserver.conf | grep -E "user=|realm=|fingerprint"

# Should see:
# user=divinebridge:XKPfmLmNHq1pz
# realm=divinebridge.io
# fingerprint
```

**If credentials don't match:**
```bash
# Fix in turnserver.conf
sudo nano /etc/turnserver.conf

# Add/update:
user=divinebridge:XKPfmLmNHq1pz
realm=divinebridge.io

# Restart
sudo systemctl restart coturn
```

### **Fix 4: Check Firewall Rules**

Ensure GCP firewall allows TURN traffic:

```bash
# Check existing rules
gcloud compute firewall-rules list | grep turn

# If missing, create:
gcloud compute firewall-rules create allow-turn \
  --allow=tcp:3478,udp:3478,tcp:5349,udp:5349,udp:49152-65535 \
  --source-ranges=0.0.0.0/0 \
  --description="Allow TURN server traffic"
```

---

## 📊 **Diagnostic Checklist**

Run through this checklist:

- [ ] TURN server port is reachable (✅ Already confirmed)
- [ ] TURN credentials match between Cloud Run and server
- [ ] Trickle ICE test shows `typ relay` candidates
- [ ] Browser console shows TURN in ICE servers list
- [ ] No 401/403 errors in browser console
- [ ] TURN server logs show successful allocations
- [ ] Firewall allows UDP 49152-65535 (relay ports)
- [ ] TCP TURN option available (not just UDP)

---

## 🔬 **Advanced Diagnostics**

### **Test TURN from Command Line**

```bash
# Install turnutils
sudo apt-get install coturn-utils

# Test TURN server
turnutils_uclient -v -u divinebridge -w XKPfmLmNHq1pz 35.192.126.89 -p 3478

# Expected output:
# "allocate request successfully sent"
# "relay address: 35.192.126.89:XXXXX"
```

### **Packet Capture**

On TURN server:
```bash
# Capture TURN traffic
sudo tcpdump -i any -n port 3478 -w turn-capture.pcap

# Let it run during a test call
# Download and analyze with Wireshark
```

---

## 🎯 **Most Likely Issues & Solutions**

### **Issue 1: Wrong Credentials** (50% probability)

**Symptoms:**
- 401 Unauthorized in console
- No relay candidates in ICE test
- TURN logs show "user not found"

**Fix:**
```bash
# On TURN server, check user list:
sudo cat /etc/turnserver.conf | grep user=

# Should match Cloud Run env vars exactly
# Restart coturn after any changes:
sudo systemctl restart coturn
```

### **Issue 2: UDP Blocked** (30% probability)

**Symptoms:**
- TURN UDP works locally but not in production
- Corporate/mobile networks
- Relay candidates fail

**Fix:**
Add TCP TURN (see Fix 2 above)

### **Issue 3: Relay Port Range Blocked** (15% probability)

**Symptoms:**
- Initial TURN allocation works
- But no media flows
- Timeout errors

**Fix:**
```bash
# On TURN server, check relay port range
sudo cat /etc/turnserver.conf | grep relay-port

# Should see:
# min-port=49152
# max-port=65535

# Ensure firewall allows this range
sudo ufw allow 49152:65535/udp
```

### **Issue 4: Realm Mismatch** (5% probability)

**Symptoms:**
- 401 errors despite correct credentials
- "Realm does not match" in logs

**Fix:**
```bash
# On TURN server:
sudo nano /etc/turnserver.conf

# Set realm to match your domain:
realm=divinebridge.io

# Restart
sudo systemctl restart coturn
```

---

## 🚀 **Recommended Action Plan**

### **Phase 1: Immediate (Next 30 minutes)**

1. **Test audio WITHOUT TURN** (Fix 1 above)
   - Temporarily remove TURN from Cloud Run
   - Test if audio works
   - This confirms TURN is the issue

2. **If TURN is the problem, check credentials:**
   - SSH to TURN server
   - Verify `/etc/turnserver.conf` matches Cloud Run env vars
   - Check coturn logs for errors

### **Phase 2: Fix TURN (1-2 hours)**

3. **Run Trickle ICE test**
   - Use https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
   - Should see `typ relay` candidates

4. **Add TCP TURN**
   - Many networks block UDP
   - TCP TURN is more reliable

5. **Verify firewall rules**
   - Ensure relay ports (49152-65535) are open

### **Phase 3: Alternative Solutions**

If TURN continues to cause issues:

**Option A: Use Only STUN (Temporary)**
- Works for 85% of connections
- No TURN complexity
- Some users won't be able to connect

**Option B: Use Paid TURN Service**
- Twilio, Xirsys, or similar
- More reliable than self-hosted
- ~$10-50/month depending on usage

**Option C: Debug Self-Hosted TURN**
- Time investment: 2-4 hours
- Cost: Free
- Full control

---

## 📝 **Quick Reference Commands**

```bash
# Test TURN server reachability
nc -zv 35.192.126.89 3478

# Remove TURN from Cloud Run (test without it)
gcloud run services update divinebridge --region=us-central1 \
  --remove-env-vars=TURN_URLS,TURN_USERNAME,TURN_PASSWORD

# Add TURN back with TCP support
gcloud run services update divinebridge --region=us-central1 \
  --update-env-vars=TURN_URLS="turn:35.192.126.89:3478,turn:35.192.126.89:3478?transport=tcp"

# Check TURN server status
ssh user@35.192.126.89 "sudo systemctl status coturn"

# View TURN logs
ssh user@35.192.126.89 "sudo journalctl -u coturn -n 50"

# Test TURN with turnutils
turnutils_uclient -v -u divinebridge -w XKPfmLmNHq1pz 35.192.126.89 -p 3478
```

---

## ✅ **Expected Outcome**

After fixing, you should see:

**Browser Console:**
```javascript
ICE servers loaded: [
  {urls: "stun:stun.l.google.com:19302"},
  {urls: "turn:35.192.126.89:3478", username: "divinebridge", credential: "***"}
]
✅ Got relay candidate: 35.192.126.89:XXXXX typ relay
✅ Connection state: connected
✅ ICE state: connected
```

**User Experience:**
- ✅ All users can hear each other
- ✅ Works on restrictive networks
- ✅ Works on mobile data
- ✅ No connection failures

---

## 🆘 **If Nothing Works**

**Simplest Solution: Disable TURN Temporarily**

```bash
# Remove TURN completely
gcloud run services update divinebridge --region=us-central1 \
  --remove-env-vars=TURN_URLS,TURN_USERNAME,TURN_PASSWORD

# Deploy
gcloud run deploy divinebridge --source . --region us-central1
```

**This will:**
- ✅ Make audio work for 85% of users (STUN only)
- ✅ Remove complexity while debugging
- ❌ Won't work for users behind strict NAT/firewalls

You can always re-add TURN later once it's properly configured.

---

**Next Steps:**
1. Run Fix 1 (disable TURN temporarily) to confirm it's the problem
2. If confirmed, work through diagnostic checklist
3. Either fix TURN or use a paid service
4. Document what worked for future reference

---

**Created:** November 5, 2025  
**Status:** 🔴 TURN Server Causing Audio Issues - Immediate Action Required

