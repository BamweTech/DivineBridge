import pytest
from unittest.mock import patch, MagicMock

@pytest.fixture(autouse=True)
def mock_google_cloud():
    """Mock Google Cloud credentials and clients for all tests"""
    with patch('google.auth.default', return_value=(MagicMock(), 'test-project')), \
         patch('google.cloud.logging.Client'), \
         patch('google.cloud.storage.Client'), \
         patch('google.oauth2.service_account.Credentials.from_service_account_info'):
        yield

@pytest.fixture
def mock_storage_client():
    """Mock storage client for tests that need it"""
    with patch('google.cloud.storage.Client') as mock:
        yield mock

@pytest.fixture
def mock_logging_client():
    """Mock logging client for tests that need it"""
    with patch('google.cloud.logging.Client') as mock:
        yield mock

@pytest.fixture
def mock_credentials():
    """Mock Google credentials for tests that need them"""
    with patch('google.oauth2.service_account.Credentials.from_service_account_info') as mock:
        yield mock 