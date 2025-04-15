import os
from dotenv import load_dotenv
import json
import logging
from google.cloud import secretmanager

# Set up logging
logger = logging.getLogger(__name__)
logger.propagate = False  # Prevent duplicate logs
if not logger.handlers:  # Only add handler if none exists
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

class Config:
    def __init__(self):
        # Load environment variables from .env file if it exists
        load_dotenv()
        
        # Determine environment
        self.env = os.getenv('FLASK_ENV', 'development')
        logger.info(f"Running in {self.env} environment")
        
        # Initialize Secret Manager client if in production
        if self.env == 'production':
            try:
                self.secret_manager = secretmanager.SecretManagerServiceClient()
                logger.info("Successfully initialized Secret Manager client")
            except Exception as e:
                logger.error(f"Failed to initialize Secret Manager client: {e}")
                self.secret_manager = None
        
        # Load secrets from environment variables or .env file
        self._load_secrets()
        
        # Validate configuration
        self.validate_config()
        
        # Set other configuration values
        self.DEBUG = self.env == 'development'
        self.TESTING = self.env == 'testing'
        
    def validate_config(self):
        """Validate all required configuration values"""
        required_vars = [
            'EMAIL_SERVICE_ACCOUNT',
            'EMAIL_USER',
            'EMAIL_PASSWORD',
            'PRAYER_SERVICE_ACCOUNT',
            'SHEET_ID',
            'PERPLEXITY_API_KEY'
        ]
        missing = [var for var in required_vars if not getattr(self, var)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")
        
    def _load_secrets(self):
        """Load secrets from environment variables or .env file"""
        try:
            # Email configuration
            self.EMAIL_SERVICE_ACCOUNT = self._get_secret('EMAIL_SERVICE_ACCOUNT')
            self.EMAIL_USER = self._get_secret('EMAIL_USER')
            self.EMAIL_PASSWORD = self._get_secret('EMAIL_PASSWORD')
            
            # Google Cloud configuration
            self.PRAYER_SERVICE_ACCOUNT = self._get_secret('PRAYER_SERVICE_ACCOUNT')
            self.SHEET_ID = self._get_secret('SHEET_ID')
            
            # API Keys
            self.PERPLEXITY_API_KEY = self._get_secret('PERPLEXITY_API_KEY')
            
            logger.info("Successfully loaded all secrets")
            
        except Exception as e:
            logger.error(f"Error loading secrets: {e}")
            raise
            
    def _get_secret(self, key):
        """Get a secret from environment variables, .env file, or Secret Manager"""
        # First try environment variables
        value = os.getenv(key)
        if value:
            return value
            
        # If in production and Secret Manager is available, try to get from Secret Manager
        if self.env == 'production' and self.secret_manager:
            try:
                project_id = os.getenv('GOOGLE_CLOUD_PROJECT')
                if not project_id:
                    raise ValueError("GOOGLE_CLOUD_PROJECT environment variable not set")
                    
                secret_name = f"projects/{project_id}/secrets/{key}/versions/latest"
                response = self.secret_manager.access_secret_version(request={"name": secret_name})
                value = response.payload.data.decode("UTF-8")
                logger.info(f"Successfully retrieved secret {key} from Secret Manager")
                return value
            except Exception as e:
                logger.error(f"Error accessing secret {key} from Secret Manager: {e}")
                # Continue to raise the original error if environment variable is not set
                
        # If we get here, the secret was not found
        raise ValueError(f"Missing required secret: {key}")

class DevelopmentConfig(Config):
    def __init__(self):
        super().__init__()
        # Development specific settings
        self.DEBUG = True
        self.TESTING = False
        
class TestingConfig(Config):
    def __init__(self):
        super().__init__()
        # Testing specific settings
        self.DEBUG = False
        self.TESTING = True
        # Use mock values for testing
        self.SHEET_ID = "test-sheet-id"
        self.PRAYER_SERVICE_ACCOUNT = json.dumps({
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "test-key-id",
            "private_key": "test-key",
            "client_email": "test@test.com",
            "client_id": "test-client-id"
        })

class ProductionConfig(Config):
    def __init__(self):
        super().__init__()
        # Production specific settings
        self.DEBUG = False
        self.TESTING = False

def get_config():
    """Get the appropriate configuration based on environment"""
    env = os.getenv('FLASK_ENV', 'development')
    
    config_map = {
        'development': DevelopmentConfig,
        'testing': TestingConfig,
        'production': ProductionConfig
    }
    
    config_class = config_map.get(env, DevelopmentConfig)
    return config_class() 