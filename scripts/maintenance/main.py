import os
from backend.services.disaster.news_fetcher import NewsScanner
from backend.services.prayer.prayer_generator import PrayerGenerator
from backend.services.email.email_sender import EmailSender
from datetime import datetime
from backend.services.email.sheet_handler import SheetHandler
import logging
from backend.integrations.storage_handler import StorageHandler

# Set up logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    logger.info("Starting Divine Bridge application")
    try:
        # Initialize components
        # scanner = NewsScanner()
        storage = StorageHandler()
        generator = PrayerGenerator(storage)
        emailer = EmailSender()
        sheet = SheetHandler('divinebridge-676c7c0963dd.json')
        
        # Get news and generate prayer
        # logger.info("Fetching news")
        # news = scanner.fetch_disaster_news()
        
        logger.info("Generating prayer")
        prayer = generator.generate_prayer()
        
        # Get email list
        logger.info("Getting email list")
        subscribers = sheet.get_subscribers()
        logger.info(f"Found {len(subscribers)} recipients")
        
        # Send emails
        for subscriber in subscribers:
            emailer.send_daily_prayer(
                subscriber['email'],
                subscriber['first_name'],
                prayer
            )
        
        # Save to file
        date = datetime.now().strftime("%Y-%m-%d")
        logger.info(f"Saving prayer for {date}")
        with open(f"prayers/{date}.txt", "w") as f:
            f.write(f"Prayer:\n{prayer}")
        
        logger.info("Application completed successfully")
        
    except Exception as e:
        logger.error(f"Application failed: {e}")
        raise

if __name__ == "__main__":
    main() 