import os
import schedule
import time
import logging
from datetime import datetime
from email_sender import EmailSender
from prayer_generator import PrayerGenerator
from dotenv import load_dotenv
from sheet_handler import SheetHandler

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class PrayerScheduler:
    def __init__(self, prayer_generator, email_sender):
        """Initialize the scheduler with prayer generator and email sender"""
        self.prayer_generator = prayer_generator
        self.email_sender = email_sender
        self.sheet_handler = SheetHandler('divinebridge-676c7c0963dd.json')  # Initialize SheetHandler with credentials
        self.scheduler = schedule.Scheduler()
        
        # Schedule daily prayer
        self.scheduler.every().day.at("22:25").do(self.generate_and_send_prayers)
        
        # For testing: run immediately and then every 5 minutes
        # self.scheduler.every(5).minutes.do(self.generate_and_send_prayers)
        # self.generate_and_send_prayers()  # Run immediately for testing
        
        logger.info("PrayerScheduler initialized successfully")

    def generate_and_send_prayers(self):
        """Generate and send prayers to all subscribers"""
        try:
            # Get all subscribers
            subscribers = self.sheet_handler.get_subscribers()
            
            # Generate prayer text
            prayer_text = self.prayer_generator.generate_prayer()
            
            # Save prayer text to file
            today = datetime.now().strftime("%Y-%m-%d")
            prayer_file = f"prayers/{today}.txt"
            os.makedirs("prayers", exist_ok=True)
            with open(prayer_file, "w") as f:
                f.write(prayer_text)
            logger.info(f"Saved prayer to {prayer_file}")
            
            # Send to each subscriber
            for subscriber in subscribers:
                try:
                    self.email_sender.send_daily_prayer(
                        recipient_email=subscriber['email'],
                        first_name=subscriber['first_name'],
                        prayer_text=prayer_text
                    )
                    logger.info(f"Successfully sent prayer to {subscriber['email']}")
                except Exception as e:
                    logger.error(f"Failed to send prayer to {subscriber['email']}: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.error(f"Error in generate_and_send_prayers: {str(e)}")

    def run(self):
        """
        Run the prayer scheduler.
        """
        try:
            logger.info("Prayer scheduler started")
            logger.info(f"Next prayer will be sent at: {self.scheduler.next_run}")
            
            while True:
                self.scheduler.run_pending()
                current_time = datetime.now().strftime("%H:%M:%S")
                logger.debug(f"Current time: {current_time}, Next run: {self.scheduler.next_run}")
                print(self.scheduler.jobs)
                time.sleep(60)
                
        except Exception as e:
            logger.error(f"Error running prayer scheduler: {e}")
            raise 