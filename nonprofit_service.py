"""
Non-Profit Service for Divine Bridge
Handles non-profit organization queries, caching, and selection using Perplexity AI.
"""

import logging
import json
import random
import requests
import hashlib
from io import BytesIO
from PIL import Image
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from config import get_config
from perplexity_client import get_perplexity_client, set_client_model
from storage_handler import StorageHandler
from location_service import get_location_service

logger = logging.getLogger(__name__)


class NonprofitService:
    """Handle non-profit organization queries and caching"""
    
    # Blacklist of organizations to exclude (incorrect info, scams, etc.)
    ORGANIZATION_BLACKLIST = [
        "moore angels inc",
        "moore angels",
        # Add more here as needed (lowercase)
    ]
    
    def __init__(self, storage_handler=None):
        """Initialize the NonprofitService"""
        try:
            # Use shared Perplexity client (avoids test query overhead)
            self.client = get_perplexity_client()
            # Use faster model for organization queries (sonar-pro is faster than sonar-reasoning-pro)
            set_client_model("sonar-pro")
            self.storage = storage_handler or StorageHandler()
            self.location_service = get_location_service()
            
            # Cache TTL settings
            self.general_cache_days = 30
            self.disaster_cache_days = 7
            
            logger.info("NonprofitService initialized successfully (using shared client)")
            
        except Exception as e:
            logger.error(f"Error initializing NonprofitService: {e}")
            raise
    
    def _filter_blacklisted(self, organizations: List[Dict]) -> List[Dict]:
        """
        Remove blacklisted organizations from list
        
        Args:
            organizations: List of organization dictionaries
        
        Returns:
            Filtered list without blacklisted organizations
        """
        filtered = []
        for org in organizations:
            org_name_lower = org.get('name', '').lower()
            if not any(blacklisted in org_name_lower for blacklisted in self.ORGANIZATION_BLACKLIST):
                filtered.append(org)
            else:
                logger.warning(f"Filtered out blacklisted organization: {org.get('name')}")
        return filtered
    
    def get_organizations_for_user(self, user_location: Dict, prayer_disasters: List[Dict], 
                                  date: str) -> List[Dict]:
        """
        Get 5 organizations for a user (3 general + 2 disaster-specific)
        Uses Perplexity AI with caching for local organizations
        
        Args:
            user_location: User's location dictionary
            prayer_disasters: List of disasters from today's prayer
            date: Today's date (YYYY-MM-DD) for seeding randomization
        
        Returns:
            List of 5 organization dictionaries
        """
        try:
            selected_orgs = []
            
            # Check if using default/fallback location
            is_default_location = (
                user_location.get('detection_method') == 'default' or
                user_location.get('city') == 'New York' or
                not user_location.get('city')
            )
            
            # If default location, use global organizations instead of local
            if is_default_location:
                logger.info("Using default location, returning global organizations")
                fallback = self._get_fallback_organizations()
                
                # Fetch logos for fallback organizations if not cached
                for org in fallback:
                    if not org.get('logo_url'):
                        logo_url = self._fetch_and_cache_logo(org)
                        org['logo_url'] = logo_url
                
                random.seed(date)
                # Get all 5 from fallback when location is not detected
                selected_orgs.extend(random.sample(fallback, min(5, len(fallback))))
                return selected_orgs
            
            # 1. Get 3 general local organizations (from cache or Perplexity)
            logger.info(f"Fetching general organizations for {user_location.get('city', 'Unknown')}")
            general_orgs = self._get_general_organizations(user_location)
            
            if general_orgs and len(general_orgs) >= 3:
                # Use date as seed for daily consistency
                random.seed(date)
                selected_general = random.sample(general_orgs, min(3, len(general_orgs)))
                selected_orgs.extend(selected_general)
                logger.info(f"Selected {len(selected_general)} general organizations")
            else:
                # Not enough local orgs, use fallback
                logger.warning(f"Not enough general orgs found, using fallback")
                fallback = self._get_fallback_organizations()
                random.seed(date)
                selected_orgs.extend(random.sample(fallback, min(3, len(fallback))))
            
            # 2. Get 2 disaster-specific organizations
            if prayer_disasters:
                logger.info(f"Fetching disaster-specific organizations for {len(prayer_disasters)} disasters")
                for disaster in prayer_disasters[:2]:  # Top 2 disasters
                    disaster_orgs = self._get_disaster_organizations(disaster)
                    if disaster_orgs:
                        # Use date as seed
                        random.seed(f"{date}-{disaster.get('type')}")
                        selected_disaster = random.sample(disaster_orgs, min(1, len(disaster_orgs)))
                        selected_orgs.extend(selected_disaster)
                        logger.info(f"Selected organization for {disaster.get('type')} disaster")
            
            # 3. Fill to 5 if needed with more general orgs or fallback
            if len(selected_orgs) < 5:
                needed = 5 - len(selected_orgs)
                logger.info(f"Need {needed} more organizations to reach 5")
                
                if general_orgs:
                    remaining = [o for o in general_orgs if o not in selected_orgs]
                    if remaining:
                        random.seed(f"{date}-fill")
                        selected_orgs.extend(random.sample(remaining, min(needed, len(remaining))))
                
                # Still need more? Use fallback
                if len(selected_orgs) < 5:
                    fallback = self._get_fallback_organizations()
                    remaining_fallback = [o for o in fallback if o not in selected_orgs]
                    random.seed(f"{date}-fallback")
                    needed = 5 - len(selected_orgs)
                    selected_orgs.extend(random.sample(remaining_fallback, min(needed, len(remaining_fallback))))
            
            # Add badges based on context
            # Final blacklist filter before returning
            selected_orgs = self._filter_blacklisted(selected_orgs)
            
            for org in selected_orgs:
                org['badge'] = self._determine_badge(org, user_location, prayer_disasters)
                org['badge_type'] = 'local' if org.get('is_local') else 'disaster' if org.get('is_disaster_response') else 'general'
            
            logger.info(f"Returning {len(selected_orgs)} total organizations (after blacklist filter)")
            return selected_orgs[:5]
            
        except Exception as e:
            logger.error(f"Error getting organizations for user: {e}", exc_info=True)
            # Return fallback organizations on error
            logger.info("Falling back to global organizations")
            fallback = self._get_fallback_organizations()
            random.seed(date)
            return random.sample(fallback, min(5, len(fallback)))
    
    def _get_general_organizations(self, location: Dict) -> List[Dict]:
        """
        Get general organizations for a location (with caching)
        
        Args:
            location: Location dictionary
        
        Returns:
            List of organization dictionaries
        """
        try:
            city_slug = self.location_service.get_city_slug(location.get('city', 'unknown'))
            country_code = location.get('country_code', 'XX')
            
            # Check cache first
            cache_path = f"organizations/{country_code}/{city_slug}/general.json"
            cached_data = self.storage.get_json_from_storage(cache_path)
            
            if cached_data and self._is_cache_valid(cached_data, self.general_cache_days):
                logger.info(f"Using cached general organizations for {location.get('city')}")
                orgs = cached_data.get('organizations', [])
                # Filter out blacklisted organizations
                orgs = self._filter_blacklisted(orgs)
                
                # Check if cached orgs need logo fetching (for old cache entries)
                needs_logo_update = any(org.get('logo_url') is None for org in orgs)
                if needs_logo_update:
                    logger.info(f"Cached orgs missing logos, fetching in background...")
                    
                    # Fetch logos in background (don't block response)
                    import threading
                    orgs_copy = [dict(org) for org in orgs]  # Create a copy for background thread
                    
                    def fetch_logos_background():
                        try:
                            logger.info(f"Background: Updating logos for cached orgs...")
                            for org in orgs_copy:
                                if org.get('logo_url') is None:
                                    logo_url = self._fetch_and_cache_logo(org)
                                    org['logo_url'] = logo_url
                            # Re-cache with updated logos
                            self._cache_organizations(orgs_copy, cache_path, fetch_logos=False)
                            logger.info(f"Background: Logo update complete for {location.get('city')}")
                        except Exception as e:
                            logger.error(f"Background logo update error: {e}")
                    
                    thread = threading.Thread(target=fetch_logos_background, daemon=True)
                    thread.start()
                
                # Mark as local
                for org in orgs:
                    org['is_local'] = True
                return orgs
            
            # Cache miss - query Perplexity
            logger.info(f"Cache miss for {location.get('city')}, querying Perplexity...")
            orgs = self._query_perplexity_for_general_orgs(location)
            
            if orgs:
                # Filter out blacklisted organizations before caching
                orgs = self._filter_blacklisted(orgs)
                
                # Cache immediately WITHOUT logos for fast response
                self._cache_organizations(orgs, cache_path, fetch_logos=False)
                
                # Fetch logos in background (don't block response)
                import threading
                def fetch_logos_background():
                    try:
                        logger.info(f"Background: Fetching logos for {len(orgs)} organizations...")
                        for org in orgs:
                            if org.get('logo_url') is None:
                                logo_url = self._fetch_and_cache_logo(org)
                                org['logo_url'] = logo_url
                        # Re-cache with logos
                        self._cache_organizations(orgs, cache_path, fetch_logos=False)
                        logger.info(f"Background: Logo fetching complete for {location.get('city')}")
                    except Exception as e:
                        logger.error(f"Background logo fetching error: {e}")
                
                thread = threading.Thread(target=fetch_logos_background, daemon=True)
                thread.start()
                
                # Mark as local
                for org in orgs:
                    org['is_local'] = True
                return orgs
            
            # If query failed, return fallback organizations
            logger.warning(f"Perplexity query failed, using fallback organizations")
            return self._get_fallback_organizations()
            
        except Exception as e:
            logger.error(f"Error getting general organizations: {e}")
            return []
    
    def _get_disaster_organizations(self, disaster: Dict) -> List[Dict]:
        """
        Get organizations responding to a specific disaster
        
        Args:
            disaster: Disaster dictionary with type and locations
        
        Returns:
            List of organization dictionaries
        """
        try:
            disaster_type = disaster.get('type', 'unknown')
            locations = disaster.get('locations', [])
            
            if not locations:
                logger.warning(f"No locations for disaster type: {disaster_type}")
                return []
            
            # Use first location as primary
            primary_location = locations[0]
            
            # Check cache
            cache_path = f"organizations/disasters/{disaster_type}/{primary_location.lower().replace(' ', '-')}.json"
            cached_data = self.storage.get_json_from_storage(cache_path)
            
            if cached_data and self._is_cache_valid(cached_data, self.disaster_cache_days):
                logger.info(f"Using cached disaster organizations for {disaster_type} in {primary_location}")
                orgs = cached_data.get('organizations', [])
                # Mark as disaster response
                for org in orgs:
                    org['is_disaster_response'] = True
                    org['disaster_type'] = disaster_type
                return orgs
            
            # Cache miss - query Perplexity
            logger.info(f"Querying Perplexity for {disaster_type} organizations in {primary_location}...")
            orgs = self._query_perplexity_for_disaster_orgs(disaster, primary_location)
            
            if orgs:
                # Cache immediately WITHOUT logos for fast response
                self._cache_organizations(orgs, cache_path, fetch_logos=False)
                
                # Fetch logos in background
                import threading
                def fetch_logos_background():
                    try:
                        logger.info(f"Background: Fetching logos for {len(orgs)} disaster orgs...")
                        for org in orgs:
                            if org.get('logo_url') is None:
                                logo_url = self._fetch_and_cache_logo(org)
                                org['logo_url'] = logo_url
                        # Re-cache with logos
                        self._cache_organizations(orgs, cache_path, fetch_logos=False)
                        logger.info(f"Background: Logo fetching complete for {disaster_type} in {primary_location}")
                    except Exception as e:
                        logger.error(f"Background logo fetching error: {e}")
                
                thread = threading.Thread(target=fetch_logos_background, daemon=True)
                thread.start()
                
                # Mark as disaster response
                for org in orgs:
                    org['is_disaster_response'] = True
                    org['disaster_type'] = disaster_type
                return orgs
            
            return []
            
        except Exception as e:
            logger.error(f"Error getting disaster organizations: {e}")
            return []
    
    def _query_perplexity_for_general_orgs(self, location: Dict) -> List[Dict]:
        """Query Perplexity AI for general organizations"""
        try:
            city = location.get('city', 'Unknown')
            country = location.get('country', 'Unknown')
            
            logger.info(f"Querying Perplexity for general organizations in {city}, {country}")
            
            prompt = f"""List 8 verified non-profit charities in {city}, {country} focused on humanitarian aid, disaster relief, community support, poverty, or mental health.

Return ONLY valid JSON array:
[{{"name":"Org Name","description":"Brief description of their work","website":"https://site.org","donation_url":"https://donate.org","logo_url":null,"focus_areas":["aid","relief"],"location":"{city}, {country}"}}]

Requirements: official websites, active donation pages, local/regional organizations preferred."""
            
            response = self.client.query(prompt)
            return self._parse_organizations_response(response)
            
        except Exception as e:
            logger.error(f"Error querying Perplexity for general orgs: {e}")
            return []
    
    def _query_perplexity_for_disaster_orgs(self, disaster: Dict, location: str) -> List[Dict]:
        """Query Perplexity AI for disaster-specific organizations"""
        try:
            disaster_type = disaster.get('type', 'disaster')
            details = disaster.get('details', '')
            
            prompt = f"""List 5 verified charities actively responding to {disaster_type} in {location}.

Return ONLY valid JSON array:
[{{"name":"Org","description":"Their specific work for {disaster_type} in {location}","website":"https://site.org","donation_url":"https://donate.org","logo_url":null,"focus_areas":["{disaster_type}","emergency"],"location":"{location}","disaster_response":"Actions"}}]

Priority: on-ground organizations, accepting donations for this disaster."""
            
            response = self.client.query(prompt)
            return self._parse_organizations_response(response)
            
        except Exception as e:
            logger.error(f"Error querying Perplexity for disaster orgs: {e}")
            return []
    
    def _parse_organizations_response(self, response: str) -> List[Dict]:
        """
        Parse Perplexity response into organization list
        
        Args:
            response: Raw response from Perplexity
        
        Returns:
            List of organization dictionaries
        """
        try:
            response = response.strip()
            
            # Remove markdown code blocks if present
            if response.startswith('```'):
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
                response = response.strip()
            
            # Parse JSON
            orgs = json.loads(response)
            
            if not isinstance(orgs, list):
                logger.error("Response is not a JSON array")
                return []
            
            # Validate each organization
            valid_orgs = []
            for org in orgs:
                if self._validate_organization(org):
                    valid_orgs.append(org)
                else:
                    logger.warning(f"Invalid organization data: {org.get('name', 'Unknown')}")
            
            logger.info(f"Parsed {len(valid_orgs)} valid organizations")
            return valid_orgs
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from Perplexity: {e}")
            logger.error(f"Response was: {response[:200]}")
            return []
        except Exception as e:
            logger.error(f"Error parsing organizations response: {e}")
            return []
    
    def _validate_organization(self, org: Dict) -> bool:
        """
        Validate organization data has required fields
        
        Args:
            org: Organization dictionary
        
        Returns:
            True if valid
        """
        required_fields = ['name', 'description', 'website']
        
        # Check required fields exist and are non-empty
        for field in required_fields:
            if not org.get(field):
                logger.warning(f"Organization missing required field: {field}")
                return False
        
        # Validate URLs if present
        if 'website' in org:
            if not org['website'].startswith('http'):
                logger.warning(f"Invalid website URL: {org['website']}")
                return False
        
        if org.get('donation_url') and not org['donation_url'].startswith('http'):
            logger.warning(f"Invalid donation URL: {org['donation_url']}")
            return False
        
        return True
    
    def _cache_organizations(self, orgs: List[Dict], cache_path: str, fetch_logos: bool = True) -> bool:
        """
        Save organizations to cache
        
        Args:
            orgs: List of organizations
            cache_path: Path in Cloud Storage
            fetch_logos: Whether to fetch logos (set False if logos already present)
        
        Returns:
            True if successful
        """
        try:
            # Fetch and cache logos for each organization (if needed)
            if fetch_logos:
                for org in orgs:
                    if org.get('logo_url') is None:
                        logo_url = self._fetch_and_cache_logo(org)
                        if logo_url:
                            org['logo_url'] = logo_url
                        else:
                            org['logo_url'] = None
            
            cache_data = {
                "organizations": orgs,
                "generated_at": datetime.now().isoformat(),
                "cache_version": "1.0"
            }
            
            return self.storage.save_json_to_storage(cache_path, cache_data)
            
        except Exception as e:
            logger.error(f"Error caching organizations: {e}")
            return False
    
    def _fetch_and_cache_logo(self, org: Dict) -> Optional[str]:
        """
        Fetch organization logo and cache it in Cloud Storage
        
        Args:
            org: Organization dictionary
        
        Returns:
            Public URL of cached logo or None
        """
        try:
            org_name = org.get('name', 'Unknown')
            website = org.get('website', '')
            
            if not website:
                logger.debug(f"No website for {org_name}, skipping logo fetch")
                return None
            
            # Generate a unique slug for the organization
            org_slug = self._generate_org_slug(org_name)
            logo_path = f"organization_logos/{org_slug}.png"
            
            # Check if logo already exists in storage
            existing_logo = self.storage.get_public_url(logo_path)
            if existing_logo:
                logger.debug(f"Logo already cached for {org_name}")
                return existing_logo
            
            # Try to fetch logo from multiple sources
            logo_data = self._fetch_logo_from_clearbit(website)
            if not logo_data:
                logo_data = self._fetch_logo_from_google(website)
            if not logo_data:
                logo_data = self._extract_favicon(website)
            
            if logo_data:
                # Resize and optimize logo
                optimized_logo = self._optimize_logo(logo_data)
                if optimized_logo:
                    # Upload to Cloud Storage
                    public_url = self.storage.upload_logo(logo_path, optimized_logo)
                    if public_url:
                        logger.info(f"Successfully cached logo for {org_name}")
                        return public_url
            
            logger.warning(f"Could not fetch logo for {org_name}")
            return None
            
        except Exception as e:
            logger.error(f"Error fetching logo for {org.get('name')}: {e}")
            return None
    
    def _generate_org_slug(self, org_name: str) -> str:
        """Generate URL-safe slug for organization"""
        # Create hash of org name for uniqueness
        name_hash = hashlib.md5(org_name.encode()).hexdigest()[:8]
        # Clean name for readability
        clean_name = org_name.lower().replace(' ', '-').replace("'", '').replace(',', '')
        clean_name = ''.join(c for c in clean_name if c.isalnum() or c == '-')
        return f"{clean_name}-{name_hash}"
    
    def _fetch_logo_from_clearbit(self, website: str) -> Optional[bytes]:
        """
        Fetch logo from Clearbit Logo API (free, no API key needed)
        
        Args:
            website: Organization website URL
        
        Returns:
            Logo image data or None
        """
        try:
            # Extract domain from URL
            from urllib.parse import urlparse
            domain = urlparse(website).netloc or website
            domain = domain.replace('www.', '')
            
            # Clearbit Logo API (free tier)
            clearbit_url = f"https://logo.clearbit.com/{domain}"
            
            response = requests.get(clearbit_url, timeout=5)
            if response.status_code == 200 and len(response.content) > 0:
                logger.debug(f"Fetched logo from Clearbit for {domain}")
                return response.content
            
            return None
            
        except Exception as e:
            logger.debug(f"Clearbit logo fetch failed: {e}")
            return None
    
    def _fetch_logo_from_google(self, website: str) -> Optional[bytes]:
        """
        Fetch logo using Google's favicon service
        
        Args:
            website: Organization website URL
        
        Returns:
            Logo image data or None
        """
        try:
            from urllib.parse import urlparse
            domain = urlparse(website).netloc or website
            
            # Google Favicon Service
            google_url = f"https://www.google.com/s2/favicons?domain={domain}&sz=128"
            
            response = requests.get(google_url, timeout=5)
            if response.status_code == 200 and len(response.content) > 100:  # Ensure it's not a tiny default icon
                logger.debug(f"Fetched logo from Google for {domain}")
                return response.content
            
            return None
            
        except Exception as e:
            logger.debug(f"Google logo fetch failed: {e}")
            return None
    
    def _extract_favicon(self, website: str) -> Optional[bytes]:
        """
        Extract favicon directly from website
        
        Args:
            website: Organization website URL
        
        Returns:
            Favicon image data or None
        """
        try:
            # Try common favicon locations
            from urllib.parse import urlparse, urljoin
            parsed = urlparse(website)
            base_url = f"{parsed.scheme}://{parsed.netloc}"
            
            favicon_urls = [
                urljoin(base_url, '/favicon.ico'),
                urljoin(base_url, '/favicon.png'),
                urljoin(base_url, '/apple-touch-icon.png'),
            ]
            
            for favicon_url in favicon_urls:
                try:
                    response = requests.get(favicon_url, timeout=3)
                    if response.status_code == 200 and len(response.content) > 100:
                        logger.debug(f"Extracted favicon from {favicon_url}")
                        return response.content
                except:
                    continue
            
            return None
            
        except Exception as e:
            logger.debug(f"Favicon extraction failed: {e}")
            return None
    
    def _optimize_logo(self, logo_data: bytes) -> Optional[bytes]:
        """
        Optimize logo: resize, convert to PNG, reduce file size
        
        Args:
            logo_data: Original logo image data
        
        Returns:
            Optimized logo data or None
        """
        try:
            # Open image
            img = Image.open(BytesIO(logo_data))
            
            # Convert to RGBA if needed
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGBA')
            
            # Resize to max 200x200 while maintaining aspect ratio
            max_size = (200, 200)
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            
            # Save as PNG to BytesIO
            output = BytesIO()
            img.save(output, format='PNG', optimize=True)
            output.seek(0)
            
            optimized_data = output.getvalue()
            logger.debug(f"Optimized logo: {len(logo_data)} → {len(optimized_data)} bytes")
            
            return optimized_data
            
        except Exception as e:
            logger.error(f"Error optimizing logo: {e}")
            return None
    
    def _is_cache_valid(self, cached_data: Dict, max_age_days: int) -> bool:
        """
        Check if cached data is still valid
        
        Args:
            cached_data: Cached data dictionary
            max_age_days: Maximum age in days
        
        Returns:
            True if cache is still valid
        """
        try:
            generated_at_str = cached_data.get('generated_at')
            if not generated_at_str:
                return False
            
            generated_at = datetime.fromisoformat(generated_at_str)
            age = datetime.now() - generated_at
            
            is_valid = age.days < max_age_days
            
            if not is_valid:
                logger.info(f"Cache expired (age: {age.days} days, max: {max_age_days})")
            
            return is_valid
            
        except Exception as e:
            logger.error(f"Error checking cache validity: {e}")
            return False
    
    def _determine_badge(self, org: Dict, user_location: Dict, disasters: List[Dict]) -> str:
        """
        Determine the appropriate badge for an organization
        
        Args:
            org: Organization dictionary
            user_location: User's location
            disasters: List of disasters
        
        Returns:
            Badge text
        """
        if org.get('is_local'):
            return "LOCAL"
        elif org.get('is_disaster_response'):
            return "RESPONDING NOW"
        else:
            return ""
    
    def _get_fallback_organizations(self) -> List[Dict]:
        """
        Get static fallback organizations when AI/cache fails
        
        Returns:
            List of global organizations
        """
        return [
            {
                "name": "International Red Cross",
                "description": "The world's largest humanitarian network providing assistance to people affected by disasters and conflicts. Operating in 192 countries with millions of volunteers.",
                "website": "https://www.icrc.org",
                "donation_url": "https://www.icrc.org/en/donate",
                "logo_url": None,
                "focus_areas": ["disaster relief", "emergency response", "healthcare"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "UNICEF",
                "description": "United Nations Children's Fund provides humanitarian aid to children worldwide, focusing on health, nutrition, education, and emergency relief in over 190 countries.",
                "website": "https://www.unicef.org",
                "donation_url": "https://www.unicef.org/donate",
                "logo_url": None,
                "focus_areas": ["children", "health", "education", "emergency relief"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "Doctors Without Borders (MSF)",
                "description": "Provides medical humanitarian aid to people affected by conflict, epidemics, disasters, or exclusion from healthcare. Operates in over 70 countries.",
                "website": "https://www.msf.org",
                "donation_url": "https://www.msf.org/donate",
                "logo_url": None,
                "focus_areas": ["medical aid", "healthcare", "emergency response"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "World Food Programme",
                "description": "The world's largest humanitarian organization addressing hunger and promoting food security. Reaches 80 million people in around 80 countries each year.",
                "website": "https://www.wfp.org",
                "donation_url": "https://www.wfp.org/support-us",
                "logo_url": None,
                "focus_areas": ["hunger", "food security", "emergency food aid"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "Save the Children",
                "description": "International organization helping children in need through education, healthcare, economic opportunities, and emergency aid. Working in over 120 countries.",
                "website": "https://www.savethechildren.org",
                "donation_url": "https://www.savethechildren.org/donate",
                "logo_url": None,
                "focus_areas": ["children", "education", "health", "emergency relief"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "Direct Relief",
                "description": "Improves the health and lives of people affected by poverty or emergencies. Provides medical aid and disaster relief with 100% of donations going to programs.",
                "website": "https://www.directrelief.org",
                "donation_url": "https://www.directrelief.org/donate",
                "logo_url": None,
                "focus_areas": ["medical aid", "disaster relief", "poverty"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "Catholic Relief Services",
                "description": "International humanitarian agency supporting relief and development work in over 100 countries, helping poor and vulnerable people overcome emergencies and hardship.",
                "website": "https://www.crs.org",
                "donation_url": "https://www.crs.org/donate",
                "logo_url": None,
                "focus_areas": ["humanitarian aid", "poverty", "disaster relief"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "Oxfam International",
                "description": "Global organization working to end poverty and injustice. Provides emergency aid during disasters and works on long-term development in over 90 countries.",
                "website": "https://www.oxfam.org",
                "donation_url": "https://www.oxfam.org/en/donate",
                "logo_url": None,
                "focus_areas": ["poverty", "inequality", "disaster response"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "CARE International",
                "description": "Leading humanitarian organization fighting global poverty with focus on empowering women and girls. Works in 100+ countries providing disaster relief and development.",
                "website": "https://www.care.org",
                "donation_url": "https://www.care.org/donate",
                "logo_url": None,
                "focus_areas": ["poverty", "women empowerment", "disaster relief"],
                "location": "Global",
                "is_fallback": True
            },
            {
                "name": "World Vision",
                "description": "Christian humanitarian organization providing emergency relief, development assistance, and advocacy for children and communities in nearly 100 countries.",
                "website": "https://www.worldvision.org",
                "donation_url": "https://www.worldvision.org/donate",
                "logo_url": None,
                "focus_areas": ["children", "poverty", "disaster relief", "development"],
                "location": "Global",
                "is_fallback": True
            }
        ]


# Singleton instance
_nonprofit_service = None

def get_nonprofit_service():
    """Get the NonprofitService singleton instance"""
    global _nonprofit_service
    if _nonprofit_service is None:
        _nonprofit_service = NonprofitService()
    return _nonprofit_service

