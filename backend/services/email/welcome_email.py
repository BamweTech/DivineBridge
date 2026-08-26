import logging
from datetime import datetime
from backend.services.email.email_sender import EmailSender
from backend.integrations.storage_handler import StorageHandler
from backend.services.prayer.prayer_generator import PrayerGenerator

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


def get_today_prayer():
    """Get today's prayer from Google Cloud Storage or generate a new one if not available."""
    try:
        # Initialize storage handler
        storage = StorageHandler()

        # Get today's date
        today = datetime.now().strftime("%Y-%m-%d")

        # First try to get existing prayer from storage
        prayer = storage.get_prayer(today)
        if prayer:
            logger.info(f"Found existing prayer for {today}")
            return prayer

        # If no prayer exists, generate a new one
        logger.info(f"No prayer found for {today}, generating new prayer")
        prayer_generator = PrayerGenerator(storage)
        new_prayer = prayer_generator.generate_prayer()

        if new_prayer:
            # Save the new prayer to storage
            storage.save_prayer(today, new_prayer)
            logger.info(f"Successfully generated and saved new prayer for {today}")
            return new_prayer
        else:
            logger.error("Failed to generate new prayer")
            return None

    except Exception as e:
        logger.error(f"Error in get_today_prayer: {str(e)}")
        return None


def send_welcome_email(email, first_name, email_service=None, storage_handler=None):
    """
    Send welcome email to new subscriber.

    Args:
        email: Recipient's email address
        first_name: Recipient's first name
        email_service: Optional EmailService instance. If None, a new instance will be created.
        storage_handler: Optional StorageHandler instance. If None, a new instance will be created.
    """
    try:
        # Check if welcome email was already sent today
        if not storage_handler:
            logger.warning("No storage handler provided, creating new instance")
            storage_handler = StorageHandler()

        today = datetime.now().strftime("%Y-%m-%d")
        welcome_emails_sent = storage_handler.get_welcome_emails_sent(today)
        if welcome_emails_sent and email in welcome_emails_sent:
            logger.info(f"Welcome email already sent to {email} today")
            return True

        # Get today's prayer
        try:
            prayer = storage_handler.get_prayer(today)

            if not prayer:
                logger.error("No prayer found for today")
                # Use a default prayer if none is found
                prayer = "May God's peace and blessings be with you today and always."
                logger.info("Using default prayer for welcome email")
        except Exception as e:
            logger.error(f"Error getting prayer for welcome email: {e}")
            # Use a default prayer if there's an error
            prayer = "May God's peace and blessings be with you today and always."
            logger.info("Using default prayer for welcome email due to error")

        # Send welcome email with today's prayer
        try:
            if not email_service:
                logger.warning("No email service provided, creating new instance")
                email_service = EmailSender()

            success = email_service.send_welcome_email(email, first_name, prayer)
            if success:
                # Record that welcome email was sent
                storage_handler.record_welcome_email_sent(today, email)
                logger.info(f"Welcome email sent successfully to {email}")
                return True
            else:
                logger.error(f"Failed to send welcome email to {email}")
                return False
        except Exception as e:
            logger.error(f"Error sending welcome email to {email}: {e}")
            return False
    except Exception as e:
        logger.error(f"Unexpected error in send_welcome_email: {e}")
        return False
