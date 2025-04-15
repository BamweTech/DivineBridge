from datetime import datetime, timedelta
import time
import logging
from storage_handler import StorageHandler
from sheet_handler import SheetHandler
from email_sender import EmailSender
from prayer_generator import PrayerGenerator
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
from config import get_config

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class PrayerScheduler:
    def __init__(self, prayer_generator, email_sender=None):
        """
        Initialize the prayer scheduler.
        
        Args:
            prayer_generator: PrayerGenerator instance
            email_sender: Optional EmailSender instance. If None, a new instance will be created.
        """
        self.prayer_generator = prayer_generator
        self.storage = StorageHandler()
        self.sheet_handler = SheetHandler()
        self.email_service = email_sender or EmailSender()
        
    def run(self):
        """
        Run the prayer scheduler loop.
        """
        while True:
            try:
                # Get current time
                now = datetime.now()
                
                # Check if it's time to generate and send prayers
                if now.hour == 0 and now.minute == 0:
                    # Generate today's prayer
                    prayer = self.prayer_generator.generate_prayer()
                    if prayer:
                        # Store prayer
                        today = now.strftime('%Y-%m-%d')
                        self.storage.store_prayer(today, prayer)
                        
                        # Send prayers to subscribers
                        self.sheet_handler.send_daily_prayers(prayer)
                        
                        logger.info(f"Generated and sent prayer for {today}")
                    else:
                        logger.error("Failed to generate prayer")
                
                # Sleep for 1 minute
                time.sleep(60)
                
            except Exception as e:
                logger.error(f"Error in prayer scheduler: {e}")
                time.sleep(60)  # Sleep for 1 minute before retrying 