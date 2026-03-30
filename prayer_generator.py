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

DAILY_PRAYER_LOOKBACK_HOURS = 48

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
        lookback_hours = DAILY_PRAYER_LOOKBACK_HOURS
        return f"""You are a compassionate prayer leader writing today's global prayer for a Christian community. Write as if you're gathering believers together and leading them in heartfelt prayer.

RESEARCH & NEWS GATHERING:
1. Search the web for the latest (last {lookback_hours} hours) news worldwide about:
   - Natural disasters (earthquakes, floods, storms, wildfires, etc.)
   - Wars and armed conflicts
   - Mass shootings and gun violence
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
   - Latest developments (focus on last {lookback_hours} hours)
   - Underreported regions and communities
   - Specific locations and human impact
   - Accuracy and verification from multiple sources

⚠️ CRITICAL: If there were ANY mass shootings or gun violence incidents in the last {lookback_hours} hours, you MUST include them in your prayer. Search specifically for "mass shooting", "gun violence", "shooting incident", "active shooter" in your research. Use search queries like "mass shooting today", "gun violence this week", "shooting incident last 2 days". If you find ANY mass shootings, you MUST mention them explicitly in the prayer body (e.g., "We pray for victims of recent mass shootings", "We lift up communities shattered by gun violence", "We remember those affected by shootings").

PRAYER STRUCTURE & CONTENT:
Write a prayer that addresses current global challenges with both structure and warmth:

Opening:
- Begin with "Heavenly Father" (not "Dear Heavenly Father")
- ⚠️ CRITICAL: Start with PRAISE - acknowledge God's goodness, faithfulness, sovereignty, love, or power before making any requests
- Examples of praise: "we praise you for your unfailing love", "we thank you for your faithfulness", "we worship you as the sovereign Lord", "we acknowledge your goodness", "we glorify you for your mercy"
- After praise, open with genuine, heartfelt acknowledgment of God's presence
- Use "we" and "our" throughout (praying as a community)

Body (2-3 paragraphs):
- Address 2-3 major current crises with compassionate details:
  * Name the regions/countries affected
  * Acknowledge the suffering without graphic details or specific casualty numbers
  * Pray for specific groups: families, children, aid workers, leaders, those grieving
  * ⚠️ CRITICAL REQUIREMENT: If ANY mass shootings occurred in the last {lookback_hours} hours, you MUST include them in your prayer. Search for "mass shooting today", "gun violence today", "shooting incident last 2 days". If found, mention them explicitly in the first or second paragraph (e.g., "We pray for victims of recent mass shootings", "We lift up communities shattered by gun violence", "We remember those affected by shootings and their families"). DO NOT skip mass shootings if they occurred.
  * Include victims of wars and armed conflicts around the world
- ALWAYS include prayer for:
  * Those who are sick and fighting illness
  * Those facing hunger and lacking daily provisions
  * Those who feel lost, hopeless, or spiritually adrift
  * Victims of mass shootings and wars around the world

⚠️ MANDATORY SECTION: You MUST ALWAYS include a sentence or phrase about mass shootings and gun violence victims in your prayer, even if you don't find specific recent incidents. Include something like: "We pray for victims of mass shootings and gun violence" OR "We lift up communities shattered by shootings" OR "We remember those affected by gun violence and their families" OR "We pray for all who have been touched by the tragedy of mass shootings". This is REQUIRED in every prayer - do not skip it, even if focusing on other crises.
- Show genuine compassion and emotion (not generic or stiff)
- Let the weight of the crisis show through authentic language

Biblical Grounding:
- Naturally weave in ONE Bible verse or biblical reference (no formal citation)
- Call on Jesus Christ and the Holy Spirit by name
- Ask for specific interventions: comfort, provision, peace, healing, protection

Closing:
- End with hope rooted in Christ
- Trust in God's sovereignty even amid suffering
- ⚠️ CRITICAL REQUIREMENT - The LAST LINE of your prayer MUST be EXACTLY (word-for-word):
  
  In Jesus-Christ's name we pray. Amen!
  
  ⚠️ DO NOT change this ending. DO NOT add anything after it. DO NOT use variations like "In Jesus' name" or "In the name of Jesus". 
  ⚠️ The EXACT text must be: "In Jesus-Christ's name we pray. Amen!"
  ⚠️ This is a hard requirement - your prayer will be rejected if it doesn't end with these exact words.

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
❌ NO numbered citations or references like [1], [2], [3] - remove all citation numbers
❌ NO numbered citations or references like [1], [2], [3] - remove all citation numbers

LENGTH: 150-200 words (concise and focused)

CRITICAL: Return ONLY the prayer text. No <think> tags, no explanations, no commentary. Just the prayer as if you're speaking it aloud to lead a community in prayer."""
        
    def _remove_citations(self, text):
        """Remove numbered citations/references like [1], [2], [3], etc. from prayer text"""
        if not text:
            return text
        
        import re
        # Remove numbered citations in brackets: [1], [2], [3], etc.
        # Also handle variations like [1][2][3] (multiple consecutive)
        text = re.sub(r'\[\d+\]', '', text)
        
        # Remove any extra spaces that might result from citation removal
        # BUT preserve newlines (paragraph breaks) - only normalize spaces and tabs
        text = re.sub(r'[ \t]+', ' ', text)  # Only replace spaces and tabs, not newlines
        text = text.strip()
        
        return text
    
    def _fix_prayer_ending(self, response):
        """Try to fix common ending issues before validation"""
        if not response:
            return response
        
        response_clean = response.strip()
        required_ending = "In Jesus-Christ's name we pray. Amen!"
        
        # Check if ending is already correct
        if response_clean.endswith(required_ending) or response_clean.endswith(required_ending[:-1]):
            return response
        
        # Try to fix common variations
        # Check if it ends with something close to the required ending
        if "In Jesus" in response_clean[-50:] or "Amen" in response_clean[-20:]:
            # If it has "Amen" but not the full ending, try to fix it
            # Find the last sentence that might be the ending
            sentences = response_clean.split('.')
            if sentences:
                last_sentence = sentences[-1].strip()
                # If the last sentence doesn't have the required ending, replace it
                if "In Jesus" not in last_sentence or "Amen" not in last_sentence:
                    # Remove the last sentence and add the correct ending
                    response_clean = '.'.join(sentences[:-1]).strip()
                    if response_clean and not response_clean.endswith('.'):
                        response_clean += '.'
                    response_clean += ' ' + required_ending
                    logger.info("Fixed prayer ending automatically")
                    return response_clean
        
        # If no fix possible, return original
        return response
    
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
        
        # Check word count (150-200 words as specified, with small flexibility)
        word_count = len(response_clean.split())
        if word_count < 140:  # Allow slight flexibility (140-205)
            raise ValueError(f"Prayer too short: {word_count} words (minimum 140)")
        if word_count > 205:
            raise ValueError(f"Prayer too long: {word_count} words (maximum 200)")
        
        logger.info(f"Prayer validation passed: {word_count} words")
        return response
        
    def generate_prayer(self, max_retries=5):
        """Generate a new prayer and save it to storage with retry logic.
        
        Args:
            max_retries: Maximum number of retry attempts if validation fails (increased from 3 to 5)
        
        Returns:
            dict: The generated prayer data if successful, None otherwise
        """
        logger.debug("Generating prayer based on global news")
        try:
            # First check if we already have a prayer for today
            today = datetime.now().strftime('%Y-%m-%d')
            existing_prayer = self.storage.get_prayer(today)
            if existing_prayer:
                # Clean citations from existing prayer before returning
                if isinstance(existing_prayer, dict) and 'content' in existing_prayer:
                    existing_prayer['content'] = self._remove_citations(existing_prayer['content'])
                    logger.info(f"Cleaned citations from existing prayer for {today}")
                elif isinstance(existing_prayer, str):
                    existing_prayer = self._remove_citations(existing_prayer)
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

⚠️⚠️⚠️ CRITICAL - Previous attempt was REJECTED for the following reason:
{last_error}

⚠️⚠️⚠️ You MUST fix this issue. Your prayer will be rejected again if you don't.

CRITICAL REQUIREMENTS (DO NOT IGNORE):
1. START with "Heavenly Father" (not "Dear Heavenly Father")
2. END with EXACTLY "In Jesus-Christ's name we pray. Amen!" - NO VARIATIONS, NO CHANGES
3. LENGTH: 150-200 words (count carefully - be concise!)
4. NO <think> tags or explanations
5. NO text after "Amen!" - stop immediately after those words

If the error was about the ending, copy this EXACTLY as the last line:
"In Jesus-Christ's name we pray. Amen!"

DO NOT use "In Jesus' name" or "In the name of Jesus" or any other variation."""
                        response = self.client.query(retry_prompt)
                    else:
                        response = self.client.query(self.prompt)
                    
                    logger.debug(f"Prayer generated on attempt {attempt}")
                    
                    # Pre-process the response to remove any <think> tags or other noise
                    if response and "<think>" in response:
                        import re
                        response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()

                    # Remove numbered citations/references like [1], [2], [3], etc.
                    response = self._remove_citations(response)

                    # Try to fix common ending issues before validation
                    response = self._fix_prayer_ending(response)

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
            
            # Remove any citations that might have been added
            response = self._remove_citations(response)
            
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
                    # Clean citations from existing prayer if present
                    if isinstance(prayer, dict) and 'content' in prayer:
                        prayer['content'] = self._remove_citations(prayer['content'])
                    elif isinstance(prayer, str):
                        prayer = self._remove_citations(prayer)
                    logger.info(f"Successfully retrieved prayer for {date}")
                    return prayer
            except Exception as e:
                logger.warning(f"Error retrieving prayer from storage: {e}")
            
            logger.warning(f"No prayer found for {date}, generating new prayer")
            return self.generate_prayer()
        except Exception as e:
            logger.error(f"Error retrieving prayer: {e}")
            raise 