# Disaster Prayer Redesign - Implementation Summary

## Overview

The disaster prayer system has been completely redesigned to be separate from the daily prayer flow. It now operates on an hourly schedule, searches for breaking news, generates customized prayers, and displays them with a modern glassmorphic design featuring country flags.

## Key Changes

### 1. New Service: `disaster_prayer_service.py`

A new service that:
- **Searches for breaking disasters** every hour using AI (Perplexity)
- **Generates customized prayers** based on actual breaking news (not generic)
- **Stores prayers separately** with 3-day expiry
- **Monitors disaster types** matching the daily prayer prompt list

**Key Features:**
- Hourly breaking news monitoring (last 3-6 hours)
- Customized prayer generation referencing specific news events
- Automatic deduplication (prevents duplicate prayers within 24 hours)
- 3-day automatic expiry for prayers
- Separate storage path: `disaster_prayers/`

### 2. New Hourly Endpoint

**Route:** `/api/disasters/generate-hourly` (POST)
- Protected by `@verify_cloud_scheduler()` decorator
- Triggered by Cloud Scheduler every hour
- Processes breaking disasters and generates customized prayers

### 3. Updated `/disasters` Page

**Changes:**
- Now fetches from new disaster prayer storage (not daily prayers)
- Shows only active prayers (within 3 days)
- Displays by country and recent events
- Modern glassmorphic card design
- Country flags displayed on each card

**Design Features:**
- Glassmorphic cards with backdrop blur
- Animated gradient background
- Country flags using flagcdn.com API
- News summary displayed on cards
- Severity-based styling (catastrophic, severe, moderate, minor)
- Responsive design

### 4. Updated Disaster Prayer Page

**Route:** `/prayers/disaster/<disaster_type>/<location>`

**Changes:**
- First checks new disaster prayer storage (3-day active prayers)
- Falls back to old cache system for backward compatibility
- Generates new prayer if neither found
- Includes country flag if available

## Cloud Scheduler Setup

To enable disaster monitoring every 4 hours, create a Cloud Scheduler job:

```bash
# Get your Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe divinebridge --region=us-central1 --format="value(status.url)")

# Create scheduler job (runs every 4 hours)
gcloud scheduler jobs create http disaster-prayer-hourly \
    --location=us-central1 \
    --schedule="0 */4 * * *" \
    --time-zone="UTC" \
    --uri="${CLOUD_RUN_URL}/api/disasters/generate-hourly" \
    --http-method=POST \
    --oidc-service-account-email=prayer-scheduler@divinebridge.iam.gserviceaccount.com \
    --oidc-token-audience="${CLOUD_RUN_URL}"
```

**Schedule:** `0 */4 * * *` (Every 4 hours at minute 0 - runs at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)

**Note:** Uses the same service account as daily prayer generation (`prayer-scheduler@divinebridge.iam.gserviceaccount.com`)

## Storage Structure

### New Disaster Prayers
- **Path:** `disaster_prayers/{disaster_type}_{country}_{timestamp}.json`
- **Expiry:** 3 days (automatic cleanup)
- **Structure:**
```json
{
  "id": "earthquake_japan_20250115_143022",
  "disaster_type": "earthquake",
  "country": "Japan",
  "location": "Tokyo",
  "severity": "severe",
  "casualties": 150,
  "news_summary": "Breaking news summary...",
  "news_source": "Source name",
  "prayer": "Customized prayer text...",
  "created_at": "2025-01-15T14:30:22",
  "expires_at": "2025-01-18T14:30:22",
  "source": "disaster_prayer_service"
}
```

### Old Cache System (Backward Compatible)
- **Path:** `cache/disaster_prayer_{disaster_type}_{location}.json`
- **Expiry:** 24 hours
- Still used as fallback for old disaster pages

## Country Flag Integration

Country flags are displayed using the `flagcdn.com` API:
- **Format:** `https://flagcdn.com/w80/{country_code}.png`
- **Mapping:** Country names are converted to ISO 3166-1 alpha-2 codes
- **Helper Function:** `get_country_flag_code()` in `routes/seo_bp.py`
- **Fallback:** Shows placeholder flag if country code not found

## Disaster Types Monitored

The service monitors these disaster types (matching daily prayer prompt):
- Natural disasters: typhoon, hurricane, cyclone, earthquake, flood, landslide, drought, wildfire, tornado, tsunami, volcano, storm
- Human crises: conflict, war, epidemic, pandemic, famine, refugee_crisis, mass_shooting, gun violence

## Key Differences from Daily Prayer Flow

| Feature | Daily Prayer | Disaster Prayers |
|---------|-------------|------------------|
| **Trigger** | Daily (midnight UTC) | Hourly |
| **Source** | Daily prayer prompt | Breaking news search |
| **Prayer Type** | Generic (covers all disasters) | Customized (specific to event) |
| **Storage** | `prayers/{date}.json` | `disaster_prayers/{id}.json` |
| **Expiry** | Permanent | 3 days |
| **Display** | Prayer Room | `/disasters` page |

## Testing

### Manual Testing

1. **Test hourly endpoint:**
```bash
curl -X POST https://your-app.run.app/api/disasters/generate-hourly \
  -H "Authorization: Bearer YOUR_TOKEN"
```

2. **Check `/disasters` page:**
- Visit `/disasters` to see active disaster prayers
- Verify glassmorphic design and country flags
- Check that prayers are sorted by severity and recency

3. **Test disaster prayer page:**
- Visit `/prayers/disaster/{type}/{location}`
- Verify it uses new storage first, then falls back to cache

### Expected Behavior

- **Hourly:** System searches for breaking disasters and generates prayers
- **3-Day Display:** Prayers automatically expire after 3 days
- **Deduplication:** Same disaster won't generate duplicate prayers within 24 hours
- **Customization:** Each prayer references specific news details

## Files Modified/Created

### Created:
- `disaster_prayer_service.py` - New service for hourly disaster monitoring

### Modified:
- `routes/seo_bp.py` - Added hourly endpoint, updated `/disasters` route, redesigned template

## Next Steps

1. **Deploy the changes** to Cloud Run
2. **Create Cloud Scheduler job** for hourly trigger
3. **Monitor logs** to ensure hourly processing works correctly
4. **Test the `/disasters` page** to verify design and functionality
5. **Verify country flags** display correctly for various countries

## Notes

- The system maintains backward compatibility with old disaster prayer cache
- Country flag mapping covers 200+ countries
- Glassmorphic design is fully responsive
- Prayers are automatically cleaned up after 3 days
- The service uses the same Perplexity client as daily prayers for consistency
