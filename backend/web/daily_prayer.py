"""Daily prayer cache helpers for the home page."""
from __future__ import annotations

import json as _json
import logging
import os
from datetime import datetime

import redis
from flask import current_app

logger = logging.getLogger(__name__)

_daily_prayer_local_cache = {}
_daily_prayer_local_date = None


def _get_prayer_redis():
    """Return a Redis client for prayer caching, or None."""
    try:
        host = os.getenv("REDIS_HOST")
        if not host:
            return None
        client = redis.Redis(
            host=host,
            port=int(os.getenv("REDIS_PORT", 6379)),
            password=os.getenv("REDIS_PASSWORD"),
            decode_responses=True,
            socket_connect_timeout=2,
        )
        client.ping()
        return client
    except Exception:
        return None


_prayer_redis = _get_prayer_redis()


def get_daily_prayer_for_date(date_str):
    """Get daily prayer for a specific date with caching.
    If prayer doesn't exist and it's today's date, attempt to generate it."""
    global _daily_prayer_local_cache, _daily_prayer_local_date

    if _daily_prayer_local_date != date_str:
        _daily_prayer_local_cache = {}
        _daily_prayer_local_date = date_str

    if date_str in _daily_prayer_local_cache:
        return _daily_prayer_local_cache[date_str]

    redis_key = f"divinebridge:prayer:{date_str}"
    if _prayer_redis:
        try:
            raw = _prayer_redis.get(redis_key)
            if raw:
                cached = _json.loads(raw)
                _daily_prayer_local_cache[date_str] = cached
                return cached
        except Exception:
            pass

    try:
        storage_handler = current_app.storage_handler
        prayer_generator = current_app.prayer_generator
        daily_prayer = storage_handler.get_prayer(date_str)

        if not daily_prayer:
            today = datetime.now().strftime("%Y-%m-%d")
            if date_str == today:
                logger.info(f"No prayer found for today ({date_str}), attempting to generate one...")
                try:
                    new_prayer = prayer_generator.generate_prayer()
                    if new_prayer:
                        logger.info(f"Successfully generated prayer for {date_str}")
                        daily_prayer = new_prayer
                    else:
                        logger.error(f"Failed to generate prayer for {date_str}")
                except Exception as gen_error:
                    logger.error(f"Error generating prayer for {date_str}: {gen_error}", exc_info=True)
            else:
                logger.info(f"No prayer found in storage for date: {date_str} (not today, won't auto-generate)")

        if daily_prayer:
            is_daily_prayer = daily_prayer.get("source") == "generated" and not daily_prayer.get("title")
            if is_daily_prayer:
                if "content" in daily_prayer and daily_prayer["content"]:
                    import re

                    daily_prayer["content"] = re.sub(r"\[\d+\]", "", daily_prayer["content"])
                    daily_prayer["content"] = re.sub(r"[ \t]+", " ", daily_prayer["content"])
                    daily_prayer["content"] = daily_prayer["content"].strip()
            else:
                logger.warning(
                    f"Prayer found for {date_str} but it's not a daily prayer "
                    f"(source={daily_prayer.get('source')}, title={daily_prayer.get('title')})"
                )
                daily_prayer = None

        _daily_prayer_local_cache[date_str] = daily_prayer
        if _prayer_redis and daily_prayer:
            try:
                _prayer_redis.setex(redis_key, 86400, _json.dumps(daily_prayer))
            except Exception:
                pass
        return daily_prayer
    except Exception as e:
        logger.error(f"Error fetching daily prayer for {date_str}: {e}", exc_info=True)
        return None
