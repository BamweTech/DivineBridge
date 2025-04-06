import logging
from datetime import datetime
import os
from email_sender import EmailSender
from storage_handler import StorageHandler
from prayer_generator import PrayerGenerator

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def get_today_prayer():
    """Get today's prayer from Google Cloud Storage or generate a new one if not available."""
    try:
        # Initialize storage handler
        storage = StorageHandler()
        
        # Get today's date
        today = datetime.now().strftime('%Y-%m-%d')
        
        # First try to get existing prayer from storage
        prayer = storage.get_prayer(today)
        if prayer:
            logger.info(f"Found existing prayer for {today}")
            return prayer
            
        # If no prayer exists, generate a new one
        logger.info(f"No prayer found for {today}, generating new prayer")
        prayer_generator = PrayerGenerator()
        new_prayer = prayer_generator.generate_prayer()
        
        if new_prayer:
            logger.info(f"Successfully generated new prayer for {today}")
            return new_prayer
        else:
            logger.error("Failed to generate new prayer")
            return None
            
    except Exception as e:
        logger.error(f"Error in get_today_prayer: {str(e)}")
        return None

def send_welcome_email(subscriber_email, subscriber_name):
    """
    Send a welcome email to a new subscriber with today's prayer.
    """
    try:
        # Initialize email sender
        email_sender = EmailSender()
        
        # Get today's prayer
        prayer = get_today_prayer()
        
        if not prayer:
            logger.error("No prayer found or generated for today")
            return False

        # Send the email using send_welcome_email
        success = email_sender.send_welcome_email(
            recipient_email=subscriber_email,
            first_name=subscriber_name,
            prayer_text=prayer
        )
        
        if success:
            logger.info(f"Welcome email sent successfully to {subscriber_email}")
            return True
        else:
            logger.error(f"Failed to send welcome email to {subscriber_email}")
            return False
            
    except Exception as e:
        logger.error(f"Error sending welcome email: {str(e)}")
        return False 