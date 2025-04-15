import unittest
from unittest.mock import patch, MagicMock
from flask import Flask
from config import TestingConfig

# Mock the logging setup before importing app
with patch('google.cloud.logging.Client'), \
     patch('google.auth.default', return_value=(MagicMock(), 'test-project')):
    from app import app

class TestApp(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Set testing configuration
        app.config['TESTING'] = True
        self.client = app.test_client()
        
        # Create mock handlers
        self.mock_prayer_generator = MagicMock()
        self.mock_storage_handler = MagicMock()
        self.mock_email_service = MagicMock()
        self.mock_sheet_handler = MagicMock()
        
        # Patch the handlers
        self.prayer_generator_patcher = patch('app.PrayerGenerator')
        self.storage_handler_patcher = patch('app.StorageHandler')
        self.email_service_patcher = patch('app.EmailService')
        self.sheet_handler_patcher = patch('app.SheetHandler')
        
        self.mock_prayer_generator_class = self.prayer_generator_patcher.start()
        self.mock_storage_handler_class = self.storage_handler_patcher.start()
        self.mock_email_service_class = self.email_service_patcher.start()
        self.mock_sheet_handler_class = self.sheet_handler_patcher.start()
        
        self.mock_prayer_generator_class.return_value = self.mock_prayer_generator
        self.mock_storage_handler_class.return_value = self.mock_storage_handler
        self.mock_email_service_class.return_value = self.mock_email_service
        self.mock_sheet_handler_class.return_value = self.mock_sheet_handler
        
    def tearDown(self):
        """Clean up test fixtures"""
        self.prayer_generator_patcher.stop()
        self.storage_handler_patcher.stop()
        self.email_service_patcher.stop()
        self.sheet_handler_patcher.stop()
        
    def test_index_route(self):
        """Test the index route"""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        
    def test_subscribe_route_success(self):
        """Test successful subscription"""
        # Setup
        self.mock_sheet_handler.add_subscriber.return_value = True
        self.mock_email_service.send_welcome_email.return_value = True
        
        # Execute
        response = self.client.post('/subscribe', json={
            'email': 'test@example.com',
            'firstName': 'Test',
            'lastName': 'User'
        })
        
        # Assert
        self.assertEqual(response.status_code, 200)
        self.mock_sheet_handler.add_subscriber.assert_called_once()
        self.mock_email_service.send_welcome_email.assert_called_once()
        
    def test_subscribe_route_failure(self):
        """Test subscription failure"""
        # Setup
        self.mock_sheet_handler.add_subscriber.return_value = False
        
        # Execute
        response = self.client.post('/subscribe', json={
            'email': 'test@example.com',
            'firstName': 'Test',
            'lastName': 'User'
        })
        
        # Assert
        self.assertEqual(response.status_code, 500)
        
    def test_unsubscribe_route_success(self):
        """Test successful unsubscription"""
        # Setup
        self.mock_sheet_handler.remove_subscriber.return_value = True
        self.mock_email_service.send_unsubscribe_confirmation.return_value = True
        
        # Execute
        response = self.client.post('/unsubscribe', json={
            'email': 'test@example.com'
        })
        
        # Assert
        self.assertEqual(response.status_code, 200)
        self.mock_sheet_handler.remove_subscriber.assert_called_once()
        self.mock_email_service.send_unsubscribe_confirmation.assert_called_once()
        
    def test_unsubscribe_route_failure(self):
        """Test unsubscription failure"""
        # Setup
        self.mock_sheet_handler.remove_subscriber.return_value = False
        
        # Execute
        response = self.client.post('/unsubscribe', json={
            'email': 'test@example.com'
        })
        
        # Assert
        self.assertEqual(response.status_code, 500)
        
    def test_get_prayer_route_success(self):
        """Test successful prayer retrieval"""
        # Setup
        self.mock_storage_handler.get_prayer.return_value = "Test prayer"
        
        # Execute
        response = self.client.get('/prayer/2024-01-01')
        
        # Assert
        self.assertEqual(response.status_code, 200)
        self.mock_storage_handler.get_prayer.assert_called_once()
        
    def test_get_prayer_route_not_found(self):
        """Test prayer retrieval when prayer doesn't exist"""
        # Setup
        self.mock_storage_handler.get_prayer.return_value = None
        
        # Execute
        response = self.client.get('/prayer/2024-01-01')
        
        # Assert
        self.assertEqual(response.status_code, 404)
        
    def test_generate_prayer_route_success(self):
        """Test successful prayer generation"""
        # Setup
        self.mock_prayer_generator.generate_prayer.return_value = "Test prayer"
        self.mock_storage_handler.save_prayer.return_value = True
        
        # Execute
        response = self.client.post('/generate-prayer')
        
        # Assert
        self.assertEqual(response.status_code, 200)
        self.mock_prayer_generator.generate_prayer.assert_called_once()
        self.mock_storage_handler.save_prayer.assert_called_once()
        
    def test_generate_prayer_route_failure(self):
        """Test prayer generation failure"""
        # Setup
        self.mock_prayer_generator.generate_prayer.return_value = None
        
        # Execute
        response = self.client.post('/generate-prayer')
        
        # Assert
        self.assertEqual(response.status_code, 500)

if __name__ == '__main__':
    unittest.main() 