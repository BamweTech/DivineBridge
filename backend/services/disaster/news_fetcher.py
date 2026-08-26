from perplexipy import PerplexityClient
import os
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class NewsScanner:
    def __init__(self):
        logger.debug("Initializing NewsScanner")
        try:
            self.client = PerplexityClient(key=os.getenv("PERPLEXITY_API_KEY"))
            logger.debug("Successfully initialized Perplexity client")
        except Exception as e:
            logger.error(f"Error initializing Perplexity client: {e}")
            raise

    def fetch_disaster_news(self):
        logger.debug("Fetching disaster news")
        query = """
        Provide today's news summary about:
        1. Natural disasters
        2. Wars and conflicts
        3. Disease outbreaks
        
        Format the response in a clear, concise manner.
        Focus on major events only.
        """

        try:
            response = self.client.query(query)
            logger.debug("Successfully fetched news")
            return response
        except Exception as e:
            logger.error(f"Error fetching news: {e}")
            raise
