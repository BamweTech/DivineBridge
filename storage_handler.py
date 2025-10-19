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
from typing import Optional

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
                    json.loads(config.google_credentials),
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

    def save_prayer_request(self, prayer_request_data: dict) -> bool:
        """Save prayer request to Cloud Storage with robust retry logic.
        
        Args:
            prayer_request_data: The prayer request content and metadata
            
        Returns:
            bool: True if prayer request was saved successfully, False otherwise
        """
        try:
            # Generate a unique ID for the prayer request
            prayer_request_id = str(uuid.uuid4())
            date = prayer_request_data.get('date', datetime.now().strftime('%Y-%m-%d'))
            blob_name = f"prayer_requests/{date}/{prayer_request_id}.json"
            
            # Add ID to the prayer request data (important for background processing)
            prayer_request_data['id'] = prayer_request_id
            
            def _upload_with_retry():
                try:
                    blob = self.bucket.blob(blob_name)
                    # Convert prayer request data to JSON and upload
                    prayer_request_json = json.dumps(prayer_request_data)
                    blob.upload_from_string(prayer_request_json, content_type='application/json')
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
                logger.info(f"Successfully saved prayer request with ID: {prayer_request_id}")
                return True
            
            logger.error(f"Failed to save prayer request after retries")
            return False

        except Exception as e:
            logger.error(f"Unexpected error saving prayer request: {str(e)}")
            return False

    def get_prayer_requests(self, limit: int = 50) -> list:
        """Get recent prayer requests from Cloud Storage"""
        try:
            prayer_requests = []
            blobs = self.bucket.list_blobs(prefix='prayer_requests/')
            
            # Sort blobs by creation time (newest first)
            sorted_blobs = sorted(blobs, key=lambda x: x.time_created, reverse=True)
            
            # Get the most recent prayer requests up to the limit
            for blob in sorted_blobs[:limit]:
                try:
                    prayer_request_json = blob.download_as_text()
                    prayer_request_data = json.loads(prayer_request_json)
                    # Add the request ID from the blob name
                    request_id = blob.name.split('/')[-1].replace('.json', '')
                    prayer_request_data['id'] = request_id
                    prayer_requests.append(prayer_request_data)
                except Exception as e:
                    logger.error(f"Error processing prayer request blob {blob.name}: {e}")
                    continue
            
            return prayer_requests
        except Exception as e:
            logger.error(f"Error getting prayer requests: {e}")
            return []
    
    def get_prayer_request_by_id(self, request_id: str) -> Optional[dict]:
        """
        Get a specific prayer request by ID
        
        Args:
            request_id: UUID of the prayer request
        
        Returns:
            Prayer request data or None
        """
        try:
            # Search for the prayer request across all dates
            blobs = self.bucket.list_blobs(prefix='prayer_requests/')
            
            for blob in blobs:
                if request_id in blob.name:
                    prayer_data = json.loads(blob.download_as_text())
                    prayer_data['id'] = request_id
                    prayer_data['_blob_name'] = blob.name  # Store for updates
                    return prayer_data
            
            logger.warning(f"Prayer request not found: {request_id}")
            return None
            
        except Exception as e:
            logger.error(f"Error getting prayer request {request_id}: {e}")
            return None
    
    def get_user_prayed_prayers(self, user_id: str) -> list:
        """
        Get list of prayer IDs that a user has prayed for
        
        Args:
            user_id: Firebase user ID
        
        Returns:
            List of prayer IDs
        """
        try:
            blob_path = f'user_interactions/{user_id}/prayed_for.json'
            data = self.get_json_from_storage(blob_path)
            if data:
                return data.get('prayer_ids', [])
            return []
        except Exception as e:
            logger.error(f"Error getting user prayed prayers: {e}")
            return []
    
    def add_user_prayed_prayer(self, user_id: str, prayer_id: str) -> bool:
        """
        Add a prayer ID to user's prayed-for list
        
        Args:
            user_id: Firebase user ID
            prayer_id: Prayer request ID
        
        Returns:
            True if successful
        """
        try:
            blob_path = f'user_interactions/{user_id}/prayed_for.json'
            
            # Get existing data
            data = self.get_json_from_storage(blob_path) or {'prayer_ids': [], 'updated_at': None}
            prayer_ids = data.get('prayer_ids', [])
            
            # Add if not already there
            if prayer_id not in prayer_ids:
                prayer_ids.append(prayer_id)
                data['prayer_ids'] = prayer_ids
                data['updated_at'] = datetime.now().isoformat()
                
                # Save back
                self.save_json_to_storage(blob_path, data)
                logger.info(f"Added prayer {prayer_id} to user {user_id}'s prayed-for list")
                return True
            
            return True  # Already exists, still success
            
        except Exception as e:
            logger.error(f"Error adding user prayed prayer: {e}")
            return False
    
    def get_user_stats(self, user_id: str) -> dict:
        """
        Get user statistics (synced across devices)
        
        Args:
            user_id: Firebase user ID
        
        Returns:
            Dictionary with user stats
        """
        try:
            # Get basic stats
            blob_path = f'user_interactions/{user_id}/stats.json'
            data = self.get_json_from_storage(blob_path) or {}
            
            stats = {
                'prayersRead': data.get('prayersRead', 0),
                'requestsSubmitted': data.get('requestsSubmitted', 0),
                'updated_at': data.get('updated_at')
            }
            
            # Calculate "People you prayed for" - count of unique prayers in prayed_for list
            prayed_for_list = self.get_user_prayed_prayers(user_id)
            stats['peopleYouPrayedFor'] = len(prayed_for_list)
            
            # Calculate "People who prayed for you" - sum of prayers on user's submitted requests
            try:
                # Get all prayer requests submitted by this user
                all_requests = self.get_prayer_requests(limit=200)
                user_requests = [r for r in all_requests if r.get('user_id') == user_id]
                
                # Sum up all prayers received
                total_prayers_received = 0
                for request in user_requests:
                    analytics = request.get('analytics', {})
                    total_prayers_received += analytics.get('prayers', 0)
                
                stats['peopleWhoPrayedForYou'] = total_prayers_received
                logger.info(f"User {user_id} has {len(user_requests)} requests with {total_prayers_received} total prayers")
                
            except Exception as e:
                logger.error(f"Error calculating received prayers: {e}")
                stats['peopleWhoPrayedForYou'] = 0
            
            return stats
            
        except Exception as e:
            logger.error(f"Error getting user stats: {e}")
            return {
                'prayersRead': 0,
                'requestsSubmitted': 0,
                'peopleYouPrayedFor': 0,
                'peopleWhoPrayedForYou': 0,
                'updated_at': None
            }
    
    def increment_user_stat(self, user_id: str, stat_name: str) -> bool:
        """
        Increment a user statistic (synced across devices)
        
        Args:
            user_id: Firebase user ID
            stat_name: Name of stat to increment (e.g., 'prayersRead', 'requestsSubmitted')
        
        Returns:
            True if successful
        """
        try:
            blob_path = f'user_interactions/{user_id}/stats.json'
            
            # Get existing data
            data = self.get_json_from_storage(blob_path) or {}
            
            # Increment stat
            data[stat_name] = data.get(stat_name, 0) + 1
            data['updated_at'] = datetime.now().isoformat()
            
            # Save back
            self.save_json_to_storage(blob_path, data)
            logger.info(f"Incremented {stat_name} for user {user_id}: {data[stat_name]}")
            return True
            
        except Exception as e:
            logger.error(f"Error incrementing user stat: {e}")
            return False
    
    def update_prayer_request(self, request_id: str, prayer_data: dict) -> bool:
        """
        Update a prayer request (e.g., increment analytics)
        
        Args:
            request_id: UUID of the prayer request
            prayer_data: Updated prayer request data
        
        Returns:
            True if successful
        """
        try:
            # Get blob name from prayer data or search for it
            blob_name = prayer_data.get('_blob_name')
            
            if not blob_name:
                # Search for the blob
                blobs = self.bucket.list_blobs(prefix='prayer_requests/')
                for blob in blobs:
                    if request_id in blob.name:
                        blob_name = blob.name
                        break
            
            if not blob_name:
                logger.error(f"Could not find blob for prayer request: {request_id}")
                return False
            
            # Remove internal fields before saving
            save_data = {k: v for k, v in prayer_data.items() if not k.startswith('_')}
            
            # Update the blob
            blob = self.bucket.blob(blob_name)
            blob.upload_from_string(
                json.dumps(save_data),
                content_type='application/json'
            )
            
            logger.debug(f"Updated prayer request: {request_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error updating prayer request {request_id}: {e}")
            return False
    
    def save_json_to_storage(self, file_path: str, data: dict) -> bool:
        """
        Save JSON data to Cloud Storage
        
        Args:
            file_path: Path in bucket (e.g., 'user_locations/user123.json')
            data: Dictionary to save as JSON
        
        Returns:
            True if successful
        """
        try:
            blob = self.bucket.blob(file_path)
            json_data = json.dumps(data, indent=2)
            blob.upload_from_string(json_data, content_type='application/json')
            logger.debug(f"Saved JSON to {file_path}")
            return True
        except Exception as e:
            logger.error(f"Error saving JSON to {file_path}: {e}")
            return False
    
    def get_json_from_storage(self, file_path: str) -> Optional[dict]:
        """
        Retrieve JSON data from Cloud Storage
        
        Args:
            file_path: Path in bucket
        
        Returns:
            Dictionary if found, None otherwise
        """
        try:
            blob = self.bucket.blob(file_path)
            if blob.exists():
                json_data = blob.download_as_text()
                return json.loads(json_data)
            return None
        except Exception as e:
            logger.debug(f"Error getting JSON from {file_path}: {e}")
            return None
    
    def upload_logo(self, file_path: str, logo_data: bytes) -> Optional[str]:
        """
        Upload logo image to Cloud Storage and return public URL
        
        Args:
            file_path: Path in bucket (e.g., 'organization_logos/org-name.png')
            logo_data: Binary image data
        
        Returns:
            Public URL of the uploaded logo or None
        """
        try:
            blob = self.bucket.blob(file_path)
            
            # Upload with correct content type and cache control
            blob.upload_from_string(
                logo_data,
                content_type='image/png'
            )
            
            # Return permanent public URL (bucket is already public)
            public_url = f"https://storage.googleapis.com/{self.bucket.name}/{file_path}"
            
            logger.debug(f"Uploaded logo to {file_path}, public URL: {public_url}")
            return public_url
            
        except Exception as e:
            logger.error(f"Error uploading logo to {file_path}: {e}")
            return None
    
    def get_public_url(self, file_path: str) -> Optional[str]:
        """
        Get public URL of a file in Cloud Storage if it exists
        
        Args:
            file_path: Path in bucket
        
        Returns:
            Public URL if file exists, None otherwise
        """
        try:
            blob = self.bucket.blob(file_path)
            if blob.exists():
                # Return permanent public URL (bucket is already public)
                return f"https://storage.googleapis.com/{self.bucket.name}/{file_path}"
            return None
        except Exception as e:
            logger.debug(f"Error checking file existence for {file_path}: {e}")
            return None
    
    def save_verse_image(self, date: str, image_data: bytes) -> bool:
        """Save verse image to Cloud Storage
        
        Args:
            date: Date string in YYYY-MM-DD format
            image_data: JPEG image data as bytes
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            blob_name = f"images/verses/{date}.jpg"
            blob = self.bucket.blob(blob_name)
            
            # Upload image with proper content type
            blob.upload_from_string(
                image_data,
                content_type='image/jpeg'
            )
            
            logger.info(f"Successfully saved verse image: {blob_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error saving verse image: {e}")
            return False
    
    def get_verse_image(self, date: str) -> bytes:
        """Get verse image from Cloud Storage
        
        Args:
            date: Date string in YYYY-MM-DD format
            
        Returns:
            bytes: JPEG image data if found, None otherwise
        """
        try:
            blob_name = f"images/verses/{date}.jpg"
            blob = self.bucket.blob(blob_name)
            
            if blob.exists():
                image_data = blob.download_as_bytes()
                logger.info(f"Retrieved cached verse image: {blob_name}")
                return image_data
            else:
                logger.debug(f"No cached verse image found: {blob_name}")
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving verse image: {e}")
            return None
    
    def save_prayer_image(self, date: str, image_data: bytes) -> bool:
        """Save prayer image to Cloud Storage
        
        Args:
            date: Date string in YYYY-MM-DD format
            image_data: JPEG image data as bytes
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            blob_name = f"images/prayers/{date}.jpg"
            blob = self.bucket.blob(blob_name)
            
            # Upload image with proper content type
            blob.upload_from_string(
                image_data,
                content_type='image/jpeg'
            )
            
            logger.info(f"Successfully saved prayer image: {blob_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error saving prayer image: {e}")
            return False
    
    def get_prayer_image(self, date: str) -> bytes:
        """Get prayer image from Cloud Storage
        
        Args:
            date: Date string in YYYY-MM-DD format
            
        Returns:
            bytes: JPEG image data if found, None otherwise
        """
        try:
            blob_name = f"images/prayers/{date}.jpg"
            blob = self.bucket.blob(blob_name)
            
            if blob.exists():
                image_data = blob.download_as_bytes()
                logger.info(f"Retrieved cached prayer image: {blob_name}")
                return image_data
            else:
                logger.debug(f"No cached prayer image found: {blob_name}")
                return None
                
        except Exception as e:
            logger.error(f"Error retrieving prayer image: {e}")
            return None 