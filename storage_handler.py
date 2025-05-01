from google.cloud import storage
import logging
from datetime import datetime
import json
import random
from config import get_config
import os
from google.api_core import retry
from google.api_core.exceptions import ServiceUnavailable
import time
import ssl
from requests.exceptions import SSLError as RequestsSSLError
from urllib3.exceptions import SSLError as URLLibSSLError
import requests
from google.auth.exceptions import RefreshError
from google.oauth2 import service_account
import io
import tempfile
import uuid

# Set up logging
logger = logging.getLogger(__name__)
logger.propagate = False  # Prevent duplicate logs
if not logger.handlers:  # Only add handler if none exists
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

class StorageHandler:
    def __init__(self):
        """
        Initialize the StorageHandler with Google Cloud Storage credentials.
        """
        try:
            # Get the service account credentials from Secret Manager
            config = get_config()
            try:
                # Create credentials from the JSON string
                credentials = service_account.Credentials.from_service_account_info(
                    json.loads(config.GOOGLE_CLOUD_CREDENTIALS),
                    scopes=['https://www.googleapis.com/auth/devstorage.read_write']
                )
                
                # Initialize the client
                self.client = storage.Client(credentials=credentials)
                self.bucket = self._get_or_create_bucket()
                
                # Initialize verses
                self.verses = self._load_verses()
                if not self.verses:
                    logger.warning("No verses loaded from bible_verses.json")
                
                logger.info("Successfully initialized StorageHandler with credentials from Secret Manager")
                
            except Exception as e:
                logger.error(f"Error creating credentials: {str(e)}")
                raise
            
        except Exception as e:
            logger.error(f"Error initializing StorageHandler: {e}")
            raise

    def __del__(self):
        """Cleanup method to release resources"""
        try:
            if hasattr(self, 'client'):
                self.client.close()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    def _retry_operation(self, operation, max_retries=5, base_delay=2):
        """Generic retry logic for storage operations"""
        for attempt in range(max_retries):
            try:
                return operation()
            except (RequestsSSLError, URLLibSSLError, ssl.SSLError) as e:
                if attempt < max_retries - 1:
                    delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                    logger.warning(f"SSL error (attempt {attempt + 1}/{max_retries}): {str(e)}")
                    logger.warning(f"Retrying in {delay:.2f} seconds...")
                    time.sleep(delay)
                else:
                    logger.error(f"Failed after {max_retries} attempts due to SSL errors")
                    raise
            except Exception as e:
                logger.error(f"Error in operation: {str(e)}")
                raise

    def _load_verses(self):
        """Load verses from the bible_verses.json file"""
        try:
            verses_file = 'static/bible_verses.json'
            if not os.path.exists(verses_file):
                logger.error(f"Verses file not found at {verses_file}")
                return []
                
            with open(verses_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if not isinstance(data, dict) or 'verses' not in data:
                    logger.error("Invalid verses file format")
                    return []
                    
                verses = data['verses']
                if not isinstance(verses, list) or not verses:
                    logger.error("No verses found in file")
                    return []
                    
                logger.info(f"Successfully loaded {len(verses)} verses")
                return verses
                
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing verses file: {e}")
            return []
        except Exception as e:
            logger.error(f"Error loading verses: {e}")
            return []

    def _get_or_create_bucket(self):
        """Get or create the storage bucket with improved retry logic."""
        try:
            bucket_name = 'divinebridge-prayers'
            
            @retry.Retry(
                predicate=retry.if_exception_type(
                    (ServiceUnavailable, requests.exceptions.SSLError, 
                     requests.exceptions.ConnectionError, requests.exceptions.ReadTimeout)
                ),
                initial=1.0,
                maximum=10.0,  # Reduced from 60.0
                multiplier=1.5,
                deadline=30.0  # Reduced from 300.0
            )
            def get_or_create_bucket():
                try:
                    # First try to get the bucket
                    bucket = self.client.get_bucket(bucket_name)
                    logger.info(f"Successfully retrieved existing bucket: {bucket_name}")
                    return bucket
                except Exception as e:
                    logger.warning(f"Bucket not found, attempting to create: {e}")
                    try:
                        # Only create if it doesn't exist
                        bucket = self.client.create_bucket(bucket_name)
                        logger.info(f"Successfully created new bucket: {bucket_name}")
                        return bucket
                    except Exception as create_error:
                        logger.error(f"Failed to create bucket: {create_error}")
                        raise
            
            bucket = get_or_create_bucket()
            return bucket
        except Exception as e:
            logger.error(f"Error getting or creating bucket: {e}")
            raise

    def save_prayer(self, prayer_data: dict, date: str = None) -> bool:
        """Save prayer to Cloud Storage with robust retry logic.
        
        Args:
            prayer_data: The prayer content and metadata
            date: Optional date string in YYYY-MM-DD format. If not provided, current date is used.
            
        Returns:
            bool: True if prayer was saved successfully, False otherwise
        """
        try:
            # Use provided date or current date
            if date is None:
                date = datetime.now().strftime('%Y-%m-%d')
            
            # Generate a unique ID for the prayer
            prayer_id = str(uuid.uuid4())
            blob_name = f"prayers/{date}/{prayer_id}.json"
            
            # Ensure prayer_data is a dictionary
            if isinstance(prayer_data, str):
                prayer_data = {
                    'content': prayer_data,
                    'date': date,
                    'created_at': datetime.now().isoformat()
                }
            
            def _upload_with_retry():
                try:
                    blob = self.bucket.blob(blob_name)
                    # Convert prayer data to JSON and upload
                    prayer_json = json.dumps(prayer_data)
                    blob.upload_from_string(prayer_json, content_type='application/json')
                    return True
                except Exception as e:
                    logger.error(f"Error in upload operation: {str(e)}")
                    return False

            # Use the retry decorator with specific retry conditions
            @retry.Retry(
                predicate=retry.if_exception_type(
                    (ServiceUnavailable, requests.exceptions.SSLError, 
                     requests.exceptions.ConnectionError)
                ),
                initial=1.0,
                maximum=60.0,
                multiplier=2,
                deadline=300.0
            )
            def _retry_upload():
                return _upload_with_retry()

            success = _retry_upload()
            if success:
                logger.info(f"Successfully saved prayer with ID: {prayer_id} for date: {date}")
                return True
            
            logger.error(f"Failed to save prayer after retries")
            return False

        except Exception as e:
            logger.error(f"Unexpected error saving prayer: {str(e)}")
            return False

    def get_prayers(self, limit: int = 50) -> list:
        """Get recent prayers from Cloud Storage"""
        try:
            prayers = []
            blobs = self.bucket.list_blobs(prefix='prayers/')
            
            # Sort blobs by creation time (newest first)
            sorted_blobs = sorted(blobs, key=lambda x: x.time_created, reverse=True)
            
            # Get the most recent prayers up to the limit
            for blob in sorted_blobs[:limit]:
                try:
                    prayer_json = blob.download_as_text()
                    prayer_data = json.loads(prayer_json)
                    prayers.append(prayer_data)
                except Exception as e:
                    logger.error(f"Error processing prayer blob {blob.name}: {e}")
                    continue
            
            return prayers
        except Exception as e:
            logger.error(f"Error getting prayers: {e}")
            return []

    def get_prayer(self, date: str = None) -> dict:
        """Get a prayer from Cloud Storage for a specific date.
        
        Args:
            date: Optional date string in YYYY-MM-DD format. If not provided, current date is used.
            
        Returns:
            dict: The prayer data if found, None otherwise
        """
        try:
            if date is None:
                date = datetime.now().strftime('%Y-%m-%d')
                
            # List all prayers for the given date
            prefix = f"prayers/{date}/"
            blobs = list(self.bucket.list_blobs(prefix=prefix))
            
            if not blobs:
                logger.warning(f"No prayers found for date: {date}")
                return None
                
            # Get the most recent prayer
            latest_blob = max(blobs, key=lambda x: x.time_created)
            
            try:
                prayer_json = latest_blob.download_as_text()
                prayer_data = json.loads(prayer_json)
                return prayer_data
            except Exception as e:
                logger.error(f"Error processing prayer blob {latest_blob.name}: {e}")
                return None
                
        except Exception as e:
            logger.error(f"Error getting prayer: {e}")
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

    def get_welcome_emails_sent(self, date):
        """
        Get the list of emails that received welcome emails on the given date.
        
        Args:
            date: The date to check (YYYY-MM-DD format)
            
        Returns:
            List of email addresses that received welcome emails, or None if error
        """
        try:
            bucket = self._get_or_create_bucket()
            blob = bucket.blob(f'welcome_emails/{date}.json')
            
            if not blob.exists():
                return []
                
            content = blob.download_as_text()
            return json.loads(content)
        except Exception as e:
            logger.error(f"Error getting welcome emails sent for {date}: {e}")
            return None
            
    def record_welcome_email_sent(self, date, email):
        """
        Record that a welcome email was sent to an email address on the given date.
        
        Args:
            date: The date the email was sent (YYYY-MM-DD format)
            email: The email address that received the welcome email
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            bucket = self._get_or_create_bucket()
            blob = bucket.blob(f'welcome_emails/{date}.json')
            
            # Get existing emails or start with empty list
            existing_emails = []
            if blob.exists():
                content = blob.download_as_text()
                existing_emails = json.loads(content)
                
            # Add new email if not already present
            if email not in existing_emails:
                existing_emails.append(email)
                
            # Upload updated list
            blob.upload_from_string(
                json.dumps(existing_emails),
                content_type='application/json'
            )
            return True
        except Exception as e:
            logger.error(f"Error recording welcome email sent to {email} on {date}: {e}")
            return False 