from perplexipy import PerplexityClient
import os
import logging
from datetime import datetime
from storage_handler import StorageHandler
from google.api_core import retry
from google.api_core.exceptions import ServiceUnavailable

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class PrayerGenerator:
    def __init__(self, storage=None):
        logger.debug("Initializing PrayerGenerator")
        try:
            api_key = os.getenv("PERPLEXITY_API_KEY")
            if not api_key:
                raise ValueError("PERPLEXITY_API_KEY environment variable not set")
                
            self.client = PerplexityClient(key=api_key)
            self.client.model = "sonar-pro"
            self.storage = storage or StorageHandler()
            self._load_prompt()
            logger.debug("Successfully initialized Perplexity client and StorageHandler")
        except Exception as e:
            logger.error(f"Error initializing PrayerGenerator: {e}")
            raise
            
    def _load_prompt(self):
        """Load the prayer generation prompt from a file"""
        try:
            prompt_file = 'config/prayer_prompt.txt'
            if os.path.exists(prompt_file):
                with open(prompt_file, 'r', encoding='utf-8') as f:
                    self.prompt = f.read()
            else:
                logger.warning(f"Prompt file not found at {prompt_file}, using default prompt")
                self.prompt = self._get_default_prompt()
        except Exception as e:
            logger.error(f"Error loading prompt: {e}")
            self.prompt = self._get_default_prompt()
            
    def _get_default_prompt(self):
        """Return the default prayer generation prompt"""
        return """
            Role:
            You are a prayer generator and a global news expert.

            Task:

            Analyze recent global news to identify people and regions affected by:

            Natural disasters

            Wars and conflicts

            Disease outbreaks

            Human rights violations

            Homocides

            Poverty

            Hunger

            Mental health

            Other major tragedies

            Information Gathering:

            Search the web for the latest (last 72 hours) news worldwide related to the topics above.

            Use up to 50 various sources from each continent.

            Fetch news sources from various languages to ensure a global and comprehensive overview.

            Include news from diverse sources, including reports in local languages.

            Expand your search to videos and firsthand accounts from platforms such as TikTok, X (Twitter), and YouTube.

            Verification Process:

            Focus on Latest Developments: For ongoing crises, mention only the most recent updates.

            Inclusivity & Coverage:

            Ensure that your analysis includes all regions, especially underreported areas.

            Prioritize accurate and diverse reporting to reflect a global perspective.

            Prayer Generation:

            Compose a prayer (maximum 200 words) based on the affected regions and people.

            Begin the prayer with: "Dear Heavenly Father"

            For the first paragraph only, always start the prayer with praise and worship to God in the form of a rhyming poem.

            The prayer should only contain the prayer text—no explanations or reasoning process.

            Always call on Jesus Christ and the Holy Spirit within the prayer.

            Where possible, include a relevant Bible verse within the prayer.

            Do not use special characters or formatting.

        """
        
    def _validate_response(self, response):
        """Validate the prayer response format"""
        if not response:
            raise ValueError("Empty response from prayer generator")
            
        if "Dear Heavenly Father" not in response:
            raise ValueError("Response does not contain prayer format")
            
        if len(response) > 2000:  # Arbitrary limit to prevent overly long responses
            raise ValueError("Response exceeds maximum length")
            
        return response
        
    def generate_prayer(self):
        logger.debug("Generating prayer based on global news")
        try:
            response = self.client.query(self.prompt)
            logger.debug("Successfully generated prayer")
            
            # Validate and process the response
            response = self._validate_response(response)
            
            # Process the response to remove any text before "Dear Heavenly Father"
            if "Dear Heavenly Father" in response:
                response = response[response.index("Dear Heavenly Father"):]
            
            # Save the generated prayer to Cloud Storage with retry logic
            today = datetime.now().strftime('%Y-%m-%d')
            try:
                if self.storage.save_prayer(response, today):
                    logger.info("Successfully saved prayer to Cloud Storage")
                else:
                    logger.warning("Failed to save prayer to Cloud Storage, but continuing with prayer generation")
            except Exception as e:
                logger.warning(f"Error saving prayer to Cloud Storage: {e}, but continuing with prayer generation")
            
            return response
        except Exception as e:
            logger.error(f"Error generating prayer: {e}")
            raise

    def get_prayer(self, date=None):
        """Retrieve a prayer for a specific date or today's prayer if no date is provided"""
        try:
            if date is None:
                date = datetime.now().strftime("%Y-%m-%d")
            
            try:
                prayer = self.storage.get_prayer(date)
                if prayer:
                    logger.info(f"Successfully retrieved prayer for {date}")
                    return prayer
            except Exception as e:
                logger.warning(f"Error retrieving prayer from storage: {e}")
            
            logger.warning(f"No prayer found for {date}, generating new prayer")
            return self.generate_prayer()
        except Exception as e:
            logger.error(f"Error retrieving prayer: {e}")
            raise 