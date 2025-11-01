# Audio Streaming Debugging Guide

This guide helps diagnose why audio isn't streaming in the prayer room.

---

## Quick Diagnostic (Run in Browser Console)

Open the browser console (F12) and paste this:

```javascript
// Prayer Room Audio Diagnostic
console.log('=== AUDIO DIAGNOSTIC ===');
console.log('Prayer Room Service:', window.prayerRoomService);
console.log('Local Stream:', window.prayerRoomService?.localStream);
console.log('Local Stream Active:', window.prayerRoomService?.localStream?.active);
console.log('Audio Tracks:', window.prayerRoomService?.localStream?.getAudioTracks());
console.log('Peers:', window.prayerRoomService?.peers);
console.log('Audio Elements:', Array.from(document.querySelectorAll('audio')).map(a => ({
    id: a.id,
    srcObject: a.srcObject,
    paused: a.paused,
    muted: a.muted,
    volume: a.volume,
    readyState: a.readyState
})));
console.log('ICE Servers:', window.prayerRoomService?.iceServers);
console.log('=== END DIAGNOSTIC ===');
```

---

## What to Look For

### 1. **"Stream not received" - Check these logs:**

Expected logs when audio SHOULD work:
```
✅ [WebRTC] Connected to [user-id]
🎵 [WebRTC] Received remote stream from [user-id]
🎵 Stream details: {active: true, audioTracks: 1}
🎵 Audio track 0: {enabled: true, readyState: "live"}
🎵 Setting up audio for participant [user-id]
🎵 Valid stream with 1 audio track(s)
🎵 Audio element created and attached to DOM
🎵 Audio metadata loaded
🎵 Audio can play
✅ Audio playback started successfully
✅ Audio is playing
```

**Missing the "Received remote stream" log?**
→ The peer connection isn't sending streams

**Stream details show audioTracks: 0?**
→ The remote user didn't have audio enabled when they connected

---

### 2. **"Browser autoplay blocked"**

Look for:
```
❌ Audio playback failed: NotAllowedError
🔇 Browser blocked autoplay
```

**Fix**: Click anywhere on the page to allow audio playback

**Prevention**: Make sure users click "Join Audio" button (this counts as user interaction)

---

### 3. **"Local stream not attached"**

Look for:
```
❌ Cannot create peer connection: No active local stream!
```

**This means**: Peer connections were created BEFORE clicking "Join Audio"

**Fix**: 
1. Leave the room
2. Rejoin
3. Click "Join Audio" BEFORE anyone else joins
4. OR: The other person leaves and rejoins

---

### 4. **"Connection established but no stream"**

Look for:
```
✅ [WebRTC] Connected to [user-id]
(but no "Received remote stream" log follows)
```

**This means**: Connection works but no media is flowing

**Possible causes**:
- Remote user hasn't enabled audio
- Remote user's audio track is disabled
- SimplePeer was created without a stream

**Check**:
- Remote user: Did they click "Join Audio"?
- Console: Look for "Creating SimplePeer with stream" - does it show audio tracks?

---

### 5. **"Audio element exists but silent"**

Check audio elements:
```javascript
document.querySelectorAll('audio').forEach(a => {
    console.log(a.id, {
        hasStream: !!a.srcObject,
        muted: a.muted,
        volume: a.volume,
        paused: a.paused
    });
});
```

**If muted: true** → Check if host muted the participant
**If paused: true** → Browser paused playback (click to resume)
**If volume: 0** → Volume got set to zero somehow
**If hasStream: false** → Stream never got attached

---

## Common Scenarios

### Scenario A: "I joined first, then someone joined - no audio"

**What happened**: You created peer connection before clicking "Join Audio"

**Solution**:
1. Click "Join Audio" button
2. Wait 2-3 seconds
3. Audio should start (the addStreamToExistingPeers() method will fix it)

**Or**: Both leave and rejoin, making sure to click "Join Audio" before connecting

---

### Scenario B: "Someone joined first, I joined - no audio"

**What happened**: The first person might not have clicked "Join Audio"

**Check**: Did they click "Join Audio"? Do you see a microphone icon next to their name?

**Solution**: First person should click "Join Audio"

---

### Scenario C: "We both have audio enabled, connected, but still no sound"

**Check these logs on BOTH sides**:

Side A (your console):
```
✅ [WebRTC] Peer connection created with local audio stream
📡 [WebRTC] Signal generated: offer
🎵 [WebRTC] Received remote stream from [user B]
✅ Audio is playing for [user B]
```

Side B (their console):
```
📡 [WebRTC] Received offer from [user A]
✅ [WebRTC] Peer connection created with local audio stream
📡 [WebRTC] Signal generated: answer
🎵 [WebRTC] Received remote stream from [user A]
✅ Audio is playing for [user A]
```

**If "Received remote stream" is missing on either side**:
→ That person didn't attach their local stream

**If "Audio is playing" is missing**:
→ Browser autoplay blocked it (click page to enable)

---

### Scenario D: "Audio worked before, now it doesn't"

**Possible causes**:
1. Browser cached old version
2. Microphone permission revoked
3. Audio track got disabled

**Solutions**:
1. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. Check browser permissions: Allow microphone
3. Leave room and rejoin
4. Check if audio tracks are enabled:
   ```javascript
   window.prayerRoomService.localStream.getAudioTracks()[0].enabled
   // Should be true
   ```

---

## Step-by-Step Debugging Process

### 1. Check Local Audio Setup

```javascript
// Should show your audio is working
window.prayerRoomService.localStream
// MediaStream {active: true, id: "...", ...}

window.prayerRoomService.localStream.getAudioTracks()
// [MediaStreamTrack {enabled: true, muted: false, readyState: "live"}]
```

**If null or empty**: Click "Join Audio" button

---

### 2. Check Peer Connections

```javascript
window.prayerRoomService.peers
// Map(1) {"user-id-here" => SimplePeer}
```

**If empty**: No one else in the room or connections failed

---

### 3. Check for Audio Elements

```javascript
document.querySelectorAll('audio')
// Should show one <audio> element per remote participant
```

**If empty**: No remote streams received

---

### 4. Check ICE Servers

```javascript
window.prayerRoomService.iceServers
```

**Should show**:
- Multiple STUN servers (stun:stun.l.google.com:19302)
- TURN server if configured (turn:YOUR_IP:3478)

**If only STUN**: Connections may fail for users behind strict firewalls

---

### 5. Check Browser Console for Errors

Look for RED error messages about:
- **getUserMedia**: Microphone permission issues
- **NotAllowedError**: Autoplay blocked
- **Connection failed**: Network/firewall issues
- **No active local stream**: Audio not joined

---

## Manual Audio Test

Run this to manually test remote audio:

```javascript
// Get remote stream from peer
const peer = Array.from(window.prayerRoomService.peers.values())[0];
const streams = peer?.streams || [];

if (streams.length > 0) {
    const testAudio = document.createElement('audio');
    testAudio.srcObject = streams[0];
    testAudio.autoplay = true;
    testAudio.volume = 1.0;
    document.body.appendChild(testAudio);
    
    testAudio.play().then(() => {
        console.log('✅ Manual audio test successful!');
    }).catch(err => {
        console.error('❌ Manual audio test failed:', err);
    });
} else {
    console.error('No streams available from peer');
}
```

---

## Network Diagnostics

### Test STUN/TURN Connectivity

Visit: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Add your ICE servers and click "Gather candidates"

**Look for**:
- `srflx` candidates: STUN is working
- `relay` candidates: TURN is working

**If no relay candidates and you have TURN configured**:
→ TURN server isn't accessible or credentials are wrong

---

## Solutions by Error Message

| Error Message | Meaning | Solution |
|---------------|---------|----------|
| "No active local stream" | Audio not joined yet | Click "Join Audio" |
| "NotAllowedError" | Browser blocked autoplay | Click page to enable |
| "Connection failed" | Can't reach peer | Set up TURN server |
| "No audio tracks in stream" | Stream exists but empty | Remote user: rejoin with audio |
| "Audio playback failed" | Can't play audio element | Check muted/volume/autoplay |
| "Invalid remote stream" | Stream validation failed | Bug - check stream.active |

---

## Last Resort: Full Reset

```javascript
// In console:
window.prayerRoomService.leaveRoom();

// Then:
// 1. Close tab
// 2. Clear cache (Cmd+Shift+R / Ctrl+Shift+R)
// 3. Reopen page
// 4. Join room
// 5. Click "Join Audio" FIRST
// 6. Wait for others to join
```

---

## Still Not Working?

Check:
1. ✅ Both users clicked "Join Audio"
2. ✅ Both users see microphone icon next to their name
3. ✅ Browser console shows "Audio is playing" for both
4. ✅ No red errors in console
5. ✅ Audio elements exist in DOM
6. ✅ Audio elements not muted
7. ✅ System volume not at 0
8. ✅ Browser has microphone permission

**If all above are ✅ but still no audio**:
→ Check physical microphone/speaker hardware
→ Try different browser
→ Check system audio settings

---

## Getting Help

When reporting audio issues, provide:

1. **Browser Console Logs** (full output)
2. **Diagnostic output** (from script above)
3. **What you tried** (steps from this guide)
4. **Both users' info**:
   - Did they click "Join Audio"?
   - What browser/OS?
   - Are they behind corporate firewall?

This helps identify the exact issue quickly!

