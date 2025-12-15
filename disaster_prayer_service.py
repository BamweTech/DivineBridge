"""
Disaster Prayer Service - Hourly breaking news monitoring and customized prayer generation
Separate from daily prayer flow, triggered every hour to find breaking disasters
"""

import logging
import json
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
            
            prompt = f"""You are a breaking news monitor searching for disasters and crises that occurred in the LAST 3-6 HOURS worldwide.

CURRENT TIME: {current_time}

SEARCH INSTRUCTIONS:
1. Search the web for BREAKING NEWS about disasters that happened in the last 3-6 hours. Use specific search queries like:
   - "earthquake today" OR "earthquake breaking news"
   - "flood [country] today" OR "flooding breaking news"
   - "hurricane breaking news" OR "typhoon today"
   - "wildfire breaking news" OR "fire [location] today"
   - "mass shooting today" OR "gun violence breaking news"
   - "conflict breaking news" OR "war [region] today"
   - "earthquake [country] [date]" (use today's date)
   - "natural disaster breaking news today"

2. Use diverse sources:
   - International news agencies (Reuters, AP, BBC, CNN)
   - Local news sources
   - Government emergency services
   - Humanitarian organizations
   - Verified social media reports

3. Focus on these disaster types: {disaster_types_str}

4. CRITICAL: Only include disasters that occurred in the LAST 3-6 HOURS. Check timestamps carefully.

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

CRITICAL REQUIREMENTS:
- Only include disasters that happened in the LAST 3-6 HOURS (breaking news)
- Be specific with country names (full names, not abbreviations like 'US' - use 'United States')
- Include specific details from the news in the summary (what happened, where, impact)
- If no breaking disasters found in last 3-6 hours, return empty array []
- Return ONLY valid JSON array, no explanations, no markdown, no code blocks
- Verify information from multiple sources when possible
- Focus on verified, reliable news sources

Return ONLY the JSON array, nothing else. Example format:
[{{"type":"earthquake","country":"Japan","location":"Tokyo","severity":"severe","casualties":150,"news_summary":"A magnitude 7.2 earthquake struck Tokyo at 2:30 PM local time, causing widespread damage to buildings and infrastructure. Emergency services are responding to multiple collapsed structures. At least 150 people are reported injured.","news_source":"Reuters","timestamp":"2025-01-15T14:30:00Z"}}]"""

            response = self.client.query(prompt)
            
            # Parse response
            disasters = self._parse_disaster_response(response)
            
            logger.info(f"Found {len(disasters)} breaking disasters")
            return disasters
            
        except Exception as e:
            logger.error(f"Error searching for breaking disasters: {e}")
            return []
    
    def _parse_disaster_response(self, response: str) -> List[Dict]:
        """Parse the AI response into list of disaster dictionaries"""
        try:
            response = response.strip()
            
            # Remove markdown code blocks if present
            if response.startswith('```'):
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
                response = response.strip()
            
            # Try to find JSON array in response
            if response.startswith('['):
                disasters = json.loads(response)
            elif '{' in response:
                # Try to extract JSON object
                start = response.find('[')
                end = response.rfind(']') + 1
                if start >= 0 and end > start:
                    disasters = json.loads(response[start:end])
                else:
                    # Single object, wrap in array
                    start = response.find('{')
                    end = response.rfind('}') + 1
                    if start >= 0 and end > start:
                        disasters = [json.loads(response[start:end])]
                    else:
                        disasters = []
            else:
                disasters = []
            
            # Validate and normalize disasters
            validated_disasters = []
            for disaster in disasters:
                if isinstance(disaster, dict) and disaster.get('country') and disaster.get('type'):
                    # Normalize disaster type
                    disaster['type'] = self._normalize_disaster_type(disaster.get('type', ''))
                    # Ensure country is properly formatted
                    disaster['country'] = disaster['country'].strip()
                    validated_disasters.append(disaster)
            
            return validated_disasters
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse disaster response: {e}")
            logger.error(f"Response was: {response[:500]}")
            return []
        except Exception as e:
            logger.error(f"Error parsing disaster response: {e}")
            return []
    
    def _normalize_disaster_type(self, disaster_type: str) -> str:
        """Normalize disaster type to standard format"""
        disaster_type = disaster_type.lower().strip()
        
        type_mapping = {
            'hurricane': 'typhoon',
            'cyclone': 'typhoon',
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

            response = self.client.generate_response(prompt)
            
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
        Save disaster prayer to storage with 3-day expiry
        
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
    
    def get_active_disaster_prayers(self) -> List[Dict]:
        """
        Get all active disaster prayers (not expired, within 3 days)
        
        Returns:
            List of disaster prayer dictionaries
        """
        try:
            prayers = []
            now = datetime.now()
            
            # List all disaster prayers
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
                            if expires_at > now:
                                prayers.append(prayer_data)
                            else:
                                # Delete expired prayer
                                blob.delete()
                                logger.info(f"Deleted expired disaster prayer: {blob.name}")
                    except Exception as e:
                        logger.warning(f"Error reading disaster prayer {blob.name}: {e}")
                        continue
            
            # Sort by created_at (most recent first)
            prayers.sort(key=lambda x: x.get('created_at', ''), reverse=True)
            
            return prayers
            
        except Exception as e:
            logger.error(f"Error getting active disaster prayers: {e}")
            return []
    
    def process_hourly_disasters(self) -> Dict:
        """
        Main method called hourly to search for breaking disasters and generate prayers
        
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
            
            # Generate prayers for each disaster
            prayers_generated = 0
            for disaster in disasters:
                try:
                    # Check if we already have a recent prayer for this disaster
                    # (avoid duplicates within 24 hours)
                    country = disaster.get('country', '').lower()
                    disaster_type = disaster.get('type', '').replace(' ', '_')
                    
                    # Check existing prayers
                    existing_prayers = self.get_active_disaster_prayers()
                    recent_duplicate = False
                    for existing in existing_prayers:
                        if (existing.get('country', '').lower() == country and
                            existing.get('disaster_type', '').replace(' ', '_') == disaster_type):
                            # Check if created within last 24 hours
                            created_at = datetime.fromisoformat(existing.get('created_at', '2000-01-01'))
                            if (datetime.now() - created_at).total_seconds() < 86400:
                                recent_duplicate = True
                                break
                    
                    if recent_duplicate:
                        logger.info(f"Skipping duplicate disaster: {disaster_type} in {country}")
                        continue
                    
                    # Generate customized prayer
                    prayer = self.generate_customized_prayer(disaster)
                    
                    # Save prayer
                    if self.save_disaster_prayer(disaster, prayer):
                        prayers_generated += 1
                        logger.info(f"Generated prayer for {disaster_type} in {country}")
                    
                except Exception as e:
                    logger.error(f"Error processing disaster {disaster}: {e}")
                    continue
            
            logger.info(f"Hourly processing complete: {prayers_generated} prayers generated from {len(disasters)} disasters")
            
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
