import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta
from scheduler import PrayerScheduler
from config import TestingConfig

class TestPrayerScheduler(unittest.TestCase):
    def setUp(self):
        """Set up test fixtures"""
        # Create mock handlers
        self.mock_prayer_generator = MagicMock()
        self.mock_email_service = MagicMock()
        
        # Initialize the scheduler with mocks
        self.scheduler = PrayerScheduler(
            prayer_generator=self.mock_prayer_generator,
            email_service=self.mock_email_service
        )
        
        # Mock SheetHandler
        self.sheet_handler_patcher = patch('scheduler.SheetHandler')
        self.mock_sheet_handler_class = self.sheet_handler_patcher.start()
        self.mock_sheet_handler = MagicMock()
        self.mock_sheet_handler_class.return_value = self.mock_sheet_handler
        
    def tearDown(self):
        """Clean up test fixtures"""
        self.sheet_handler_patcher.stop()
        
    def test_initialization(self):
        """Test that the scheduler initializes correctly"""
        self.assertIsNotNone(self.scheduler.scheduler)
        self.assertEqual(self.scheduler.prayer_generator, self.mock_prayer_generator)
        self.assertEqual(self.scheduler.email_service, self.mock_email_service)
        
    def test_generate_and_send_prayers_success(self):
        """Test successful prayer generation and sending"""
        # Setup
        mock_subscribers = [
            {'email': 'test1@example.com', 'first_name': 'Test1'},
            {'email': 'test2@example.com', 'first_name': 'Test2'}
        ]
        self.mock_sheet_handler.get_subscribers.return_value = mock_subscribers
        self.mock_prayer_generator.generate_prayer.return_value = "Test Prayer"
        self.mock_prayer_generator.storage.save_prayer.return_value = True
        
        # Execute
        self.scheduler.generate_and_send_prayers()
        
        # Assert
        self.mock_sheet_handler.get_subscribers.assert_called_once()
        self.mock_prayer_generator.generate_prayer.assert_called_once()
        self.mock_prayer_generator.storage.save_prayer.assert_called_once()
        self.assertEqual(self.mock_email_service.send_daily_prayer.call_count, 2)
        
    def test_generate_and_send_prayers_no_subscribers(self):
        """Test prayer generation and sending with no subscribers"""
        # Setup
        self.mock_sheet_handler.get_subscribers.return_value = []
        
        # Execute
        self.scheduler.generate_and_send_prayers()
        
        # Assert
        self.mock_sheet_handler.get_subscribers.assert_called_once()
        self.mock_prayer_generator.generate_prayer.assert_not_called()
        self.mock_email_service.send_daily_prayer.assert_not_called()
        
    def test_run_scheduler(self):
        """Test running the scheduler"""
        # Mock time.sleep to avoid infinite loop
        with patch('time.sleep', side_effect=KeyboardInterrupt):
            # Execute and assert no exceptions are raised
            try:
                self.scheduler.run()
            except KeyboardInterrupt:
                pass
            
            # Assert scheduler was started
            self.assertTrue(self.scheduler.scheduler.start.called)

if __name__ == '__main__':
    unittest.main() 