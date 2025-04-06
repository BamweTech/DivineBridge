import os
from dotenv import load_dotenv
import logging
import json

logger = logging.getLogger(__name__)

class Config:
    def __init__(self):
        # Load environment variables
        load_dotenv()
        
        # Google Cloud settings
        self.EMAIL_SERVICE_ACCOUNT = os.getenv('EMAIL_SERVICE_ACCOUNT')
        self.PRAYER_SERVICE_ACCOUNT = os.getenv('PRAYER_SERVICE_ACCOUNT')
        self.GOOGLE_CLOUD_BUCKET = os.getenv('GOOGLE_CLOUD_BUCKET', 'divinebridge-prayers')
        self.SHEET_ID = os.getenv('SHEET_ID')
        
        # Email settings
        self.EMAIL_USER = os.getenv('EMAIL_USER')
        self.EMAIL_PASSWORD = os.getenv('EMAIL_PASSWORD')
        
        # API Keys
        self.PERPLEXITY_API_KEY = os.getenv('PERPLEXITY_API_KEY')
        
        # Debug mode
        self.DEBUG = os.getenv('FLASK_ENV') == 'development'
        
        # Log configuration
        logger.info(f"Initialized Config with FLASK_ENV={os.getenv('FLASK_ENV', 'development')}")

class LocalConfig(Config):
    def __init__(self):
        super().__init__()
        # Load service account files for local development
        try:
            with open('divinebridge-676c7c0963dd.json', 'r') as f:
                self.EMAIL_SERVICE_ACCOUNT = json.load(f)
            with open('divinebridge-db42f07139c5.json', 'r') as f:
                self.PRAYER_SERVICE_ACCOUNT = json.load(f)
            logger.info("Using local configuration with local service account files")
        except Exception as e:
            logger.error(f"Error loading service account files: {e}")
            raise

class ProductionConfig(Config):
    def __init__(self):
        super().__init__()
        # In production, the secrets are provided as environment variables
        logger.info("Using production configuration with environment variables")

def get_config():
    """Get the appropriate configuration based on environment"""
    env = os.getenv('FLASK_ENV', 'development')
    if env == 'production':
        return ProductionConfig()
    return LocalConfig() 