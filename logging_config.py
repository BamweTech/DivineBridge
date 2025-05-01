import logging
import os
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

        # Configure root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.INFO)
        
        # Remove any existing handlers
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
            
        # Add handlers to root logger
        root_logger.addHandler(file_handler)
        root_logger.addHandler(console_handler)

        # Create loggers for different components
        loggers = {
            'prayer_generator': logging.getLogger('prayer_generator'),
            'storage_handler': logging.getLogger('storage_handler'),
            'app': logging.getLogger('app')
        }

        # Set up component-specific loggers
        for logger_name, logger in loggers.items():
            logger.setLevel(logging.INFO)
            logger.propagate = False  # Prevent propagation to root logger
            
            # Remove any existing handlers
            for handler in logger.handlers[:]:
                logger.removeHandler(handler)
                
            # Add handlers
            logger.addHandler(file_handler)
            logger.addHandler(console_handler)

        logging.info("Logging configuration completed successfully")
        return loggers

    except Exception as e:
        print(f"Error setting up logging: {e}")
        raise 