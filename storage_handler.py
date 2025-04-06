from google.cloud import storage
import logging
from datetime import datetime
import json
import random
from config import get_config
import os

# Set up logging
logger = logging.getLogger(__name__)

class StorageHandler:
    def __init__(self):
        """Initialize the storage handler with appropriate configuration"""
        try:
            config = get_config()
            
            # Handle service account info based on environment
            if isinstance(config.PRAYER_SERVICE_ACCOUNT, dict):
                # Local environment - using service account info
                service_account_info = config.PRAYER_SERVICE_ACCOUNT
            else:
                # Production environment - parse service account JSON from string
                try:
                    service_account_info = json.loads(config.PRAYER_SERVICE_ACCOUNT)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse service account JSON: {e}")
                    raise
            
            # Initialize the Google Cloud Storage client with prayer service account
            self.client = storage.Client.from_service_account_info(service_account_info)
            self.bucket = self.client.bucket(config.GOOGLE_CLOUD_BUCKET)
            self.verses = self._load_verses()
            logger.info(f"Successfully initialized StorageHandler with bucket: {config.GOOGLE_CLOUD_BUCKET}")
        except Exception as e:
            logger.error(f"Error initializing StorageHandler: {e}")
            raise

    def _load_verses(self):
        """Load verses from the bible_verses.json file"""
        try:
            with open('static/bible_verses.json', 'r') as f:
                data = json.load(f)
                return data['verses']
        except Exception as e:
            logger.error(f"Error loading verses: {e}")
            return []

    def save_prayer(self, date, prayer_text):
        """Save a prayer to Cloud Storage"""
        try:
            # Create a filename with the provided date
            filename = f"prayers/{date}.txt"
            
            # Create a blob and upload the prayer
            blob = self.bucket.blob(filename)
            blob.upload_from_string(prayer_text)
            
            logger.info(f"Successfully saved prayer to {filename}")
            return True
        except Exception as e:
            logger.error(f"Error saving prayer: {e}")
            return False

    def get_prayer(self, date):
        """Retrieve a prayer from Cloud Storage by date"""
        try:
            filename = f"prayers/{date}.txt"
            blob = self.bucket.blob(filename)
            
            if not blob.exists():
                logger.warning(f"Prayer not found for date: {date}")
                return None
                
            prayer_text = blob.download_as_string().decode('utf-8')
            logger.info(f"Successfully retrieved prayer for {date}")
            return prayer_text
        except Exception as e:
            logger.error(f"Error retrieving prayer: {e}")
            return None

    def get_verse(self, date=None):
        """Get a random verse from the bible_verses.json file"""
        try:
            if not self.verses:
                logger.error("No verses available")
                return None
            
            # Select a random verse
            verse = random.choice(self.verses)
            
            # Format the verse for display
            formatted_verse = f"VERSE: {verse['text']}\nREFERENCE: {verse['reference']}"
            
            logger.info(f"Successfully retrieved verse: {verse['reference']}")
            return formatted_verse
        except Exception as e:
            logger.error(f"Error retrieving verse: {e}")
            return None 