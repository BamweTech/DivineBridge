import os
import logging
from google.oauth2 import service_account
from googleapiclient.discovery import build
import json
from dotenv import load_dotenv
from config import get_config
from datetime import datetime
from storage_handler import StorageHandler
import re
from google.auth.exceptions import RefreshError
from google.api_core import retry
import time
import random
import requests
import ssl
from google.api_core.retry import Retry
from google.api_core.exceptions import RetryError
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry as RequestsRetry
from google.auth.transport.requests import Request, AuthorizedSession
from googleapiclient.errors import HttpError

# Set up logging
logger = logging.getLogger(__name__)
logger.propagate = False  # Prevent duplicate logs
if not logger.handlers:  # Only add handler if none exists
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

# Load environment variables
load_dotenv()

class SheetHandler:
    def __init__(self):
        """Initialize the SheetHandler with Google Sheets API credentials."""
        try:
            service_account_info = os.getenv('PRAYER_SERVICE_ACCOUNT')
            if not service_account_info:
                raise ValueError("PRAYER_SERVICE_ACCOUNT environment variable not set")
            logger.info("Found PRAYER_SERVICE_ACCOUNT environment variable")

            # Parse service account info
            try:
                if isinstance(service_account_info, str):
                    service_account_info = json.loads(service_account_info)
                logger.info("Successfully parsed service account JSON")
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse service account JSON: {e}")
                raise ValueError("Invalid service account JSON format")

            # Create credentials
            try:
                credentials = service_account.Credentials.from_service_account_info(
                    service_account_info,
                    scopes=['https://www.googleapis.com/auth/spreadsheets']
                )
                logger.info("Successfully created credentials")
            except Exception as e:
                logger.error(f"Failed to create credentials: {e}")
                raise ValueError("Failed to create service account credentials")

            # Initialize the Sheets API
            try:
                self.service = build('sheets', 'v4', credentials=credentials)
                logger.info("Successfully initialized Sheets API")
            except Exception as e:
                logger.error(f"Failed to initialize Sheets API: {e}")
                raise ValueError("Failed to initialize Sheets API")

            # Get sheet ID from environment
            self.sheet_id = os.getenv('SHEET_ID')
            if not self.sheet_id:
                raise ValueError("SHEET_ID environment variable not set")
            logger.info("Found SHEET_ID environment variable")

            # Test sheet access
            try:
                self._test_sheet_access()
                logger.info("Successfully tested sheet access")
            except Exception as e:
                logger.error(f"Failed to access sheet: {e}")
                raise ValueError(f"Sheet access failed: {str(e)}")

            # Initialize storage handler after successful service initialization
            try:
                self.storage = StorageHandler()
                logger.info("StorageHandler initialized successfully")
            except Exception as e:
                logger.error(f"Error initializing StorageHandler: {e}")
                self.storage = None

            # Initialize email service
            try:
                from email_sender import EmailSender
                self.email_service = EmailSender()
                logger.info("EmailSender initialized successfully")
            except Exception as e:
                logger.error(f"Error initializing EmailSender: {e}")
                self.email_service = None
            
            logger.info("SheetHandler initialized successfully")
            
        except Exception as e:
            # Clean up resources if initialization fails
            self.__del__()
            logger.error(f"Error initializing SheetHandler: {str(e)}")
            raise

    def __del__(self):
        """Cleanup method to release resources"""
        try:
            # Clean up service
            if hasattr(self, 'service'):
                try:
                    self.service._http.close()
                except:
                    pass
                
            # Clean up storage
            if hasattr(self, 'storage') and self.storage is not None:
                try:
                    del self.storage
                except:
                    pass
                    
            # Clean up email service
            if hasattr(self, 'email_service') and self.email_service is not None:
                try:
                    del self.email_service
                except:
                    pass
                    
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

    def _check_storage(self):
        """Helper method to check if storage is available"""
        if self.storage is None:
            logger.error("StorageHandler not initialized")
            return False
        return True

    def _check_email_service(self):
        """Helper method to check if email service is available"""
        if self.email_service is None:
            logger.error("EmailSender not initialized")
            return False
        return True

    def add_subscriber(self, email, first_name, last_name):
        """
        Add a new subscriber to the Google Sheet with robust retry logic.
        
        Args:
            email: Subscriber's email address
            first_name: Subscriber's first name
            last_name: Subscriber's last name
        """
        @retry.Retry(
            predicate=retry.if_exception_type(
                (requests.exceptions.SSLError, requests.exceptions.ConnectionError,
                 requests.exceptions.Timeout, requests.exceptions.ReadTimeout)
            ),
            initial=1.0,
            maximum=60.0,
            multiplier=2,
            deadline=300.0
        )
        def _add_subscriber_with_retry():
            try:
                logger.debug(f"Adding subscriber: {email}")
                
                # Check if subscriber already exists
                try:
                    subscribers = self.get_subscribers()
                    if any(sub['email'] == email for sub in subscribers):
                        logger.warning(f"Subscriber already exists: {email}")
                        return True  # Consider this a success since the user is already subscribed
                except Exception as e:
                    logger.error(f"Error checking existing subscribers: {e}")
                    # Continue with adding the subscriber
                
                # Add subscriber to sheet with subscription date
                try:
                    values = [[email, first_name, last_name, datetime.now().strftime('%Y-%m-%d %H:%M:%S')]]
                    body = {'values': values}
                    
                    result = self.service.spreadsheets().values().append(
                        spreadsheetId=self.sheet_id,
                        range='Subscribers!A:D',
                        valueInputOption='RAW',
                        insertDataOption='INSERT_ROWS',
                        body=body
                    ).execute()
                    
                    logger.info(f"Subscriber added successfully: {email}")
                    return True
                except Exception as e:
                    logger.error(f"Error adding subscriber to sheet: {e}")
                    return False
                
            except Exception as e:
                logger.error(f"Error in add_subscriber_with_retry: {e}")
                return False
        
        try:
            return _add_subscriber_with_retry()
        except Exception as e:
            logger.error(f"Error in add_subscriber: {e}")
            return False

    def get_subscribers(self):
        """
        Get all subscribers from the Google Sheet with robust retry logic.
        
        Returns:
            List of dictionaries containing subscriber information
        """
        @retry.Retry(
            predicate=retry.if_exception_type(
                (requests.exceptions.SSLError, requests.exceptions.ConnectionError,
                 requests.exceptions.Timeout, requests.exceptions.ReadTimeout)
            ),
            initial=1.0,
            maximum=60.0,
            multiplier=2,
            deadline=300.0
        )
        def _get_subscribers_with_retry():
            try:
                logger.debug("Getting subscribers")
                
                result = self.service.spreadsheets().values().get(
                    spreadsheetId=self.sheet_id,
                    range='Subscribers!A:D'
                ).execute()
                
                values = result.get('values', [])
                if not values:
                    logger.debug("No subscribers found")
                    return []
                
                # Skip header row
                subscribers = []
                for row in values[1:]:
                    if len(row) >= 4:  # Ensure row has all required fields
                        subscriber = {
                            'email': row[0],
                            'first_name': row[1],
                            'last_name': row[2],
                            'subscribed_date': row[3]
                        }
                        subscribers.append(subscriber)
                
                logger.debug(f"Found {len(subscribers)} subscribers")
                return subscribers
                
            except Exception as e:
                logger.error(f"Error getting subscribers: {e}")
                raise

        try:
            return _get_subscribers_with_retry()
        except Exception as e:
            logger.error(f"Failed to get subscribers after retries: {e}")
            return []

    def remove_subscriber(self, email):
        """
        Remove a subscriber from the Google Sheet.
        
        Args:
            email: Subscriber's email address
        """
        try:
            logger.debug(f"Removing subscriber: {email}")
            
            # Get all subscribers
            subscribers = self.get_subscribers()
            if not subscribers:
                logger.warning("No subscribers found")
                return False
            
            # Find subscriber
            subscriber = next((sub for sub in subscribers if sub['email'] == email), None)
            if not subscriber:
                logger.warning(f"Subscriber not found: {email}")
                return False
            
            # Get sheet data
            result = self.service.spreadsheets().values().get(
                spreadsheetId=self.sheet_id,
                range='Subscribers!A:C'
            ).execute()
            
            values = result.get('values', [])
            if not values:
                logger.warning("No data found in sheet")
                return False
            
            # Find row to delete
            row_to_delete = None
            for i, row in enumerate(values):
                if row[0] == email:
                    row_to_delete = i + 1  # Add 1 for 1-based indexing
                    break
            
            if not row_to_delete:
                logger.warning(f"Could not find row for subscriber: {email}")
                return False
            
            # Delete row
            request = {
                'requests': [{
                    'deleteDimension': {
                        'range': {
                            'sheetId': 0,
                            'dimension': 'ROWS',
                            'startIndex': row_to_delete - 1,
                            'endIndex': row_to_delete
                        }
                    }
                }]
            }
            
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=self.sheet_id,
                body=request
            ).execute()
            
            logger.info(f"Subscriber removed successfully: {email}")
            return True
            
        except Exception as e:
            logger.error(f"Error removing subscriber {email}: {e}")
            return False

    def send_daily_prayers(self):
        """
        Send daily prayers to all subscribers.
        """
        try:
            if not self._check_storage():
                return False
                
            if not self._check_email_service():
                return False

            logger.debug("Sending daily prayers")
            
            # Get today's prayer
            today = datetime.now().strftime('%Y-%m-%d')
            prayer = self.storage.get_prayer(today)
            
            if not prayer:
                logger.error("No prayer found for today")
                return False
            
            # Get all subscribers
            subscribers = self.get_subscribers()
            if not subscribers:
                logger.warning("No subscribers found")
                return False
            
            # Send prayer to each subscriber
            success_count = 0
            for subscriber in subscribers:
                # Skip unsubscribed users
                if subscriber.get('subscribed_date', '').startswith('UNSUBSCRIBED'):
                    continue
                    
                success = self.email_service.send_daily_prayer(
                    subscriber['email'],
                    subscriber['first_name'],
                    prayer
                )
                if success:
                    success_count += 1
            
            logger.info(f"Daily prayers sent successfully to {success_count} subscribers")
            return True
            
        except Exception as e:
            logger.error(f"Error sending daily prayers: {e}")
            return False

    def get_email_list(self):
        """
        Get list of subscribers with their email addresses and first names.
        
        Returns:
            list: List of tuples containing (email, first_name)
        """
        try:
            subscribers = self.get_subscribers()
            return [(sub['email'], sub['first_name']) for sub in subscribers]
        except Exception as e:
            logger.error(f"Error getting email list: {e}")
            raise

    def unsubscribe(self, email):
        """
        Unsubscribe a user from the prayer service.
        
        Args:
            email: Email address to unsubscribe
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            logger.debug(f"Attempting to unsubscribe: {email}")
            
            # Get all subscribers
            result = self.service.spreadsheets().values().get(
                spreadsheetId=self.sheet_id,
                range='Subscribers!A:D'
            ).execute()
            
            values = result.get('values', [])
            if not values:
                logger.warning(f"No subscribers found to unsubscribe: {email}")
                return False
            
            # Find the row with the email (email is in column A)
            for i, row in enumerate(values, start=1):  # start=1 for actual row numbers
                if row[0] == email:
                    # Update the subscription date column to indicate unsubscribed status
                    self.service.spreadsheets().values().update(
                        spreadsheetId=self.sheet_id,
                        range=f'Subscribers!D{i}',
                        valueInputOption='RAW',
                        body={'values': [[f'UNSUBSCRIBED {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}']]}
                    ).execute()
                    
                    logger.info(f"Successfully unsubscribed: {email}")
                    return True
            
            logger.warning(f"Email not found to unsubscribe: {email}")
            return False
            
        except Exception as e:
            logger.error(f"Error unsubscribing {email}: {e}")
            return False

    def get_first_name(self, email):
        """
        Get the first name of a subscriber by their email.
        
        Args:
            email: Email address of the subscriber
            
        Returns:
            str: First name of the subscriber, or 'Friend' if not found
        """
        try:
            subscribers = self.get_subscribers()
            for subscriber in subscribers:
                if subscriber['email'] == email:
                    return subscriber['first_name']
            return 'Friend'  # Default if not found
        except Exception as e:
            logger.error(f"Error getting first name for {email}: {e}")
            return 'Friend'  # Default on error

    def _ensure_sheet_exists(self):
        """Ensure the Subscribers sheet exists and has the correct structure"""
        try:
            # Get all sheets in the spreadsheet
            spreadsheet = self.service.spreadsheets().get(spreadsheetId=self.sheet_id).execute()
            sheets = spreadsheet.get('sheets', [])
            
            # Check if Subscribers sheet exists
            subscribers_sheet = next((sheet for sheet in sheets if sheet['properties']['title'] == 'Subscribers'), None)
            
            if not subscribers_sheet:
                # Create Subscribers sheet
                body = {
                    'requests': [{
                        'addSheet': {
                            'properties': {
                                'title': 'Subscribers'
                            }
                        }
                    }]
                }
                self.service.spreadsheets().batchUpdate(
                    spreadsheetId=self.sheet_id,
                    body=body
                ).execute()
                
                # Add headers
                headers = [['Email', 'First Name', 'Last Name', 'Subscription Date']]
                self.service.spreadsheets().values().update(
                    spreadsheetId=self.sheet_id,
                    range='Subscribers!A1:D1',
                    valueInputOption='RAW',
                    body={'values': headers}
                ).execute()
                
                logger.info("Created Subscribers sheet with headers")
            else:
                # Check if headers exist
                result = self.service.spreadsheets().values().get(
                    spreadsheetId=self.sheet_id,
                    range='Subscribers!A1:D1'
                ).execute()
                
                values = result.get('values', [])
                if not values:
                    # Add headers if they don't exist
                    headers = [['Email', 'First Name', 'Last Name', 'Subscription Date']]
                    self.service.spreadsheets().values().update(
                        spreadsheetId=self.sheet_id,
                        range='Subscribers!A1:D1',
                        valueInputOption='RAW',
                        body={'values': headers}
                    ).execute()
                    logger.info("Added headers to Subscribers sheet")
                
        except Exception as e:
            logger.error(f"Error ensuring sheet exists: {e}")
            raise 

    def _test_sheet_access(self):
        """Test sheet access with retry logic"""
        @retry.Retry(
            predicate=retry.if_exception_type(
                (requests.exceptions.SSLError, requests.exceptions.ConnectionError,
                 HttpError)
            ),
            initial=1.0,
            maximum=60.0,
            multiplier=2,
            deadline=300.0
        )
        def _test_sheet_access():
            try:
                logger.info(f"Attempting to access sheet with ID: {self.sheet_id}")
                sheet = self.service.spreadsheets().get(spreadsheetId=self.sheet_id).execute()
                logger.info(f"Successfully accessed sheet: {sheet.get('properties', {}).get('title', 'Unknown')}")
            except HttpError as e:
                if e.resp.status == 404:
                    logger.error(f"Sheet not found. Details: {str(e)}")
                    raise ValueError(f"Sheet not found. Please check if the service account has access to the sheet with ID: {self.sheet_id}")
                elif e.resp.status == 403:
                    logger.error(f"Permission denied. Details: {str(e)}")
                    raise ValueError(f"Permission denied. Please check if the service account has the correct permissions for the sheet with ID: {self.sheet_id}")
                else:
                    logger.error(f"Error accessing sheet: {str(e)}")
                    raise ValueError(f"Error accessing sheet: {str(e)}")
        
        _test_sheet_access() 