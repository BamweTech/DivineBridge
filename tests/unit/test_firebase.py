import firebase_admin
from firebase_admin import credentials, auth
import json
import logging
from backend.core.config import get_config

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def clean_json_string(json_str):
    """Clean the JSON string by removing problematic characters"""

    # Remove any potential BOM characters
    if json_str.startswith("\ufeff"):
        json_str = json_str[1:]
    # Replace any Windows line endings with Unix line endings
    json_str = json_str.replace("\r\n", "\n")
    # Remove any other control characters except newlines and tabs
    json_str = "".join(char for char in json_str if char >= " " or char in "\n\t")
    return json_str


def test_firebase_initialization():
    try:
        # Get configuration
        config = get_config()
        logger.info("Successfully loaded configuration")

        # Check if credentials are present
        if not config.FIREBASE_CREDENTIALS:
            logger.error("Firebase credentials not found in configuration")
            return False

        # Parse credentials from config (matching production code)
        try:
            cred = credentials.Certificate(json.loads(config.FIREBASE_CREDENTIALS))
            logger.info("Successfully created Firebase credentials object")
        except Exception as e:
            logger.error(f"Error creating Firebase credentials: {e}")
            return False

        # Initialize Firebase if not already initialized
        if not firebase_admin._apps:
            try:
                firebase_admin.initialize_app(cred)
                logger.info("Successfully initialized Firebase Admin SDK")
            except Exception as e:
                logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
                return False

        # Test authentication by getting a list of users (limited to 1 for testing)
        try:
            users = auth.list_users(max_results=1)
            logger.info("Successfully connected to Firebase Authentication")
            first_user = next(users.users, None)
            if first_user:
                logger.info(f"Found user with email: {first_user.email}")
            else:
                logger.info("No users found in the database")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to Firebase Authentication: {e}")
            return False

    except Exception as e:
        logger.error(f"Firebase initialization test failed: {e}")
        return False


if __name__ == "__main__":
    success = test_firebase_initialization()
    if success:
        logger.info("Firebase initialization test completed successfully")
    else:
        logger.error("Firebase initialization test failed")
