import os
import schedule
import time
import logging
from datetime import datetime
from email_sender import EmailSender
from prayer_generator import PrayerGenerator
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class PrayerScheduler:
    def __init__(self):
        """
        Initialize the PrayerScheduler with EmailSender and PrayerGenerator instances.
        """
        try:
            self.email_sender = EmailSender()
            self.prayer_generator = PrayerGenerator()
            logger.info("PrayerScheduler initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing PrayerScheduler: {e}")
            raise

    def generate_and_send_prayers(self):
        """
        Generate and send daily prayers to all subscribers.
        """
        try:
            logger.info("Starting daily prayer generation and sending process")
            
            # Generate prayer for today
            prayer = self.prayer_generator.generate_prayer()
            
            # Send prayer to all subscribers
            self.email_sender.send_daily_prayer()
            
            logger.info("Daily prayer generation and sending process completed")
            
        except Exception as e:
            logger.error(f"Error in generate_and_send_prayers: {e}")
            raise

    def run(self):
        """
        Run the prayer scheduler.
        """
        try:
            # Schedule daily prayer email at 8:00 AM
            schedule.every().day.at("08:00").do(self.generate_and_send_prayers)
            
            logger.info("Prayer scheduler started")
            
            while True:
                schedule.run_pending()
                time.sleep(60)
                
        except Exception as e:
            logger.error(f"Error running prayer scheduler: {e}")
            raise 