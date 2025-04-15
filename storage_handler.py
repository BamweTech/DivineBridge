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
            service_account_info = os.getenv('PRAYER_SERVICE_ACCOUNT')
            if not service_account_info:
                raise ValueError("PRAYER_SERVICE_ACCOUNT environment variable not set")
            
            # Write the service account info to a temporary file
            with tempfile.NamedTemporaryFile(mode='w', delete=False) as temp_file:
                temp_file.write(service_account_info)
                temp_file_path = temp_file.name
            
            try:
                # Create credentials from the temporary file
                credentials = service_account.Credentials.from_service_account_file(
                    temp_file_path,
                    scopes=['https://www.googleapis.com/auth/devstorage.read_write']
                )
                
                # Initialize the client
                self.client = storage.Client(credentials=credentials)
                self.bucket = self._get_or_create_bucket()
                
                # Initialize verses
                self.verses = self._load_verses()
                if not self.verses:
                    logger.warning("No verses loaded from bible_verses.json")
                
                logger.info("StorageHandler initialized successfully")
                
            finally:
                # Clean up the temporary file
                try:
                    os.unlink(temp_file_path)
                except Exception as e:
                    logging.warning(f"Failed to delete temporary file {temp_file_path}: {e}")
            
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

    def save_prayer(self, prayer_text: str, date: str) -> bool:
        """Save prayer to Cloud Storage with robust retry logic."""
        try:
            # Ensure the date is properly formatted and sanitized
            blob_name = f"prayers/{date}.txt"
            
            def _upload_with_retry():
                try:
                    blob = self.bucket.blob(blob_name)
                    # Ensure the prayer text is encoded as UTF-8
                    encoded_prayer = prayer_text.encode('utf-8')
                    blob.upload_from_string(prayer_text, content_type='text/plain; charset=utf-8')
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
                logger.info(f"Successfully saved prayer for {date}")
                return True
            
            logger.error(f"Failed to save prayer for {date} after retries")
            return False

        except Exception as e:
            logger.error(f"Unexpected error saving prayer: {str(e)}")
            return False

    def get_prayer(self, date):
        """Get a prayer from Cloud Storage"""
        try:
            blob = self.bucket.blob(f'prayers/{date}.txt')
            if not blob.exists():
                logger.warning(f"Prayer not found for date: {date}")
                return None
            return self._retry_operation(
                lambda: blob.download_as_text(),
                max_retries=3,
                base_delay=1
            )
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