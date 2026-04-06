"""
Shared Perplexity Client for Divine Bridge
Lazy initialization pattern - client only created when first used
"""

import logging
from openai import OpenAI
from config import get_config

logger = logging.getLogger(__name__)

PERPLEXITY_API_URL = 'https://api.perplexity.ai'
DEFAULT_TIMEOUT = 30.0

# Global singleton instance
_perplexity_client = None
_client_lock = False


class LazyPerplexityClient:
    """
    Wrapper for PerplexityClient that delays initialization until first use.
    This avoids slow test queries during app startup.
    """
    
    def __init__(self, api_key, model="sonar-reasoning-pro"):
        self.api_key = api_key
        self._model = model
        self._client = None
        self._openai_client = None
    
    @property
    def model(self):
        return self._model
    
    @model.setter
    def model(self, value):
        self._model = value
        if self._client:
            self._client.model = value
    
    def _ensure_initialized(self):
        """Initialize the actual client only when needed"""
        if self._client is None:
            logger.info(f"Initializing Perplexity client on first use (model: {self._model})...")
            from perplexipy import PerplexityClient
            self._client = PerplexityClient(key=self.api_key)
            self._client.model = self._model
            logger.info("Perplexity client initialized")
    
    def _ensure_openai_client(self):
        if self._openai_client is None:
            self._openai_client = OpenAI(
                api_key=self.api_key,
                base_url=PERPLEXITY_API_URL,
                timeout=DEFAULT_TIMEOUT,
            )
    
    def query(self, prompt):
        """Execute query using perplexipy (30s default timeout)"""
        self._ensure_initialized()
        return self._client.query(prompt)
    
    def query_with_timeout(self, prompt, timeout=120.0):
        """Execute query with a custom timeout, bypassing perplexipy's 30s cap."""
        self._ensure_openai_client()
        response = self._openai_client.with_options(timeout=timeout).chat.completions.create(
            model=self._model,
            messages=[{'role': 'user', 'content': prompt}],
        )
        return response.choices[0].message.content


def get_perplexity_client(model="sonar-reasoning-pro"):
    """
    Get shared lazy Perplexity client instance (singleton pattern)
    
    Args:
        model: Perplexity model to use (default: sonar-reasoning-pro)
    
    Returns:
        LazyPerplexityClient instance
    
    Note:
        Client initialization is deferred until first query to avoid
        slow test queries during app startup. This reduces cold start
        time from 30+ seconds to under 5 seconds.
    """
    global _perplexity_client, _client_lock
    
    if _perplexity_client is None and not _client_lock:
        _client_lock = True
        try:
            config = get_config()
            api_key = config.perplexity_api_key
            
            if not api_key:
                raise ValueError("Perplexity API key not found in config")
            
            logger.debug("Creating lazy Perplexity client (initialization deferred)...")
            _perplexity_client = LazyPerplexityClient(api_key, model)
            logger.debug("Lazy Perplexity client created successfully")
            
        except Exception as e:
            logger.error(f"Error creating lazy Perplexity client: {e}")
            _client_lock = False
            raise
        finally:
            _client_lock = False
    
    return _perplexity_client


def set_client_model(model):
    """
    Set the model for the shared client
    
    Args:
        model: Perplexity model name
    """
    client = get_perplexity_client()
    client.model = model
    logger.debug(f"Perplexity client model set to: {model}")

