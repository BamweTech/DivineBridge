# Scheduled Prayer Sessions - Flow Analysis & Recommendations

## Current Implementation Analysis

### 📋 What Exists Now:

#### 1. **Scheduling a Session** ✅
- User can schedule a prayer room for a future date/time
- Data stored in `scheduled_rooms` Firestore collection
- Fields: `room_name`, `scheduled_time`, `host_id`, `host_name`, `room_privacy`, `room_code` (if private), `status`

#### 2. **Viewing Scheduled Sessions** ✅
- Users can view their scheduled rooms in "My Rooms" modal
- Shows upcoming vs. past sessions
- Can edit upcoming sessions
- Can cancel/delete sessions

#### 3. **Sharing Scheduled Sessions** ✅
- Copy room code
- Share link functionality

### ❌ What's Missing (Critical Gaps):

#### 1. **NO Automatic Activation When Time Arrives**
- Scheduled rooms stay in `scheduled_rooms` collection forever
- They are NEVER automatically converted to active rooms
- Status remains `'scheduled'` even after the time passes

#### 2. **NO Notifications to Host**
- Host never gets reminded their session is starting
- No email notification
- No browser/push notification

#### 3. **NO Notifications to Participants**
- No way for participants to "sign up" or "RSVP" for scheduled sessions
- Even if there was, they wouldn't be notified

#### 4. **NO Automatic Room Creation**
- Host must manually create the room when the time arrives
- This defeats the purpose of scheduling!

#### 5. **NO Recurring Sessions**
- No support for weekly/monthly recurring prayers
- Each session must be manually scheduled

#### 6. **NO Reminders**
- No "15 minutes before" reminders
- No "starting now" alerts

#### 7. **NO Status Transitions**
- Sessions stay `'scheduled'` forever
- No transition to `'active'`, `'completed'`, or `'cancelled'`

---

## Complete Flow Diagram

### Current (Broken) Flow:
```
User schedules room
    ↓
Saved to scheduled_rooms collection (status='scheduled')
    ↓
Time arrives → NOTHING HAPPENS ❌
    ↓
Time passes → Still nothing ❌
    ↓
Host has to manually remember → Create new room manually ❌
```

### Recommended Complete Flow:
```
User schedules room
    ↓
Saved to scheduled_rooms (status='scheduled')
    ↓
Cloud Scheduler checks every 5 minutes
    ↓
15 min before → Send reminders to host & participants
    ↓
At scheduled time:
    ├─ Auto-create active room
    ├─ Send "Room is Live!" notifications
    ├─ Update status → 'active'
    └─ For recurring: Create next occurrence
    ↓
Session ends (host leaves/room timeout)
    ↓
Update status → 'completed'
    ↓
Send follow-up email with summary
```

---

## Recommended Implementation Plan

### Phase 1: Auto-Activation (CRITICAL) 🔴

#### A. Cloud Scheduler Job
Create a new Cloud Scheduler job that runs every 5 minutes:

```yaml
Job Name: activate-scheduled-rooms
Schedule: */5 * * * * (every 5 minutes)
URL: https://divinebridge.io/api/prayer-room/activate-scheduled-rooms
Method: POST
Auth: OIDC with service account
```

#### B. Backend Endpoint
```python
@prayer_room_bp.route('/activate-scheduled-rooms', methods=['POST'])
@verify_cloud_scheduler()
def activate_scheduled_rooms():
    """
    Check for scheduled rooms whose time has arrived and activate them
    Triggered by Cloud Scheduler every 5 minutes
    """
    try:
        db = get_firestore_client()
        now = datetime.utcnow()
        
        # Find scheduled rooms whose time has arrived (±5 min window)
        scheduled_rooms = db.collection('scheduled_rooms')\
            .where('status', '==', 'scheduled')\
            .where('scheduled_time', '<=', now)\
            .stream()
        
        activated_count = 0
        for scheduled_doc in scheduled_rooms:
            scheduled_data = scheduled_doc.to_dict()
            
            # Create active room
            room_id = create_active_room_from_scheduled(scheduled_data)
            
            # Update scheduled room status
            scheduled_doc.reference.update({
                'status': 'active',
                'activated_at': now,
                'active_room_id': room_id
            })
            
            # Send notifications
            send_session_live_notifications(scheduled_data, room_id)
            
            activated_count += 1
        
        return jsonify({
            'success': True,
            'activated_count': activated_count
        })
    except Exception as e:
        logging.error(f"Error activating scheduled rooms: {e}")
        return jsonify({'error': str(e)}), 500
```

#### C. Helper Functions
```python
def create_active_room_from_scheduled(scheduled_data):
    """Create an active room from scheduled room data"""
    db = get_firestore_client()
    room_id = generate_room_id()
    
    room_data = {
        'room_id': room_id,
        'room_name': scheduled_data['room_name'],
        'room_description': scheduled_data.get('room_description', ''),
        'room_privacy': scheduled_data.get('room_privacy', 'public'),
        'room_code': scheduled_data.get('room_code'),
        'host_id': scheduled_data['host_id'],
        'host_name': scheduled_data['host_name'],
        'created_at': datetime.utcnow(),
        'is_active': True,
        'is_locked': False,
        'scheduled_room_id': scheduled_data.get('scheduled_room_id'),
        'participants': [{
            'user_id': scheduled_data['host_id'],
            'user_name': scheduled_data['host_name'],
            'joined_at': datetime.utcnow(),
            'is_muted': False,
            'is_host': True
        }],
        'settings': {
            'allow_anonymous': scheduled_data.get('room_privacy', 'public') == 'public',
            'max_participants': 50,
            'auto_mute_new_participants': False
        }
    }
    
    db.collection('prayer_rooms').document(room_id).set(room_data)
    return room_id

def send_session_live_notifications(scheduled_data, room_id):
    """Send notifications that scheduled session is now live"""
    # Send email to host
    # Send emails to RSVPed participants
    # Send push notifications (future)
    pass
```

---

### Phase 2: Participant RSVP System 🟡

#### A. Data Model
```javascript
// scheduled_room_participants collection
{
  scheduled_room_id: "abc123",
  user_id: "user_firebase_id",
  user_email: "user@example.com",
  user_name: "John Doe",
  rsvp_status: "interested" | "going" | "maybe" | "not_going",
  rsvp_at: timestamp,
  reminder_preferences: {
    email_15min: true,
    email_1hour: true,
    push: true
  }
}
```

#### B. Frontend UI
Add "I'm Interested" or "RSVP" button when viewing scheduled sessions:
- Shows participant count
- Allows users to RSVP
- Participants receive notifications when session goes live

#### C. Backend Endpoints
```python
POST /api/prayer-room/scheduled/<room_id>/rsvp
DELETE /api/prayer-room/scheduled/<room_id>/rsvp
GET /api/prayer-room/scheduled/<room_id>/participants
```

---

### Phase 3: Reminder System 🟡

#### A. Reminder Schedule
- **24 hours before**: "Reminder: Prayer session tomorrow"
- **1 hour before**: "Starting in 1 hour"
- **15 minutes before**: "Starting soon - be ready!"
- **At start time**: "Session is LIVE - Join now!"

#### B. Implementation
Modify Cloud Scheduler job to also check for upcoming sessions:

```python
def send_reminders():
    now = datetime.utcnow()
    
    # 15-minute reminders
    upcoming_15min = db.collection('scheduled_rooms')\
        .where('status', '==', 'scheduled')\
        .where('scheduled_time', '>=', now)\
        .where('scheduled_time', '<=', now + timedelta(minutes=15))\
        .where('reminder_15min_sent', '==', False)\
        .stream()
    
    for room in upcoming_15min:
        send_reminder_email(room, '15 minutes')
        room.reference.update({'reminder_15min_sent': True})
```

---

### Phase 4: Recurring Sessions 🟢

#### A. Data Model Extension
```javascript
scheduled_rooms {
  // ... existing fields ...
  recurrence: {
    enabled: true,
    pattern: "weekly" | "biweekly" | "monthly",
    day_of_week: 1-7,  // Monday=1
    end_date: timestamp,
    occurrences_count: 10
  }
}
```

#### B. Auto-Create Next Occurrence
When a recurring session activates:
1. Create the active room
2. Calculate next occurrence date
3. Create new scheduled_room for next occurrence
4. Update current with `next_occurrence_id`

#### C. Frontend UI
- Checkbox: "Make this recurring"
- Dropdown: Weekly / Biweekly / Monthly
- Select day of week
- End date or occurrence count

---

### Phase 5: Status Management 🟡

#### A. Status Lifecycle
```
scheduled → active → completed
           ↓
         cancelled
```

#### B. Auto-Complete Sessions
- After 2 hours of inactivity
- When host explicitly ends
- When last participant leaves

#### C. Cleanup Old Scheduled Rooms
Monthly job to archive completed/cancelled sessions older than 90 days

---

### Phase 6: Analytics & Reporting 🟢

Track for each scheduled session:
- How many people RSVPed
- How many actually joined
- Average join time (on-time vs late)
- Session duration
- Recurring session attendance trends

---

## Implementation Priority

### 🔴 **Critical (Must Have)** - Deploy ASAP
1. **Auto-Activation System**
   - Cloud Scheduler job
   - Activate scheduled rooms endpoint
   - Create active room from scheduled room
   - Basic host email notification

### 🟡 **Important (Should Have)** - Next Sprint
2. **RSVP System**
   - Data model
   - Frontend UI
   - Notifications to RSVPed participants

3. **Reminder System**
   - 15-minute reminder
   - "Session is live" notification

4. **Status Management**
   - Status lifecycle
   - Auto-complete sessions

### 🟢 **Nice to Have** - Future Enhancement
5. **Recurring Sessions**
   - Weekly/monthly patterns
   - Auto-create next occurrence

6. **Advanced Features**
   - Multiple reminder times
   - Custom reminder messages
   - Calendar integration (Google Calendar, iCal)
   - SMS notifications
   - Analytics dashboard

---

## Database Schema Updates

### scheduled_rooms (existing, add fields):
```javascript
{
  // ... existing fields ...
  
  // New fields for Phase 1
  status: 'scheduled' | 'active' | 'completed' | 'cancelled',
  activated_at: timestamp,
  active_room_id: string,
  completed_at: timestamp,
  
  // New fields for Phase 3
  reminder_15min_sent: boolean,
  reminder_1hour_sent: boolean,
  reminder_24hour_sent: boolean,
  
  // New fields for Phase 4
  recurrence: {
    enabled: boolean,
    pattern: string,
    day_of_week: number,
    end_date: timestamp
  },
  next_occurrence_id: string,
  parent_scheduled_room_id: string
}
```

### scheduled_room_participants (new collection):
```javascript
{
  scheduled_room_id: string,
  user_id: string,
  user_email: string,
  user_name: string,
  rsvp_status: string,
  rsvp_at: timestamp,
  reminder_preferences: object,
  notified_15min: boolean,
  notified_live: boolean,
  joined_session: boolean
}
```

---

## Email Templates Needed

### 1. **Scheduled Confirmation Email** (to host)
Subject: "✅ Prayer Session Scheduled"
- Session details
- Share link
- Edit/cancel options

### 2. **RSVP Confirmation Email** (to participant)
Subject: "You're registered for [Room Name]"
- Session details
- Add to calendar link
- Room code (if private)

### 3. **15-Minute Reminder** (to all)
Subject: "🕐 Prayer session starting in 15 minutes"
- Quick join link
- Room details reminder

### 4. **Session Live Notification** (to all)
Subject: "🙏 [Room Name] is LIVE - Join Now!"
- Big "Join Now" button
- Room code prominent
- "Already started, don't be late!"

### 5. **Session Completed** (to participants)
Subject: "Thank you for joining [Room Name]"
- Prayer summary
- Next occurrence (if recurring)
- Encourage testimony sharing

---

## Testing Checklist

### Phase 1 Testing:
- [ ] Cloud Scheduler job triggers every 5 minutes
- [ ] Scheduled room activates at correct time
- [ ] Active room created with correct data
- [ ] Host added as participant
- [ ] Room code preserved (if private)
- [ ] Host receives email notification
- [ ] Status updated to 'active'
- [ ] Multiple scheduled rooms activate correctly
- [ ] Past scheduled rooms ignored
- [ ] Error handling for failed activations

### Phase 2 Testing:
- [ ] User can RSVP to scheduled session
- [ ] Participant count updates
- [ ] Duplicate RSVPs prevented
- [ ] Unregister works correctly
- [ ] RSVPed users notified when live

### Phase 3 Testing:
- [ ] 15-minute reminder sent
- [ ] Reminders not duplicated
- [ ] Reminder preference respected
- [ ] Email delivery successful

### Phase 4 Testing:
- [ ] Next occurrence created automatically
- [ ] Recurrence pattern correct
- [ ] End date respected
- [ ] Recurring chain maintained

---

## Cost Considerations

### Cloud Scheduler:
- **Phase 1**: 1 additional job (every 5 minutes) = 8,640 executions/month
- **Cost**: ~$0.10/month (3 free jobs, $0.10 per additional job)

### Cloud Functions/Run Invocations:
- **Phase 1**: 8,640 invocations/month
- **Cost**: Within free tier (2M requests/month)

### Firestore Reads/Writes:
- **Phase 1**: ~500 reads/day + 100 writes/day = 18K operations/month
- **Cost**: ~$0.10/month

### Email Sending:
- **Depends on user base**
- If 100 scheduled sessions/day with 10 participants each:
  - 1,000 reminder emails/day
  - 30,000 emails/month
- **Cost**: Depends on email service (SendGrid free tier: 100/day)

### **Total Estimated Cost**: $0.50-$2.00/month (plus email costs)

---

## Deployment Strategy

### Step 1: Deploy Backend Changes
```bash
# Add new endpoint
# Update prayer_room_bp.py
git add routes/prayer_room_bp.py
git commit -m "Add scheduled room auto-activation"
gcloud run deploy divinebridge --source .
```

### Step 2: Create Cloud Scheduler Job
```bash
gcloud scheduler jobs create http activate-scheduled-rooms \
    --schedule="*/5 * * * *" \
    --uri="https://divinebridge.io/api/prayer-room/activate-scheduled-rooms" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --location=us-central1
```

### Step 3: Test
```bash
# Manually trigger the job
gcloud scheduler jobs run activate-scheduled-rooms --location=us-central1

# Check logs
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=activate-scheduled-rooms" --limit=10
```

### Step 4: Monitor
- Check Firestore for activated rooms
- Verify emails sent
- Monitor error logs

---

## Success Metrics

### Phase 1:
- ✅ 100% of scheduled rooms activate automatically
- ✅ Host receives notification within 1 minute
- ✅ Zero manual activation needed

### Phase 2-3:
- 📊 RSVP rate: Target 30%+ of viewers
- 📊 Show-up rate: Target 60%+ of RSVPs actually join
- 📊 On-time join rate: Target 70%+ join within 5 minutes

### Phase 4:
- 📊 Recurring session retention: Target 80%+ week-over-week
- 📊 Average recurring session lifespan: Target 8+ weeks

---

## Documentation Updates Needed

1. Update `ROOM_SUBSCRIPTION_GUIDE.md` - merge with scheduled sessions
2. Create `SCHEDULED_SESSIONS_USER_GUIDE.md` - for end users
3. Update `DEPLOYMENT_GUIDE.md` - add Cloud Scheduler job setup
4. Update API documentation with new endpoints

---

## Conclusion

The current scheduled sessions feature is **incomplete and non-functional** for its intended purpose. Users schedule sessions, but nothing happens when the time arrives.

**Immediate Action Required**: Implement Phase 1 (Auto-Activation) to make the feature actually work.

**Estimated Development Time**:
- Phase 1: 4-6 hours
- Phase 2: 6-8 hours  
- Phase 3: 4-6 hours
- Phase 4: 8-10 hours

**Total for MVP (Phases 1-3)**: 14-20 hours

---

**Last Updated**: November 3, 2025  
**Status**: Analysis Complete - Awaiting Implementation

