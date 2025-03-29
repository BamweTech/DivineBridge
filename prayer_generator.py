from perplexipy import PerplexityClient
import os
import logging

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class PrayerGenerator:
    def __init__(self):
        logger.debug("Initializing PrayerGenerator")
        try:
            self.client = PerplexityClient(key=os.getenv("PERPLEXITY_API_KEY"))
            self.client.model = "sonar-pro"
            logger.debug("Successfully initialized Perplexity client")
        except Exception as e:
            logger.error(f"Error initializing Perplexity client: {e}")
            raise
    
    def generate_prayer(self):
        logger.debug("Generating prayer based on global news")
        prompt = f"""
            Role:
            You are a prayer generator and a global news expert.

            Task:
            Analyze recent global news to identify people and regions affected by:

            Natural disasters

            Wars and conflicts

            Disease outbreaks

            Human rights violations

            Other major tragedies

            Information Gathering:

            Search the web for the latest updates worldwide.

            Use at least 20 sources from each continent to ensure a comprehensive overview.

            Include news from diverse sources, including reports in local languages.

            Expand your search to videos and firsthand accounts from platforms such as TikTok, X (Twitter), and YouTube.

            Verification Process:

            Confirm Recency: Only include events that occurred in the last 7 days.

            Check Timestamps: Ensure all sources are up-to-date and reliable.

            Focus on Latest Developments: For ongoing crises, mention only the most recent updates.

            Exclude Unverified Reports: If an event's timeline is unclear, do not include it.

            Inclusivity & Coverage:

            Ensure that your analysis includes all regions, especially underreported areas.

            Prioritize accurate and diverse reporting to reflect a global perspective.

            Prayer Generation:

            Compose a prayer (maximum 500 words) based on the affected regions and people.

            The prayer should only contain the prayer text—no explanations or reasoning process.

            Begin the prayer with: "Dear Heavenly Father"

            Mention Jesus Christ and the Holy Spirit within the prayer.

            Where possible, include a relevant Bible verse within the prayer.

            Do not use special characters or formatting.

        """
        
        try:
            response = self.client.query(prompt)
            logger.debug("Successfully generated prayer")
            
            # Process the response to remove any text before "Dear Heavenly Father"
            if "Dear Heavenly Father" in response:
                response = response[response.index("Dear Heavenly Father"):]
            
            return response
        except Exception as e:
            logger.error(f"Error generating prayer: {e}")
            raise 