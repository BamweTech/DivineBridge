# Testing Scheduled Room Auto-Activation Locally

This guide helps you test the scheduled room auto-activation system before deploying to production.

## Overview

The auto-activation system:
1. Checks for scheduled rooms whose time has arrived
2. Creates active prayer rooms automatically
3. Sends email notifications to the host
4. Updates the scheduled room status

## Prerequisites

- Flask app running locally
- Firebase credentials configured
- Firestore database access
- Python 3.7+

---

## Method 1: Automated Test Script (Recommended)

### Step 1: Start Your Local Server

```bash
cd /Users/jeancalmerekubwayo/Documents/divineBridge
python app.py
```

The app should start on `http://localhost:8080`

### Step 2: Run the Test Script

In a new terminal:

```bash
cd /Users/jeancalmerekubwayo/Documents/divineBridge
python test_scheduled_activation.py
```

### What the Script Does:

1. ✅ Creates a test scheduled room (activates in 1 minute)
2. ⏳ Waits for the scheduled time
3. 📡 Calls the activation endpoint
4. ✅ Verifies the active room was created
5. 🗑️ Offers to clean up test data

### Expected Output:

```
============================================================
  SCHEDULED ROOM AUTO-ACTIVATION TEST
============================================================

=== Creating Test Scheduled Room ===

✅ Created scheduled room: abc123def456
   Room Name: Test Auto-Activation Room
   Scheduled Time: 2025-11-03 15:30:00 UTC
   Current Time: 2025-11-03 15:29:00 UTC
   Will activate in: 1 minute

=== Waiting for Scheduled Time ===

⏳ Time until activation: 60 seconds

✅ Scheduled time reached!

=== Triggering Activation Endpoint ===

📡 Calling: POST http://localhost:8080/api/prayer-room/activate-scheduled-rooms
📨 Response Status: 200
📝 Response Body:
{
  "success": true,
  "timestamp": "2025-11-03T15:30:05",
  "activated_count": 1,
  "checked_rooms": 1
}

✅ SUCCESS! Room(s) activated

=== Verifying Activation ===

📋 Scheduled Room Status: active
✅ Status updated to 'active'
✅ Active room ID: ABCDEF

🎉 Active room created successfully!
   Room Name: Test Auto-Activation Room
   Host: Test Host
   Participants: 1
   Is Active: True

🗑️  Delete test data? (y/n): y
✅ Test data cleaned up

============================================================
  ✅ TEST PASSED - AUTO-ACTIVATION WORKS!
============================================================
```

---

## Method 2: Manual Testing

### Step 1: Create a Test Scheduled Room

Use the app UI:

1. Go to `http://localhost:8080/prayer-room`
2. Click "Schedule Session"
3. Fill in:
   - Name: "Test Activation"
   - Date/Time: **2 minutes from now**
   - Privacy: Public
4. Click "Schedule"

### Step 2: Note the Scheduled Room ID

Check Firestore console or logs for the scheduled room ID.

### Step 3: Wait for Scheduled Time

Wait until the scheduled time arrives (+ 10 seconds buffer).

### Step 4: Manually Trigger Activation

Use curl or Postman:

```bash
curl -X POST http://localhost:8080/api/prayer-room/activate-scheduled-rooms \
  -H "X-Local-Dev: true"
```

### Step 5: Verify in Firestore

Check Firestore:

**scheduled_rooms collection:**
- Status should be "active"
- `active_room_id` should be set
- `activated_at` timestamp should be present

**prayer_rooms collection:**
- New active room should exist
- Room name matches scheduled room
- Host is in participants array
- `is_active` is true

---

## Method 3: Testing with Real Schedule (Longer Wait)

For more realistic testing:

### Step 1: Schedule a Real Session

1. Login to your account
2. Schedule a session for 5-10 minutes from now
3. Note the scheduled room ID

### Step 2: Monitor Logs

Keep your terminal open to watch logs:

```bash
tail -f app.log
```

### Step 3: Manually Trigger at Scheduled Time

When the time arrives, trigger the endpoint:

```bash
curl -X POST http://localhost:8080/api/prayer-room/activate-scheduled-rooms \
  -H "X-Local-Dev: true"
```

### Step 4: Check Your Email

You should receive: "🙏 [Room Name] is Now Live!"

### Step 5: Join the Active Room

Navigate to the prayer rooms page - your scheduled session should now be in the "Active Rooms" list.

---

## Debugging

### Issue: "No rooms were activated"

**Check:**
1. Is the scheduled time in the past?
   ```python
   # In Python console
   from firebase_auth import get_firestore_client
   from datetime import datetime
   
   db = get_firestore_client()
   rooms = db.collection('scheduled_rooms').where('status', '==', 'scheduled').stream()
   for room in rooms:
       data = room.to_dict()
       print(f"Room: {data['room_name']}")
       print(f"Scheduled: {data['scheduled_time']}")
       print(f"Now: {datetime.utcnow()}")
   ```

2. Is the status "scheduled"? (not "active" or "cancelled")

3. Is the scheduled_time within the last 10 minutes?
   - The endpoint only checks a 10-minute window

### Issue: "Authentication required" or 401 error

**Solution:** Add the local dev header:

```bash
curl -X POST http://localhost:8080/api/prayer-room/activate-scheduled-rooms \
  -H "X-Local-Dev: true" \
  -H "User-Agent: Test-Script"
```

Or temporarily bypass auth check in `auth_decorators.py`:

```python
def verify_cloud_scheduler():
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # For local testing
            if os.getenv('FLASK_ENV') == 'development':
                return f(*args, **kwargs)
            # ... rest of verification
```

### Issue: "Email not sent"

**Check:**
1. Is `email_service.py` configured?
2. Are SMTP credentials set in environment variables?
3. Does the host have an email in Firebase Auth?

**Temporary workaround:** Comment out email sending in the test:

```python
# In send_session_live_notifications()
# send_email(host_email, subject, body)  # Comment out for testing
logging.info(f"Would send email to {host_email}")
```

### Issue: Room created but status not updated

**Check Firestore rules:**

Ensure your rules allow updating scheduled_rooms:

```javascript
match /scheduled_rooms/{roomId} {
  allow read: if true;
  allow update: if request.auth != null || 
                request.auth.token.email_verified == true;
}
```

---

## Verifying Email Notifications

### If emails are not actually sending:

Check `app.log` for:
```
INFO - Sent session live notification to host test@example.com
```

### To test email delivery:

1. **Use your real email** as the test host
2. Schedule a room with your account
3. Trigger activation
4. Check your inbox (and spam folder)

### Email should contain:
- Subject: "🙏 [Room Name] is Now Live!"
- Big "Join Your Room Now" button
- Room code (if private)
- Bible verse
- Professional HTML design

---

## Clean Up Test Data

### Remove test scheduled rooms:

```python
from firebase_auth import get_firestore_client
from datetime import datetime

db = get_firestore_client()

# Delete test scheduled rooms
test_rooms = db.collection('scheduled_rooms')\
    .where('host_name', '==', 'Test Host')\
    .stream()

for room in test_rooms:
    print(f"Deleting test room: {room.id}")
    room.reference.delete()
```

### Remove test active rooms:

```python
# Delete test active rooms
test_active = db.collection('prayer_rooms')\
    .where('host_name', '==', 'Test Host')\
    .stream()

for room in test_active:
    print(f"Deleting active room: {room.id}")
    room.reference.delete()
```

---

## Next Steps After Successful Testing

Once local testing passes:

1. ✅ Commit the changes
2. 🚀 Deploy to Cloud Run
3. ☁️ Set up Cloud Scheduler job
4. 📊 Monitor production logs
5. 📧 Test with real scheduled sessions

See `SCHEDULED_SESSIONS_ANALYSIS.md` for deployment instructions.

---

## Troubleshooting Checklist

- [ ] Flask app running on localhost:8080
- [ ] Firebase credentials configured
- [ ] Firestore accessible
- [ ] Test scheduled room created
- [ ] Scheduled time in correct timezone (UTC)
- [ ] Status field set to "scheduled"
- [ ] Activation endpoint responds (200 OK)
- [ ] Active room created in Firestore
- [ ] Scheduled room status updated to "active"
- [ ] Host email notification sent (if configured)
- [ ] Test data cleaned up

---

**Last Updated:** November 3, 2025  
**Status:** Ready for Testing

