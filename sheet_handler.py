import os
import logging
from google.oauth2 import service_account
from googleapiclient.discovery import build
import json
from dotenv import load_dotenv
from config import get_config

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class SheetHandler:
    def __init__(self):
        """Initialize the SheetHandler with appropriate credentials"""
        try:
            config = get_config()
            
            # Create credentials based on environment
            if isinstance(config.EMAIL_SERVICE_ACCOUNT, dict):
                # Local environment - using service account info
                service_account_info = config.EMAIL_SERVICE_ACCOUNT
            else:
                # Production environment - parse service account JSON from string
                try:
                    # Try to parse as JSON string
                    service_account_info = json.loads(config.EMAIL_SERVICE_ACCOUNT)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse service account JSON: {e}")
                    # If parsing fails, try to use it as a raw string
                    try:
                        service_account_info = eval(config.EMAIL_SERVICE_ACCOUNT)
                    except Exception as e:
                        logger.error(f"Failed to evaluate service account string: {e}")
                        raise
            
            # Create credentials from service account info
            credentials = service_account.Credentials.from_service_account_info(
                service_account_info,
                scopes=['https://www.googleapis.com/auth/spreadsheets']
            )
            
            # Get sheet ID from config
            self.sheet_id = config.SHEET_ID
            if not self.sheet_id:
                raise ValueError("SHEET_ID not configured")
            
            # Build the Sheets API service
            self.service = build('sheets', 'v4', credentials=credentials)
            logger.info("Successfully initialized SheetHandler")
            
        except Exception as e:
            logger.error(f"Error initializing SheetHandler: {e}")
            raise

    def add_subscriber(self, email, first_name, last_name):
        """Add a new subscriber to the Google Sheet"""
        try:
            # Prepare the row data
            row = [email, first_name, last_name]
            
            # Append the row to the sheet
            body = {
                'values': [row]
            }
            
            result = self.service.spreadsheets().values().append(
                spreadsheetId=self.sheet_id,
                range='Email List!A:C',  # Using correct sheet name
                valueInputOption='RAW',
                insertDataOption='INSERT_ROWS',
                body=body
            ).execute()
            
            logger.info(f"Successfully added subscriber: {email}")
            return result
        except Exception as e:
            logger.error(f"Error adding subscriber: {e}")
            raise

    def get_subscribers(self):
        """
        Get all subscribers from the Google Sheet.
        
        Returns:
            list: List of dictionaries containing subscriber information
        """
        try:
            sheet = self.service.spreadsheets()
            
            # Get all values from the sheet
            result = sheet.values().get(
                spreadsheetId=self.sheet_id,
                range='Email List!A:C'  # Using correct sheet name
            ).execute()
            
            values = result.get('values', [])
            
            # Convert values to list of dictionaries, skipping header row
            subscribers = []
            for row in values[1:]:  # Skip first row (header)
                if len(row) >= 3:  # Ensure row has all required fields
                    subscribers.append({
                        'email': row[0],
                        'first_name': row[1],
                        'last_name': row[2]
                    })
            
            logger.info(f"Retrieved {len(subscribers)} subscribers from sheet")
            return subscribers
            
        except Exception as e:
            logger.error(f"Error getting subscribers from sheet: {e}")
            raise

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
            # First, let's check the sheet structure
            sheet_metadata = self.service.spreadsheets().get(spreadsheetId=self.sheet_id).execute()
            sheets = sheet_metadata.get('sheets', '')
            logger.info(f"Available sheets: {[sheet['properties']['title'] for sheet in sheets]}")
            
            # Get the first sheet's name
            first_sheet = sheets[0]['properties']['title']
            logger.info(f"Using sheet: {first_sheet}")
            
            # Find the row with the email
            result = self.service.spreadsheets().values().get(
                spreadsheetId=self.sheet_id,
                range=f'{first_sheet}!A2:D'  # Use the actual sheet name
            ).execute()
            
            values = result.get('values', [])
            if not values:
                logger.warning(f"No subscribers found to unsubscribe: {email}")
                return False
                
            # Log the first row to understand the structure
            if values:
                logger.info(f"First row structure: {values[0]}")
                
            # Find the row with the email
            for i, row in enumerate(values, start=2):  # start=2 because we're starting from A2
                if len(row) > 1 and row[1] == email:  # Make sure row has enough columns and email is in column B
                    # Update the status to 'unsubscribed'
                    self.service.spreadsheets().values().update(
                        spreadsheetId=self.sheet_id,
                        range=f'{first_sheet}!D{i}',  # Use the actual sheet name
                        valueInputOption='RAW',
                        body={'values': [['unsubscribed']]}
                    ).execute()
                    
                    logger.info(f"Successfully unsubscribed: {email}")
                    return True
                    
            logger.warning(f"Email not found to unsubscribe: {email}")
            return False
            
        except Exception as e:
            logger.error(f"Error unsubscribing {email}: {e}")
            return False 