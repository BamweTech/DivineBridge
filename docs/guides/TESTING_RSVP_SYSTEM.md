# Testing RSVP System for Scheduled Sessions

This guide helps you test the public scheduled sessions display and RSVP functionality locally before deploying to production.

## Overview

The RSVP system allows users to:
- Browse upcoming public prayer sessions
- RSVP with different statuses (Going, Maybe, Interested)
- See real-time RSVP counts
- Get email reminders (1 hour before + when session goes live)
- View sessions in a beautiful glassmorphic UI

---

## Prerequisites

- Flask app running locally (`python app.py`)
- At least one **public** scheduled session in Firestore
- User account to test RSVP functionality
- Firebase credentials configured

---

## Quick Test (5 minutes)

### Step 1: Create Test Scheduled Session

1. **Start your local server:**
   ```bash
   cd /Users/jeancalmerekubwayo/Documents/divineBridge
   python app.py
   ```

2. **Login to your account:**
   - Go to `http://localhost:8080/login`
   - Login with your test account

3. **Schedule a public session:**
   - Go to `http://localhost:8080/prayer-room`
   - Click "Schedule Session"
   - Fill in:
     - **Name:** "Community Prayer Circle"
     - **Description:** "Join us for a time of prayer and worship"
     - **Date/Time:** Tomorrow at 7:00 PM
     - **Privacy:** **Public** (this is important!)
   - Click "Schedule"

### Step 2: View Scheduled Sessions

1. **Navigate to Prayer Rooms page:**
   - Go to `http://localhost:8080/prayer-room`
   
2. **Click "Upcoming" tab:**
   - You should see the glassmorphic tabs: "Live Now" and "Upcoming"
   - Click "Upcoming"
   
3. **Verify session display:**
   - ✅ Your scheduled session should appear
   - ✅ Glassmorphic card design
   - ✅ Session name, host, date/time
   - ✅ "0 people interested" count
   - ✅ "I'm Interested 👋" button

### Step 3: Test RSVP Flow

1. **RSVP as "Interested":**
   - Click "I'm Interested 👋" button
   - Dropdown should appear with:
     - ✓ Going
     - 🤔 Maybe
     - 👋 Interested
   - Click "👋 Interested"
   
2. **Verify RSVP confirmation:**
   - ✅ Toast notification: "✓ RSVP confirmed! You'll get reminders..."
   - ✅ Button changes to "👋 Interested ▾"
   - ✅ Count updates to "1 person interested"

3. **Change RSVP status:**
   - Click the button again
   - Select "✓ Going"
   - ✅ Toast: "✓ RSVP confirmed!"
   - ✅ Button: "✓ Going ▾"
   - ✅ Count shows under "going"

4. **Remove RSVP:**
   - Click the button
   - Select "Remove RSVP"
   - ✅ Toast: "RSVP removed"
   - ✅ Button resets to "I'm Interested 👋"
   - ✅ Count back to "0 people interested"

### Step 4: Test Multi-User RSVP

1. **Open incognito window:**
   - Open `http://localhost:8080`
   - Login with a different account

2. **RSVP to the same session:**
   - Go to Prayer Rooms → Upcoming
   - RSVP as "Maybe"
   
3. **Back in original window:**
   - Refresh the page
   - ✅ Count should show RSVPs from both users

---

## Detailed Testing

### Backend API Testing

#### 1. Get Public Scheduled Sessions

```bash
curl http://localhost:8080/api/prayer-room/public-scheduled-sessions
```

**Expected Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "scheduled_room_id": "abc123",
      "room_name": "Community Prayer Circle",
      "host_name": "John Doe",
      "scheduled_time": 1699046400.0,
      "room_description": "Join us...",
      "rsvp_count": {
        "going": 1,
        "maybe": 2,
        "interested": 5
      },
      "total_rsvps": 8,
      "user_rsvp_status": "going"
    }
  ],
  "total": 1
}
```

#### 2. RSVP to Session

```bash
curl -X POST http://localhost:8080/api/prayer-room/scheduled-session/abc123/rsvp \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{
    "rsvp_status": "going",
    "reminder_1hour": true,
    "reminder_live": true
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "RSVP confirmed",
  "rsvp_status": "going",
  "rsvp_count": {
    "going": 2,
    "maybe": 2,
    "interested": 5
  },
  "total_rsvps": 9
}
```

#### 3. Remove RSVP

```bash
curl -X DELETE http://localhost:8080/api/prayer-room/scheduled-session/abc123/rsvp \
  -H "Cookie: session=YOUR_SESSION_COOKIE"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "RSVP removed",
  "removed": true
}
```

---

## Frontend UI Testing

### Glassmorphic Design Verification

1. **Visual Checks:**
   - ✅ Blurred glass effect on cards
   - ✅ Smooth hover animations (cards lift up)
   - ✅ Gradient blue accents
   - ✅ Rounded corners (20px border-radius)
   - ✅ Subtle shadows

2. **Tab Navigation:**
   - ✅ Active tab has blue gradient background
   - ✅ Inactive tabs are transparent
   - ✅ Smooth transition when switching tabs
   - ✅ Icons display correctly

3. **Session Cards:**
   - ✅ Room name with calendar icon
   - ✅ Host name displayed
   - ✅ "Public" badge in top right
   - ✅ Date/time with clock icon
   - ✅ Description (if provided)
   - ✅ RSVP stats section
   - ✅ RSVP button

4. **RSVP Dropdown:**
   - ✅ Appears above button
   - ✅ Glassmorphic background
   - ✅ Three status options with icons
   - ✅ Active status highlighted
   - ✅ "Remove RSVP" option (if already RSVPed)
   - ✅ Closes on outside click
   - ✅ Closes on Escape key

5. **Toast Notifications:**
   - ✅ Slides in from right
   - ✅ Glassmorphic design
   - ✅ Success/Error/Info icons
   - ✅ Auto-dismisses after 3 seconds
   - ✅ Smooth slide-out animation

### Mobile Responsive Testing

1. **Resize browser to mobile width (< 768px):**

2. **Verify:**
   - ✅ Session cards stack vertically
   - ✅ RSVP section becomes column layout
   - ✅ RSVP buttons take full width
   - ✅ Meta info stacks vertically
   - ✅ Tabs remain functional
   - ✅ Toast notifications are full-width

---

## Integration Testing

### Test Complete Flow: Schedule → RSVP → Activate

1. **Schedule a session for 2 minutes from now:**
   - Privacy: Public
   - Note the scheduled_room_id

2. **RSVP to the session:**
   - RSVP as "Going"
   - Verify in Firestore:
     ```
     scheduled_room_rsvps collection:
       - scheduled_room_id: matches
       - user_id: your user ID
       - rsvp_status: "going"
       - reminder_preferences: {email_1hour: true, email_live: true}
     ```

3. **Wait for scheduled time:**
   - Trigger activation:
     ```bash
     curl -X POST http://localhost:8080/api/prayer-room/activate-scheduled-rooms \
       -H "X-Local-Dev: true"
     ```

4. **Verify:**
   - ✅ Session disappears from "Upcoming" tab
   - ✅ Active room appears in "Live Now" tab
   - ✅ You can join the room
   - ✅ (If emails configured) Received email notification

---

## Database Verification

### Firestore Collections

#### 1. `scheduled_rooms`

Check that your scheduled room exists:

```javascript
{
  scheduled_room_id: "auto-generated",
  room_name: "Community Prayer Circle",
  room_description: "Join us...",
  room_privacy: "public",  // MUST be public to appear in listings
  host_id: "user123",
  host_name: "John Doe",
  scheduled_time: Timestamp,
  created_at: Timestamp,
  status: "scheduled"
}
```

#### 2. `scheduled_room_rsvps`

After RSVPing, verify:

```javascript
{
  rsvp_id: "auto-generated",
  scheduled_room_id: "abc123",
  user_id: "user456",
  user_email: "user@example.com",
  user_name: "Jane Smith",
  room_name: "Community Prayer Circle",
  rsvp_status: "going",  // or "maybe", "interested"
  rsvp_at: Timestamp,
  is_active: true,
  reminder_preferences: {
    email_1hour: true,
    email_live: true
  }
}
```

---

## Common Issues & Solutions

### Issue 1: "No Upcoming Sessions" even though sessions exist

**Possible Causes:**
- Session privacy is "private" (only public sessions show)
- Session status is not "scheduled"
- Scheduled time is in the past
- Firestore query issue

**Solution:**
```python
# Verify in Python console
from firebase_auth import get_firestore_client
from datetime import datetime

db = get_firestore_client()

sessions = db.collection('scheduled_rooms')\
    .where('status', '==', 'scheduled')\
    .where('room_privacy', '==', 'public')\
    .where('scheduled_time', '>=', datetime.utcnow())\
    .stream()

for s in sessions:
    print(f"Session: {s.id} - {s.to_dict()}")
```

### Issue 2: RSVP button not working / 401 error

**Cause:** User not authenticated

**Solution:**
- Ensure user is logged in
- Check browser cookies
- Verify session is valid

### Issue 3: RSVP count not updating

**Cause:** Frontend not re-fetching data

**Solution:**
- Check browser console for errors
- Verify API response includes updated counts
- Try hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)

### Issue 4: Glassmorphic effects not showing

**Cause:** Browser doesn't support backdrop-filter

**Solution:**
- Test in modern browsers (Chrome 76+, Safari 13+, Firefox 103+)
- Check if CSS file is loaded: View Source → Check for `scheduled-sessions.css`

### Issue 5: Tabs not switching

**Cause:** JavaScript not loaded or conflicts

**Solution:**
- Open browser console
- Check for errors
- Verify `scheduled-sessions.js` is loaded
- Check `scheduledSessions` object exists: `console.log(scheduledSessions)`

---

## Performance Testing

### Load Testing (Many Sessions)

1. **Create 20 test sessions:**
   ```python
   from firebase_auth import get_firestore_client
   from datetime import datetime, timedelta
   
   db = get_firestore_client()
   
   for i in range(20):
       session_data = {
           'room_name': f'Test Session {i+1}',
           'room_description': 'Test description',
           'room_privacy': 'public',
           'host_id': 'test_host',
           'host_name': 'Test Host',
           'scheduled_time': datetime.utcnow() + timedelta(hours=i+1),
           'created_at': datetime.utcnow(),
           'status': 'scheduled'
       }
       db.collection('scheduled_rooms').add(session_data)
   ```

2. **Verify performance:**
   - ✅ Page loads in < 2 seconds
   - ✅ Scrolling is smooth
   - ✅ No layout shifts
   - ✅ RSVP actions are instant

### Network Testing

1. **Throttle network in DevTools:**
   - Open DevTools → Network tab
   - Set to "Slow 3G"

2. **Verify:**
   - ✅ Loading spinner shows while fetching
   - ✅ Graceful fallback on error
   - ✅ Toast notifications still work
   - ✅ No broken UI

---

## Accessibility Testing

1. **Keyboard Navigation:**
   - ✅ Tab through all interactive elements
   - ✅ Enter key activates buttons
   - ✅ Escape closes dropdown
   - ✅ Focus indicators visible

2. **Screen Reader:**
   - ✅ Session info is readable
   - ✅ RSVP button states are announced
   - ✅ Toast notifications are announced

---

## Clean Up Test Data

```python
from firebase_auth import get_firestore_client

db = get_firestore_client()

# Delete test scheduled rooms
test_sessions = db.collection('scheduled_rooms')\
    .where('host_name', '==', 'Test Host')\
    .stream()

for session in test_sessions:
    print(f"Deleting: {session.id}")
    session.reference.delete()

# Delete test RSVPs
test_rsvps = db.collection('scheduled_room_rsvps')\
    .where('user_name', '==', 'Test User')\
    .stream()

for rsvp in test_rsvps:
    print(f"Deleting RSVP: {rsvp.id}")
    rsvp.reference.delete()

print("✅ Test data cleaned up")
```

---

## Next Steps After Successful Testing

Once all tests pass:

1. ✅ Commit changes
2. 🚀 Deploy to Cloud Run
3. ☁️ Set up Cloud Scheduler for auto-activation
4. 📧 Configure email reminders
5. 📊 Monitor real usage
6. 🎯 Move to Phase 3 (Recurring sessions)

---

**Last Updated:** November 3, 2025  
**Status:** Ready for Testing  
**Phase:** 2 of 3 (Public Display + RSVP)

