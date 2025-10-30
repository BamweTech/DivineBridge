import os
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
        # Initialize Secret Manager client
        try:
            self.secret_manager = secretmanager.SecretManagerServiceClient()
            logger.info("Successfully initialized Secret Manager client")
        except Exception as e:
            logger.error(f"Failed to initialize Secret Manager client: {e}")
            self.secret_manager = None
        
        # First get the project ID from environment or Secret Manager
        self.GOOGLE_CLOUD_PROJECT = os.getenv('GOOGLE_CLOUD_PROJECT')
        if not self.GOOGLE_CLOUD_PROJECT:
            logger.info("GOOGLE_CLOUD_PROJECT not in environment, trying Secret Manager")
            self.GOOGLE_CLOUD_PROJECT = self._get_secret_direct('GOOGLE_CLOUD_PROJECT')
        else:
            logger.info(f"Using GOOGLE_CLOUD_PROJECT from environment: {self.GOOGLE_CLOUD_PROJECT}")
        
        # Then load all other secrets
        self._load_secrets()
        
        # Validate configuration
        self.validate_config()
        
        # Set CORS configuration
        self.CORS_ORIGINS = [
            'https://divinebridge.io',
            'https://www.divinebridge.io',
            'https://api.divinebridge.io'
        ]
        self.CORS_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
        self.CORS_ALLOW_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With']
        self.CORS_SUPPORTS_CREDENTIALS = True
        self.CORS_MAX_AGE = 3600
        # Additional security headers
        self.CORS_EXPOSE_HEADERS = []
        self.CORS_VARY_HEADER = True
        
    def validate_config(self):
        """Validate all required configuration values"""
        required_vars = [
            'email_service_account',
            'email_user',
            'email_password',
            'prayer_service_account',
            'sheet_id',
            'perplexity_api_key',
            'FIREBASE_CLIENT_CONFIG',
            'FIREBASE_CREDENTIALS',
            'GOOGLE_CLOUD_PROJECT'
        ]
        
        missing = [var for var in required_vars if not getattr(self, var)]
        if missing:
            raise ValueError(f"Missing required configuration: {', '.join(missing)}")
            
    def _load_secrets(self):
        """Load secrets from Secret Manager"""
        try:
            # Load Firebase credentials
            self.FIREBASE_CREDENTIALS = self._get_secret('FIREBASE_CREDENTIALS')
            self.FIREBASE_CLIENT_CONFIG = json.loads(self._get_secret('FIREBASE_CLIENT_CONFIG'))
            
            # Email configuration
            self.email_service_account = self._get_secret('email-service-account')
            self.email_user = self._get_secret('email-user')
            self.email_password = self._get_secret('email-password')
            
            # Google Cloud configuration
            self.prayer_service_account = self._get_secret('prayer-service-account')
            self.sheet_id = self._get_secret('sheet-id')
            self.google_credentials = self._get_secret('google-credentials')
            
            # API Keys
            self.perplexity_api_key = self._get_secret('perplexity-api-key')
            
            # Session secret key
            self.session_secret_key = self._get_secret('session-secret-key')
            
            logger.info("Successfully loaded all secrets")
            
        except Exception as e:
            logger.error(f"Error loading secrets: {e}")
            raise
            
    def _get_secret_direct(self, key):
        """Get a secret directly from Secret Manager without using project ID"""
        if self.secret_manager:
            try:
                secret_name = f"projects/divinebridge/secrets/{key}/versions/latest"
                logger.info(f"Attempting to retrieve secret {key} from Secret Manager at {secret_name}")
                response = self.secret_manager.access_secret_version(request={"name": secret_name})
                value = response.payload.data.decode("UTF-8")
                logger.info(f"Successfully retrieved secret {key} from Secret Manager")
                return value
            except Exception as e:
                logger.error(f"Error accessing secret {key} from Secret Manager: {e}")
                if hasattr(e, 'details'):
                    logger.error(f"Error details: {e.details}")
                raise ValueError(f"Failed to get secret {key} from Secret Manager: {str(e)}")
        logger.error(f"Secret Manager client not initialized for {key}")
        raise ValueError(f"Missing required secret: {key}")
            
    def _get_secret(self, key):
        """Get a secret from Secret Manager using project ID"""
        if self.secret_manager:
            try:
                secret_name = f"projects/{self.GOOGLE_CLOUD_PROJECT}/secrets/{key}/versions/latest"
                logger.info(f"Attempting to retrieve secret {key} from Secret Manager at {secret_name}")
                response = self.secret_manager.access_secret_version(request={"name": secret_name})
                value = response.payload.data.decode("UTF-8")
                
                # For JSON secrets, validate format
                if key in ['FIREBASE_CREDENTIALS', 'FIREBASE_CLIENT_CONFIG'] or key.endswith('_SERVICE_ACCOUNT'):
                    try:
                        json.loads(value)
                        logger.info(f"Successfully validated JSON format for {key}")
                    except json.JSONDecodeError as e:
                        logger.error(f"Invalid JSON format for {key}: {e}")
                        logger.error(f"First 100 characters of {key}: {value[:100]}")
                        raise ValueError(f"Invalid JSON format for {key}")
                        
                logger.info(f"Successfully retrieved secret {key} from Secret Manager")
                return value
            except Exception as e:
                logger.error(f"Error accessing secret {key} from Secret Manager: {e}")
                if hasattr(e, 'details'):
                    logger.error(f"Error details: {e.details}")
                raise ValueError(f"Failed to get secret {key} from Secret Manager: {str(e)}")
        logger.error(f"Secret Manager client not initialized for {key}")
        raise ValueError(f"Missing required secret: {key}")

# Singleton instance
_config_instance = None

def get_config():
    """Get the configuration (singleton pattern to avoid multiple Secret Manager calls)"""
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance 