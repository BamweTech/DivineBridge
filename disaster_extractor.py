"""
Disaster Extractor for Divine Bridge
Extracts disaster information from daily prayer text using AI.
"""

import logging
import json
from typing import List, Dict, Optional
from config import get_config
from perplexity_client import get_perplexity_client, set_client_model
from datetime import datetime

logger = logging.getLogger(__name__)


class DisasterExtractor:
    """Extract disaster information from prayer text using AI"""
    
    # Disaster type taxonomy
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
        'storm'
    ]
    
    def __init__(self):
        """Initialize the DisasterExtractor"""
        try:
            # Use shared Perplexity client (avoids test query overhead)
            self.client = get_perplexity_client()
            set_client_model("sonar-reasoning-pro")
            logger.info("DisasterExtractor initialized successfully (using shared client)")
            
        except Exception as e:
            logger.error(f"Error initializing DisasterExtractor: {e}")
            raise
    
    def extract_disasters(self, prayer_content: str) -> Dict:
        """
        Extract disaster information from prayer text
        
        Args:
            prayer_content: The daily prayer text
        
        Returns:
            Dictionary with disasters, topics, and affected regions
        """
        try:
            prompt = self._build_extraction_prompt(prayer_content)
            response = self.client.query(prompt)
            
            # Parse the JSON response
            metadata = self._parse_extraction_response(response)
            metadata['extracted_at'] = datetime.now().isoformat()
            
            logger.info(f"Extracted {len(metadata.get('disasters', []))} disasters from prayer")
            return metadata
            
        except Exception as e:
            logger.error(f"Error extracting disasters: {e}")
            # Return empty structure on error
            return {
                "disasters": [],
                "topics": [],
                "affected_regions": [],
                "extracted_at": datetime.now().isoformat(),
                "extraction_error": str(e)
            }
    
    def _build_extraction_prompt(self, prayer_content: str) -> str:
        """Build the prompt for disaster extraction"""
        return f"""Analyze this prayer and extract ALL disaster and crisis-related information.

Prayer text:
{prayer_content}

Return ONLY a JSON object (no other text) with this exact structure:
{{
  "disasters": [
    {{
      "type": "one of: typhoon, hurricane, earthquake, flood, landslide, drought, wildfire, tornado, tsunami, volcano, conflict, war, epidemic, pandemic, famine, storm",
      "locations": ["Country1", "Country2", "Specific Region"],
      "severity": "minor" | "moderate" | "severe" | "catastrophic",
      "casualties": number or null,
      "names": ["Name of disaster if mentioned"] or null,
      "details": "Brief summary of the disaster"
    }}
  ],
  "topics": ["general topics like: natural disasters, humanitarian aid, refugee crisis, etc."],
  "affected_regions": ["Broader regions like: Southeast Asia, Middle East, etc."]
}}

Rules:
- Extract ALL disasters/crises mentioned in the prayer
- Be specific with country names (full country names, not abbreviations)
- Categorize each disaster by the most specific type listed above
- If no disasters are mentioned, return empty arrays
- Ensure the response is VALID JSON only
- Do not include any explanation, only the JSON object"""
    
    def _parse_extraction_response(self, response: str) -> Dict:
        """
        Parse the AI response into structured metadata
        
        Args:
            response: Raw response from Perplexity
        
        Returns:
            Parsed metadata dictionary
        """
        try:
            # Try to find JSON in the response
            response = response.strip()
            
            # Remove markdown code blocks if present
            if response.startswith('```'):
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
                response = response.strip()
            
            # Parse JSON
            metadata = json.loads(response)
            
            # Validate structure
            if 'disasters' not in metadata:
                metadata['disasters'] = []
            if 'topics' not in metadata:
                metadata['topics'] = []
            if 'affected_regions' not in metadata:
                metadata['affected_regions'] = []
            
            # Normalize disaster types
            for disaster in metadata['disasters']:
                if 'type' in disaster:
                    disaster['type'] = self._normalize_disaster_type(disaster['type'])
            
            return metadata
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from response: {e}")
            logger.error(f"Response was: {response[:200]}")
            return {"disasters": [], "topics": [], "affected_regions": []}
        except Exception as e:
            logger.error(f"Error parsing extraction response: {e}")
            return {"disasters": [], "topics": [], "affected_regions": []}
    
    def _normalize_disaster_type(self, disaster_type: str) -> str:
        """
        Normalize disaster type to standard taxonomy
        
        Args:
            disaster_type: Raw disaster type from extraction
        
        Returns:
            Normalized disaster type
        """
        disaster_type = disaster_type.lower().strip()
        
        # Map variations to standard types
        type_mapping = {
            'hurricane': 'typhoon',
            'cyclone': 'typhoon',
            'flooding': 'flood',
            'wildfire': 'fire',
            'volcanic_eruption': 'volcano',
            'pandemic': 'epidemic',
            'war': 'conflict',
            'refugee_crisis': 'conflict'
        }
        
        return type_mapping.get(disaster_type, disaster_type)
    
    def enrich_prayer_with_metadata(self, prayer_data: Dict) -> Dict:
        """
        Add disaster metadata to prayer data
        
        Args:
            prayer_data: Prayer dictionary with 'content' field
        
        Returns:
            Enhanced prayer data with 'metadata' field
        """
        try:
            if 'content' not in prayer_data:
                logger.warning("Prayer data has no content field")
                return prayer_data
            
            # Extract disasters from prayer content
            metadata = self.extract_disasters(prayer_data['content'])
            
            # Add metadata to prayer
            prayer_data['metadata'] = metadata
            
            logger.info(f"Enriched prayer with metadata: {len(metadata.get('disasters', []))} disasters")
            return prayer_data
            
        except Exception as e:
            logger.error(f"Error enriching prayer with metadata: {e}")
            # Return original prayer data without metadata
            return prayer_data
    
    def get_primary_disasters(self, prayer_metadata: Dict, limit: int = 2) -> List[Dict]:
        """
        Get the most severe disasters from prayer metadata
        
        Args:
            prayer_metadata: Prayer metadata with disasters
            limit: Maximum number of disasters to return
        
        Returns:
            List of disaster dictionaries, sorted by severity
        """
        disasters = prayer_metadata.get('disasters', [])
        if not disasters:
            return []
        
        # Severity ranking
        severity_rank = {
            'catastrophic': 4,
            'severe': 3,
            'moderate': 2,
            'minor': 1
        }
        
        # Sort by severity (highest first), then by casualties
        # Ensure casualties is always an integer for proper sorting
        def get_casualties_int(disaster):
            casualties = disaster.get('casualties', 0) or 0
            # Convert to int if it's a string or other type
            if isinstance(casualties, str):
                try:
                    return int(casualties)
                except (ValueError, TypeError):
                    return 0
            try:
                return int(casualties)
            except (ValueError, TypeError):
                return 0
        
        sorted_disasters = sorted(
            disasters,
            key=lambda d: (
                severity_rank.get(d.get('severity', 'minor'), 0),
                get_casualties_int(d)
            ),
            reverse=True
        )
        
        return sorted_disasters[:limit]


# Singleton instance
_disaster_extractor = None

def get_disaster_extractor():
    """Get the DisasterExtractor singleton instance"""
    global _disaster_extractor
    if _disaster_extractor is None:
        _disaster_extractor = DisasterExtractor()
    return _disaster_extractor

