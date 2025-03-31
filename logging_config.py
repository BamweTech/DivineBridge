import logging
import os
from google.cloud import logging as google_logging
from datetime import datetime

def setup_logging():
    """Set up logging configuration for both local and Google Cloud"""
    try:
        # Create logs directory if it doesn't exist
        if not os.path.exists('logs'):
            os.makedirs('logs')

        # Set up local file logging
        log_filename = f'logs/app_{datetime.now().strftime("%Y%m%d")}.log'
        file_handler = logging.FileHandler(log_filename)
        file_handler.setLevel(logging.INFO)
        file_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        file_handler.setFormatter(file_formatter)

        # Set up console logging
        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)
        console_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_formatter)

        # Set up Google Cloud Logging
        client = google_logging.Client()
        cloud_handler = client.get_default_handler()
        cloud_handler.setLevel(logging.INFO)
        cloud_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        cloud_handler.setFormatter(cloud_formatter)

        # Configure root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.INFO)
        root_logger.addHandler(file_handler)
        root_logger.addHandler(console_handler)
        root_logger.addHandler(cloud_handler)

        # Create loggers for different components
        loggers = {
            'prayer_generator': logging.getLogger('prayer_generator'),
            'storage_handler': logging.getLogger('storage_handler'),
            'app': logging.getLogger('app')
        }

        # Set up component-specific loggers
        for logger_name, logger in loggers.items():
            logger.setLevel(logging.INFO)
            logger.addHandler(file_handler)
            logger.addHandler(console_handler)
            logger.addHandler(cloud_handler)

        logging.info("Logging configuration completed successfully")
        return loggers

    except Exception as e:
        print(f"Error setting up logging: {e}")
        raise 