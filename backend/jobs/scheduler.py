import os
import time
import logging
from datetime import datetime
from dotenv import load_dotenv
from backend.services.email.sheet_handler import SheetHandler
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.memory import MemoryJobStore
from google.api_core import retry
import requests
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_MISSED

# Set up logging
logger = logging.getLogger(__name__)
logger.propagate = False  # Prevent duplicate logs
if not logger.handlers:  # Only add handler if none exists
    handler = logging.StreamHandler()
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

# Load environment variables
load_dotenv()


class PrayerScheduler:
    def __init__(self, prayer_generator, email_service):
        """Initialize the scheduler with prayer generator and email service"""
        try:
            self.prayer_generator = prayer_generator
            self.email_service = email_service

            # Initialize sheet handler with error handling
            try:
                self.sheet_handler = SheetHandler()
                logger.info("Successfully initialized SheetHandler in scheduler")
            except Exception as e:
                logger.error(f"Failed to initialize SheetHandler in scheduler: {e}")
                self.sheet_handler = None

            # Get timezone from environment or use UTC
            self.timezone = os.getenv("TIMEZONE", "UTC")

            # Initialize the scheduler with memory job store
            self.scheduler = BackgroundScheduler(jobstores={"default": MemoryJobStore()}, timezone=self.timezone)

            # Add error handler for job execution
            self.scheduler.add_listener(self._handle_job_error, EVENT_JOB_ERROR | EVENT_JOB_MISSED)

            # Add the daily prayer job - runs at UTC midnight
            logger.info("Adding daily prayer job (UTC midnight)")
            self.scheduler.add_job(
                self.generate_and_send_prayers,
                "cron",
                hour=0,
                minute=0,
                id="daily_prayer_job",
                replace_existing=True,
                misfire_grace_time=3600,  # Allow job to run up to 1 hour late
                coalesce=True,  # Combine multiple missed runs into one
                timezone="UTC",  # Always use UTC for consistent global generation
            )

            logger.info("Successfully initialized PrayerScheduler")

            # Check if today's prayer needs to be sent
            self._check_todays_prayer()

        except Exception as e:
            logger.error(f"Error initializing PrayerScheduler: {e}")
            # Don't raise the exception, allow the scheduler to start with degraded functionality

    def _handle_job_error(self, event):
        """Handle job execution errors"""
        if event.exception:
            logger.error(f"Job {event.job_id} failed with error: {event.exception}")
            logger.error(f"Traceback: {event.traceback}")

            # Attempt to recover by checking if prayer exists
            if event.job_id == "daily_prayer_job":
                self._check_todays_prayer()
        else:
            logger.warning(f"Job {event.job_id} missed its scheduled time")

    def _check_todays_prayer(self):
        """Check if today's prayer has been sent and send if needed"""
        try:
            today = datetime.now().strftime("%Y-%m-%d")
            prayer_text = self.prayer_generator.storage.get_prayer(today)

            if not prayer_text:
                logger.info("Today's prayer not found, generating and sending now")
                self.generate_and_send_prayers()
            else:
                logger.info("Today's prayer already exists")
        except Exception as e:
            logger.error(f"Error checking today's prayer: {e}")
            # Attempt to generate new prayer as fallback
            try:
                self.generate_and_send_prayers()
            except Exception as fallback_error:
                logger.error(f"Fallback prayer generation failed: {fallback_error}")

    @retry.Retry(
        predicate=retry.if_exception_type(
            (
                requests.exceptions.SSLError,
                requests.exceptions.ConnectionError,
                requests.exceptions.Timeout,
                requests.exceptions.ReadTimeout,
            )
        ),
        initial=1.0,
        maximum=60.0,
        multiplier=2,
        deadline=300.0,
    )
    def generate_and_send_prayers(self):
        """Generate and send prayers to all subscribers"""
        try:
            # Generate today's prayer
            prayer = self.prayer_generator.generate_prayer()
            if not prayer:
                logger.error("Failed to generate prayer")
                return

            # Get subscribers if sheet handler is available
            subscribers = []
            if self.sheet_handler:
                try:
                    subscribers = self.sheet_handler.get_subscribers()
                except Exception as e:
                    logger.error(f"Failed to get subscribers: {e}")

            # Send prayer to subscribers
            for subscriber in subscribers:
                try:
                    self.email_service.send_prayer(subscriber["email"], subscriber["first_name"], prayer)
                    logger.info(f"Sent prayer to {subscriber['email']}")
                except Exception as e:
                    logger.error(f"Failed to send prayer to {subscriber['email']}: {e}")

            # Store the prayer in storage
            try:
                self.prayer_generator.storage.save_prayer(prayer)
                logger.info("Successfully stored prayer")
            except Exception as e:
                logger.error(f"Failed to store prayer: {e}")

        except Exception as e:
            logger.error(f"Error in generate_and_send_prayers: {e}")

    def run(self):
        """Start the scheduler and log job information"""
        try:
            self.scheduler.start()
            logger.info("Scheduler started successfully")

            # Log the next run time after scheduler is started
            daily_job = self.scheduler.get_job("daily_prayer_job")

            if daily_job:
                logger.info(f"Daily prayer job next run at: {daily_job.next_run_time}")
            else:
                logger.warning("Daily prayer job not found")

            # Keep the scheduler running
            try:
                while True:
                    time.sleep(1)
            except (KeyboardInterrupt, SystemExit):
                logger.info("Cleaning up prayer scheduler")
                self.scheduler.shutdown()
        except Exception as e:
            logger.error(f"Error starting scheduler: {e}")
            raise
