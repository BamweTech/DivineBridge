import os
import logging
from datetime import datetime
from storage_handler import StorageHandler
from google.api_core import retry
from google.api_core.exceptions import ServiceUnavailable
from config import get_config
from perplexity_client import get_perplexity_client, set_client_model
import json
import requests
import random
from google.cloud.storage import Client
from typing import Optional, Dict

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class PrayerGenerator:
    def __init__(self, storage=None):
        logger.debug("Initializing PrayerGenerator")
        try:
            # Use shared Perplexity client (avoids test query overhead)
            self.client = get_perplexity_client()
            set_client_model("sonar-reasoning-pro")
            self.storage = storage or StorageHandler()
            self._load_prompt()
            logger.debug("Successfully initialized with shared Perplexity client and StorageHandler")
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
        """Return the default prayer generation prompt (HYBRID: Structure + Warmth)"""
        return """You are a compassionate prayer leader writing today's global prayer for a Christian community. Write as if you're gathering believers together and leading them in heartfelt prayer.

RESEARCH & NEWS GATHERING:
1. Search the web for the latest (last 72 hours) news worldwide about:
   - Natural disasters (earthquakes, floods, storms, wildfires, etc.)
   - Wars and armed conflicts
   - Disease outbreaks and public health crises
   - Human rights violations
   - Poverty and hunger
   - Mental health crises
   - Other major tragedies affecting communities

2. Use diverse sources from all continents, including:
   - International news agencies
   - Local news in original languages
   - Reports from humanitarian organizations
   - Firsthand accounts from social media (Twitter/X, TikTok, YouTube)

3. Prioritize:
   - Latest developments (focus on last 72 hours)
   - Underreported regions and communities
   - Specific locations and human impact
   - Accuracy and verification from multiple sources

PRAYER STRUCTURE & CONTENT:
Write a prayer that addresses current global challenges with both structure and warmth:

Opening:
- Begin with "Heavenly Father" (not "Dear Heavenly Father")
- Open with genuine, heartfelt acknowledgment of God's presence
- Use "we" and "our" throughout (praying as a community)

Body (2-3 paragraphs):
- Address 2-3 major current crises with compassionate details:
  * Name the regions/countries affected
  * Acknowledge the suffering without graphic details or specific casualty numbers
  * Pray for specific groups: families, children, aid workers, leaders, those grieving
- ALWAYS include prayer for:
  * Those who are sick and fighting illness
  * Those facing hunger and lacking daily provisions
  * Those who feel lost, hopeless, or spiritually adrift
- Show genuine compassion and emotion (not generic or stiff)
- Let the weight of the crisis show through authentic language

Biblical Grounding:
- Naturally weave in ONE Bible verse or biblical reference (no formal citation)
- Call on Jesus Christ and the Holy Spirit by name
- Ask for specific interventions: comfort, provision, peace, healing, protection

Closing:
- End with hope rooted in Christ
- Trust in God's sovereignty even amid suffering
- The LAST LINE of your prayer MUST be EXACTLY (word-for-word):
  
  In Jesus-Christ's name we pray. Amen!
  
  (Do not change this ending. Do not add anything after it. Use these exact words.)

VOICE & TONE:
✅ Natural, conversational language (like speaking to a friend)
✅ Personal and relational (varies sentence length for natural rhythm)
✅ Authentic emotion (let compassion show)
✅ Balance reverence with warmth
✅ Accessible to all Christians (avoid theological jargon)
✅ Flows naturally when read aloud

❌ No rhyming poems (too artificial)
❌ No stiff, formal corporate prayer language
❌ No generic platitudes without specifics
❌ No overly flowery or archaic language ("thee," "thou")
❌ No repetitive phrases or clichés
❌ NO thinking process, explanations, or reasoning (PRAYER TEXT ONLY)
❌ No special characters or formatting

LENGTH: 150-250 words (concise and focused)

CRITICAL: Return ONLY the prayer text. No <think> tags, no explanations, no commentary. Just the prayer as if you're speaking it aloud to lead a community in prayer."""
        
    def _validate_response(self, response):
        """Validate the prayer response format with strict requirements"""
        if not response:
            raise ValueError("Empty response from prayer generator")
        
        # Strip whitespace for validation
        response_clean = response.strip()
        
        # MUST start with "Heavenly Father" (strict requirement from prompt)
        if not response_clean.startswith("Heavenly Father"):
            logger.error(f"Prayer must start with 'Heavenly Father'. Actual start: {response_clean[:100]}")
            raise ValueError("Prayer must start with 'Heavenly Father'")
        
        # MUST end with specific closing (allow flexibility with punctuation)
        required_ending = "In Jesus-Christ's name we pray. Amen"
        # Accept with or without exclamation mark
        if not (response_clean.endswith(required_ending + "!") or response_clean.endswith(required_ending)):
            logger.error(f"Prayer must end with '{required_ending}[!]'. Actual end: {response_clean[-150:]}")
            raise ValueError(f"Prayer must end with '{required_ending}!'")
        
        # Check word count (150-250 words as specified, with flexibility)
        word_count = len(response_clean.split())
        if word_count < 140:  # Allow slight flexibility (140-270)
            raise ValueError(f"Prayer too short: {word_count} words (minimum 140)")
        if word_count > 270:
            raise ValueError(f"Prayer too long: {word_count} words (maximum 270)")
        
        logger.info(f"Prayer validation passed: {word_count} words")
        return response
        
    def generate_prayer(self, max_retries=3):
        """Generate a new prayer and save it to storage with retry logic.
        
        Args:
            max_retries: Maximum number of retry attempts if validation fails
        
        Returns:
            dict: The generated prayer data if successful, None otherwise
        """
        logger.debug("Generating prayer based on global news")
        try:
            # First check if we already have a prayer for today
            today = datetime.now().strftime('%Y-%m-%d')
            existing_prayer = self.storage.get_prayer(today)
            if existing_prayer:
                logger.info(f"Using existing prayer for {today}")
                return existing_prayer
            
            # Attempt to generate prayer with retries
            last_error = None
            for attempt in range(1, max_retries + 1):
                try:
                    logger.info(f"Prayer generation attempt {attempt}/{max_retries}")
                    
                    # Build prompt with feedback from previous attempt if any
                    if attempt > 1 and last_error:
                        retry_prompt = f"""{self.prompt}

IMPORTANT - Previous attempt was REJECTED for the following reason:
{last_error}

Please regenerate the prayer ensuring you address this issue. Remember:
- START with "Heavenly Father" (not "Dear Heavenly Father")
- END with EXACTLY "In Jesus-Christ's name we pray. Amen!"
- LENGTH: 150-250 words (count carefully - be concise!)
- NO <think> tags or explanations"""
                        response = self.client.query(retry_prompt)
                    else:
                        response = self.client.query(self.prompt)
                    
                    logger.debug(f"Prayer generated on attempt {attempt}")
                    
                    # Validate and process the response
                    response = self._validate_response(response)
                    logger.info(f"Prayer validation passed on attempt {attempt}")
                    break  # Success! Exit retry loop
                    
                except ValueError as ve:
                    last_error = str(ve)
                    logger.warning(f"Attempt {attempt} failed validation: {last_error}")
                    if attempt == max_retries:
                        logger.error(f"All {max_retries} attempts failed. Last error: {last_error}")
                        raise
                    # Continue to next attempt
                    continue
            
            # If we get here, validation passed
            response = response
            
            # Process the response to remove any text before prayer starts
            # Also remove any <think> tags or explanatory text
            if "<think>" in response:
                # Remove everything from <think> to </think>
                import re
                response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL)
            
            # Find the start of the actual prayer
            if "Heavenly Father" in response:
                # Prefer "Heavenly Father" over "Dear Heavenly Father"
                if "Dear Heavenly Father" in response and "Heavenly Father," in response:
                    # Check which comes first
                    idx_dear = response.index("Dear Heavenly Father")
                    idx_plain = response.index("Heavenly Father,")
                    if idx_plain < idx_dear:
                        response = response[idx_plain:]
                    else:
                        response = response[idx_dear:]
                elif "Heavenly Father," in response:
                    response = response[response.index("Heavenly Father,"):]
                elif "Dear Heavenly Father" in response:
                    response = response[response.index("Dear Heavenly Father"):]
            
            # Clean up any remaining whitespace
            response = response.strip()
            
            # Create prayer data structure
            prayer_data = {
                'content': response,
                'date': today,
                'created_at': datetime.now().isoformat(),
                'source': 'generated'
            }
            
            # Extract disaster metadata from prayer
            try:
                from disaster_extractor import get_disaster_extractor
                extractor = get_disaster_extractor()
                metadata = extractor.extract_disasters(response)
                prayer_data['metadata'] = metadata
                logger.info(f"Extracted {len(metadata.get('disasters', []))} disasters from prayer")
            except Exception as e:
                logger.error(f"Error extracting disaster metadata: {e}")
                # Continue without metadata if extraction fails
                prayer_data['metadata'] = {"disasters": [], "topics": [], "affected_regions": []}
            
            # Save the generated prayer to Cloud Storage
            try:
                logger.info(f"Attempting to save prayer for date: {today}")
                logger.info(f"Prayer data keys: {list(prayer_data.keys())}")
                save_result = self.storage.save_prayer(prayer_data, today)
                logger.info(f"Save result: {save_result}")
                
                if save_result:
                    logger.info("Successfully saved prayer with metadata to Cloud Storage")
                    return prayer_data
                else:
                    logger.error("Failed to save prayer to Cloud Storage")
                    return None
            except Exception as e:
                logger.error(f"Error saving prayer to Cloud Storage: {e}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
                # Return the prayer data even if storage fails
                return prayer_data
                
        except Exception as e:
            logger.error(f"Error generating prayer: {e}")
            return None

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