---
name: prayer-check
description: >-
  Check for today's prayer in storage before generating a new one. Use proactively
  whenever prayer generation, daily content, or prayer-related features are being
  worked on.
---

# Prayer Content Check

Before generating or modifying any prayer content, always check if today's prayer already exists.

## Check procedure

1. Identify today's date in `YYYY-MM-DD` format.
2. Check storage for existing prayer:
   - The `get_daily_prayer_for_date(date_str)` helper (see `backend/web/daily_prayer.py` / `app.py`) handles the full lookup chain: in-process cache → Redis cache → storage.
   - `backend.services.prayer.prayer_generator.PrayerGenerator` generates prayers via Perplexity AI.
   - Storage is either GCS (`backend.integrations.storage_handler`) or local (`backend.integrations.local_storage` when `USE_LOCAL_STORAGE=true`).

3. If a prayer exists for today: **do not generate a new one**. Return the existing prayer.
4. If no prayer exists and it is today's date: generate via `PrayerGenerator.generate_prayer()`.
5. If no prayer exists and it is a past date: do not auto-generate. Log and return None.

## Prayer data shape

```python
{
    'content': 'Prayer text...',
    'date': '2026-04-07',
    'source': 'generated'
}
```

The `source` must be `'generated'` and `title` must be absent for it to qualify as a daily prayer.

## Caching layers

1. **In-process**: `_daily_prayer_local_cache` dict in `app.py`, reset on date change.
2. **Redis**: `divinebridge:prayer:{date}` key with 24h TTL, shared across Cloud Run instances.
3. **Storage**: GCS bucket or local filesystem (source of truth).

## When modifying prayer logic

- Check `backend/services/prayer/prayer_generator.py` for the generation pipeline.
- Check `get_daily_prayer_for_date()` for the caching/retrieval flow.
- Check `backend/api/prayer_bp.py` for the API endpoint.
- Scheduled generation is configured in `docs/deployment/CLOUD_SCHEDULER_SETUP.md`.
