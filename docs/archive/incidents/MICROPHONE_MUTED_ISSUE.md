# Microphone Track Muted Issue

## The Problem

You're seeing this in the console:
```
🎵 Audio track 0: {enabled: true, muted: true, readyState: 'live'}
⚠️ Remote audio track is muted (not producing audio)!
```

This means:
- ✅ WebRTC connection is working
- ✅ Stream is being received
- ✅ Audio element is playing
- ❌ **BUT**: The audio track isn't producing any sound

---

## What `track.muted = true` Means

The `muted` property on a MediaStreamTrack is **READ-ONLY** and indicates whether the track is currently producing media.

**This is NOT the same as**:
- Clicking a mute button in the app (that sets `track.enabled = false`)
- Muting the HTML audio element (that sets `audioElement.muted = true`)

`track.muted = true` means:
> **"The microphone is enabled, but no audio data is flowing from the hardware"**

---

## Common Causes

### 1. **Another Application Is Using the Microphone**

**Most common cause!** Many apps have exclusive access to the microphone.

**Check if any of these are running:**
- Zoom
- Microsoft Teams
- Slack
- Discord
- Skype
- Google Meet (in another tab)
- OBS Studio
- Any recording software
- Any video calling app

**Solution:**
1. Close ALL other applications that might use the microphone
2. Refresh the prayer room page
3. Click "Join Audio" again

---

### 2. **Browser Doesn't Have OS-Level Permission**

Sometimes the browser has permission, but the operating system doesn't.

**On macOS:**
```
1. System Preferences → Security & Privacy → Privacy
2. Click "Microphone" in left sidebar
3. Find your browser (Chrome, Safari, Firefox, etc.)
4. Make sure the checkbox is CHECKED ✅
5. If not, enable it
6. Close and reopen browser completely
```

**On Windows:**
```
1. Settings → Privacy → Microphone
2. Make sure "Allow apps to access your microphone" is ON
3. Scroll down and find your browser
4. Make sure it's ON
5. Close and reopen browser completely
```

**On Linux:**
```bash
# Check if browser has microphone access
pactl list sources | grep -i monitor

# If needed, configure PulseAudio permissions
```

---

### 3. **Microphone Was Changed/Disconnected**

If you:
- Unplugged/plugged in a microphone
- Changed audio devices
- Switched between internal mic and external mic
- Connected/disconnected Bluetooth headset

**While the prayer room was open**, the track can become muted.

**Solution:**
1. Refresh the page
2. Make sure the correct microphone is plugged in
3. Click "Join Audio" again

---

### 4. **Virtual Audio Device Issues**

Using virtual audio routing software like:
- OBS Virtual Camera/Audio
- Loopback (Mac)
- VB-Audio VoiceMeeter (Windows)
- BlackHole (Mac)

These can sometimes cause tracks to be muted if not configured correctly.

**Solution:**
1. Try using your physical microphone instead
2. Or: Configure the virtual device correctly
3. Make sure the virtual device is actually receiving audio

---

### 5. **Browser Bug or Cache Issue**

Sometimes browsers get confused about microphone state.

**Solution:**
1. **Close ALL browser windows completely** (not just the tab)
2. **Clear browser cache**:
   - Chrome: Cmd+Shift+Delete (Mac) / Ctrl+Shift+Delete (Windows)
   - Select "Cached images and files"
   - Clear data
3. **Reopen browser**
4. Go to prayer room
5. Click "Join Audio"

---

### 6. **Microphone in Use by System**

On some systems, the OS reserves the microphone for system functions.

**Solution:**
- Close any system audio monitoring tools
- Disable voice commands (Siri, Cortana, etc.) temporarily
- Check if any accessibility features are using the mic

---

## Step-by-Step Troubleshooting

### Step 1: Close Other Apps
```
✓ Close Zoom, Teams, Discord, Skype, etc.
✓ Close any recording software
✓ Check Task Manager/Activity Monitor for hidden audio apps
```

### Step 2: Check System Permissions
```
✓ System Preferences/Settings → Privacy → Microphone
✓ Enable browser access
✓ Close and reopen browser
```

### Step 3: Check Microphone Hardware
```
✓ Is microphone plugged in?
✓ Is correct device selected in system settings?
✓ Test at: https://www.onlinemictest.com/
```

### Step 4: Fresh Browser Session
```
✓ Close ALL browser windows
✓ Clear cache
✓ Reopen browser
✓ Join prayer room
✓ Click "Join Audio"
```

### Step 5: Try Different Browser
```
✓ If using Chrome → try Firefox
✓ If using Firefox → try Chrome
✓ If using Safari → try Chrome
```

---

## Testing Your Microphone

### Quick Test (Browser Console)

Open console (F12) and run:
```javascript
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const track = stream.getAudioTracks()[0];
    console.log('Microphone test:', {
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState
    });
    
    if (track.muted) {
      console.error('❌ Microphone is muted! Check the solutions above.');
    } else {
      console.log('✅ Microphone is working!');
    }
    
    // Clean up
    track.stop();
  })
  .catch(err => {
    console.error('❌ Cannot access microphone:', err);
  });
```

**Expected output if working:**
```
✅ Microphone is working!
{label: "Built-in Microphone", enabled: true, muted: false, readyState: "live"}
```

**If you see `muted: true`:**
→ Follow the troubleshooting steps above

---

## Monitoring in Real-Time

The prayer room now monitors for mute/unmute events. Watch the console:

**When microphone becomes available:**
```
✅ Your microphone is now producing audio
✅ Remote audio track from [user] is now UNMUTED and producing audio!
```

**When microphone stops working:**
```
⚠️ Your microphone stopped producing audio (track.muted = true)
⚠️ Remote audio track from [user] became MUTED (stopped producing audio)
```

If you see the "stopped producing audio" message:
1. Check if another app took control of the microphone
2. Refresh the page
3. Try the troubleshooting steps above

---

## Prevention Tips

To avoid this issue:

1. **Close other audio apps BEFORE joining**
   - Don't have Zoom/Teams running in background
   
2. **Don't change audio devices while in call**
   - If you need to switch mics, leave and rejoin

3. **Grant permissions at OS level first**
   - Set up browser permissions before first use

4. **Use physical microphones when possible**
   - Avoid virtual audio devices unless necessary

5. **One browser session only**
   - Don't open prayer room in multiple tabs

---

## Still Not Working?

If you've tried everything above and `track.muted` is still `true`:

1. **Try a different microphone**
   - Built-in vs external
   - USB vs 3.5mm jack
   - Wired vs Bluetooth

2. **Try a different computer**
   - Rules out hardware/driver issues

3. **Check for OS updates**
   - Sometimes audio drivers need updating

4. **Restart computer**
   - Clears any system audio conflicts

---

## Technical Details

For developers:

The `MediaStreamTrack.muted` property reflects the hardware/OS state:
- Set by browser when hardware stops producing media
- Can change dynamically (fires 'mute'/'unmute' events)
- Different from `track.enabled` (which you control)
- Different from `audioElement.muted` (which mutes playback)

Events to monitor:
```javascript
track.addEventListener('mute', () => {
  // Track stopped producing media
});

track.addEventListener('unmute', () => {
  // Track started producing media again
});
```

This is not a code bug - it's hardware/OS state reporting working as designed.

---

## Summary

**Problem**: `track.muted = true` means no audio data from hardware  
**Most Common Cause**: Another app is using the microphone  
**Solution**: Close other apps, refresh page, rejoin audio  
**Prevention**: Close audio apps before joining prayer room  

The WebRTC implementation is working correctly - this is a client-side hardware/permission issue!

