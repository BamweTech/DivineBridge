import logging
from datetime import datetime, timedelta
from verse_generator import verse_generator

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class VerseCache:
    def __init__(self):
        self.cache = {}
        self.cache_expiry = datetime.now() + timedelta(hours=24)
        
    def get_today_verse(self):
        """Get today's verse from cache or generate a new one."""
        try:
            today = datetime.now().strftime('%Y-%m-%d')
            
            # Check if cache is expired
            if datetime.now() > self.cache_expiry:
                self.cache = {}
                self.cache_expiry = datetime.now() + timedelta(hours=24)
            
            # Check cache first
            if today in self.cache:
                logger.info("Verse found in cache")
                return self.cache[today]
            
            # If not in cache, get a new verse
            verse = verse_generator.get_daily_verse()
            if verse:
                # Store in cache
                self.cache[today] = verse
                logger.info("Verse stored in cache")
                return verse
            
            logger.warning(f"No verse found for {today}")
            return None
            
        except Exception as e:
            logger.error(f"Error in get_today_verse: {str(e)}")
            return None

# Create a singleton instance
verse_cache = VerseCache() 