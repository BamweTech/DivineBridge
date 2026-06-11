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


def _parse_first_json_object(text: str) -> Optional[Dict]:
    """Parse the first JSON object in text; ignores trailing prose after valid JSON."""
    if not text:
        return None
    start = text.find('{')
    if start < 0:
        return None
    try:
        value, _ = json.JSONDecoder().raw_decode(text[start:])
        return value if isinstance(value, dict) else None
    except (json.JSONDecodeError, ValueError):
        return None


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
    'mass shooting', 'gun violence',
    # Major accidents & infrastructure (Global Prayer Watch, not only weather/geopolitics)
    'plane crash', 'aviation accident', 'airport incident',
    'train derailment', 'major transportation accident',
    'building collapse', 'bridge collapse', 'industrial accident', 'explosion',
]

# Global Prayer Watch: wide enough to keep major crises visible for several days (humanitarian
# response, aftershocks, rising tolls) without the feed going stale for weeks.
DISASTER_DISCOVERY_MAX_AGE_DAYS = 5
ACTIVE_EVENT_MAX_AGE_HOURS = 120  # 5 days; must stay in sync with discovery window above
# Summaries sometimes repeat the onset date ("on March 10…") while an event is still active; keep
# a modest buffer for prose dates, but much tighter than the daily prayer's broader summary scope.
DISASTER_TEXT_DATE_MAX_AGE_DAYS = 10
# "March 2026" without a day: treat as stale only if that month is well behind "now"
DISASTER_TEXT_MONTH_ONLY_MIN_AGE_DAYS = 45
# JSON `type` values must match slugs after _normalize_disaster_type (search may use broader terms).
DISCOVERY_JSON_TYPE_SLUGS = (
    "typhoon, earthquake, flood, landslide, drought, fire, tornado, tsunami, volcano, "
    "conflict, epidemic, famine, mass_shooting, major_accident"
)
DISCOVERY_MAX_ITEMS = 12
# sonar is better at live web search; reasoning-pro over-filters and often returns [].
DISCOVERY_MODEL = "sonar"
DISCOVERY_QUERY_TIMEOUT = 90.0

VALID_SEVERITIES = frozenset({'minor', 'moderate', 'severe', 'catastrophic'})
SEVERITY_ALIASES = {
    'high': 'severe',
    'critical': 'severe',
    'extreme': 'catastrophic',
    'ongoing': 'moderate',
    'unknown': 'moderate',
}
MIN_NEWS_SUMMARY_CHARS = 40
MAX_CASUALTIES_DEFAULT = 500_000
CASUALTY_CAP_EXEMPT_TYPES = frozenset({'conflict', 'epidemic', 'famine'})
VALID_DEVELOPMENT_TYPES = frozenset({'new_impact', 'ongoing_response', 'forecast_watch'})
VALID_CONFIDENCE_LEVELS = frozenset({'high', 'medium', 'low'})
GENERIC_NEWS_SOURCES = frozenset({
    '', 'unknown', 'n/a', 'na', 'example', 'example.com', 'not available', 'none',
})
VAGUE_LOCATION_RE = re.compile(
    r'\b(?:nationwide|unknown|tracked\s+region|western\s+pacific|eastern\s+pacific|'
    r'global(?:\s+disaster)?|multiple\s+locations(?:\s+across)?|asean\s+region|'
    r'various\s+regions?|affected\s+regions?)\b',
    re.IGNORECASE,
)
ROUNDUP_SUMMARY_RE = re.compile(
    r'\b(?:weekly\s+(?:disaster\s+)?(?:update|report|roundup)|'
    r'\d+\s+significant\s+(?:earthquakes?|floods?|fires?)|'
    r'multiple\s+locations\s+across|several\s+(?:significant\s+)?(?:earthquakes?|events?))\b',
    re.IGNORECASE,
)
META_PHRASE_RE = re.compile(
    r'\b(?:search\s+results?\s+(?:did\s+not|provided)|available\s+alert\s+text|'
    r'this\s+is\s+included\s+because|the\s+listing\s+indicates|'
    r'no\s+(?:fresh|specific)\s+(?:single[- ]incident\s+)?update)\b',
    re.IGNORECASE,
)
IMPACT_KEYWORDS_RE = re.compile(
    r'\b(?:affected|displaced|evacuat|damage|injur|fatal|killed|wounded|missing|'
    r'destroy|response|emergency|shelter|collapse|crash|explosion|burning|'
    r'flooded|landslide|aftershock|casualt|death\s+toll)\b',
    re.IGNORECASE,
)
CONFLICT_DEVELOPMENT_RE = re.compile(
    r'\b(?:displaced|offensive|ceasefire|humanitarian|blockade|famine|truce|fighting|'
    r'attack|strike|shell|bombard|aid\s+(?:convoy|access|delivery)|evacuat|'
    r'injur|fatal|killed|wounded|toll|front\s*line|cease[- ]?fire)\b',
    re.IGNORECASE,
)
# Non-sovereign labels → (country, default_location_if_vague)
COUNTRY_LOCATION_FIXES = {
    'gaza': ('Palestine', 'Gaza Strip'),
    'gaza strip': ('Palestine', 'Gaza Strip'),
    'crimea': ('Ukraine', 'Crimea'),
    'donbas': ('Ukraine', 'Donbas'),
    'donetsk': ('Ukraine', 'Donetsk region'),
    'drc': ('Democratic Republic of the Congo', None),
    'dr congo': ('Democratic Republic of the Congo', None),
    'democratic republic of congo': ('Democratic Republic of the Congo', None),
    'usa': ('United States', None),
    'u.s.': ('United States', None),
    'u.s.a.': ('United States', None),
    'uk': ('United Kingdom', None),
}


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
        Search for active breaking events for Global Prayer Watch
        
        Returns:
            List of disaster dictionaries with news details
        """
        try:
            hazard_search_hints = ", ".join(DISASTER_TYPES)
            now = datetime.now()
            max_age_days = DISASTER_DISCOVERY_MAX_AGE_DAYS
            current_time = now.strftime("%B %d, %Y %H:%M (local server)")
            window_start = (now - timedelta(days=max_age_days)).strftime("%B %d, %Y")
            window_end = now.strftime("%B %d, %Y")
            cutoff_iso = (now - timedelta(days=max_age_days)).strftime("%Y-%m-%dT%H:%M:%S")
            example_ts = (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ")
            today_tokens = f"{now.strftime('%B')} {now.day}, {now.year}"

            prompt = f"""You are the Global Prayer Watch news monitor. Search the web and return active disasters and humanitarian crises for a Christian prayer feed. Be factual and calm.

CURRENT TIME: {current_time}
WINDOW: Events or fresh reporting from **{window_start}** through **{window_end}** (last {max_age_days} days). Today's anchor: {today_tokens}.

WHAT TO INCLUDE (cast a wide net, then curate):
- Natural disasters with community impact: displacement, damage, injuries, evacuations, or emergency response.
- **Ongoing conflicts** only when the summary cites a development inside the window (offensive, displacement, aid blockade, ceasefire shift, rising toll, etc.).
- Major accidents (aviation, rail, structural collapse, industrial explosions) from the window.
- Prefer reporting in the last 24–72 hours; major ongoing crises may use the full {max_age_days}-day window.
- Downstream code filters weak rows — include plausible candidates when events exist.

SOURCE QUALITY (prefer in order):
1. Government emergency agencies, UN OCHA, GDACS, USGS, national meteorological services
2. Major wires (Reuters, AP, AFP) and established humanitarian orgs (ICRC, WFP, UNHCR)
3. Regional disaster networks (AHA Centre, ReliefWeb)
Avoid: social media rumors, unverified blogs, opinion pieces, fundraising pages.

INCIDENT RULES:
- **One row = one specific incident** or one named ongoing crisis — not a generic weekly roundup.
- Do NOT emit vague weekly tallies ("seven earthquakes this week") unless you name the primary location and latest development.
- `location` must be a city, province, or named region — not "western Pacific", "tracked region", or "multiple locations across ASEAN".
- `country` must be a UN-recognized sovereign state (United States, not USA). Gaza Strip → country "Palestine", location "Gaza Strip". Donbas → country "Ukraine".
- `severity` must be exactly: minor | moderate | severe | catastrophic (never high/critical/ongoing).
- `news_summary`: 2–4 factual sentences; no hype; no [1] citations; no markdown; **no meta-commentary** (never write "search results did not include…").
- Prefer events with reported community impact. Skip pure forecast watches with no impact yet unless severity is severe+.

EXCLUDE:
- Anniversary / "on this day" recaps with no new development.
- Stories whose primary event date is clearly months or years old with no current activity.

SEARCH: Real-time web search — breaking news, official alerts, wires, humanitarian agencies. Keywords: {hazard_search_hints}.

CANONICAL `type` per row (lowercase slug):
{DISCOVERY_JSON_TYPE_SLUGS}
Map hurricanes/cyclones/storms → typhoon; wildfires → fire; wars → conflict; aviation/rail/structural/explosion → major_accident.

OUTPUT:
- Return **3–{DISCOVERY_MAX_ITEMS}** objects when qualifying events exist worldwide.
- One object per distinct incident; merge duplicate articles into one `news_summary`.
- `casualties`: integer only if sources state a count; otherwise null.
- `timestamp`: ISO 8601 UTC for the article/update you rely on (on or after {cutoff_iso}).
- `development_type`: new_impact | ongoing_response | forecast_watch
- `confidence`: high | medium | low (high = named outlet + clear timing; low = weak or inferred)

Return ONLY a JSON array, no markdown or prose:
[{{"type":"earthquake","country":"Japan","location":"Tokyo","severity":"moderate","casualties":null,"news_summary":"Officials report strong shaking in the capital region. Agencies issued safety guidance. Response teams are assessing damage.","news_source":"Reuters","source_url":"https://example.com/article","timestamp":"{example_ts}","development_type":"new_impact","confidence":"high"}}]"""

            set_client_model(DISCOVERY_MODEL)
            response = self.client.query_with_timeout(prompt, timeout=DISCOVERY_QUERY_TIMEOUT)
            
            # Log the raw response first to see what Perplexity actually returned
            logger.info(f"Perplexity RAW response (first 2000 chars): {response[:2000]}")
            logger.info(f"Perplexity RAW response (full length): {len(response)} chars")
            # Also log the end of the response to see if JSON is there
            if len(response) > 2000:
                logger.info(f"Perplexity RAW response (last 500 chars): {response[-500:]}")
            
            # Log the cleaned response (after removing think tags) for better readability
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
            max_age = timedelta(hours=ACTIVE_EVENT_MAX_AGE_HOURS)

            for disaster in disasters:
                if isinstance(disaster, dict) and disaster.get('country') and disaster.get('type'):
                    timestamp_str = disaster.get('timestamp')
                    if not timestamp_str or not str(timestamp_str).strip():
                        logger.warning(
                            f"Rejected disaster (missing timestamp): {disaster.get('type')} in {disaster.get('country')}"
                        )
                        continue
                    timestamp_str = str(timestamp_str).strip()

                    disaster_time = None
                    try:
                        disaster_time = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                        if disaster_time.tzinfo:
                            disaster_time = disaster_time.replace(tzinfo=None)
                    except (ValueError, TypeError):
                        for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d']:
                            try:
                                disaster_time = datetime.strptime(timestamp_str[:19], fmt)
                                break
                            except (ValueError, TypeError):
                                continue

                    if not disaster_time:
                        logger.warning(
                            f"Rejected disaster (unparseable timestamp): {disaster.get('type')} in "
                            f"{disaster.get('country')} — {timestamp_str!r}"
                        )
                        continue

                    age = now - disaster_time
                    if age > max_age:
                        logger.warning(
                            f"Rejected old disaster: {disaster.get('type')} in {disaster.get('country')} — "
                            f"{age.days}d ago ({timestamp_str})"
                        )
                        continue
                    if age.total_seconds() < -3600:
                        logger.warning(
                            f"Rejected future disaster: {disaster.get('type')} in {disaster.get('country')} — "
                            f"{timestamp_str}"
                        )
                        continue

                    combined_text = f"{disaster.get('news_summary', '')} {disaster.get('news_source', '')}"
                    if self._has_old_date_in_text(
                        combined_text,
                        max_age_days=DISASTER_TEXT_DATE_MAX_AGE_DAYS,
                    ):
                        logger.warning(
                            f"Rejected disaster (stale date in summary/source text): {disaster.get('type')} in "
                            f"{disaster.get('country')}"
                        )
                        continue
                    if self._text_suggests_historical_event(combined_text):
                        logger.warning(
                            f"Rejected disaster (historical phrasing in summary): {disaster.get('type')} in "
                            f"{disaster.get('country')}"
                        )
                        continue

                    disaster['type'] = self._normalize_disaster_type(disaster.get('type', ''))
                    country, location = self._normalize_discovery_country(
                        disaster.get('country', ''),
                        disaster.get('location', ''),
                    )
                    disaster['country'] = country.strip()
                    disaster['location'] = (location or country).strip()
                    disaster['severity'] = self._normalize_severity(disaster.get('severity', ''))
                    disaster['development_type'] = self._normalize_development_type(
                        disaster.get('development_type', '')
                    )
                    disaster['confidence'] = self._normalize_confidence(disaster.get('confidence', ''))
                    disaster['source_url'] = (disaster.get('source_url') or '').strip()
                    disaster['news_source'] = (disaster.get('news_source') or '').strip()

                    reject_reason = self._validate_discovery_row(disaster, disaster_time, now)
                    if reject_reason:
                        logger.warning(
                            f"Rejected disaster ({reject_reason}): {disaster.get('type')} in "
                            f"{disaster.get('country')} — {disaster.get('location', '')[:60]}"
                        )
                        continue

                    validated_disasters.append(disaster)

            validated_disasters = self._dedupe_discovery_batch(validated_disasters)
            logger.info(
                f"Validated {len(validated_disasters)} disasters "
                f"(rejected {len(disasters) - len(validated_disasters)} old/invalid disasters)"
            )
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
            'gun violence': 'mass_shooting',
            # Major accidents → single bucket for grouping & prayer generation
            'plane crash': 'major_accident',
            'plane_crash': 'major_accident',
            'aviation accident': 'major_accident',
            'aviation_accident': 'major_accident',
            'airport incident': 'major_accident',
            'airport_incident': 'major_accident',
            'airport emergency': 'major_accident',
            'train derailment': 'major_accident',
            'train_derailment': 'major_accident',
            'major transportation accident': 'major_accident',
            'transportation accident': 'major_accident',
            'transport accident': 'major_accident',
            'building collapse': 'major_accident',
            'building_collapse': 'major_accident',
            'bridge collapse': 'major_accident',
            'bridge_collapse': 'major_accident',
            'industrial accident': 'major_accident',
            'industrial_accident': 'major_accident',
            'explosion': 'major_accident',
            'major accident': 'major_accident',
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
            
            # Build location string
            if location and location != country:
                location_str = f"{location}, {country}"
            else:
                location_str = country
            
            # Build prompt for customized prayer
            prompt = f"""You are a prayer leader writing for those affected by {disaster_type} in {location_str}. Stay **close to the facts** below; do not dramatize, exaggerate casualty figures, or add details not in the summary.

SITUATION SUMMARY (only basis for specifics):
{news_summary}

PRAYER REQUIREMENTS:
- Start with "Heavenly Father," (not "Dear Heavenly Father")
- Start with brief **praise** — God's goodness, faithfulness, sovereignty, love, or power — before requests
- Length: 60-100 words
- Name **{location_str}** and **{disaster_type}** plainly
- Weave in **only** factual threads from the summary (places, type of event, reported needs). If casualties are unknown, pray generally for the hurt and missing without inventing numbers
- Intercede for: affected people and families, responders, medical workers, leaders, communities — as fits what the summary actually says
- One brief biblical comfort or promise (no verse citation needed)
- Name Jesus Christ and the Holy Spirit
- End with hope in Christ; close with "In Jesus-Christ's name we pray. Amen!" (exactly)
- Tone: **warm, steady, and sincere** — not alarmist, not theatrical. No words like "catastrophic," "unprecedented," or "devastating" unless they appear in the summary above
- Use "we" / "our" throughout
- NO thinking tags, NO commentary, NO [1] citations

❌ No rhyming poems; no archaic language ("thee," "thou"); no generic filler without ties to this situation

Return ONLY the prayer text."""
            response = self.client.query(prompt)
            
            # Clean the response
            prayer = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()
            # Remove citation markers from prayer
            prayer = re.sub(r'\[\d+\]', '', prayer).strip()
            prayer = re.sub(r'\s+', ' ', prayer).strip()
            
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
                'source_url': disaster.get('source_url', ''),
                'development_type': disaster.get('development_type', ''),
                'confidence': disaster.get('confidence', ''),
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
        Save grouped disaster prayer by type with all affected countries.
        If an active grouped prayer already exists for the same disaster type with overlapping
        affected countries (same evolving event, e.g. earthquake then aftershocks/building collapse),
        updates that object in place (stable id) instead of creating a second post.
        """
        try:
            # Ensure disaster_type is normalized (storm -> typhoon, etc.)
            disaster_type = self._normalize_disaster_type(disaster_type)
            now = datetime.now()
            countries = info.get('affected_countries', []) or []

            match = self._find_grouped_prayer_to_update(disaster_type, countries)
            if match:
                blob_path, existing = match
                prayer_id = existing.get('id') or ''
                if not prayer_id:
                    prayer_id = f"{disaster_type}_grouped_{now.strftime('%Y%m%d_%H%M%S')}"
                created_at = existing.get('created_at') or now.isoformat()
                logger.info(
                    f"Updating existing grouped disaster prayer {prayer_id} at {blob_path} "
                    f"(same-event merge, {len(countries)} countries in latest snapshot)"
                )
            else:
                timestamp = now.strftime('%Y%m%d_%H%M%S')
                prayer_id = f"{disaster_type}_grouped_{timestamp}"
                created_at = now.isoformat()
                blob_path = f"disaster_prayers/grouped/{prayer_id}.json"
                logger.info(f"Creating new grouped disaster prayer: {prayer_id}")

            # Create grouped prayer data
            prayer_data = {
                'id': prayer_id,
                'disaster_type': disaster_type,
                'disaster_type_display': disaster_type.replace('_', ' ').replace('-', ' ').title(),
                'affected_countries': countries,
                'affected_regions': info.get('affected_regions', []),
                'overall_severity': info.get('overall_severity', 'moderate'),
                'total_casualties': info.get('total_casualties'),
                'summary': result.get('summary', ''),
                'prayer': result.get('prayer', ''),
                # Short 1-2 sentence prayer for the mobile Prayer Wall feed
                'wall_prayer': result.get('wall_prayer', ''),
                'comprehensive_summary': info.get('comprehensive_summary', ''),
                'key_details': info.get('key_details', []),
                'all_news_summaries': info.get('all_news_summaries', []),
                'all_areas': info.get('all_areas', []),
                # Internal audit trail (not exposed in prayer feeds or public APIs)
                'event_sources': self._build_event_sources(info.get('all_areas', [])),
                'created_at': created_at,
                'updated_at': now.isoformat(),
                'expires_at': (now + timedelta(days=3)).isoformat(),
                'source': 'disaster_prayer_service_grouped',
                'is_grouped': True
            }

            blob = self.storage.bucket.blob(blob_path)
            blob.upload_from_string(
                json.dumps(prayer_data, indent=2),
                content_type='application/json'
            )

            self._delete_absorbed_grouped_duplicates(
                disaster_type, blob_path, countries
            )

            logger.info(
                f"Saved grouped disaster prayer: {prayer_id} for {disaster_type} "
                f"covering {len(countries)} countries"
            )
            return True

        except Exception as e:
            logger.error(f"Error saving grouped disaster prayer: {e}")
            return False
    
    def get_active_disaster_prayers(self) -> List[Dict]:
        """
        Get all active disaster prayers for Global Prayer Watch.
        Prioritizes grouped prayers, falls back to individual prayers
        
        Returns:
            List of disaster prayer dictionaries (grouped prayers first)
        """
        try:
            prayers = []
            grouped_prayers = []
            now = datetime.now()
            max_disaster_age = timedelta(hours=ACTIVE_EVENT_MAX_AGE_HOURS)
            
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
                            # For grouped prayers, use the latest refresh time so active events can
                            # stay visible while the hourly summarizer keeps updating them.
                            refreshed_at_str = prayer_data.get('updated_at') or prayer_data.get('created_at')
                            if refreshed_at_str:
                                try:
                                    refreshed_at = datetime.fromisoformat(str(refreshed_at_str).replace('Z', '+00:00'))
                                    if refreshed_at.tzinfo:
                                        refreshed_at = refreshed_at.replace(tzinfo=None)
                                    if (now - refreshed_at) <= max_disaster_age:
                                        # Prayer was generated recently — trust it.
                                        # Text-scanning prayer prose for old dates was
                                        # over-filtering: summaries naturally reference
                                        # when events started (e.g. "conflict since 2024").
                                        grouped_prayers.append(prayer_data)
                                    else:
                                        logger.info(f"Filtered out inactive grouped prayer: {blob.name} (last update {now - refreshed_at} ago)")
                                        blob.delete()
                                        logger.info(f"Deleted old grouped disaster prayer: {blob.name}")
                                except Exception as e:
                                    logger.warning(f"Error parsing grouped prayer recency for {blob.name}: {e}")
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
                                        # Check if disaster is still within the active-event window
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
            
            grouped_prayers = self._dedupe_grouped_by_event_signature(grouped_prayers)
            grouped_prayers.sort(key=lambda x: self._prayer_recency_ts(x), reverse=True)
            prayers.sort(key=lambda x: self._prayer_recency_ts(x), reverse=True)
            
            logger.info(f"Returning {len(grouped_prayers)} grouped prayers and {len(prayers)} individual prayers in the active-event window")
            
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

    def _text_suggests_historical_event(self, text: str) -> bool:
        """True if wording suggests a recap / anniversary / far-past framing (not breaking news).

        Intentionally narrow: phrases like "since 2024" or "ongoing since 2023" are
        common in coverage of current events and should NOT be flagged here.  Only
        clearly retrospective framing should trigger a rejection.
        """
        if not text:
            return False
        t = text.lower()
        if re.search(r'\b(?:several|many|few)\s+months\s+ago\b', t):
            return True
        if re.search(r'\b\d+\s+years?\s+ago\b', t):
            return True
        if re.search(r'\banniversary\s+of\b', t):
            return True
        if 'on this day' in t:
            return True
        if re.search(r'\blooking\s+back\b', t):
            return True
        if re.search(r'\bin\s+retrospect\b', t):
            return True
        return False

    def _normalize_discovery_country(self, country: str, location: str) -> tuple:
        """Map non-sovereign country labels to sovereign state + clearer location."""
        country = (country or '').strip()
        location = (location or '').strip()
        key = country.lower().strip()
        if key in COUNTRY_LOCATION_FIXES:
            fixed_country, default_loc = COUNTRY_LOCATION_FIXES[key]
            if not location or VAGUE_LOCATION_RE.search(location):
                location = default_loc or location or fixed_country
            return fixed_country, location
        return country, location

    def _normalize_severity(self, severity: str) -> str:
        raw = (severity or 'moderate').lower().strip()
        if raw in VALID_SEVERITIES:
            return raw
        return SEVERITY_ALIASES.get(raw, 'moderate')

    def _is_vague_location(self, location: str) -> bool:
        loc = (location or '').strip()
        if not loc or len(loc) < 3:
            return True
        return bool(VAGUE_LOCATION_RE.search(loc))

    def _has_meta_phrasing(self, text: str) -> bool:
        return bool(text and META_PHRASE_RE.search(text))

    def _is_generic_news_source(self, source: str) -> bool:
        return (source or '').strip().lower() in GENERIC_NEWS_SOURCES

    def _is_weekly_roundup(self, summary: str, location: str) -> bool:
        text = f"{summary} {location}"
        return bool(ROUNDUP_SUMMARY_RE.search(text))

    def _passes_impact_gate(
        self,
        disaster_type: str,
        summary: str,
        development_type: str,
        severity: str = 'moderate',
    ) -> bool:
        if disaster_type == 'conflict':
            return True
        if development_type == 'forecast_watch':
            return severity in ('severe', 'catastrophic')
        if development_type in ('new_impact', 'ongoing_response') and severity in (
            'moderate', 'severe', 'catastrophic'
        ):
            return True
        return bool(IMPACT_KEYWORDS_RE.search(summary or ''))

    def _passes_conflict_freshness(self, summary: str, disaster_time: Optional[datetime], now: datetime) -> bool:
        if CONFLICT_DEVELOPMENT_RE.search(summary or ''):
            return True
        if disaster_time and (now - disaster_time) <= timedelta(hours=72):
            return True
        return self._summary_has_recent_date_token(summary, now)

    def _summary_has_recent_date_token(self, summary: str, now: datetime) -> bool:
        if not summary:
            return False
        month_names = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ]
        month_re = '|'.join(month_names)
        window_start = now - timedelta(days=DISASTER_DISCOVERY_MAX_AGE_DAYS)
        for m in re.finditer(rf'\b({month_re})\s+(\d{{1,2}})(?:,?\s+(\d{{4}}))?\b', summary, re.IGNORECASE):
            mon_name = m.group(1).lower()
            try:
                mon = next(i for i, name in enumerate(month_names, 1) if name.lower() == mon_name)
                day = int(m.group(2))
                year = int(m.group(3)) if m.group(3) else now.year
                dt = datetime(year, mon, day)
                if window_start <= dt <= now + timedelta(days=1):
                    return True
            except (ValueError, StopIteration):
                continue
        for m in re.finditer(r'\b(\d{{4}})-(\d{{2}})-(\d{{2}})\b', summary):
            try:
                dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                if window_start <= dt <= now + timedelta(days=1):
                    return True
            except ValueError:
                continue
        return False

    def _normalize_development_type(self, value: str) -> str:
        raw = (value or 'ongoing_response').lower().strip()
        return raw if raw in VALID_DEVELOPMENT_TYPES else 'ongoing_response'

    def _normalize_confidence(self, value: str) -> str:
        raw = (value or 'medium').lower().strip()
        return raw if raw in VALID_CONFIDENCE_LEVELS else 'medium'

    def _casualties_exceed_cap(self, disaster_type: str, casualties) -> bool:
        if casualties is None:
            return False
        try:
            count = int(casualties)
        except (TypeError, ValueError):
            return False
        if disaster_type in CASUALTY_CAP_EXEMPT_TYPES:
            return count > MAX_CASUALTIES_DEFAULT * 2
        return count > MAX_CASUALTIES_DEFAULT

    def _discovery_dedup_key(self, disaster: Dict) -> str:
        dtype = self._normalize_disaster_type(disaster.get('type', ''))
        country = (disaster.get('country') or '').lower().strip()
        location = re.sub(r'\s+', ' ', (disaster.get('location') or '').lower().strip())
        location_key = ' '.join(location.split()[:4])
        return f"{dtype}|{country}|{location_key}"

    def _dedupe_discovery_batch(self, disasters: List[Dict]) -> List[Dict]:
        seen = set()
        deduped = []
        for disaster in disasters:
            key = self._discovery_dedup_key(disaster)
            if key in seen:
                logger.debug(f"Skipping duplicate discovery row: {key}")
                continue
            seen.add(key)
            deduped.append(disaster)
        return deduped

    def _build_event_sources(self, all_areas: List[Dict]) -> List[Dict]:
        """Internal audit trail — stored in GCS, not exposed in prayer feeds."""
        sources = []
        for area in all_areas or []:
            sources.append({
                'country': area.get('country', ''),
                'location': area.get('location', ''),
                'news_source': area.get('news_source', ''),
                'source_url': area.get('source_url', ''),
                'timestamp': area.get('timestamp', ''),
                'development_type': area.get('development_type', ''),
                'confidence': area.get('confidence', ''),
            })
        return sources

    def _validate_discovery_row(
        self,
        disaster: Dict,
        disaster_time: datetime,
        now: datetime,
    ) -> Optional[str]:
        """Return rejection reason, or None if the row passes."""
        dtype = self._normalize_disaster_type(disaster.get('type', ''))
        country = disaster.get('country', '')
        location = disaster.get('location', '')
        summary = (disaster.get('news_summary') or '').strip()
        news_source = (disaster.get('news_source') or '').strip()
        development_type = self._normalize_development_type(disaster.get('development_type', ''))
        confidence = self._normalize_confidence(disaster.get('confidence', ''))

        if len(summary) < MIN_NEWS_SUMMARY_CHARS:
            return 'summary too short'
        if self._has_meta_phrasing(summary):
            return 'meta-commentary in summary'
        if self._is_generic_news_source(news_source):
            return 'missing or generic news_source'
        # confidence is stored for audit; weak rows are caught by source/impact/location gates
        if self._is_vague_location(location):
            return 'vague location'
        if self._is_weekly_roundup(summary, location):
            return 'weekly roundup not specific incident'
        if self._casualties_exceed_cap(dtype, disaster.get('casualties')):
            return 'casualties exceed sanity cap'
        if not self._passes_impact_gate(dtype, summary, development_type, disaster.get('severity', 'moderate')):
            return 'no community impact signal'
        if dtype == 'conflict' and not self._passes_conflict_freshness(summary, disaster_time, now):
            return 'conflict lacks in-window development'
        return None

    def _has_old_date_in_text(self, text: str, max_age_days: Optional[int] = None) -> bool:
        """
        True if text cites a calendar date clearly outside the recent window (e.g. "October 2025"
        when we are in 2026, or a full date older than max_age_days).

        max_age_days defaults to DISASTER_DISCOVERY_MAX_AGE_DAYS; discovery parsing passes
        DISASTER_TEXT_DATE_MAX_AGE_DAYS so onset dates in prose do not over-filter vs. timestamp.
        """
        if not text:
            return False

        now = datetime.now()
        days = max_age_days if max_age_days is not None else DISASTER_DISCOVERY_MAX_AGE_DAYS
        cutoff = now - timedelta(days=days)
        cy, cm = now.year, now.month
        month_only_cutoff = now - timedelta(days=DISASTER_TEXT_MONTH_ONLY_MIN_AGE_DAYS)

        month_names = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ]
        month_re = '|'.join(month_names)
        month_by_lower = {m.lower(): i for i, m in enumerate(month_names, 1)}

        # "October 2025" / "March 2024" (no day) — use the month_only_cutoff
        # uniformly so recent previous-year months aren't over-rejected.
        for m in re.finditer(rf'\b({month_re})\s+(\d{{4}})\b', text, re.IGNORECASE):
            y = int(m.group(2))
            mon = month_by_lower.get(m.group(1).lower())
            if not mon:
                continue
            try:
                mid_month = datetime(y, mon, 15)
            except ValueError:
                mid_month = datetime(y, mon, 1)
            if mid_month < month_only_cutoff:
                logger.debug(f"Stale month+year in text (>{DISASTER_TEXT_MONTH_ONLY_MIN_AGE_DAYS}d old): {m.group(1)} {y}")
                return True

        # "January 15, 2025" / "15 January 2025" — any year
        for m in re.finditer(rf'\b({month_re})\s+(\d{{1,2}}),\s+(\d{{4}})\b', text, re.IGNORECASE):
            mon = month_by_lower.get(m.group(1).lower())
            if not mon:
                continue
            try:
                d, y = int(m.group(2)), int(m.group(3))
                dt = datetime(y, mon, d)
            except (ValueError, TypeError):
                continue
            if dt < cutoff:
                logger.debug(f"Stale full date in text: {m.group(0)}")
                return True

        for m in re.finditer(rf'\b(\d{{1,2}})\s+({month_re})\s+(\d{{4}})\b', text, re.IGNORECASE):
            mon = month_by_lower.get(m.group(2).lower())
            if not mon:
                continue
            try:
                d, y = int(m.group(1)), int(m.group(3))
                dt = datetime(y, mon, d)
            except (ValueError, TypeError):
                continue
            if dt < cutoff:
                logger.debug(f"Stale EU-style date in text: {m.group(0)}")
                return True

        # ISO YYYY-MM-DD anywhere in text
        for m in re.finditer(r'\b(\d{4})-(\d{2})-(\d{2})(?:T|\b)', text):
            try:
                y, mon, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                dt = datetime(y, mon, d)
            except (ValueError, TypeError):
                continue
            if y < 1990 or y > cy + 1:
                continue
            if dt < cutoff:
                logger.debug(f"Stale ISO date in text: {m.group(0)}")
                return True

        # NOTE: We intentionally do NOT scan for loose "since {year}" / "in {year}"
        # / "from {year}" patterns here — those phrases appear frequently in ongoing
        # disaster coverage (e.g. "conflict escalating since 2024") and the timestamp
        # age check is the authoritative recency gate.  The "Month YYYY" and full-date
        # patterns above already catch stale calendar dates in the text.

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
                source_url = disaster.get('source_url', '')
                timestamp = disaster.get('timestamp', '')
                development_type = disaster.get('development_type', '')
                confidence = disaster.get('confidence', '')

                # Remove citation markers like [1], [2], [3], etc. from news summary
                if news_summary:
                    news_summary = re.sub(r'\[\d+\]', '', news_summary).strip()
                    # Clean up any double spaces left after removing citations
                    news_summary = re.sub(r'\s+', ' ', news_summary).strip()

                area_info = {
                    'country': country,
                    'location': location if location else country,
                    'news_summary': news_summary,
                    'casualties': casualties,
                    'severity': severity,
                    'news_source': news_source,
                    'source_url': source_url,
                    'timestamp': timestamp,
                    'development_type': development_type,
                    'confidence': confidence,
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
            
            prompt = f"""You are analyzing {disaster_type} situations affecting multiple countries/regions for a Christian prayer app. Be **factual and restrained** — no sensational language.

CURRENT TIME: {current_time}

AFFECTED AREAS AND NEWS DETAILS:
{areas_list}

TASK: Synthesize only what the lines above support. Include:
1. All affected countries/regions
2. Overall impact in **measured** terms (no hype words like "catastrophic", "unprecedented", "devastating" unless a named source uses them — prefer plain description)
3. Key facts from the news (what happened, who is responding, what is known / unknown)
4. Current situation as reported

SEVERITY & CASUALTIES:
- `overall_severity`: **minor** | **moderate** | **severe** | **catastrophic**. Default toward **moderate** when unclear. Reserve higher levels for well-supported large-scale harm; do not inflate.
- `total_casualties`: sum or aggregate **only if** the inputs give explicit numbers; otherwise **null**. Never invent counts.

Return a JSON object with this structure:
{{
    "affected_countries": ["Country1", "Country2", ...],
    "affected_regions": ["Region1, Country1", "Region2, Country2", ...],
    "overall_severity": "minor|moderate|severe|catastrophic",
    "total_casualties": number or null,
    "comprehensive_summary": "3-5 sentences, calm and specific, no exaggeration",
    "key_details": ["Short factual bullet 1", "Short factual bullet 2", "Short factual bullet 3"]
}}

Return ONLY valid JSON, no markdown, no [1] citations."""
            
            response = self.client.query(prompt)
            
            # Parse response
            cleaned_response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL | re.IGNORECASE).strip()
            
            # Extract JSON (raw_decode: first balanced object, not greedy regex)
            info = _parse_first_json_object(cleaned_response)
            if info:
                # Remove citation markers from comprehensive_summary if present
                if 'comprehensive_summary' in info and info['comprehensive_summary']:
                    info['comprehensive_summary'] = re.sub(r'\[\d+\]', '', info['comprehensive_summary']).strip()
                    info['comprehensive_summary'] = re.sub(r'\s+', ' ', info['comprehensive_summary']).strip()
                
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
                    existing_countries.add(str(country).strip())
                for c in prayer.get('affected_countries') or []:
                    if c:
                        existing_countries.add(str(c).strip())
                if location:
                    existing_regions.append(f"{location}, {country}" if country and location != country else (country or location))
                for r in prayer.get('affected_regions') or []:
                    if r:
                        existing_regions.append(str(r).strip())
                if prayer.get('news_summary'):
                    existing_summaries.append(prayer.get('news_summary'))
                for s in prayer.get('all_news_summaries') or []:
                    if s:
                        existing_summaries.append(s)
            
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

    @staticmethod
    def _canonical_country_slug(raw) -> str:
        """Map common aliases to one slug so USA / United States / US dedupe correctly."""
        if raw is None:
            return ''
        s = str(raw).strip().lower()
        s = re.sub(r'[\.\u2019]', ' ', s)
        s = re.sub(r'\s+', ' ', s).strip()
        if not s:
            return ''
        aliases = {
            'usa': 'united states',
            'us': 'united states',
            'u s': 'united states',
            'u s a': 'united states',
            'united states of america': 'united states',
            'uk': 'united kingdom',
            'u k': 'united kingdom',
            'great britain': 'united kingdom',
            'britain': 'united kingdom',
            'republic of korea': 'south korea',
            'south korea': 'south korea',
            # US state/region often used as "country" in breaking-news blobs
            'hawaii': 'united states',
        }
        return aliases.get(s, s)

    @staticmethod
    def _norm_country_set(countries) -> set:
        """Canonical country slugs for overlap / dedupe checks."""
        out = set()
        for c in countries or []:
            slug = DisasterPrayerService._canonical_country_slug(c)
            if slug:
                out.add(slug)
        return out

    @staticmethod
    def _country_sets_jaccard(a: set, b: set) -> float:
        if not a or not b:
            return 0.0
        inter = len(a & b)
        union = len(a | b)
        return float(inter) / float(union) if union else 0.0

    @staticmethod
    def _prayer_recency_ts(prayer: Dict) -> float:
        """Prefer updated_at, then created_at, for merge targets and feed ordering."""
        for fld in ('updated_at', 'created_at'):
            s = prayer.get(fld)
            if not s:
                continue
            try:
                d = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
                return d.timestamp()
            except Exception:
                try:
                    d = datetime.fromisoformat(str(s)[:19])
                    return d.timestamp()
                except Exception:
                    continue
        return 0.0

    def _dedupe_grouped_by_event_signature(self, prayers: List[Dict]) -> List[Dict]:
        """
        Collapse multiple stored blobs for the same logical event (same normalized type + countries).
        Keeps the most recently updated prayer so the feed shows one card with the latest text.
        """
        buckets: Dict[tuple, Dict] = {}
        for p in prayers:
            dt = self._normalize_disaster_type(p.get('disaster_type', '') or '')
            cset = frozenset(self._norm_country_set(p.get('affected_countries', [])))
            if not cset:
                key = (dt, frozenset(), p.get('id', '') or '')
            else:
                key = (dt, cset)
            cur = buckets.get(key)
            if cur is None or self._prayer_recency_ts(p) > self._prayer_recency_ts(cur):
                buckets[key] = p
        return list(buckets.values())

    def _find_grouped_prayer_to_update(
        self, disaster_type: str, new_countries: List[str], min_jaccard: float = 0.45
    ):
        """
        Find an existing grouped prayer blob that likely describes the same evolving event
        (e.g. earthquake then building collapse in the same country): same disaster type and
        sufficient overlap of affected_countries.
        If several match (e.g. duplicate hourly saves), pick the most recently updated blob
        so we overwrite that file and duplicate cleanup can remove the rest.
        Returns (blob_name, existing_prayer_dict) or None.
        """
        disaster_type = self._normalize_disaster_type(disaster_type)
        new_set = self._norm_country_set(new_countries)
        if not new_set:
            return None
        candidates: List[tuple] = []
        try:
            for blob in self.storage.bucket.list_blobs(prefix='disaster_prayers/grouped/'):
                if not blob.name.endswith('.json'):
                    continue
                try:
                    prayer = json.loads(blob.download_as_text())
                except Exception as e:
                    logger.debug(f"Skip unreadable grouped blob {blob.name}: {e}")
                    continue
                if not (prayer.get('is_grouped') or 'grouped' in blob.name):
                    continue
                if self._normalize_disaster_type(prayer.get('disaster_type', '')) != disaster_type:
                    continue
                old_set = self._norm_country_set(prayer.get('affected_countries', []))
                score = self._country_sets_jaccard(new_set, old_set)
                if score >= min_jaccard:
                    rec = self._prayer_recency_ts(prayer)
                    candidates.append((score, rec, blob.name, prayer))
        except Exception as e:
            logger.warning(f"Error scanning grouped prayers for update match: {e}")
            return None
        if not candidates:
            return None
        candidates.sort(key=lambda x: (-x[0], -x[1]))
        _, _, blob_name, prayer = candidates[0]
        return (blob_name, prayer)

    def _delete_absorbed_grouped_duplicates(
        self,
        disaster_type: str,
        keep_blob_name: str,
        final_countries: List[str],
        min_jaccard: float = 0.45,
    ) -> None:
        """After upserting one grouped prayer, remove other grouped blobs of the same type that overlap the same event set."""
        disaster_type = self._normalize_disaster_type(disaster_type)
        final_set = self._norm_country_set(final_countries)
        if not final_set:
            return
        try:
            for blob in self.storage.bucket.list_blobs(prefix='disaster_prayers/grouped/'):
                if not blob.name.endswith('.json') or blob.name == keep_blob_name:
                    continue
                try:
                    prayer = json.loads(blob.download_as_text())
                except Exception:
                    continue
                if not (prayer.get('is_grouped') or 'grouped' in blob.name):
                    continue
                if self._normalize_disaster_type(prayer.get('disaster_type', '')) != disaster_type:
                    continue
                other = self._norm_country_set(prayer.get('affected_countries', []))
                if self._country_sets_jaccard(final_set, other) >= min_jaccard:
                    blob.delete()
                    logger.info(f"Removed absorbed duplicate grouped prayer: {blob.name}")
        except Exception as e:
            logger.warning(f"Duplicate cleanup skipped: {e}")
    
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
            summary_prompt = f"""Write a **short, factual** prayer-card summary (2-3 sentences) about {disaster_type} affecting multiple countries. Calm tone: no hype, no exaggerated numbers, no words like "catastrophic" or "unprecedented" unless directly reflecting a named source in the text below.

- Mention the affected countries/regions
- State impact in measured, plain language
- Suitable for people who want truth without sensationalism

AFFECTED COUNTRIES: {countries_str}

AFFECTED REGIONS:
{regions_str}

DETAILED NEWS FROM ALL AREAS:
{all_summaries}

Do not mention news outlets, URLs, or source names.

Return ONLY the summary text (2-3 sentences), no JSON, no bullet list."""
            
            summary_response = self.client.query(summary_prompt)
            summary = re.sub(r'<think>.*?</think>', '', summary_response, flags=re.DOTALL | re.IGNORECASE).strip()
            # Remove citation markers like [1], [2], [3], etc.
            summary = re.sub(r'\[\d+\]', '', summary).strip()
            # Clean up any double spaces left after removing citations
            summary = re.sub(r'\s+', ' ', summary).strip()
            
            # Query 3: Generate prayer
            prayer_prompt = f"""You are a prayer leader for people affected by {disaster_type} in multiple countries. Ground every concrete detail in the text below; **do not** invent casualties, scale, or drama.

AFFECTED COUNTRIES AND REGIONS:
{countries_str}

NEWS FROM AFFECTED AREAS (only source for specifics):
{all_summaries}

COMPREHENSIVE SUMMARY:
{info.get('comprehensive_summary', '')}

PRAYER REQUIREMENTS:
- Start with "Heavenly Father," then brief **praise** before intercession
- Length: 80-120 words
- Name these places explicitly: {countries_str}
- Intercede for needs that **match** the summaries (affected people, families, responders, leaders, healing, peace — as appropriate). If harm is uncertain, pray with humility without stating unreported facts
- Brief biblical comfort or promise (no verse citation)
- Name Jesus Christ and the Holy Spirit; end with hope in Christ
- Closing exactly: "In Jesus-Christ's name we pray. Amen!"
- Tone: **steady, compassionate, factual** — not alarmist. Avoid exaggerated language and unverified superlatives
- Use "we" / "our" throughout
- NO thinking tags, NO commentary
- Do not mention news outlets, URLs, or source names

Return ONLY the prayer text."""
            
            prayer_response = self.client.query(prayer_prompt)
            prayer = re.sub(r'<think>.*?</think>', '', prayer_response, flags=re.DOTALL | re.IGNORECASE).strip()
            # Remove citation markers from prayer
            prayer = re.sub(r'\[\d+\]', '', prayer).strip()
            prayer = re.sub(r'\s+', ' ', prayer).strip()
            
            # Ensure proper formatting
            if not prayer.startswith("Heavenly Father"):
                prayer = "Heavenly Father, " + prayer
            
            if not prayer.endswith("Amen!") and not prayer.endswith("Amen"):
                if "In Jesus-Christ's name" not in prayer:
                    prayer = prayer.rstrip('.') + ". In Jesus-Christ's name we pray. Amen!"

            # Query 4: Generate a short wall prayer for the mobile Prayer Wall feed
            wall_prayer = self._generate_wall_prayer(disaster_type, info, all_summaries)

            return {
                'summary': summary,
                'prayer': prayer,
                'wall_prayer': wall_prayer,
            }
            
        except Exception as e:
            logger.error(f"Error generating grouped summary and prayer for {disaster_type}: {e}")
            # Fallback
            countries_str = ", ".join(info.get('affected_countries', []))
            return {
                'summary': f"{disaster_type.title()} affecting {countries_str}.",
                'prayer': self._generate_fallback_prayer({'type': disaster_type, 'country': countries_str}),
                'wall_prayer': self._fallback_wall_prayer(disaster_type, info.get('affected_countries', [])),
            }

    def _generate_wall_prayer(self, disaster_type: str, info: Dict, all_summaries: str) -> str:
        """
        Generate a short, social-media-style prayer post (1-2 sentences) for the mobile Prayer Wall.

        This is NOT the long intercessory prayer — it's a concise, human, community-voice post
        that calls out the specific event, location, and a short prayerful statement.

        Example output (factual, not hyped):
        "Praying for California after reported strong earthquake activity. May those affected find safety and support. 🙏"
        """
        try:
            countries_str = ", ".join(info.get('affected_countries', []))
            # Pull one representative news headline/detail from the summaries for specificity
            first_area = (info.get('all_areas') or [{}])[0]
            key_detail = first_area.get('news_summary', '')[:300]  # just enough context

            prompt = f"""You are writing a short prayer post for a Christian prayer wall (e.g. Threads-style). **Factual and gentle** — no sensational words or unverified numbers.

EVENT: {disaster_type.replace('_', ' ').title()} affecting {countries_str}
NEWS DETAIL: {key_detail}

TASK: 1-2 sentences, max 200 characters total:
- Community voice ("Praying for...", "Standing with...", "Lifting up...")
- Name the location(s) and event type in plain language
- **One** concrete detail from the news only if it is stated above (e.g. region, advisory, reported response) — do NOT invent magnitude, death tolls, or superlatives
- End with a simple prayerful wish (comfort, safety, strength)
- Optional single 🙏 or ✝️ at the end
- No "Heavenly Father" opener; no hype words ("catastrophic", "unprecedented", "devastating") unless they appear verbatim in NEWS DETAIL

GOOD EXAMPLES:
"Praying for California as officials assess earthquake impacts. May neighbors find safety and help. 🙏"
"Standing with Queensland communities under cyclone watch. May families stay safe. 🙏"

BAD: invented stats, alarmist tone, more than 2 sentences, formal liturgical opening.

Do not mention news outlets, URLs, or source names.

Return ONLY the post text. No quotes or labels."""

            response = self.client.query(prompt)
            wall_prayer = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL | re.IGNORECASE).strip()
            wall_prayer = re.sub(r'\[\d+\]', '', wall_prayer).strip()
            wall_prayer = re.sub(r'^[""]|[""]$', '', wall_prayer).strip()  # strip surrounding quotes
            wall_prayer = re.sub(r'\s+', ' ', wall_prayer).strip()

            # Safety: truncate if AI went rogue and wrote way too much
            if len(wall_prayer) > 300:
                sentences = re.findall(r'[^.!?]+[.!?]+', wall_prayer)
                wall_prayer = ' '.join(sentences[:2]).strip()
                if len(wall_prayer) > 300:
                    wall_prayer = wall_prayer[:300].rsplit(' ', 1)[0] + '…'

            if not wall_prayer:
                return self._fallback_wall_prayer(disaster_type, info.get('affected_countries', []))

            logger.info(f"Generated wall prayer for {disaster_type}/{countries_str}: {len(wall_prayer)} chars")
            return wall_prayer

        except Exception as e:
            logger.warning(f"Wall prayer generation failed for {disaster_type}: {e}")
            return self._fallback_wall_prayer(disaster_type, info.get('affected_countries', []))

    def _fallback_wall_prayer(self, disaster_type: str, countries: list) -> str:
        """Simple template fallback for the wall prayer when AI generation fails."""
        location = ", ".join(countries[:2]) if countries else "those affected"
        extra = f" and {len(countries) - 2} more" if len(countries) > 2 else ""
        dtype = disaster_type.replace('_', ' ')
        return f"Praying for the people of {location}{extra} affected by {dtype}. May God bring comfort and healing to all those impacted. 🙏"
    
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
            
            # _parse_disaster_response already validates timestamps, age, and text
            # content — no redundant pass needed here.
            logger.info(f"Proceeding with {len(disasters)} validated disasters from parsing stage")
            
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
