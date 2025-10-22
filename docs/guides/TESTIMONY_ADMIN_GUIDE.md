# Testimony Admin & Approval Guide

## Overview
Testimonies submitted by users require manual approval before appearing publicly in the Prayer Room. This ensures quality and appropriateness of content.

---

## Approval Methods

### Method 1: CLI Admin Tool (Recommended)

The easiest way to review and approve testimonies:

```bash
cd /Users/jeancalmerekubwayo/Documents/divineBridge
source venv/bin/activate
python3 admin_testimonies.py
```

**Features:**
- Shows all pending testimonies
- Displays full content for review
- Interactive approve/reject/skip options
- Adds rejection reasons
- Shows before/after statistics

**Actions:**
- **[A]pprove** - Make testimony public
- **[R]eject** - Hide testimony, add reason
- **[S]kip** - Review later
- **[Q]uit** - Exit tool

---

### Method 2: API Endpoints

For programmatic or web-based admin interfaces:

#### Get Pending Testimonies:
```bash
curl http://localhost:5001/api/testimony/admin/pending
```

Response:
```json
{
  "testimonies": [
    {
      "id": "uuid",
      "title": "God healed my grandmother!",
      "content": "Full testimony...",
      "created_at": "2025-10-20T00:38:04",
      "approved": false
    }
  ],
  "count": 1
}
```

#### Approve a Testimony:
```bash
curl -X POST http://localhost:5001/api/testimony/admin/approve/TESTIMONY_ID
```

#### Reject a Testimony:
```bash
curl -X POST http://localhost:5001/api/testimony/admin/reject/TESTIMONY_ID \
  -H "Content-Type: application/json" \
  -d '{"reason": "Inappropriate content"}'
```

---

### Method 3: Python Script

```python
from storage_handler import StorageHandler

storage = StorageHandler()

# Get all pending
all_testimonies = storage.get_all_testimonies()
pending = [t for t in all_testimonies if not t.get('approved')]

print(f"{len(pending)} pending testimonies")

# Approve a specific one
testimony_id = "uuid-here"
testimony = storage.get_testimony(testimony_id)
testimony['approved'] = True
storage.update_testimony(testimony_id, testimony)
```

---

## Approval Workflow

### 1. User Submits Testimony
- User clicks "Thanksgiving" button in Prayer Room
- Fills out form with title and content
- Clicks "Share Thanksgiving"
- Testimony saved with `approved: false`

### 2. Admin Reviews
- Run `admin_testimonies.py` CLI tool
- Read each testimony
- Decide: Approve, Reject, or Skip

### 3. Testimony Goes Live
- Once approved, testimony appears in Prayer Room
- Mixed with prayer requests (gold/yellow theme)
- Users can read and be encouraged

---

## Review Guidelines

### ✅ Approve If:
- Genuine testimony of God's work
- Appropriate language and content
- Encourages faith
- No personal attacks or negativity
- Proper grammar (mostly)

### ❌ Reject If:
- Spam or promotional content
- Inappropriate language
- Off-topic (not about God/faith)
- Too vague or unclear
- Potential scam or manipulation
- Personal information (phone numbers, addresses)

### ⏳ Skip If:
- Unsure - need to think about it
- Want to review with someone else
- Will decide later

---

## Bulk Approval (Future Enhancement)

For now, testimonies are reviewed one by one. Future enhancements could include:
- AI-powered pre-screening
- Bulk approve/reject
- Web-based admin dashboard
- Email notifications for new testimonies
- Auto-approve from trusted users

---

## Security Recommendations

### Current State:
- ⚠️ Admin endpoints are **unprotected** (no authentication)
- Anyone with API access can approve/reject

### Recommended Additions:
1. **Admin authentication** - Require login with admin role
2. **Secret key** - Add `ADMIN_KEY` to Secret Manager
3. **Rate limiting** - Prevent abuse of admin endpoints
4. **Audit log** - Track who approved/rejected what

### Quick Security Fix:
Add to `routes/testimony_bp.py`:
```python
# At the top of approve/reject functions:
data = request.get_json() or {}
admin_key = data.get('admin_key')
if admin_key != current_app.config.get('ADMIN_KEY'):
    return jsonify({'error': 'Unauthorized'}), 403
```

---

## Testing the System

### 1. Submit a Test Testimony:
Open http://localhost:5001/prayers → Click "Thanksgiving" → Submit

### 2. Check Pending:
```bash
curl http://localhost:5001/api/testimony/admin/pending
```

### 3. Approve It:
```bash
python3 admin_testimonies.py
# Choose [A]pprove
```

### 4. Verify It Appears:
Refresh http://localhost:5001/prayers → Should see gold testimony card!

---

## Quick Reference

**View pending testimonies:**
```bash
python3 admin_testimonies.py
```

**Approve via API:**
```bash
curl -X POST http://localhost:5001/api/testimony/admin/approve/TESTIMONY_ID
```

**Approve via Python:**
```python
from storage_handler import StorageHandler
s = StorageHandler()
t = s.get_testimony('ID')
t['approved'] = True
s.update_testimony('ID', t)
```

---

## Location in Storage

Testimonies are stored in Google Cloud Storage:
- **Path**: `gs://divinebridge-prayers/testimonies/{date}/{testimony_id}.json`
- **Example**: `gs://divinebridge-prayers/testimonies/2025-10-20/uuid.json`

**List all testimonies:**
```bash
gcloud storage ls gs://divinebridge-prayers/testimonies/** --project=divinebridge
```

---

**The CLI tool (`admin_testimonies.py`) is the easiest way to manage testimonies!** ⚡✨

