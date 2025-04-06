import os
import time
import logging
from datetime import datetime
from email_sender import EmailSender
from prayer_generator import PrayerGenerator
from dotenv import load_dotenv
from sheet_handler import SheetHandler
from apscheduler.schedulers.background import BackgroundScheduler
from config import get_config

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class PrayerScheduler:
    def __init__(self, prayer_generator, email_sender):
        """Initialize the scheduler with prayer generator and email sender"""
        try:
            self.prayer_generator = prayer_generator
            self.email_sender = email_sender
            self.sheet_handler = SheetHandler()  # Initialize SheetHandler without credentials
            
            # Initialize the scheduler
            self.scheduler = BackgroundScheduler()
            
            # Add the daily prayer job
            logger.info("Adding daily prayer job")
            self.scheduler.add_job(
                self.generate_and_send_prayers,
                'cron',
                hour=15,
                minute=30,
                id='daily_prayer_job',
                replace_existing=True
            )
            
            logger.info("Successfully initialized PrayerScheduler")
        except Exception as e:
            logger.error(f"Error initializing PrayerScheduler: {e}")
            raise

    def generate_and_send_prayers(self):
        """Generate and send prayers to all subscribers"""
        try:
            logger.info("Starting prayer generation and sending process")
            
            # Create a new SheetHandler instance for this operation
            sheet_handler = SheetHandler()
            
            # Get all subscribers
            subscribers = sheet_handler.get_subscribers()
            logger.info(f"Found {len(subscribers)} subscribers")
            
            # Generate prayer text
            logger.info("Generating prayer text")
            prayer_text = self.prayer_generator.generate_prayer()
            
            # Save prayer to Cloud Storage
            today = datetime.now().strftime("%Y-%m-%d")
            if self.prayer_generator.storage.save_prayer(today, prayer_text):
                logger.info(f"Saved prayer to Cloud Storage for {today}")
            else:
                logger.error(f"Failed to save prayer to Cloud Storage for {today}")
            
            # Send to each subscriber
            for subscriber in subscribers:
                try:
                    logger.info(f"Sending prayer to subscriber: {subscriber['email']}")
                    self.email_sender.send_daily_prayer(
                        recipient_email=subscriber['email'],
                        first_name=subscriber['first_name'],
                        prayer_text=prayer_text
                    )
                    logger.info(f"Successfully sent prayer to {subscriber['email']}")
                except Exception as e:
                    logger.error(f"Failed to send prayer to {subscriber['email']}: {str(e)}")
                    continue
            
            logger.info("Completed prayer generation and sending process")
                    
        except Exception as e:
            logger.error(f"Error in generate_and_send_prayers: {str(e)}")

    def run(self):
        """Start the scheduler and log job information"""
        try:
            self.scheduler.start()
            logger.info("Scheduler started successfully")
            
            # Log the next run time after scheduler is started
            daily_job = self.scheduler.get_job('daily_prayer_job')
            
            if daily_job:
                logger.info(f"Daily prayer job next run at: {daily_job.next_run_time}")
            else:
                logger.warning("Daily prayer job not found")
            
            # Keep the scheduler running
            try:
                while True:
                    time.sleep(1)
            except (KeyboardInterrupt, SystemExit):
                pass
        except Exception as e:
            logger.error(f"Error starting scheduler: {e}")
            raise 