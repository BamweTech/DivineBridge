import logging
from backend.core.config import get_config
from backend.integrations.firebase_auth import initialize_firebase

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


def test_firebase_init():
    """Test Firebase initialization"""
    try:
        # Get configuration
        get_config()
        logger.info("Successfully loaded configuration")

        # Initialize Firebase
        if initialize_firebase():
            logger.info("Firebase initialization successful")
            return True
        else:
            logger.error("Firebase initialization failed")
            return False
    except Exception as e:
        logger.error(f"Error during Firebase initialization test: {e}")
        return False


if __name__ == "__main__":
    test_firebase_init()
