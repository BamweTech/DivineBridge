# Cloud Scheduler Setup for Divine Bridge

## Problem
The application's built-in APScheduler only runs when the Flask app is active. Since Cloud Run scales to zero when idle, prayers are not being generated automatically at UTC midnight.

## Solution
Set up Google Cloud Scheduler to trigger prayer generation daily.

---

## Setup Steps

### 1. Enable Cloud Scheduler API

```bash
gcloud services enable cloudscheduler.googleapis.com
```

### 2. Create Service Account for Scheduler

```bash
# Create service account
gcloud iam service-accounts create prayer-scheduler \
    --display-name="Prayer Scheduler Service Account"

# Grant permission to invoke Cloud Run
gcloud run services add-iam-policy-binding divinebridge \
    --region=us-central1 \
    --member=serviceAccount:prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --role=roles/run.invoker
```

### 3. Create Scheduler Job

```bash
# Daily prayer generation job
gcloud scheduler jobs create http daily-prayer-generator \
    --location=us-central1 \
    --schedule="0 0 * * *" \
    --time-zone="UTC" \
    --uri="https://divinebridge-<your-hash>-uc.a.run.app/api/prayer/generate" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="https://divinebridge-<your-hash>-uc.a.run.app"

# Weekly email sending job (Mondays at 6 AM ET)
gcloud scheduler jobs create http send-daily-emails \
    --location=us-central1 \
    --schedule="0 6 * * 1" \
    --time-zone="America/New_York" \
    --uri="https://divinebridge-<your-hash>-uc.a.run.app/api/email/send-daily-emails" \
    --http-method=POST \
    --oidc-service-account-email=divinebridge@appspot.gserviceaccount.com \
    --oidc-token-audience="https://divinebridge-<your-hash>-uc.a.run.app"

# Nightly verse-context warmer (7-day look-ahead)
# Pre-generates the AI sermon / original-language words / reflection questions
# for the next week of daily verses into Firestore `verse_contexts/{slug}`.
# Skips any verses already cached, so the cost on a normal night is near-zero.
gcloud scheduler jobs create http verse-context-warmer \
    --location=us-central1 \
    --schedule="30 0 * * *" \
    --time-zone="UTC" \
    --uri="https://divinebridge-<your-hash>-uc.a.run.app/api/today-verse/context/generate" \
    --http-method=POST \
    --message-body='{"days":7,"force":false}' \
    --headers="Content-Type=application/json" \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="https://divinebridge-<your-hash>-uc.a.run.app"

# Private prayer matching lifecycle and call reminders (every 5 minutes)
# Expires unclaimed requests after 48 hours and sends the one-hour/call-ready push.
gcloud scheduler jobs create http private-prayer-request-maintenance \
    --location=us-central1 \
    --schedule="*/5 * * * *" \
    --time-zone="UTC" \
    --uri="https://divinebridge-<your-hash>-uc.a.run.app/api/prayer/private-request/maintenance" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="https://divinebridge-<your-hash>-uc.a.run.app"

# Prayer-room cleanup (every 15 minutes). Only rooms ended over an hour ago
# are processed; active calls are never swept.
gcloud scheduler jobs create http prayer-room-cleanup \
    --location=us-central1 \
    --schedule="*/15 * * * *" \
    --time-zone="UTC" \
    --uri="https://divinebridge-<your-hash>-uc.a.run.app/api/prayer-room/cleanup" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="https://divinebridge-<your-hash>-uc.a.run.app"
```

**Note:** Replace `<your-hash>` with your actual Cloud Run service URL.

### 4. Get Your Cloud Run URL

```bash
gcloud run services describe divinebridge --region=us-central1 --format="value(status.url)"
```

### 5. Test the Scheduler Job

```bash
# Trigger manually to test
gcloud scheduler jobs run daily-prayer-generator --location=us-central1

# Check logs
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=daily-prayer-generator" --limit=10
```

---

## API Endpoint to Create

Add this endpoint to `routes/prayer_bp.py`:

```python
@prayer_bp.route('/generate', methods=['POST'])
def generate_daily_prayer():
    """
    Generate daily prayer (triggered by Cloud Scheduler)
    No authentication required (protected by Cloud IAM)
    """
    try:
        from prayer_generator import PrayerGenerator
        from storage_handler import StorageHandler
        from datetime import datetime
        
        logger.info("Cloud Scheduler triggered daily prayer generation")
        
        storage = StorageHandler()
        prayer_gen = PrayerGenerator(storage=storage)
        
        # Generate prayer
        prayer = prayer_gen.generate_prayer()
        
        if prayer:
            logger.info(f"Successfully generated prayer for {datetime.now().strftime('%Y-%m-%d')}")
            return jsonify({
                'success': True,
                'message': 'Prayer generated successfully',
                'date': prayer.get('date')
            }), 200
        else:
            logger.error("Failed to generate prayer")
            return jsonify({
                'success': False,
                'message': 'Prayer generation failed'
            }), 500
            
    except Exception as e:
        logger.error(f"Error generating daily prayer: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500
```

---

## Schedule Details

### Daily Prayer Generation
- **Frequency**: Daily at 00:00 UTC (midnight)
- **Cron Expression**: `0 0 * * *`
- **Timezone**: UTC
- **Method**: HTTP POST
- **Authentication**: OIDC (Cloud IAM)

### Weekly Email Sending
- **Frequency**: Every Monday at 6:00 AM ET
- **Cron Expression**: `0 6 * * 1`
- **Timezone**: America/New_York
- **Method**: HTTP POST
- **Authentication**: OIDC (Cloud IAM)

---

## Monitoring

### Check Scheduler Status
```bash
gcloud scheduler jobs describe daily-prayer-generator --location=us-central1
```

### View Execution History
```bash
gcloud scheduler jobs describe daily-prayer-generator --location=us-central1 --format="value(status)"
```

### View Logs
```bash
# Scheduler logs
gcloud logging read "resource.type=cloud_scheduler_job" --limit=20

# App logs for prayer generation
gcloud logging read "resource.type=cloud_run_revision AND textPayload=~\"prayer generation\"" --limit=20
```

---

## Troubleshooting

### Prayer Not Generated
1. Check if scheduler job ran:
   ```bash
   gcloud scheduler jobs describe daily-prayer-generator --location=us-central1
   ```

2. Check app logs:
   ```bash
   gcloud run services logs read divinebridge --region=us-central1 --limit=50
   ```

3. Manually trigger:
   ```bash
   gcloud scheduler jobs run daily-prayer-generator --location=us-central1
   ```

### Permission Errors
If you see 403 errors, ensure the service account has the correct permissions:
```bash
gcloud run services add-iam-policy-binding divinebridge \
    --region=us-central1 \
    --member=serviceAccount:prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --role=roles/run.invoker
```

---

## Audit Log Format Migration (Action Required by Sep 30, 2026)

Google notified that Cloud Scheduler is migrating to a new GFE-format audit log structure. Enforcement starts **September 30, 2026**.

**Current status:** This project does not parse Cloud Scheduler audit logs, so no code changes are required at this time.

If audit log parsing is added in the future, use the **new payload structure**:

### Authorization Info — New Structure
```json
"authorizationInfo": [
  {
    "resource": "projects/divinebridge/locations/us-central1/jobs/daily-prayer-generator",
    "permission": "cloudscheduler.jobs.create",
    "granted": true,
    "resourceAttributes": {
      "service": "cloudscheduler.googleapis.com",
      "name": "projects/divinebridge/locations/us-central1/jobs/daily-prayer-generator"
    },
    "permissionType": "ADMIN_WRITE"
  }
]
```

### Retry Config — New Structure (snake_case with nested duration objects)
```json
"retry_config": {
  "max_backoff_duration": { "seconds": 3600 },
  "min_backoff_duration": { "seconds": 5 },
  "max_retry_duration": {},
  "max_doublings": 5
}
```

Key differences from the old format:
- `resource` field now uses the full resource path instead of an opaque ID
- `resourceAttributes` object added with `service` and `name` fields
- Retry config keys use `snake_case` instead of `camelCase`
- Duration values are nested objects (`{ "seconds": N }`) instead of strings (`"5s"`)
- `callerIp` will contain a default/placeholder value until the old log format is removed

---

## Cost Estimate

- Cloud Scheduler: $0.10/month per job (3 free jobs per account)
- Cloud Run invocations: Minimal (1 per day, likely covered by free tier)

**Total estimated cost: ~$0.10/month or FREE if within free tier**

---

## Migration from APScheduler

Once Cloud Scheduler is set up and tested:

1. Remove APScheduler from `requirements.txt`
2. Remove scheduler initialization from `app.py`
3. Delete `scheduler.py` (no longer needed)

The application will be simpler and more reliable with Cloud Scheduler handling the cron job externally.

