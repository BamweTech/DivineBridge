# Daily Prayer Generation Fix - November 22, 2025

## Issue Summary

The daily prayer was not generated on November 22, 2025. Investigation revealed that Cloud Scheduler successfully triggered the prayer generation endpoint at midnight UTC, but all 3 retry attempts failed validation.

## Root Cause

The Perplexity AI model (`sonar-reasoning-pro`) was not consistently following the prompt requirements, specifically:
1. **Attempt 1**: Prayer was too long (296 words, max 270)
2. **Attempt 2**: Prayer didn't end with required ending (ended with "and embody Your love in every response.")
3. **Attempt 3**: Prayer didn't end with required ending (ended with "us always.")

All attempts failed validation, resulting in HTTP 500 error and no prayer being saved.

## Fixes Implemented

### 1. Increased Retry Attempts
- Changed `max_retries` from 3 to 5 in `prayer_generator.py`
- Gives the AI more chances to generate a valid prayer

### 2. Added Automatic Ending Fix
- New `_fix_prayer_ending()` method that attempts to fix common ending issues before validation
- If the prayer has "In Jesus" or "Amen" near the end but not the exact required ending, it tries to fix it automatically
- This provides a fallback when the AI is close but not exact

### 3. Strengthened Prompt
- Added more explicit warnings (⚠️) about the ending requirement
- Made it clear that variations like "In Jesus' name" are not acceptable
- Emphasized that the exact text "In Jesus-Christ's name we pray. Amen!" is required

### 4. Improved Retry Prompt
- Added stronger language in retry prompts when validation fails
- Provides exact text to copy for the ending
- Makes it clear that the prayer will be rejected again if requirements aren't met

## Files Modified

- `prayer_generator.py`:
  - Increased `max_retries` from 3 to 5
  - Added `_fix_prayer_ending()` method
  - Strengthened default prompt with more explicit ending requirements
  - Improved retry prompt with stronger language

## Next Steps

1. **Test locally** to ensure the fixes work correctly
2. **Deploy to production** after local testing
3. **Monitor** the next scheduled run (midnight UTC) to verify it succeeds
4. **Manually trigger** today's prayer generation to create the missing prayer for November 22, 2025

## Manual Trigger Command

To manually trigger prayer generation for today:

```bash
# Using curl (requires Cloud Scheduler authentication)
curl -X POST https://divinebridge-853408757178.us-central1.run.app/api/prayer/generate \
  -H "User-Agent: Google-Cloud-Scheduler" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"

# Or use Cloud Scheduler to trigger manually
gcloud scheduler jobs run daily-prayer-generator --location=us-central1
```

## Monitoring

To monitor future prayer generation:

```bash
# Check Cloud Scheduler execution logs
gcloud logging read "resource.type=cloud_scheduler_job AND jsonPayload.jobName=projects/divinebridge/locations/us-central1/jobs/daily-prayer-generator" --limit=10

# Check app logs for prayer generation
gcloud run services logs read divinebridge --region us-central1 --limit 100 | grep -i "prayer\|generate"
```

## Expected Behavior After Fix

- Prayer generation should succeed within 5 retry attempts
- Automatic ending fix should catch and correct most ending issues
- Stronger prompts should result in better compliance with requirements
- If all 5 attempts fail, the error will be logged with detailed information

