import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime
import json
from storage_handler import StorageHandler
from config import TestingConfig

class TestStorageHandler(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Patch the config to use testing config
        self.config_patcher = patch('storage_handler.get_config')
        self.mock_get_config = self.config_patcher.start()
        self.mock_get_config.return_value = TestingConfig()
        
        # Create a mock storage client
        self.mock_client = MagicMock()
        self.mock_bucket = MagicMock()
        self.mock_client.get_bucket.return_value = self.mock_bucket
        
        # Patch the storage client
        self.storage_patcher = patch('storage_handler.storage.Client')
        self.mock_storage = self.storage_patcher.start()
        self.mock_storage.from_service_account_info.return_value = self.mock_client
        
        # Initialize the storage handler
        self.storage_handler = StorageHandler()
        
    def tearDown(self):
        """Clean up test fixtures"""
        self.config_patcher.stop()
        self.storage_patcher.stop()
        
    def test_initialization(self):
        """Test that the storage handler initializes correctly"""
        self.mock_storage.from_service_account_info.assert_called_once()
        self.mock_client.get_bucket.assert_called_once_with('divinebridge-prayers')
        
    def test_save_prayer_success(self):
        """Test successful prayer saving"""
        # Setup
        prayer_text = "Test prayer"
        date = datetime.now().strftime('%Y-%m-%d')
        mock_blob = MagicMock()
        self.mock_bucket.blob.return_value = mock_blob
        
        # Execute
        result = self.storage_handler.save_prayer(prayer_text, date)
        
        # Assert
        self.assertTrue(result)
        self.mock_bucket.blob.assert_called_once_with(f'prayers/{date}.txt')
        mock_blob.upload_from_string.assert_called_once_with(prayer_text)
        
    def test_save_prayer_ssl_error(self):
        """Test prayer saving with SSL error"""
        # Setup
        prayer_text = "Test prayer"
        mock_blob = MagicMock()
        mock_blob.upload_from_string.side_effect = Exception("SSL Error")
        self.mock_bucket.blob.return_value = mock_blob
        
        # Execute
        result = self.storage_handler.save_prayer(prayer_text)
        
        # Assert
        self.assertFalse(result)
        
    def test_get_prayer_success(self):
        """Test successful prayer retrieval"""
        # Setup
        date = "2024-01-01"
        expected_text = "Test prayer"
        mock_blob = MagicMock()
        mock_blob.exists.return_value = True
        mock_blob.download_as_text.return_value = expected_text
        self.mock_bucket.blob.return_value = mock_blob
        
        # Execute
        result = self.storage_handler.get_prayer(date)
        
        # Assert
        self.assertEqual(result, expected_text)
        self.mock_bucket.blob.assert_called_once_with(f'prayers/{date}.txt')
        
    def test_get_prayer_not_found(self):
        """Test prayer retrieval when prayer doesn't exist"""
        # Setup
        date = "2024-01-01"
        mock_blob = MagicMock()
        mock_blob.exists.return_value = False
        self.mock_bucket.blob.return_value = mock_blob
        
        # Execute
        result = self.storage_handler.get_prayer(date)
        
        # Assert
        self.assertIsNone(result)
        
    def test_get_verse_success(self):
        """Test successful verse retrieval"""
        # Setup
        mock_verses = [
            {"text": "Test verse 1", "reference": "John 1:1"},
            {"text": "Test verse 2", "reference": "John 1:2"}
        ]
        with patch('builtins.open', unittest.mock.mock_open(read_data=json.dumps({"verses": mock_verses}))):
            # Execute
            result = self.storage_handler.get_verse()
            
            # Assert
            self.assertIsNotNone(result)
            self.assertIn("VERSE:", result)
            self.assertIn("REFERENCE:", result)
            
    def test_get_verse_no_verses(self):
        """Test verse retrieval when no verses are available"""
        # Setup
        with patch('builtins.open', unittest.mock.mock_open(read_data=json.dumps({"verses": []}))):
            # Execute
            result = self.storage_handler.get_verse()
            
            # Assert
            self.assertIsNone(result)

if __name__ == '__main__':
    unittest.main() 