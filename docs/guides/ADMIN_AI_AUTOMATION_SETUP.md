# Admin AI Daily Report Setup Guide

## Overview

The Admin AI Assistant generates **daily task lists**:
1. Tasks are queued in Firestore
2. Cloud Scheduler triggers daily at 5pm
3. System reviews admin tasks and production errors (last 24 hours)
4. Creates combined task list saved to Firebase
5. Email sent with prioritized task list to jeancalmere.kubwayo@divinebridge.io

## Cloud Scheduler Setup

### Step 1: Create Service Account (if needed)

```bash
# Create service account for scheduler
gcloud iam service-accounts create admin-scheduler \
    --display-name="Admin Task Scheduler Service Account"

# Grant permission to invoke Cloud Run
gcloud run services add-iam-policy-binding divinebridge \
    --region=us-central1 \
    --member=serviceAccount:admin-scheduler@divinebridge.iam.gserviceaccount.com \
    --role=roles/run.invoker
```

### Step 2: Create Cloud Scheduler Job

```bash
# Get your Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe divinebridge --region=us-central1 --format="value(status.url)")

# Create scheduler job (runs daily at 5pm UTC)
gcloud scheduler jobs create http generate-daily-report \
    --location=us-central1 \
    --schedule="0 17 * * *" \
    --time-zone="UTC" \
    --uri="${CLOUD_RUN_URL}/admin/api/generate-daily-report" \
    --http-method=POST \
    --oidc-service-account-email=admin-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="${CLOUD_RUN_URL}"
```

### Step 3: Test the Scheduler

```bash
# Trigger manually to test
gcloud scheduler jobs run generate-daily-report --location=us-central1

# Check logs
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=generate-daily-report" --limit=10
```

## Firestore Index Setup

### Required Indexes

#### 1. Admin Tasks Index

Create a composite index for `admin_tasks` collection:

**Index Name:** `admin_tasks_status_created_at`

**Fields:**
- `status` (Ascending)
- `created_at` (Ascending)

#### 2. Daily Task Lists Index (Optional)

For querying daily task lists by date:

**Index Name:** `daily_task_lists_date_generated_at`

**Fields:**
- `date` (Ascending)
- `generated_at` (Descending)

**Create via Firebase Console:**
1. Go to Firebase Console → Firestore → Indexes
2. Click "Create Index"
3. Collection ID: `admin_tasks`
4. Add fields: `status` (Ascending), `created_at` (Ascending)
5. Click "Create"

**Or create via gcloud:**
```bash
gcloud firestore indexes composite create \
    --collection-group=admin_tasks \
    --query-scope=COLLECTION \
    --field-config=field-path=status,order=ASCENDING \
    --field-config=field-path=created_at,order=ASCENDING
```

## How It Works

### Daily Report Flow

```
1. Admin posts tasks → Added to Firestore queue (status: 'pending')
   ↓
2. Cloud Scheduler triggers daily at 5pm UTC
   ↓
3. Daily report generation:
   a. Fetch all pending admin tasks
   b. Fetch production errors/warnings (last 24 hours)
   c. Analyze logs for patterns
   d. Create combined task list with priorities:
      - High: Admin tasks + Critical errors
      - Medium: General errors + Patterns
      - Low: Warnings
   e. Save task list to Firestore (daily_task_lists collection)
   f. Mark admin tasks as 'reviewed'
   g. Send email with task list
```

### Task Statuses

- **pending**: Task queued, waiting for daily review
- **reviewed**: Task included in daily report
- **completed**: (Manual status update if needed)

### Task List Structure

Each daily task list contains:
- **date**: Date of report
- **generated_at**: Timestamp
- **task_list**: Array of tasks with:
  - `type`: admin_task, error, warning, pattern
  - `priority`: high, medium, low
  - `description`: Task description
  - `source`: Admin, Production Error, etc.
  - `category`: authentication, audio, scheduler, database, general
- **admin_tasks_count**: Number of admin tasks
- **errors_count**: Number of errors found
- **warnings_count**: Number of warnings found

## Task List Categories

Tasks are automatically categorized:

### High Priority
- Admin tasks (from admin panel)
- Critical errors (authentication, database, scheduler)
- Audio/WebRTC errors

### Medium Priority
- General errors
- Frequent error patterns (>5 occurrences)

### Low Priority
- Warnings
- Non-critical issues

### Categories
- **authentication**: Auth, login, token, session errors
- **audio**: Audio, WebRTC, peer connection errors
- **scheduler**: Scheduler, cron, job errors
- **database**: Firestore, database, query, index errors
- **general**: Other errors

## Security

- **Cloud Scheduler Protection**: Endpoint verified via OIDC token
- **Passcode Protection**: Admin login still required
- **Firestore Security**: Tasks stored securely in Firestore

## Required Permissions

The Cloud Run service account needs:
- `logging.logEntries.list` - Read Cloud Logging
- `firestore.databases.get` - Access Firestore
- `firestore.databases.write` - Write to Firestore

## Troubleshooting

### Report Not Generated

1. Check Cloud Scheduler job is running:
   ```bash
   gcloud scheduler jobs describe generate-daily-report --location=us-central1
   ```

2. Check Cloud Run logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND textPayload=~'daily-report'" --limit=20
   ```

3. Verify Firestore index exists:
   ```bash
   gcloud firestore indexes list
   ```

### Email Not Sending

1. Verify email credentials in Secret Manager
2. Check SMTP settings
3. Review Cloud Run logs for email errors
4. Verify recipient email: jeancalmere.kubwayo@divinebridge.io

## Manual Processing (Testing)

You can manually trigger daily report generation:

```bash
# Get auth token
TOKEN=$(gcloud auth print-identity-token)

# Trigger report generation
curl -X POST \
  https://divinebridge-853408757178.us-central1.run.app/admin/api/generate-daily-report \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

## Monitoring

### View Task Queue

```python
from google.cloud import firestore

db = firestore.Client()

# View pending admin tasks
tasks = db.collection('admin_tasks').where('status', '==', 'pending').stream()
for task in tasks:
    data = task.to_dict()
    print(f"{task.id}: {data.get('message', '')[:50]}")

# View daily task lists
task_lists = db.collection('daily_task_lists').order_by('generated_at', direction=firestore.Query.DESCENDING).limit(10).stream()
for task_list in task_lists:
    data = task_list.to_dict()
    print(f"{data.get('date')}: {len(data.get('task_list', []))} tasks")
```

### Check Recent Reports

```bash
# View in Firebase Console:
# Firestore → daily_task_lists collection
# Firestore → admin_tasks collection
```

## Schedule Details

- **Frequency**: Daily at 5pm
- **Cron Expression**: `0 17 * * *` (5pm UTC)
- **Timezone**: UTC
- **Method**: HTTP POST
- **Authentication**: OIDC (Cloud IAM)
- **Email Recipient**: jeancalmere.kubwayo@divinebridge.io

## Next Steps

1. ✅ Set up Cloud Scheduler job (daily at 5pm)
2. ✅ Create Firestore indexes
3. ✅ Test with sample admin tasks
4. ✅ Wait for 5pm or trigger manually
5. ✅ Verify email delivery to jeancalmere.kubwayo@divinebridge.io
6. ✅ Check Firestore for saved task list

