# 🔄 Recurring Sessions Fix - Morning Prayer

**Revision:** `divinebridge-00446-r8p`  
**Status:** Fixed and deployed

---

## Issue Reported

"My Morning Prayer was supposed to be recurring every day but I don't see it in the upcoming or scheduled sessions."

---

## Root Causes Found

### 1. Parent Session Status Changed
- Your "Morning Prayer" session went live → status changed from `scheduled` to `active`
- Recurring instance generator only looked for `status == 'scheduled'`
- Result: Stopped generating future instances

### 2. Datetime Timezone Comparison Error
- Error: `can't compare offset-naive and offset-aware datetimes`
- Firestore timestamps are timezone-aware
- Python `datetime.utcnow()` is timezone-naive
- Comparisons were failing silently

---

## Fixes Applied

### Fix 1: Query Both Scheduled AND Active Recurring Sessions
**Before:**
```python
recurring_sessions = db.collection('scheduled_rooms')\
    .where('is_recurring', '==', True)\
    .where('status', '==', 'scheduled')\
    .stream()
```

**After:**
```python
# Query both scheduled and active recurring sessions
scheduled_recurring = db.collection('scheduled_rooms')\
    .where('is_recurring', '==', True)\
    .where('status', '==', 'scheduled')\
    .stream()

active_recurring = db.collection('scheduled_rooms')\
    .where('is_recurring', '==', True)\
    .where('status', '==', 'active')\
    .stream()

all_recurring = list(scheduled_recurring) + list(active_recurring)
```

**Benefit:** Recurring sessions continue generating future instances even after going live

---

### Fix 2: Normalize Datetime Timezones
**Before:**
```python
if next_time <= check_until and (not recurrence_end_date or next_time <= recurrence_end_date):
    # Comparison failed due to timezone mismatch
```

**After:**
```python
# Remove timezone info from all datetimes before comparison
if hasattr(recurrence_end_date, 'replace') and recurrence_end_date.tzinfo:
    recurrence_end_date = recurrence_end_date.replace(tzinfo=None)

if isinstance(last_generated_time, datetime):
    current_check = last_generated_time.replace(tzinfo=None) if last_generated_time.tzinfo else last_generated_time

check_until_naive = check_until.replace(tzinfo=None) if check_until.tzinfo else check_until
```

**Benefit:** Datetime comparisons work correctly, no silent failures

---

## Results

### ✅ 4 Morning Prayer Instances Generated

After fixing and triggering the generator:

1. **Nov 10, 2025 13:30 UTC** (7:30 AM CST)
2. **Nov 11, 2025 13:30 UTC** (7:30 AM CST)
3. **Nov 12, 2025 13:30 UTC** (7:30 AM CST)
4. **Nov 13, 2025 13:30 UTC** (7:30 AM CST)

**Days:** Monday, Tuesday, Wednesday, Thursday (matching your recurrence_days: [0, 1, 2, 3])

---

## How It Works Now

### Recurring Session Lifecycle

1. **Create recurring session**
   - Set `is_recurring: True`
   - Set pattern (weekly/biweekly/monthly)
   - Set recurrence days (for weekly)
   - Status: `scheduled`

2. **First instance goes live**
   - Cloud Scheduler activates at scheduled time
   - Parent session status changes: `scheduled` → `active`
   - Live room created

3. **Future instances continue generating** ✅ **NEW**
   - Recurring generator queries both `scheduled` AND `active` sessions
   - Creates future instances for next 7 days
   - Runs daily at 2am (America/New_York timezone)

4. **Each future instance**
   - Links to parent via `parent_recurring_id`
   - Has own `scheduled_time`
   - Status: `scheduled`
   - Goes live when its time arrives

---

## Verification

### Check Upcoming Sessions
1. Go to `/prayer-room`
2. Click "Upcoming" tab
3. Should see your Morning Prayer sessions for:
   - Monday, Nov 10
   - Tuesday, Nov 11
   - Wednesday, Nov 12
   - Thursday, Nov 13

### Check My Rooms
1. Click "My Rooms" button
2. Go to "Scheduled" tab
3. Should see the future Morning Prayer instances

---

## Scheduler Jobs Status

- **generate-recurring-instances:** Runs daily at 2 AM ET
- **Last Run:** Just now (manual trigger)
- **Instances Created:** 4
- **Next Auto Run:** Nov 8, 2025 at 2 AM ET

---

## Summary

✅ **Root cause identified:** Status change from `scheduled` to `active` stopped instance generation  
✅ **Fix deployed:** Generator now queries both statuses  
✅ **Datetime fix:** Timezone comparison errors resolved  
✅ **4 instances created:** Your Morning Prayer sessions are now scheduled  
✅ **Visible in upcoming:** Sessions will appear in the Upcoming tab  

Your recurring Morning Prayer sessions are now working properly!

