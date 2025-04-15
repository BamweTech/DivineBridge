import unittest
from unittest.mock import patch, MagicMock
from email_handler import EmailService
from config import TestingConfig

class TestEmailService(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Patch the config to use testing config
        self.config_patcher = patch('email_handler.get_config')
        self.mock_get_config = self.config_patcher.start()
        self.mock_get_config.return_value = TestingConfig()
        
        # Create mock SMTP server
        self.smtp_patcher = patch('smtplib.SMTP')
        self.mock_smtp_class = self.smtp_patcher.start()
        self.mock_smtp = MagicMock()
        self.mock_smtp_class.return_value.__enter__.return_value = self.mock_smtp
        
        # Initialize the email service
        self.email_service = EmailService()
        
    def tearDown(self):
        """Clean up test fixtures"""
        self.config_patcher.stop()
        self.smtp_patcher.stop()
        
    def test_initialization(self):
        """Test that the email service initializes correctly"""
        self.assertIsNotNone(self.email_service.sender_email)
        self.assertIsNotNone(self.email_service.sender_password)
        self.assertEqual(self.email_service.smtp_server, 'smtp.gmail.com')
        self.assertEqual(self.email_service.smtp_port, 587)
        
    def test_send_welcome_email_success(self):
        """Test successful welcome email sending"""
        # Setup
        recipient_email = "test@example.com"
        first_name = "Test"
        prayer_text = "Test Prayer"
        
        # Execute
        result = self.email_service.send_welcome_email(recipient_email, first_name, prayer_text)
        
        # Assert
        self.assertTrue(result)
        self.mock_smtp.login.assert_called_once()
        self.mock_smtp.send_message.assert_called_once()
        
    def test_send_welcome_email_failure(self):
        """Test welcome email sending failure"""
        # Setup
        recipient_email = "test@example.com"
        first_name = "Test"
        prayer_text = "Test Prayer"
        self.mock_smtp.send_message.side_effect = Exception("SMTP Error")
        
        # Execute
        result = self.email_service.send_welcome_email(recipient_email, first_name, prayer_text)
        
        # Assert
        self.assertFalse(result)
        
    def test_send_daily_prayer_success(self):
        """Test successful daily prayer email sending"""
        # Setup
        recipient_email = "test@example.com"
        first_name = "Test"
        prayer_text = "Test Prayer"
        
        # Execute
        result = self.email_service.send_daily_prayer(recipient_email, first_name, prayer_text)
        
        # Assert
        self.assertTrue(result)
        self.mock_smtp.login.assert_called_once()
        self.mock_smtp.send_message.assert_called_once()
        
    def test_send_daily_prayer_failure(self):
        """Test daily prayer email sending failure"""
        # Setup
        recipient_email = "test@example.com"
        first_name = "Test"
        prayer_text = "Test Prayer"
        self.mock_smtp.send_message.side_effect = Exception("SMTP Error")
        
        # Execute
        result = self.email_service.send_daily_prayer(recipient_email, first_name, prayer_text)
        
        # Assert
        self.assertFalse(result)

if __name__ == '__main__':
    unittest.main() 