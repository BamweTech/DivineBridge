# Admin AI Automation Setup Guide

## Overview

The Admin AI Assistant now features **fully automated processing**:
1. Tasks are queued in Firestore
2. Cloud Scheduler triggers processing every 5 minutes
3. AI automatically analyzes logs, implements fixes, and deploys
4. Email summary sent after completion

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

# Create scheduler job (runs every 5 minutes)
gcloud scheduler jobs create http process-admin-tasks \
    --location=us-central1 \
    --schedule="*/5 * * * *" \
    --time-zone="UTC" \
    --uri="${CLOUD_RUN_URL}/admin/api/process-queue" \
    --http-method=POST \
    --oidc-service-account-email=admin-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="${CLOUD_RUN_URL}"
```

### Step 3: Test the Scheduler

```bash
# Trigger manually to test
gcloud scheduler jobs run process-admin-tasks --location=us-central1

# Check logs
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=process-admin-tasks" --limit=10
```

## Firestore Index Setup

### Required Index

Create a composite index for `admin_tasks` collection:

**Index Name:** `admin_tasks_status_created_at`

**Fields:**
- `status` (Ascending)
- `created_at` (Ascending)

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

### Task Flow

```
1. Admin posts task → Added to Firestore queue (status: 'pending')
   ↓
2. Cloud Scheduler triggers every 5 minutes
   ↓
3. Processing endpoint finds pending tasks
   ↓
4. For each task:
   a. Mark as 'processing'
   b. Fetch logs (last hour)
   c. Analyze errors and issues
   d. Identify issues from message keywords
   e. Implement fixes
   f. Commit changes to git
   g. Deploy to Cloud Run
   h. Create summary
   i. Send email
   j. Mark as 'completed'
```

### Task Statuses

- **pending**: Task queued, waiting for processing
- **processing**: Currently being processed
- **completed**: Successfully processed and deployed
- **failed**: Processing failed (error logged)

## Automated Fixes

The system can automatically fix:

### Authentication Issues
- Token expiration handling
- Session management verification

### Audio/WebRTC Issues
- Connection handling verification
- TURN server configuration checks

### Scheduler Issues
- Firestore index detection
- Import error detection

### Database Issues
- Index requirement detection
- Permission issue detection

## Security

- **Cloud Scheduler Protection**: Endpoint verified via OIDC token
- **Passcode Protection**: Admin login still required
- **Firestore Security**: Tasks stored securely in Firestore
- **Git Access**: Service account needs Cloud Source Repositories access for commits

## Required Permissions

The Cloud Run service account needs:
- `logging.logEntries.list` - Read Cloud Logging
- `firestore.databases.get` - Access Firestore
- `source.repos.get` - Read git repository
- `source.repos.commit` - Commit changes
- `run.services.update` - Deploy to Cloud Run

## Troubleshooting

### Tasks Not Processing

1. Check Cloud Scheduler job is running:
   ```bash
   gcloud scheduler jobs describe process-admin-tasks --location=us-central1
   ```

2. Check Cloud Run logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND textPayload=~'admin'" --limit=20
   ```

3. Verify Firestore index exists:
   ```bash
   gcloud firestore indexes list
   ```

### Deployment Fails

1. Check git permissions
2. Verify gcloud CLI is available in Cloud Run
3. Check Cloud Build service account permissions

### Email Not Sending

1. Verify email credentials in Secret Manager
2. Check SMTP settings
3. Review Cloud Run logs for email errors

## Manual Processing (Testing)

You can manually trigger processing:

```bash
# Get auth token
TOKEN=$(gcloud auth print-identity-token)

# Trigger processing
curl -X POST \
  https://divinebridge-853408757178.us-central1.run.app/admin/api/process-queue \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

## Monitoring

### View Task Queue

```python
from google.cloud import firestore

db = firestore.Client()
tasks = db.collection('admin_tasks').stream()

for task in tasks:
    data = task.to_dict()
    print(f"{task.id}: {data.get('status')} - {data.get('message', '')[:50]}")
```

### Check Recent Tasks

```bash
# View pending tasks
gcloud firestore databases get --database=(default)

# Or use Firebase Console:
# Firestore → admin_tasks collection
```

## Schedule Details

- **Frequency**: Every 5 minutes
- **Cron Expression**: `*/5 * * * *`
- **Timezone**: UTC
- **Method**: HTTP POST
- **Authentication**: OIDC (Cloud IAM)

## Next Steps

1. ✅ Set up Cloud Scheduler job
2. ✅ Create Firestore index
3. ✅ Test with a sample task
4. ✅ Monitor first automated processing
5. ✅ Verify email delivery

