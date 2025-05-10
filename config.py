import os
from dotenv import load_dotenv
import json
import logging
from google.cloud import secretmanager
from google.oauth2 import service_account
import tempfile

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
        
        # Initialize Secret Manager client
        try:
            self.secret_manager = secretmanager.SecretManagerServiceClient()
            logger.info("Successfully initialized Secret Manager client")
        except Exception as e:
            logger.error(f"Failed to initialize Secret Manager client: {e}")
            self.secret_manager = None
        
        # Load secrets from environment variables or Secret Manager
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
        
        # Only require Firebase and Google Cloud credentials in production
        if self.env == 'production':
            required_vars.extend(['GOOGLE_CLOUD_CREDENTIALS'])
            
        # In development mode, only validate that the variables exist, not their values
        if self.env == 'development':
            missing = [var for var in required_vars if not os.getenv(var)]
            if missing:
                logger.warning(f"Missing configuration in development mode: {', '.join(missing)}")
                # Don't raise an error in development mode
        else:
            missing = [var for var in required_vars if not getattr(self, var)]
            if missing:
                raise ValueError(f"Missing required configuration: {', '.join(missing)}")
            
    def _load_secrets(self):
        """Load secrets from environment variables or Secret Manager"""
        try:
            # Load Firebase credentials from Secret Manager
            try:
                self.FIREBASE_CREDENTIALS = self._get_secret('FIREBASE_CREDENTIALS')
                logger.info("Successfully loaded Firebase credentials from Secret Manager")
            except Exception as e:
                logger.error(f"Failed to load Firebase credentials from Secret Manager: {e}")
                raise
                
            # Load Firebase client configuration
            try:
                self.FIREBASE_CLIENT_CONFIG = json.loads(self._get_secret('FIREBASE_CLIENT_CONFIG'))
                logger.info("Successfully loaded Firebase client configuration")
            except Exception as e:
                logger.error(f"Failed to load Firebase client configuration: {e}")
                raise
                
            # Email configuration
            self.EMAIL_SERVICE_ACCOUNT = self._get_secret('EMAIL_SERVICE_ACCOUNT')
            self.EMAIL_USER = self._get_secret('EMAIL_USER')
            self.EMAIL_PASSWORD = self._get_secret('EMAIL_PASSWORD')
            
            # Google Cloud configuration
            self.PRAYER_SERVICE_ACCOUNT = self._get_secret('PRAYER_SERVICE_ACCOUNT')
            self.SHEET_ID = self._get_secret('SHEET_ID')
            
            # API Keys
            self.PERPLEXITY_API_KEY = self._get_secret('PERPLEXITY_API_KEY')
            
            # Google Cloud credentials (optional in development)
            try:
                self.GOOGLE_CLOUD_CREDENTIALS = self._get_secret('GOOGLE_CLOUD_CREDENTIALS')
            except ValueError as e:
                if self.env == 'production':
                    raise
                else:
                    logger.warning("Google Cloud credentials not found in development mode")
                    self.GOOGLE_CLOUD_CREDENTIALS = None
            
            logger.info("Successfully loaded all secrets")
            
        except Exception as e:
            logger.error(f"Error loading secrets: {e}")
            raise
            
    def _get_secret(self, key):
        """Get a secret from environment variables or Secret Manager"""
        # First try environment variables
        value = os.getenv(key)
        if value:
            logger.info(f"Retrieved {key} from environment variables")
            return value
            
        # If Secret Manager is available, try to get from Secret Manager
        if self.secret_manager:
            try:
                project_id = os.getenv('GOOGLE_CLOUD_PROJECT')
                if not project_id:
                    raise ValueError("GOOGLE_CLOUD_PROJECT environment variable not set")
                    
                secret_name = f"projects/{project_id}/secrets/{key}/versions/latest"
                logger.info(f"Attempting to retrieve secret {key} from Secret Manager at {secret_name}")
                response = self.secret_manager.access_secret_version(request={"name": secret_name})
                value = response.payload.data.decode("UTF-8")
                logger.info(f"Successfully retrieved secret {key} from Secret Manager")
                
                # For service account secrets, validate JSON format
                if key.endswith('_SERVICE_ACCOUNT') or key == 'FIREBASE_CREDENTIALS':
                    try:
                        json.loads(value)  # Validate JSON format
                        logger.info(f"Successfully validated JSON format for {key}")
                    except json.JSONDecodeError as e:
                        logger.error(f"Invalid JSON format for {key}: {e}")
                        logger.error(f"First 100 characters of {key}: {value[:100]}")
                        raise ValueError(f"Invalid JSON format for {key}")
                
                return value
            except Exception as e:
                logger.error(f"Error accessing secret {key} from Secret Manager: {e}")
                if hasattr(e, 'details'):
                    logger.error(f"Error details: {e.details}")
                raise ValueError(f"Failed to get secret {key} from Secret Manager: {str(e)}")
        
        # If we get here, the secret was not found
        logger.error(f"Secret {key} not found in environment variables or Secret Manager")
        raise ValueError(f"Missing required secret: {key}")

class DevelopmentConfig(Config):
    """Development configuration."""
    CORS_ORIGINS = ['*']
    CORS_SUPPORTS_CREDENTIALS = False

class TestingConfig(Config):
    """Testing configuration."""
    TESTING = True
    CORS_ORIGINS = ['*']
    CORS_SUPPORTS_CREDENTIALS = False
    
    def __init__(self):
        # Skip loading environment variables and secrets in testing
        self.env = 'testing'
        self.DEBUG = True
        self.TESTING = True
        self.SHEET_ID = 'test-sheet-id'
        self.EMAIL_SERVICE_ACCOUNT = '{"type": "service_account", "project_id": "test-project"}'
        self.EMAIL_USER = 'test@example.com'
        self.EMAIL_PASSWORD = 'test-password'
        self.PRAYER_SERVICE_ACCOUNT = '{"type": "service_account", "project_id": "test-project"}'
        self.GOOGLE_CLOUD_CREDENTIALS = '{"type": "service_account", "project_id": "test-project"}'
        self.secret_manager = None
        self.SKIP_ACCESS_VERIFICATION = True

class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    CORS_ORIGINS = [
        'https://divinebridge.io',
        'https://www.divinebridge.io',
        'https://api.divinebridge.io'
    ]
    CORS_SUPPORTS_CREDENTIALS = True

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