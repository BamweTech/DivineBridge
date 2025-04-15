import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime
from sheet_handler import SheetHandler
from config import TestingConfig

class TestSheetHandler(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Patch the config to use testing config
        self.config_patcher = patch('sheet_handler.get_config')
        self.mock_get_config = self.config_patcher.start()
        self.mock_get_config.return_value = TestingConfig()
        
        # Create mock service
        self.mock_service = MagicMock()
        self.mock_spreadsheet = MagicMock()
        self.mock_sheet = MagicMock()
        
        # Setup mock chain
        self.mock_service.spreadsheets.return_value = self.mock_spreadsheet
        self.mock_spreadsheet.values.return_value = self.mock_sheet
        
        # Patch the build function
        self.build_patcher = patch('sheet_handler.build')
        self.mock_build = self.build_patcher.start()
        self.mock_build.return_value = self.mock_service
        
        # Initialize the sheet handler
        self.sheet_handler = SheetHandler()
        
    def tearDown(self):
        """Clean up test fixtures"""
        self.config_patcher.stop()
        self.build_patcher.stop()
        
    def test_initialization(self):
        """Test that the sheet handler initializes correctly"""
        self.mock_build.assert_called_once()
        self.assertEqual(self.sheet_handler.sheet_id, "test-sheet-id")
        
    def test_add_subscriber_success(self):
        """Test successful subscriber addition"""
        # Setup
        email = "test@example.com"
        first_name = "Test"
        last_name = "User"
        subscribed_date = datetime.now().strftime('%Y-%m-%d')
        
        # Mock the append response
        mock_response = {'updates': {'updatedRows': 1}}
        self.mock_sheet.append.return_value.execute.return_value = mock_response
        
        # Execute
        result = self.sheet_handler.add_subscriber(email, first_name, last_name)
        
        # Assert
        self.assertTrue(result)
        self.mock_sheet.append.assert_called_once()
        
    def test_add_subscriber_failure(self):
        """Test subscriber addition failure"""
        # Setup
        email = "test@example.com"
        first_name = "Test"
        last_name = "User"
        
        # Mock the append to raise an exception
        self.mock_sheet.append.return_value.execute.side_effect = Exception("API Error")
        
        # Execute
        result = self.sheet_handler.add_subscriber(email, first_name, last_name)
        
        # Assert
        self.assertFalse(result)
        
    def test_get_subscribers_success(self):
        """Test successful subscriber retrieval"""
        # Setup
        mock_values = [
            ['email1@example.com', 'John', 'Doe', '2024-01-01'],
            ['email2@example.com', 'Jane', 'Smith', '2024-01-02']
        ]
        self.mock_sheet.get.return_value.execute.return_value = {'values': mock_values}
        
        # Execute
        subscribers = self.sheet_handler.get_subscribers()
        
        # Assert
        self.assertEqual(len(subscribers), 2)
        self.assertEqual(subscribers[0]['email'], 'email1@example.com')
        self.assertEqual(subscribers[1]['first_name'], 'Jane')
        
    def test_get_subscribers_empty(self):
        """Test subscriber retrieval when sheet is empty"""
        # Setup
        self.mock_sheet.get.return_value.execute.return_value = {'values': []}
        
        # Execute
        subscribers = self.sheet_handler.get_subscribers()
        
        # Assert
        self.assertEqual(len(subscribers), 0)
        
    def test_remove_subscriber_success(self):
        """Test successful subscriber removal"""
        # Setup
        email = "test@example.com"
        mock_values = [
            ['test@example.com', 'Test', 'User', '2024-01-01'],
            ['other@example.com', 'Other', 'User', '2024-01-02']
        ]
        self.mock_sheet.get.return_value.execute.return_value = {'values': mock_values}
        self.mock_sheet.clear.return_value.execute.return_value = {}
        self.mock_sheet.update.return_value.execute.return_value = {}
        
        # Execute
        result = self.sheet_handler.remove_subscriber(email)
        
        # Assert
        self.assertTrue(result)
        self.mock_sheet.clear.assert_called_once()
        self.mock_sheet.update.assert_called_once()
        
    def test_remove_subscriber_not_found(self):
        """Test subscriber removal when subscriber doesn't exist"""
        # Setup
        email = "nonexistent@example.com"
        mock_values = [
            ['test@example.com', 'Test', 'User', '2024-01-01']
        ]
        self.mock_sheet.get.return_value.execute.return_value = {'values': mock_values}
        
        # Execute
        result = self.sheet_handler.remove_subscriber(email)
        
        # Assert
        self.assertFalse(result)
        self.mock_sheet.clear.assert_not_called()
        self.mock_sheet.update.assert_not_called()

if __name__ == '__main__':
    unittest.main() 