import os
from google.oauth2 import service_account
from googleapiclient.discovery import build
import logging
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class SheetHandler:
    def __init__(self, credentials_file):
        """
        Initialize the SheetHandler with Google Sheets API credentials.
        
        Args:
            credentials_file: Path to the Google Cloud credentials JSON file
        """
        try:
            self.credentials = service_account.Credentials.from_service_account_file(
                credentials_file,
                scopes=['https://www.googleapis.com/auth/spreadsheets']
            )
            self.service = build('sheets', 'v4', credentials=self.credentials)
            logger.info("SheetHandler initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing SheetHandler: {e}")
            raise

    def add_subscriber(self, email, first_name, last_name):
        """
        Add a new subscriber to the Google Sheet.
        
        Args:
            email: Subscriber's email address
            first_name: Subscriber's first name
            last_name: Subscriber's last name
        """
        try:
            # Get the Google Sheet
            sheet_id = os.getenv('SPREADSHEET_ID')
            if not sheet_id:
                raise ValueError("SPREADSHEET_ID not found in environment variables")
                
            sheet = self.service.spreadsheets()
            
            # Add the new subscriber
            values = [[email, first_name, last_name]]
            body = {
                'values': values
            }
            
            result = sheet.values().append(
                spreadsheetId=sheet_id,
                range='A:C',
                valueInputOption='RAW',
                body=body
            ).execute()
            
            logger.info(f"New subscription added to sheet: {first_name} {last_name} - {email}")
            
        except Exception as e:
            logger.error(f"Error adding subscriber to sheet: {e}")
            raise

    def get_subscribers(self):
        """
        Get all subscribers from the Google Sheet.
        
        Returns:
            list: List of dictionaries containing subscriber information
        """
        try:
            # Get the Google Sheet
            sheet_id = os.getenv('SPREADSHEET_ID')
            if not sheet_id:
                raise ValueError("SPREADSHEET_ID not found in environment variables")
                
            sheet = self.service.spreadsheets()
            
            # Get all values from the sheet
            result = sheet.values().get(
                spreadsheetId=sheet_id,
                range='A:C'
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