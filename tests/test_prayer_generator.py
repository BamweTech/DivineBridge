import unittest
from unittest.mock import patch, MagicMock
from prayer_generator import PrayerGenerator
from config import TestingConfig
from unittest import TestCase, mock
from storage_handler import StorageHandler

class TestPrayerGenerator(TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Patch the config to use testing config
        self.config_patcher = patch('prayer_generator.get_config')
        self.mock_get_config = self.config_patcher.start()
        self.mock_get_config.return_value = TestingConfig()
        
        # Create mock client
        self.mock_client = MagicMock()
        
        # Patch the client
        self.client_patcher = patch('prayer_generator.Client')
        self.mock_client_class = self.client_patcher.start()
        self.mock_client_class.return_value = self.mock_client
        
        # Initialize the prayer generator
        self.storage = mock.Mock(spec=StorageHandler)
        self.prayer_generator = PrayerGenerator(self.storage)
        
    def tearDown(self):
        """Clean up test fixtures"""
        self.config_patcher.stop()
        self.client_patcher.stop()
        
    def test_initialization(self):
        """Test that the prayer generator initializes correctly"""
        self.mock_client_class.assert_called_once()
        
    def test_generate_prayer_success(self):
        """Test successful prayer generation"""
        # Setup
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Generated prayer text"
        self.mock_client.chat.completions.create.return_value = mock_response
        
        # Execute
        result = self.prayer_generator.generate_prayer()
        
        # Assert
        self.assertIsNotNone(result)
        self.assertEqual(result, "Generated prayer text")
        self.mock_client.chat.completions.create.assert_called_once()
        
    def test_generate_prayer_failure(self):
        """Test prayer generation failure"""
        # Setup
        self.mock_client.chat.completions.create.side_effect = Exception("API Error")
        
        # Execute
        result = self.prayer_generator.generate_prayer()
        
        # Assert
        self.assertIsNone(result)
        
    def test_generate_prayer_with_verse_success(self):
        """Test successful prayer generation with verse"""
        # Setup
        mock_prayer_response = MagicMock()
        mock_prayer_response.choices = [MagicMock()]
        mock_prayer_response.choices[0].message.content = "Generated prayer text"
        
        mock_verse_response = MagicMock()
        mock_verse_response.choices = [MagicMock()]
        mock_verse_response.choices[0].message.content = "Generated verse text"
        
        self.mock_client.chat.completions.create.side_effect = [
            mock_prayer_response,
            mock_verse_response
        ]
        
        # Execute
        prayer, verse = self.prayer_generator.generate_prayer_with_verse()
        
        # Assert
        self.assertIsNotNone(prayer)
        self.assertIsNotNone(verse)
        self.assertEqual(prayer, "Generated prayer text")
        self.assertEqual(verse, "Generated verse text")
        self.assertEqual(self.mock_client.chat.completions.create.call_count, 2)
        
    def test_generate_prayer_with_verse_failure(self):
        """Test prayer generation with verse failure"""
        # Setup
        self.mock_client.chat.completions.create.side_effect = Exception("API Error")
        
        # Execute
        prayer, verse = self.prayer_generator.generate_prayer_with_verse()
        
        # Assert
        self.assertIsNone(prayer)
        self.assertIsNone(verse)

if __name__ == '__main__':
    unittest.main() 