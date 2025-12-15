# Disaster Prayer Redesign - Deployment Guide

## Date: January 15, 2025

## Overview

This deployment includes:
1. New `disaster_prayer_service.py` - Hourly breaking news monitoring
2. Updated `/disasters` page with glassmorphic design and country flags
3. New hourly endpoint `/api/disasters/generate-hourly`
4. Enhanced prompts for breaking news search and customized prayer generation

---

## Pre-Deployment Checklist

- [x] Code reviewed and tested locally
- [x] No linting errors
- [x] All imports verified
- [x] Prompts documented
- [x] Backward compatibility maintained
- [ ] Cloud Scheduler service account verified
- [ ] Perplexity API key configured in Secret Manager

---

## Step 1: Deploy to Cloud Run

```bash
# Navigate to project directory
cd /Users/jeancalmerekubwayo/Documents/divineBridge

# Set project
gcloud config set project divinebridge

# Deploy to Cloud Run
gcloud run deploy divinebridge \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --min-instances 0 \
  --port 5001

# Get the service URL
CLOUD_RUN_URL=$(gcloud run services describe divinebridge \
  --region us-central1 \
  --format="value(status.url)")

echo "Deployed to: $CLOUD_RUN_URL"
```

---

## Step 2: Verify Service Account

The hourly disaster prayer endpoint uses the same service account as daily prayer generation.

```bash
# Check if service account exists
gcloud iam service-accounts describe prayer-scheduler@divinebridge.iam.gserviceaccount.com

# If it doesn't exist, create it:
gcloud iam service-accounts create prayer-scheduler \
  --display-name="Prayer Scheduler Service Account"

# Grant permission to invoke Cloud Run
gcloud run services add-iam-policy-binding divinebridge \
  --region=us-central1 \
  --member=serviceAccount:prayer-scheduler@divinebridge.iam.gserviceaccount.com \
  --role=roles/run.invoker
```

---

## Step 3: Create Cloud Scheduler Job for Hourly Disaster Monitoring

```bash
# Get Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe divinebridge \
  --region us-central1 \
  --format="value(status.url)")

# Create hourly scheduler job
gcloud scheduler jobs create http disaster-prayer-hourly \
  --location=us-central1 \
  --schedule="0 * * * *" \
  --time-zone="UTC" \
  --uri="${CLOUD_RUN_URL}/api/disasters/generate-hourly" \
  --http-method=POST \
  --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
  --oidc-token-audience="${CLOUD_RUN_URL}" \
  --description="Hourly breaking news search and disaster prayer generation"

# Verify the job was created
gcloud scheduler jobs describe disaster-prayer-hourly --location=us-central1
```

**Schedule Details:**
- **Cron:** `0 * * * *` (Every hour at minute 0)
- **Timezone:** UTC
- **Endpoint:** `/api/disasters/generate-hourly`
- **Method:** POST

---

## Step 4: Test the Deployment

### Test 1: Verify Endpoint is Accessible

```bash
# Test the endpoint manually (should fail without auth, but verify it exists)
curl -X POST "${CLOUD_RUN_URL}/api/disasters/generate-hourly" \
  -H "Content-Type: application/json" \
  -v
```

Expected: 403 Forbidden (correct - endpoint is protected)

### Test 2: Test via Cloud Scheduler (Manual Trigger)

```bash
# Manually trigger the scheduler job to test
gcloud scheduler jobs run disaster-prayer-hourly --location=us-central1

# Check logs immediately after
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=disaster-prayer-hourly" \
  --limit=10 \
  --format=json
```

### Test 3: Verify /disasters Page

```bash
# Visit the disasters page
open "${CLOUD_RUN_URL}/disasters"
```

Expected:
- Page loads without errors
- Glassmorphic design displays correctly
- Country flags appear (if disasters exist)
- Responsive design works on mobile

### Test 4: Check Logs

```bash
# View recent Cloud Run logs
gcloud run services logs read divinebridge \
  --region us-central1 \
  --limit=50

# Filter for disaster prayer service logs
gcloud logging read "resource.type=cloud_run_revision AND textPayload=~\"disaster\"" \
  --limit=20
```

---

## Step 5: Monitor First Hourly Run

After deployment, wait for the next hour (when minute = 0) and monitor:

```bash
# Watch logs in real-time
gcloud logging tail "resource.type=cloud_run_revision" \
  --format="table(timestamp,textPayload)" \
  --filter='textPayload=~"disaster" OR textPayload=~"breaking"'

# Or check scheduler execution logs
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=disaster-prayer-hourly" \
  --limit=5 \
  --format=json
```

**What to Look For:**
- ✅ "Cloud Scheduler triggered hourly disaster prayer generation"
- ✅ "Found X breaking disasters"
- ✅ "Generated prayer for {type} in {country}"
- ✅ "Hourly processing complete: X prayers generated"

---

## Post-Deployment Verification

### Immediate Checks (First 5 minutes):

- [ ] Visit `${CLOUD_RUN_URL}/disasters` - page loads
- [ ] Check Cloud Run logs - no errors
- [ ] Verify scheduler job exists and is enabled
- [ ] Test manual trigger of scheduler job

### Within 1 Hour:

- [ ] Check if hourly job ran successfully
- [ ] Verify disaster prayers are being generated
- [ ] Check `/disasters` page shows new prayers (if any found)
- [ ] Verify country flags display correctly
- [ ] Test glassmorphic design on different browsers

### Within 24 Hours:

- [ ] Monitor hourly runs (should run 24 times)
- [ ] Check storage for `disaster_prayers/` folder
- [ ] Verify 3-day expiry is working (check old prayers are deleted)
- [ ] Review generated prayers for quality
- [ ] Check for any errors in logs

---

## Troubleshooting

### Issue: Scheduler Job Fails

**Check:**
```bash
# View scheduler job details
gcloud scheduler jobs describe disaster-prayer-hourly --location=us-central1

# Check execution history
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=disaster-prayer-hourly" \
  --limit=10 \
  --format=json
```

**Common Causes:**
- Service account doesn't have `run.invoker` role
- Cloud Run URL incorrect
- Endpoint path incorrect

### Issue: No Disasters Found

**Check:**
- Perplexity API is working
- Prompts are effective (see `docs/DISASTER_PRAYER_PROMPTS.md`)
- Breaking disasters actually exist in last 3-6 hours
- Check logs for parsing errors

### Issue: Country Flags Not Displaying

**Check:**
- Country flag code mapping in `routes/seo_bp.py`
- Flag API (flagcdn.com) is accessible
- Country names are properly formatted

### Issue: Prayers Not Customized

**Check:**
- `news_summary` field contains details
- Prayer generation prompt is using news summary
- Review generated prayers in storage

---

## Rollback Plan

If issues occur, you can:

1. **Disable the scheduler job:**
```bash
gcloud scheduler jobs pause disaster-prayer-hourly --location=us-central1
```

2. **Rollback Cloud Run deployment:**
```bash
# List revisions
gcloud run revisions list --service divinebridge --region us-central1

# Rollback to previous revision
gcloud run services update-traffic divinebridge \
  --region us-central1 \
  --to-revisions PREVIOUS-REVISION-NAME=100
```

3. **Delete scheduler job:**
```bash
gcloud scheduler jobs delete disaster-prayer-hourly --location=us-central1
```

---

## Monitoring Commands

### Check Scheduler Status
```bash
gcloud scheduler jobs list --location=us-central1
```

### View Recent Executions
```bash
gcloud logging read "resource.type=cloud_scheduler_job AND resource.labels.job_id=disaster-prayer-hourly" \
  --limit=10 \
  --format="table(timestamp,jsonPayload.status.code,textPayload)"
```

### Check Disaster Prayers Generated
```bash
# List disaster prayer files in storage
gsutil ls gs://divinebridge-storage/disaster_prayers/
```

### Monitor Cloud Run Performance
```bash
gcloud run services describe divinebridge \
  --region us-central1 \
  --format="table(status.conditions,status.url,status.latestReadyRevisionName)"
```

---

## Success Criteria

✅ Deployment successful:
- Cloud Run service updated
- No deployment errors
- Service is healthy

✅ Scheduler configured:
- Job created and enabled
- Service account has correct permissions
- Schedule is correct (hourly)

✅ Functionality working:
- Hourly endpoint responds (with auth)
- Breaking news search works
- Customized prayers generated
- `/disasters` page displays correctly
- Country flags show correctly

✅ Monitoring in place:
- Logs accessible
- Scheduler executions visible
- Storage accessible

---

## Next Steps After Deployment

1. **Monitor first few hourly runs** to ensure everything works
2. **Review generated prayers** for quality and customization
3. **Check `/disasters` page** regularly to see new prayers
4. **Adjust prompts if needed** based on results
5. **Set up alerts** for scheduler failures (optional)

---

## Related Documentation

- `docs/DISASTER_PRAYER_REDESIGN.md` - Feature overview
- `docs/DISASTER_PRAYER_PROMPTS.md` - Prompt documentation
- `docs/deployment/CLOUD_SCHEDULER_SETUP.md` - General scheduler setup

---

**Deployment Date:** _______________  
**Deployed By:** _______________  
**Cloud Run URL:** _______________  
**Scheduler Job:** disaster-prayer-hourly  
**Status:** _______________
