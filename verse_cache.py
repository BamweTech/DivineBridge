import json
import logging
import os
from datetime import datetime, timedelta
from verse_generator import verse_generator

logger = logging.getLogger(__name__)

def _get_redis_client():
    """Create a Redis client for shared caching across instances. Returns None if unavailable."""
    try:
        import redis
        client = redis.Redis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', 6379)),
            password=os.getenv('REDIS_PASSWORD'),
            decode_responses=True,
            socket_connect_timeout=2,
        )
        client.ping()
        return client
    except Exception:
        return None


class VerseCache:
    REDIS_PREFIX = "divinebridge:verse:"
    REDIS_TTL = 86400  # 24 hours

    def __init__(self):
        self._local_cache = {}
        self._local_expiry = datetime.now() + timedelta(hours=24)
        self._redis = _get_redis_client()
        if self._redis:
            logger.info("VerseCache using Redis for cross-instance caching")
        else:
            logger.info("VerseCache using in-process cache (Redis unavailable)")

    def _redis_get(self, key):
        if not self._redis:
            return None
        try:
            raw = self._redis.get(f"{self.REDIS_PREFIX}{key}")
            return json.loads(raw) if raw else None
        except Exception:
            return None

    def _redis_set(self, key, value):
        if not self._redis:
            return
        try:
            self._redis.setex(f"{self.REDIS_PREFIX}{key}", self.REDIS_TTL, json.dumps(value))
        except Exception:
            pass

    def get_today_verse(self, day_of_year=None):
        """Get today's verse from cache or generate a new one.

        Args:
            day_of_year: Optional day of year (1-366) to use instead of server's date
        """
        try:
            if day_of_year is not None:
                today = f"day-{day_of_year}"
            else:
                today = datetime.now().strftime('%Y-%m-%d')
                day_of_year = datetime.now().timetuple().tm_yday

            # Check local in-process cache (fast path)
            if datetime.now() > self._local_expiry:
                self._local_cache = {}
                self._local_expiry = datetime.now() + timedelta(hours=24)

            if today in self._local_cache:
                return self._local_cache[today]

            # Check Redis (shared across instances)
            verse = self._redis_get(today)
            if verse:
                self._local_cache[today] = verse
                return verse

            # Generate from source
            verse = verse_generator.get_daily_verse(day_of_year=day_of_year)
            if verse:
                self._local_cache[today] = verse
                self._redis_set(today, verse)
                logger.info("Verse generated and cached")
                return verse

            logger.warning(f"No verse found for {today}")
            return None

        except Exception as e:
            logger.error(f"Error in get_today_verse: {str(e)}")
            return None


verse_cache = VerseCache()