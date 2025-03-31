from google.cloud import storage
import os
import logging
from datetime import datetime
import json
import random

# Set up logging
logger = logging.getLogger(__name__)

class StorageHandler:
    def __init__(self, bucket_name):
        """Initialize the storage handler with a bucket name"""
        try:
            self.client = storage.Client()
            self.bucket = self.client.bucket(bucket_name)
            self.verses = self._load_verses()
            logger.info(f"StorageHandler initialized successfully with bucket: {bucket_name}")
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

    def save_prayer(self, prayer_text):
        """Save a prayer to Cloud Storage"""
        try:
            # Create a filename with today's date
            today = datetime.now().strftime("%Y-%m-%d")
            filename = f"prayers/prayer_{today}.txt"
            
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
            filename = f"prayers/prayer_{date}.txt"
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