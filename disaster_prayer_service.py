"""
Disaster Prayer Service - Hourly breaking news monitoring and customized prayer generation
Separate from daily prayer flow, triggered every hour to find breaking disasters
"""

import logging
import json
import re
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from config import get_config
from perplexity_client import get_perplexity_client, set_client_model
from storage_handler import StorageHandler

logger = logging.getLogger(__name__)

# Disaster types to monitor (from daily prayer prompt)
DISASTER_TYPES = [
    'typhoon', 'hurricane', 'cyclone',
    'earthquake',
    'flood', 'flooding',
    'landslide',
    'drought',
    'wildfire', 'fire',
    'tornado',
    'tsunami',
    'volcanic_eruption', 'volcano',
    'conflict', 'war',
    'epidemic', 'pandemic',
    'famine',
    'refugee_crisis',
    'storm',
    'mass shooting', 'gun violence'
]


class DisasterPrayerService:
    """Service for hourly disaster monitoring and customized prayer generation"""
    
    def __init__(self, storage: Optional[StorageHandler] = None):
        """Initialize the DisasterPrayerService"""
        try:
            self.client = get_perplexity_client()
            set_client_model("sonar-reasoning-pro")
            self.storage = storage or StorageHandler()
            logger.info("DisasterPrayerService initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing DisasterPrayerService: {e}")
            raise
    
    def search_breaking_disasters(self) -> List[Dict]:
        """
        Search for breaking news about disasters in the last few hours
        
        Returns:
            List of disaster dictionaries with news details
        """
        try:
            # Build search query for breaking disasters
            disaster_types_str = ", ".join(DISASTER_TYPES)
            from datetime import datetime
            current_time = datetime.now().strftime("%B %d, %Y %H:%M UTC")
            
            prompt = f"""You are a breaking news monitor searching for RECENT disasters and crises that occurred in the LAST 12-24 HOURS worldwide.

CURRENT TIME: {current_time}

CRITICAL: Only include disasters that occurred in the LAST 24 HOURS. Do NOT include disasters from last year, last month, or even last week. Only include disasters that happened TODAY or YESTERDAY.

SEARCH INSTRUCTIONS:
1. Search the web for BREAKING NEWS and RECENT disasters. Use time-specific search queries like:
   - "disaster breaking news last 12 hours" OR "disaster breaking news last 24 hours"
   - "natural disaster news {current_time.split()[0]} {current_time.split()[1]}" (today's date)
   - "emergency response today" OR "disaster alert today"
   - "earthquake today" OR "earthquake breaking news"
   - "flood [country] today" OR "flooding breaking news"
   - "hurricane breaking news" OR "typhoon today"
   - "wildfire breaking news" OR "fire [location] today"
   - "mass shooting today" OR "gun violence breaking news"
   - "conflict breaking news" OR "war [region] today"
   - "developing disaster" OR "ongoing emergency"
   - "natural disaster breaking news today"

2. Use diverse sources:
   - International news agencies (Reuters, AP, BBC, CNN)
   - Local news sources
   - Government emergency services
   - Humanitarian organizations
   - Verified social media reports

3. Focus on these disaster types: {disaster_types_str}

4. TIME WINDOW GUIDANCE (STRICT - only recent disasters):
   - PRIMARY: Disasters from the last 12 hours (highest priority)
   - SECONDARY: Disasters from 12-24 hours ago that are:
     * Still developing or ongoing
     * Have breaking updates or new developments
     * Are part of active emergency response
   - STRICTLY EXCLUDE:
     * Disasters from last year, last month, or last week
     * Disasters older than 24 hours unless they have breaking updates TODAY
     * Historical disasters mentioned in news articles
     * Disasters that occurred more than 24 hours ago with no recent updates
   - ONLY INCLUDE disasters that:
     * Occurred in the last 24 hours
     * Have breaking updates or new developments TODAY
     * Are part of active emergency response happening NOW

5. Prioritize disasters with:
   - Significant casualties or injuries
   - Large-scale evacuations
   - Major property damage
   - Ongoing emergency response
   - Breaking/developing situations

For each BREAKING disaster found, return a JSON array with this EXACT structure:
[
  {{
    "type": "one of: typhoon, hurricane, earthquake, flood, landslide, drought, wildfire, tornado, tsunami, volcano, conflict, war, epidemic, pandemic, famine, storm, mass_shooting",
    "country": "Full country name (e.g., 'Japan', 'Philippines', 'United States', 'Mexico')",
    "location": "Specific location/city/region if mentioned (e.g., 'Tokyo', 'Manila', 'California')",
    "severity": "minor" | "moderate" | "severe" | "catastrophic",
    "casualties": number or null,
    "news_summary": "Detailed summary of what happened (2-4 sentences with specific details from the news)",
    "news_source": "Source of the news (e.g., 'Reuters', 'BBC', 'AP News')",
    "timestamp": "When the disaster occurred (ISO format if available, or approximate time)"
  }}
]

CRITICAL REQUIREMENTS FOR TIMESTAMPS:
- ⚠️ MANDATORY: Every disaster MUST have an accurate timestamp showing when it occurred
- ⚠️ TIMESTAMP FORMAT: Use ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ (e.g., "2025-12-16T14:30:00Z")
- ⚠️ DATE VALIDATION: The timestamp year MUST be 2025 (current year)
- ⚠️ DATE VALIDATION: The timestamp date MUST be within the last 7 days (December 9-16, 2025)
- ⚠️ STRICTLY EXCLUDE:
  * Disasters with timestamps from 2024 or earlier (last year)
  * Disasters with timestamps older than 7 days
  * Disasters with timestamps in the future
  * Disasters without timestamps
  * Disasters where the timestamp year is not 2025
- ⚠️ VERIFY TIMESTAMP: Before including a disaster, verify:
  1. The timestamp year is 2025
  2. The timestamp date is December 9-16, 2025 (last 7 days)
  3. The timestamp is in correct ISO format
  4. The timestamp makes sense (not in future, not too old)

CRITICAL REQUIREMENTS:
- STRICTLY EXCLUDE disasters that occurred more than 7 days ago
- STRICTLY EXCLUDE disasters from last year (2024 or earlier), last month, or last week
- ONLY INCLUDE disasters if they meet ALL of these criteria:
  * Occurred in the last 7 days (December 9-16, 2025)
  * Have a VALID timestamp showing the disaster occurred in 2025
  * Have a timestamp date within the last 7 days
  * Are breaking news or have updates from TODAY
- Be specific with country names (full names, not abbreviations like 'US' - use 'United States')
- Include specific details from the news in the summary (what happened, where, impact)
- Include accurate timestamp in ISO format: YYYY-MM-DDTHH:MM:SSZ (e.g., "2025-12-16T14:30:00Z")
- Verify the date/timestamp before including - if a disaster occurred last year (2024), DO NOT include it
- If you cannot determine an accurate timestamp within the last 7 days, DO NOT include the disaster
- Only return empty array [] if NO disasters are found in the past 7 days
- Return ONLY valid JSON array, no explanations, no markdown, no code blocks
- Verify information from multiple sources when possible
- Focus on verified, reliable news sources
- When in doubt about timing, EXCLUDE the disaster rather than include old news

Return ONLY the JSON array, nothing else. 

EXAMPLE FORMAT (note: timestamp must be within last 7 days, year must be 2025):
[{{"type":"earthquake","country":"Japan","location":"Tokyo","severity":"severe","casualties":150,"news_summary":"A magnitude 7.2 earthquake struck Tokyo at 2:30 PM local time, causing widespread damage to buildings and infrastructure. Emergency services are responding to multiple collapsed structures. At least 150 people are reported injured.","news_source":"Reuters","timestamp":"2025-12-16T14:30:00Z"}}]

REMEMBER: 
- Timestamp year MUST be 2025
- Timestamp date MUST be December 9-16, 2025 (last 7 days)
- If disaster occurred in 2024 or earlier, DO NOT include it
- If you cannot verify the timestamp is recent (within last 7 days), DO NOT include the disaster"""

            response = self.client.query(prompt)
            
            # Log the raw response first to see what Perplexity actually returned
            logger.info(f"Perplexity RAW response (first 2000 chars): {response[:2000]}")
            logger.info(f"Perplexity RAW response (full length): {len(response)} chars")
            # Also log the end of the response to see if JSON is there
            if len(response) > 2000:
                logger.info(f"Perplexity RAW response (last 500 chars): {response[-500:]}")
            
            # Log the cleaned response (after removing think tags) for better readability
            import re
            cleaned_for_log = re.sub(r'<think>.*?</think>', '[reasoning removed]', response, flags=re.DOTALL | re.IGNORECASE)
            logger.info(f"Perplexity response (first 1000 chars, cleaned): {cleaned_for_log[:1000]}")
            logger.debug(f"Perplexity full response (cleaned): {cleaned_for_log}")
            
            # Parse response (will strip think tags during parsing)
            disasters = self._parse_disaster_response(response)
            
            logger.info(f"Found {len(disasters)} breaking disasters after parsing")
            if len(disasters) == 0 and response:
                logger.warning(f"Parsing returned 0 disasters but response was not empty. Response length: {len(response)}")
                logger.debug(f"Full response for debugging: {response}")
            
            return disasters
            
        except Exception as e:
            logger.error(f"Error searching for breaking disasters: {e}")
            return []
    
    def _parse_disaster_response(self, response: str) -> List[Dict]:
        """Parse the AI response into list of disaster dictionaries"""
        try:
            original_response = response
            response = response.strip()
            
            logger.debug(f"Parsing disaster response. Length: {len(response)}, starts with: {response[:50]}")
            
            # Remove <think> tags if present (Perplexity sometimes includes these)
            import re
            if '<think>' in response.lower():
                logger.debug("Removing <think> tags from response")
                response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL | re.IGNORECASE)
                response = response.strip()
            
            # Remove markdown code blocks if present
            if response.startswith('```'):
                logger.debug("Removing markdown code blocks")
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
                response = response.strip()
            
            # Try to find JSON array in response
            if response.startswith('['):
                logger.debug("Response starts with '[', parsing as JSON array")
                disasters = json.loads(response)
            elif '{' in response:
                logger.debug("Response contains '{', trying to extract JSON")
                # Try to extract JSON object
                start = response.find('[')
                end = response.rfind(']') + 1
                if start >= 0 and end > start:
                    logger.debug(f"Found JSON array at positions {start}-{end}")
                    disasters = json.loads(response[start:end])
                else:
                    # Single object, wrap in array
                    start = response.find('{')
                    end = response.rfind('}') + 1
                    if start >= 0 and end > start:
                        logger.debug(f"Found JSON object at positions {start}-{end}, wrapping in array")
                        disasters = [json.loads(response[start:end])]
                    else:
                        logger.warning("Could not find JSON array or object in response")
                        disasters = []
            else:
                logger.warning(f"Response does not contain '[' or '{{'. Response preview: {response[:200]}")
                disasters = []
            
            # Validate and normalize disasters
            validated_disasters = []
            now = datetime.now()
            max_age = timedelta(days=7)  # Only accept disasters from last week
            
            for disaster in disasters:
                if isinstance(disaster, dict) and disaster.get('country') and disaster.get('type'):
                    # Check timestamp - CRITICAL: reject old disasters
                    timestamp_str = disaster.get('timestamp', '')
                    if timestamp_str:
                        disaster_time = None
                        try:
                            # Try ISO format first
                            disaster_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                            # Remove timezone for comparison
                            if disaster_time.tzinfo:
                                disaster_time = disaster_time.replace(tzinfo=None)
                        except:
                            try:
                                # Try common formats
                                for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                                    try:
                                        disaster_time = datetime.strptime(timestamp_str[:19], fmt)
                                        break
                                    except:
                                        continue
                            except:
                                pass
                        
                        if disaster_time:
                            # Check if disaster is within last week
                            age = now - disaster_time
                            if age > max_age:
                                logger.warning(f"Rejected old disaster: {disaster.get('type')} in {disaster.get('country')} - occurred {age.days} days ago (timestamp: {timestamp_str})")
                                continue
                            elif age.days < 0:
                                # Future timestamp - invalid
                                logger.warning(f"Rejected future disaster: {disaster.get('type')} in {disaster.get('country')} - timestamp is in future: {timestamp_str}")
                                continue
                        else:
                            # Could not parse timestamp - check if it contains year
                            current_year = datetime.now().year
                            if str(current_year - 1) in timestamp_str or str(current_year - 2) in timestamp_str:
                                logger.warning(f"Rejected disaster with old year in timestamp: {disaster.get('type')} in {disaster.get('country')} - timestamp: {timestamp_str}")
                                continue
                    
                    # Normalize disaster type
                    disaster['type'] = self._normalize_disaster_type(disaster.get('type', ''))
                    # Ensure country is properly formatted
                    disaster['country'] = disaster['country'].strip()
                    validated_disasters.append(disaster)
            
            logger.info(f"Validated {len(validated_disasters)} disasters (rejected {len(disasters) - len(validated_disasters)} old/invalid disasters)")
            return validated_disasters
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse disaster response as JSON: {e}")
            logger.error(f"Response preview (first 1000 chars): {original_response[:1000]}")
            logger.error(f"Response length: {len(original_response)}")
            # Try to log the problematic part
            try:
                error_pos = getattr(e, 'pos', None)
                if error_pos:
                    start = max(0, error_pos - 200)
                    end = min(len(original_response), error_pos + 200)
                    logger.error(f"Error around position {error_pos}: {original_response[start:end]}")
            except:
                pass
            return []
        except Exception as e:
            logger.error(f"Error parsing disaster response: {e}")
            logger.error(f"Response preview: {original_response[:500]}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return []
    
    def _normalize_disaster_type(self, disaster_type: str) -> str:
        """Normalize disaster type to standard format"""
        disaster_type = disaster_type.lower().strip()
        
        type_mapping = {
            'hurricane': 'typhoon',
            'cyclone': 'typhoon',
            'storm': 'typhoon',  # Normalize storm to typhoon (same weather system type)
            'flooding': 'flood',
            'wildfire': 'fire',
            'volcanic_eruption': 'volcano',
            'pandemic': 'epidemic',
            'war': 'conflict',
            'refugee_crisis': 'conflict',
            'mass shooting': 'mass_shooting',
            'gun violence': 'mass_shooting'
        }
        
        return type_mapping.get(disaster_type, disaster_type)
    
    def generate_customized_prayer(self, disaster: Dict) -> str:
        """
        Generate a customized prayer based on specific disaster news
        
        Args:
            disaster: Dictionary with disaster details including news_summary
            
        Returns:
            Customized prayer text
        """
        try:
            disaster_type = disaster.get('type', 'disaster').replace('_', ' ')
            country = disaster.get('country', '')
            location = disaster.get('location', '')
            news_summary = disaster.get('news_summary', '')
            casualties = disaster.get('casualties')
            
            # Build location string
            if location and location != country:
                location_str = f"{location}, {country}"
            else:
                location_str = country
            
            # Build prompt for customized prayer
            prompt = f"""You are a compassionate prayer leader writing a customized prayer for those affected by BREAKING NEWS about {disaster_type} in {location_str}.

BREAKING NEWS DETAILS (use these specific details in your prayer):
{news_summary}

PRAYER REQUIREMENTS:
- Start with "Heavenly Father," (not "Dear Heavenly Father")
- ⚠️ CRITICAL: Start with PRAISE - acknowledge God's goodness, faithfulness, sovereignty, love, or power before making any requests
- Examples of praise: "we praise you for your unfailing love", "we thank you for your faithfulness", "we worship you as the sovereign Lord", "we acknowledge your goodness"
- Length: 120-180 words (detailed and specific)
- Reference the SPECIFIC situation described in the news summary above - mention specific details like the location, what happened, the impact
- Mention {location_str} and {disaster_type} specifically by name
- Address the specific needs based on THIS breaking news event:
  * Those directly affected by this specific {disaster_type} in {location_str}
  * Families who lost loved ones or are searching for missing family members
  * Those injured and receiving medical care right now
  * Children who are scared and traumatized by this event
  * Rescue workers and first responders currently on the scene
  * Medical teams treating the injured at this moment
  * Government leaders coordinating response efforts for this crisis
  * Communities coming together to help those affected
- Include a brief biblical reference or promise (no citation needed) - something relevant to this situation
- Call on Jesus Christ and the Holy Spirit by name
- End with hope rooted in Christ
- End with "In Jesus-Christ's name we pray. Amen!" (EXACTLY this ending)
- Compassionate, specific, and heartfelt tone
- Write as if leading a prayer gathering for THIS specific breaking news RIGHT NOW
- Make it feel urgent and relevant to THIS specific event - reference the news details
- Use "we" and "our" throughout (praying as a community)
- Natural, conversational language (like speaking to a friend)
- Authentic emotion - let the weight of this specific crisis show through
- NO explanations, NO thinking tags, NO commentary - just the prayer text
- NO numbered citations or references like [1], [2], [3]

VOICE & TONE:
✅ Natural, conversational language (like speaking to a friend)
✅ Personal and relational (varies sentence length for natural rhythm)
✅ Authentic emotion (let compassion show)
✅ Balance reverence with warmth
✅ Accessible to all Christians (avoid theological jargon)
✅ Flows naturally when read aloud
✅ Specific to THIS breaking news event

❌ No rhyming poems (too artificial)
❌ No stiff, formal corporate prayer language
❌ No generic platitudes without specifics
❌ No overly flowery or archaic language ("thee," "thou")
❌ No repetitive phrases or clichés
❌ NO thinking process, explanations, or reasoning (PRAYER TEXT ONLY)
❌ No special characters or formatting
❌ NO numbered citations or references like [1], [2], [3]

CRITICAL: Return ONLY the prayer text. No <think> tags, no explanations, no commentary. Just the prayer as if you're speaking it aloud to lead a community in prayer for this specific breaking news event."""

            response = self.client.query(prompt)
            
            # Clean the response
            import re
            prayer = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()
            
            # Ensure it starts correctly
            if not prayer.startswith("Heavenly Father"):
                prayer = "Heavenly Father, " + prayer
            
            # Ensure it ends correctly
            if not prayer.endswith("Amen!") and not prayer.endswith("Amen"):
                if "In Jesus-Christ's name" not in prayer:
                    prayer = prayer.rstrip('.') + ". In Jesus-Christ's name we pray. Amen!"
            
            logger.info(f"Generated customized prayer for {disaster_type} in {location_str}")
            return prayer
            
        except Exception as e:
            logger.error(f"Error generating customized prayer: {e}")
            # Return fallback prayer
            return self._generate_fallback_prayer(disaster)
    
    def _generate_fallback_prayer(self, disaster: Dict) -> str:
        """Generate a fallback prayer if customization fails"""
        disaster_type = disaster.get('type', 'disaster').replace('_', ' ')
        country = disaster.get('country', '')
        location = disaster.get('location', '')
        
        if location and location != country:
            location_str = f"{location}, {country}"
        else:
            location_str = country
        
        return f"""Heavenly Father, we come before You with heavy hearts for the people of {location_str} affected by {disaster_type}. We pray for those who have lost their homes, their loved ones, and their sense of security. Comfort the children who are frightened and the families torn apart by this tragedy.

We ask for Your divine protection over rescue workers and first responders as they serve tirelessly. Give wisdom to leaders making critical decisions, and provide resources for those in desperate need. May Your presence be a refuge and strength to every person facing this crisis.

Lord, we trust in Your promise to never leave nor forsake us. Bring healing, hope, and restoration to {location_str}. In Jesus-Christ's name we pray. Amen!"""
    
    def save_disaster_prayer(self, disaster: Dict, prayer: str) -> bool:
        """
        Save disaster prayer to storage with 3-day expiry (legacy method for backward compatibility)
        
        Args:
            disaster: Disaster dictionary
            prayer: Generated prayer text
            
        Returns:
            True if saved successfully
        """
        try:
            # Create unique ID for this disaster prayer
            disaster_type = disaster.get('type', '').replace(' ', '_')
            country = disaster.get('country', '').lower().replace(' ', '_')
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            prayer_id = f"{disaster_type}_{country}_{timestamp}"
            
            # Create prayer data
            prayer_data = {
                'id': prayer_id,
                'disaster_type': disaster.get('type', ''),
                'country': disaster.get('country', ''),
                'location': disaster.get('location', ''),
                'severity': disaster.get('severity', 'moderate'),
                'casualties': disaster.get('casualties'),
                'news_summary': disaster.get('news_summary', ''),
                'news_source': disaster.get('news_source', ''),
                'prayer': prayer,
                'created_at': datetime.now().isoformat(),
                'expires_at': (datetime.now() + timedelta(days=3)).isoformat(),
                'source': 'disaster_prayer_service'
            }
            
            # Save to storage
            blob_path = f"disaster_prayers/{prayer_id}.json"
            blob = self.storage.bucket.blob(blob_path)
            blob.upload_from_string(
                json.dumps(prayer_data, indent=2),
                content_type='application/json'
            )
            
            logger.info(f"Saved disaster prayer: {prayer_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error saving disaster prayer: {e}")
            return False
    
    def save_grouped_disaster_prayer(self, disaster_type: str, info: Dict, result: Dict) -> bool:
        """
        Save grouped disaster prayer by type with all affected countries
        
        Args:
            disaster_type: Type of disaster (should already be normalized, but we'll ensure it)
            info: Comprehensive information dictionary
            result: Dictionary with 'summary' and 'prayer' keys
            
        Returns:
            True if saved successfully
        """
        try:
            # Ensure disaster_type is normalized (storm -> typhoon, etc.)
            disaster_type = self._normalize_disaster_type(disaster_type)
            
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            prayer_id = f"{disaster_type}_grouped_{timestamp}"
            
            # Create grouped prayer data
            prayer_data = {
                'id': prayer_id,
                'disaster_type': disaster_type,
                'disaster_type_display': disaster_type.replace('_', ' ').replace('-', ' ').title(),
                'affected_countries': info.get('affected_countries', []),
                'affected_regions': info.get('affected_regions', []),
                'overall_severity': info.get('overall_severity', 'moderate'),
                'total_casualties': info.get('total_casualties'),
                'summary': result.get('summary', ''),
                'prayer': result.get('prayer', ''),
                'comprehensive_summary': info.get('comprehensive_summary', ''),
                'key_details': info.get('key_details', []),
                'all_news_summaries': info.get('all_news_summaries', []),
                'created_at': datetime.now().isoformat(),
                'expires_at': (datetime.now() + timedelta(days=3)).isoformat(),
                'source': 'disaster_prayer_service_grouped',
                'is_grouped': True
            }
            
            # Save to storage
            blob_path = f"disaster_prayers/grouped/{prayer_id}.json"
            blob = self.storage.bucket.blob(blob_path)
            blob.upload_from_string(
                json.dumps(prayer_data, indent=2),
                content_type='application/json'
            )
            
            logger.info(f"Saved grouped disaster prayer: {prayer_id} for {disaster_type} covering {len(info.get('affected_countries', []))} countries")
            return True
            
        except Exception as e:
            logger.error(f"Error saving grouped disaster prayer: {e}")
            return False
    
    def get_active_disaster_prayers(self) -> List[Dict]:
        """
        Get all active disaster prayers (not expired, within 3 days, and disasters from last week)
        Prioritizes grouped prayers, falls back to individual prayers
        
        Returns:
            List of disaster prayer dictionaries (grouped prayers first)
        """
        try:
            prayers = []
            grouped_prayers = []
            now = datetime.now()
            # Only show disasters from the last week (7 days)
            max_disaster_age = timedelta(days=7)
            
            # List all disaster prayers (both grouped and individual)
            blobs = self.storage.bucket.list_blobs(prefix='disaster_prayers/')
            
            for blob in blobs:
                if blob.name.endswith('.json'):
                    try:
                        content = blob.download_as_text()
                        prayer_data = json.loads(content)
                        
                        # Check if expired
                        expires_at_str = prayer_data.get('expires_at')
                        if expires_at_str:
                            expires_at = datetime.fromisoformat(expires_at_str)
                            if expires_at <= now:
                                # Delete expired prayer
                                blob.delete()
                                logger.info(f"Deleted expired disaster prayer: {blob.name}")
                                continue
                        
                        # Check disaster timestamp for grouped prayers
                        if prayer_data.get('is_grouped') or 'grouped' in blob.name:
                            # For grouped prayers, check created_at (when we generated the prayer)
                            # Only include if created within last week
                            created_at_str = prayer_data.get('created_at')
                            if created_at_str:
                                try:
                                    created_at = datetime.fromisoformat(created_at_str)
                                    if (now - created_at) <= max_disaster_age:
                                        # Also check if summary/comprehensive_summary contains old dates
                                        summary = prayer_data.get('summary', '')
                                        comprehensive_summary = prayer_data.get('comprehensive_summary', '')
                                        all_summaries = prayer_data.get('all_news_summaries', [])
                                        
                                        has_old_date = False
                                        if summary and self._has_old_date_in_text(summary):
                                            has_old_date = True
                                        elif comprehensive_summary and self._has_old_date_in_text(comprehensive_summary):
                                            has_old_date = True
                                        else:
                                            for news_summary in all_summaries:
                                                if news_summary and self._has_old_date_in_text(news_summary):
                                                    has_old_date = True
                                                    break
                                        
                                        if has_old_date:
                                            logger.warning(f"Filtered out grouped prayer with old date in content: {blob.name}")
                                            blob.delete()
                                            logger.info(f"Deleted grouped disaster prayer with old date: {blob.name}")
                                        else:
                                            grouped_prayers.append(prayer_data)
                                    else:
                                        logger.info(f"Filtered out old grouped prayer: {blob.name} (created {now - created_at} ago)")
                                        # Delete old prayer
                                        blob.delete()
                                        logger.info(f"Deleted old grouped disaster prayer: {blob.name}")
                                except Exception as e:
                                    logger.warning(f"Error parsing created_at for {blob.name}: {e}")
                                    continue
                        else:
                            # For individual prayers, check the disaster timestamp
                            timestamp_str = prayer_data.get('timestamp')
                            if timestamp_str:
                                try:
                                    # Try to parse timestamp
                                    disaster_time = None
                                    try:
                                        disaster_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                                    except:
                                        try:
                                            for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                                                try:
                                                    disaster_time = datetime.strptime(timestamp_str[:19], fmt)
                                                    break
                                                except:
                                                    continue
                                        except:
                                            pass
                                    
                                    if disaster_time:
                                        # Check if disaster is within last week
                                        if (now - disaster_time.replace(tzinfo=None)) <= max_disaster_age:
                                            prayers.append(prayer_data)
                                        else:
                                            logger.info(f"Filtered out old disaster: {blob.name} (disaster occurred {now - disaster_time.replace(tzinfo=None)} ago)")
                                            # Delete old prayer
                                            blob.delete()
                                            logger.info(f"Deleted old disaster prayer: {blob.name}")
                                    else:
                                        # If timestamp parsing fails, use created_at as fallback
                                        created_at_str = prayer_data.get('created_at')
                                        if created_at_str:
                                            try:
                                                created_at = datetime.fromisoformat(created_at_str)
                                                if (now - created_at) <= max_disaster_age:
                                                    prayers.append(prayer_data)
                                                else:
                                                    blob.delete()
                                                    logger.info(f"Deleted old disaster prayer (fallback): {blob.name}")
                                            except:
                                                # If both fail, skip this prayer
                                                logger.warning(f"Could not determine age for {blob.name}, skipping")
                                                continue
                                except Exception as e:
                                    logger.warning(f"Error checking timestamp for {blob.name}: {e}")
                                    # Fallback to created_at
                                    created_at_str = prayer_data.get('created_at')
                                    if created_at_str:
                                        try:
                                            created_at = datetime.fromisoformat(created_at_str)
                                            if (now - created_at) <= max_disaster_age:
                                                prayers.append(prayer_data)
                                        except:
                                            continue
                            else:
                                # No timestamp, use created_at as fallback
                                created_at_str = prayer_data.get('created_at')
                                if created_at_str:
                                    try:
                                        created_at = datetime.fromisoformat(created_at_str)
                                        if (now - created_at) <= max_disaster_age:
                                            prayers.append(prayer_data)
                                    except:
                                        continue
                    except Exception as e:
                        logger.warning(f"Error reading disaster prayer {blob.name}: {e}")
                        continue
            
            # Sort by created_at (most recent first)
            grouped_prayers.sort(key=lambda x: x.get('created_at', ''), reverse=True)
            prayers.sort(key=lambda x: x.get('created_at', ''), reverse=True)
            
            logger.info(f"Returning {len(grouped_prayers)} grouped prayers and {len(prayers)} individual prayers (all within last week)")
            
            # Return grouped prayers first, then individual prayers
            return grouped_prayers + prayers
            
        except Exception as e:
            logger.error(f"Error getting active disaster prayers: {e}")
            return []
    
    def _is_duplicate_disaster(self, new_disaster: Dict, existing_prayers: List[Dict]) -> bool:
        """
        Check if a disaster is a duplicate of an existing prayer
        
        Args:
            new_disaster: The new disaster to check
            existing_prayers: List of existing disaster prayers
            
        Returns:
            True if duplicate found, False otherwise
        """
        new_type = self._normalize_disaster_type(new_disaster.get('type', '')).replace(' ', '_')
        new_country = new_disaster.get('country', '').lower().strip()
        new_location = new_disaster.get('location', '').lower().strip()
        new_timestamp_str = new_disaster.get('timestamp', '')
        
        # Try to parse timestamp to get approximate time
        new_time = None
        if new_timestamp_str:
            try:
                # Try ISO format first
                new_time = datetime.fromisoformat(new_timestamp_str.replace('Z', '+00:00'))
            except:
                try:
                    # Try common formats
                    for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                        try:
                            new_time = datetime.strptime(new_timestamp_str[:19], fmt)
                            break
                        except:
                            continue
                except:
                    pass
        
        for existing in existing_prayers:
            existing_type = self._normalize_disaster_type(existing.get('disaster_type', '')).replace(' ', '_')
            existing_country = existing.get('country', '').lower().strip()
            existing_location = existing.get('location', '').lower().strip()
            existing_created = datetime.fromisoformat(existing.get('created_at', '2000-01-01'))
            
            # Check 1: Exact match on type + country + location
            if (new_type == existing_type and 
                new_country == existing_country and 
                new_location == existing_location):
                # If created within last 12 hours, consider it a duplicate
                if (datetime.now() - existing_created).total_seconds() < 43200:  # 12 hours
                    logger.debug(f"Duplicate found: exact match {new_type} in {new_location}, {new_country}")
                    return True
            
            # Check 2: Same type + country, different location but same day
            if (new_type == existing_type and 
                new_country == existing_country and
                new_location != existing_location):
                # If created within last 6 hours and same country, likely related
                if (datetime.now() - existing_created).total_seconds() < 21600:  # 6 hours
                    logger.debug(f"Duplicate found: same type/country {new_type} in {new_country} (different location)")
                    return True
            
            # Check 3: Same type + country, check if timestamps are very close (same event)
            if (new_type == existing_type and 
                new_country == existing_country and
                new_time and existing_created):
                time_diff = abs((new_time - existing_created).total_seconds())
                # If timestamps are within 2 hours, likely the same event
                if time_diff < 7200:  # 2 hours
                    logger.debug(f"Duplicate found: same type/country with close timestamps {new_type} in {new_country}")
                    return True
            
            # Check 4: Similar news summary (simple keyword matching)
            new_summary = new_disaster.get('news_summary', '').lower()
            existing_summary = existing.get('news_summary', '').lower()
            if new_summary and existing_summary:
                # Extract key words (location, disaster type, key numbers)
                new_keywords = set([w for w in new_summary.split() if len(w) > 4])
                existing_keywords = set([w for w in existing_summary.split() if len(w) > 4])
                # If more than 30% keyword overlap and same type/country, likely duplicate
                if (new_type == existing_type and 
                    new_country == existing_country and
                    len(new_keywords & existing_keywords) / max(len(new_keywords), 1) > 0.3):
                    if (datetime.now() - existing_created).total_seconds() < 43200:  # 12 hours
                        logger.debug(f"Duplicate found: similar summary keywords {new_type} in {new_country}")
                        return True
        
        return False
    
    def _has_old_date_in_text(self, text: str) -> bool:
        """
        Check if text contains references to old dates (previous years)
        
        Args:
            text: Text to check
            
        Returns:
            True if old date found, False otherwise
        """
        if not text:
            return False
        
        current_year = datetime.now().year
        previous_year = current_year - 1
        
        import re
        
        # Check for previous year in text with various patterns
        if str(previous_year) in text:
            # Look for date patterns like "December 14, 2024" or "2024-12-14"
            date_patterns = [
                rf'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{{1,2}},\s+{previous_year}\b',
                rf'\b{previous_year}-\d{{2}}-\d{{2}}\b',
                rf'\b{previous_year}/\d{{2}}/\d{{2}}\b',
                rf'\b\d{{1,2}}/\d{{1,2}}/{previous_year}\b',
                rf'\bsince\s+{previous_year}\b',
                rf'\bin\s+{previous_year}\b',
                rf'\bfrom\s+{previous_year}\b',
                rf'\bstarting\s+in\s+{previous_year}\b',
                rf'\bbegan\s+in\s+{previous_year}\b',
                rf'\bstarted\s+in\s+{previous_year}\b',
            ]
            
            for pattern in date_patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    return True
        
        # Also check for years older than previous year (2023, 2022, etc.)
        for year in range(2020, previous_year):
            year_str = str(year)
            if year_str in text:
                # Check for context indicating it's a date
                year_patterns = [
                    rf'\bsince\s+{year_str}\b',
                    rf'\bin\s+{year_str}\b',
                    rf'\bfrom\s+{year_str}\b',
                    rf'\bstarting\s+in\s+{year_str}\b',
                    rf'\bbegan\s+in\s+{year_str}\b',
                    rf'\bstarted\s+in\s+{year_str}\b',
                    rf'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{{1,2}},\s+{year_str}\b',
                    rf'\b{year_str}-\d{{2}}-\d{{2}}\b',
                ]
                
                for pattern in year_patterns:
                    if re.search(pattern, text, re.IGNORECASE):
                        return True
        
        return False
    
    def _collect_disaster_info_by_type(self, disaster_type: str, disasters: List[Dict]) -> Dict:
        """
        Collect comprehensive information about all affected countries for a disaster type
        
        Args:
            disaster_type: Type of disaster (e.g., 'flood', 'earthquake')
            disasters: List of disaster dictionaries for this type
            
        Returns:
            Dictionary with collected information
        """
        try:
            from datetime import datetime
            current_time = datetime.now().strftime("%B %d, %Y %H:%M UTC")
            
            # Build list of affected countries/regions with details
            # Filter out disasters with old dates in their news summaries
            affected_areas = []
            for disaster in disasters:
                country = disaster.get('country', '')
                location = disaster.get('location', '')
                news_summary = disaster.get('news_summary', '')
                casualties = disaster.get('casualties')
                severity = disaster.get('severity', 'moderate')
                news_source = disaster.get('news_source', '')
                timestamp = disaster.get('timestamp', '')
                
                # Check if news summary contains old dates
                if self._has_old_date_in_text(news_summary):
                    logger.warning(f"Rejected disaster with old date in summary: {disaster_type} in {country} - summary contains previous year")
                    continue
                
                area_info = {
                    'country': country,
                    'location': location if location else country,
                    'news_summary': news_summary,
                    'casualties': casualties,
                    'severity': severity,
                    'news_source': news_source,
                    'timestamp': timestamp
                }
                affected_areas.append(area_info)
            
            if not affected_areas:
                logger.warning(f"No valid recent disasters found for {disaster_type} after filtering old dates")
                return None
            
            # Query 1: Collect comprehensive info about this disaster type
            areas_list = "\n".join([
                f"- {area['location']}, {area['country']}: {area['news_summary']}"
                for area in affected_areas
            ])
            
            prompt = f"""You are analyzing {disaster_type} disasters affecting multiple countries/regions.

CURRENT TIME: {current_time}

AFFECTED AREAS AND NEWS DETAILS:
{areas_list}

TASK: Analyze all the information above and provide a comprehensive summary that includes:
1. All affected countries/regions
2. Overall impact and severity
3. Key details from the news about what happened
4. Current situation status

Return a JSON object with this structure:
{{
    "affected_countries": ["Country1", "Country2", ...],
    "affected_regions": ["Region1, Country1", "Region2, Country2", ...],
    "overall_severity": "minor|moderate|severe|catastrophic",
    "total_casualties": number or null,
    "comprehensive_summary": "Detailed summary (3-5 sentences) covering all affected areas and the overall situation",
    "key_details": ["Detail 1", "Detail 2", "Detail 3"]
}}

Return ONLY valid JSON, no explanations."""
            
            response = self.client.query(prompt)
            
            # Parse response
            import re
            cleaned_response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL | re.IGNORECASE).strip()
            
            # Extract JSON
            json_match = re.search(r'\{.*\}', cleaned_response, re.DOTALL)
            if json_match:
                info = json.loads(json_match.group())
                info['all_news_summaries'] = [area['news_summary'] for area in affected_areas]
                info['all_areas'] = affected_areas
                return info
            else:
                logger.warning(f"Could not parse info collection response for {disaster_type}")
                # Fallback: create basic info from disasters
                countries = list(set([d.get('country', '') for d in disasters if d.get('country')]))
                return {
                    'affected_countries': countries,
                    'affected_regions': [f"{d.get('location', d.get('country', ''))}, {d.get('country', '')}" for d in disasters],
                    'overall_severity': max([d.get('severity', 'moderate') for d in disasters], key=lambda x: ['minor', 'moderate', 'severe', 'catastrophic'].index(x) if x in ['minor', 'moderate', 'severe', 'catastrophic'] else 1),
                    'total_casualties': sum([d.get('casualties') or 0 for d in disasters]),
                    'comprehensive_summary': f"{disaster_type.title()} affecting {len(countries)} countries/regions.",
                    'key_details': [d.get('news_summary', '')[:100] for d in disasters[:3]],
                    'all_news_summaries': [d.get('news_summary', '') for d in disasters],
                    'all_areas': affected_areas
                }
                
        except Exception as e:
            logger.error(f"Error collecting disaster info for {disaster_type}: {e}")
            # Fallback
            countries = list(set([d.get('country', '') for d in disasters if d.get('country')]))
            return {
                'affected_countries': countries,
                'affected_regions': [f"{d.get('location', d.get('country', ''))}, {d.get('country', '')}" for d in disasters],
                'overall_severity': 'moderate',
                'total_casualties': None,
                'comprehensive_summary': f"{disaster_type.title()} affecting multiple regions.",
                'key_details': [],
                'all_news_summaries': [d.get('news_summary', '') for d in disasters],
                'all_areas': [{'country': d.get('country', ''), 'location': d.get('location', ''), 'news_summary': d.get('news_summary', '')} for d in disasters]
            }
    
    def _merge_with_existing_info(self, disaster_type: str, new_info: Dict) -> Dict:
        """
        Merge new disaster info with existing active prayers for the same type
        
        Args:
            disaster_type: Type of disaster
            new_info: Newly collected information
            
        Returns:
            Merged information dictionary
        """
        try:
            existing_prayers = self.get_active_disaster_prayers()
            
            # Find existing prayers for this disaster type
            existing_for_type = [
                p for p in existing_prayers 
                if self._normalize_disaster_type(p.get('disaster_type', '')) == self._normalize_disaster_type(disaster_type)
            ]
            
            if not existing_for_type:
                return new_info
            
            # Extract existing affected countries/regions
            existing_countries = set()
            existing_regions = []
            existing_summaries = []
            
            for prayer in existing_for_type:
                country = prayer.get('country', '')
                location = prayer.get('location', '')
                if country:
                    existing_countries.add(country)
                if location:
                    existing_regions.append(f"{location}, {country}" if location != country else country)
                if prayer.get('news_summary'):
                    existing_summaries.append(prayer.get('news_summary'))
            
            # Merge countries
            merged_countries = list(set(new_info.get('affected_countries', []) + list(existing_countries)))
            
            # Merge regions
            merged_regions = list(set(new_info.get('affected_regions', []) + existing_regions))
            
            # Merge summaries
            merged_summaries = new_info.get('all_news_summaries', []) + existing_summaries
            
            # Update info
            merged_info = new_info.copy()
            merged_info['affected_countries'] = merged_countries
            merged_info['affected_regions'] = merged_regions
            merged_info['all_news_summaries'] = merged_summaries
            
            logger.info(f"Merged info for {disaster_type}: {len(merged_countries)} countries total")
            
            return merged_info
            
        except Exception as e:
            logger.error(f"Error merging existing info for {disaster_type}: {e}")
            return new_info
    
    def _generate_grouped_summary_and_prayer(self, disaster_type: str, info: Dict) -> Dict:
        """
        Generate AI summary and prayer for grouped disaster type
        
        Args:
            disaster_type: Type of disaster
            info: Comprehensive information dictionary
            
        Returns:
            Dictionary with 'summary' and 'prayer' keys
        """
        try:
            from datetime import datetime
            current_time = datetime.now().strftime("%B %d, %Y %H:%M UTC")
            
            # Build comprehensive context
            countries_str = ", ".join(info.get('affected_countries', []))
            regions_str = "\n".join([f"- {r}" for r in info.get('affected_regions', [])])
            all_summaries = "\n\n".join([
                f"News from {area.get('location', area.get('country', 'Unknown'))}, {area.get('country', 'Unknown')}:\n{area.get('news_summary', '')}"
                for area in info.get('all_areas', [])
            ])
            
            # Query 2: Generate summary
            summary_prompt = f"""Based on the following information about {disaster_type} disasters affecting multiple countries, generate a brief, compassionate summary (2-3 sentences) that:
- Mentions all affected countries/regions
- Describes the overall impact
- Is suitable for display on a prayer card

AFFECTED COUNTRIES: {countries_str}

AFFECTED REGIONS:
{regions_str}

DETAILED NEWS FROM ALL AREAS:
{all_summaries}

Return ONLY the summary text (2-3 sentences), no explanations, no JSON."""
            
            summary_response = self.client.query(summary_prompt)
            summary = re.sub(r'<think>.*?</think>', '', summary_response, flags=re.DOTALL | re.IGNORECASE).strip()
            
            # Query 3: Generate prayer
            prayer_prompt = f"""You are a compassionate prayer leader writing a customized prayer for those affected by {disaster_type} in multiple countries/regions.

AFFECTED COUNTRIES AND REGIONS:
{countries_str}

DETAILED NEWS FROM ALL AFFECTED AREAS (use these specific details in your prayer):
{all_summaries}

COMPREHENSIVE SUMMARY:
{info.get('comprehensive_summary', '')}

PRAYER REQUIREMENTS:
- Start with "Heavenly Father," (not "Dear Heavenly Father")
- ⚠️ CRITICAL: Start with PRAISE - acknowledge God's goodness, faithfulness, sovereignty, love, or power before making any requests
- Length: 150-200 words (detailed and comprehensive)
- Mention ALL affected countries/regions specifically by name: {countries_str}
- Reference the SPECIFIC situations described in the news summaries above
- Address the needs of:
  * All those directly affected by {disaster_type} in {countries_str}
  * Families who lost loved ones or are searching for missing family members across all affected areas
  * Those injured and receiving medical care
  * Children who are scared and traumatized
  * Rescue workers and first responders in all affected regions
  * Medical teams treating the injured
  * Government leaders coordinating response efforts
  * Communities coming together to help
- Include a brief biblical reference or promise relevant to this situation
- Call on Jesus Christ and the Holy Spirit by name
- End with hope rooted in Christ
- End with "In Jesus-Christ's name we pray. Amen!" (EXACTLY this ending)
- Make it feel urgent and relevant to THIS specific multi-country crisis
- Use "we" and "our" throughout (praying as a community)
- Natural, conversational language
- Authentic emotion - let the weight of this crisis show through
- NO explanations, NO thinking tags, NO commentary - just the prayer text

CRITICAL: Return ONLY the prayer text. No <think> tags, no explanations, no commentary."""
            
            prayer_response = self.client.query(prayer_prompt)
            prayer = re.sub(r'<think>.*?</think>', '', prayer_response, flags=re.DOTALL | re.IGNORECASE).strip()
            
            # Ensure proper formatting
            if not prayer.startswith("Heavenly Father"):
                prayer = "Heavenly Father, " + prayer
            
            if not prayer.endswith("Amen!") and not prayer.endswith("Amen"):
                if "In Jesus-Christ's name" not in prayer:
                    prayer = prayer.rstrip('.') + ". In Jesus-Christ's name we pray. Amen!"
            
            return {
                'summary': summary,
                'prayer': prayer
            }
            
        except Exception as e:
            logger.error(f"Error generating grouped summary and prayer for {disaster_type}: {e}")
            # Fallback
            countries_str = ", ".join(info.get('affected_countries', []))
            return {
                'summary': f"{disaster_type.title()} affecting {countries_str}.",
                'prayer': self._generate_fallback_prayer({'type': disaster_type, 'country': countries_str})
            }
    
    def process_hourly_disasters(self) -> Dict:
        """
        Main method called hourly to search for breaking disasters and generate grouped prayers by type
        
        Returns:
            Dictionary with processing results
        """
        try:
            logger.info("Starting hourly disaster prayer processing")
            
            # Search for breaking disasters
            disasters = self.search_breaking_disasters()
            
            if not disasters:
                logger.info("No breaking disasters found in this hour")
                return {
                    'success': True,
                    'disasters_found': 0,
                    'prayers_generated': 0
                }
            
            # Additional validation: filter out any disasters with old timestamps
            now = datetime.now()
            max_age = timedelta(days=7)
            current_year = datetime.now().year
            original_count = len(disasters)
            validated_disasters = []
            
            for disaster in disasters:
                timestamp_str = disaster.get('timestamp', '')
                if not timestamp_str:
                    logger.warning(f"Disaster without timestamp rejected: {disaster.get('type')} in {disaster.get('country')}")
                    continue
                
                # Check if timestamp contains old year
                if str(current_year - 1) in timestamp_str or str(current_year - 2) in timestamp_str:
                    logger.warning(f"Disaster with old year rejected: {disaster.get('type')} in {disaster.get('country')} - timestamp: {timestamp_str}")
                    continue
                
                # Parse and validate timestamp
                disaster_time = None
                try:
                    disaster_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    if disaster_time.tzinfo:
                        disaster_time = disaster_time.replace(tzinfo=None)
                except:
                    try:
                        for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                            try:
                                disaster_time = datetime.strptime(timestamp_str[:19], fmt)
                                break
                            except:
                                continue
                    except:
                        pass
                
                if disaster_time:
                    # Check year
                    if disaster_time.year != current_year:
                        logger.warning(f"Disaster from wrong year rejected: {disaster.get('type')} in {disaster.get('country')} - year: {disaster_time.year}, timestamp: {timestamp_str}")
                        continue
                    
                    # Check age
                    age = now - disaster_time
                    if age > max_age:
                        logger.warning(f"Disaster too old rejected: {disaster.get('type')} in {disaster.get('country')} - {age.days} days old, timestamp: {timestamp_str}")
                        continue
                    elif age.days < 0:
                        logger.warning(f"Disaster with future timestamp rejected: {disaster.get('type')} in {disaster.get('country')} - timestamp: {timestamp_str}")
                        continue
                else:
                    # Could not parse timestamp - reject if contains old year
                    if str(current_year - 1) in timestamp_str:
                        logger.warning(f"Disaster with unparseable old timestamp rejected: {disaster.get('type')} in {disaster.get('country')} - timestamp: {timestamp_str}")
                        continue
                
                validated_disasters.append(disaster)
            
            disasters = validated_disasters
            logger.info(f"After timestamp validation: {len(disasters)} disasters remaining (rejected {original_count - len(disasters)} with invalid/old timestamps)")
            
            if not disasters:
                logger.info("No valid recent disasters found after timestamp validation")
                return {
                    'success': True,
                    'disasters_found': 0,
                    'prayers_generated': 0
                }
            
            # Group disasters by type
            disasters_by_type = {}
            for disaster in disasters:
                disaster_type = self._normalize_disaster_type(disaster.get('type', ''))
                if disaster_type not in disasters_by_type:
                    disasters_by_type[disaster_type] = []
                disasters_by_type[disaster_type].append(disaster)
            
            logger.info(f"Found {len(disasters)} disasters across {len(disasters_by_type)} disaster types")
            
            # Process each disaster type
            prayers_generated = 0
            for disaster_type, type_disasters in disasters_by_type.items():
                try:
                    logger.info(f"Processing {disaster_type}: {len(type_disasters)} disasters")
                    
                    # Step 1: Collect comprehensive info
                    info = self._collect_disaster_info_by_type(disaster_type, type_disasters)
                    
                    # Skip if no valid disasters after filtering
                    if info is None:
                        logger.info(f"Skipping {disaster_type} - no valid recent disasters after filtering")
                        continue
                    
                    # Step 2: Merge with existing info
                    merged_info = self._merge_with_existing_info(disaster_type, info)
                    
                    # Step 3: Generate summary and prayer
                    result = self._generate_grouped_summary_and_prayer(disaster_type, merged_info)
                    
                    # Step 4: Save grouped prayer
                    if self.save_grouped_disaster_prayer(disaster_type, merged_info, result):
                        prayers_generated += 1
                        logger.info(f"Generated grouped prayer for {disaster_type} covering {len(merged_info.get('affected_countries', []))} countries")
                    
                except Exception as e:
                    logger.error(f"Error processing disaster type {disaster_type}: {e}")
                    continue
            
            logger.info(f"Hourly processing complete: {prayers_generated} grouped prayers generated from {len(disasters)} disasters")
            
            return {
                'success': True,
                'disasters_found': len(disasters),
                'prayers_generated': prayers_generated
            }
            
        except Exception as e:
            logger.error(f"Error in hourly disaster processing: {e}")
            return {
                'success': False,
                'error': str(e),
                'disasters_found': 0,
                'prayers_generated': 0
            }


# Singleton instance
_disaster_prayer_service = None

def get_disaster_prayer_service(storage: Optional[StorageHandler] = None):
    """Get the DisasterPrayerService singleton instance"""
    global _disaster_prayer_service
    if _disaster_prayer_service is None:
        _disaster_prayer_service = DisasterPrayerService(storage)
    return _disaster_prayer_service
