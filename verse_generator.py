import json
import logging
from datetime import datetime
import os
from flask import current_app
from pathlib import Path

# Set up logging
logger = logging.getLogger(__name__)
logger.propagate = False  # Prevent duplicate logs
if not logger.handlers:  # Only add handler if none exists
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

class VerseGenerator:
    def __init__(self):
        self._verses = None
        self._last_load_time = None
        self._reload_interval = 3600  # Reload verses every hour
        
    def _should_reload(self):
        """Check if we should reload the verses."""
        if self._last_load_time is None:
            return True
        now = datetime.now()
        return (now - self._last_load_time).total_seconds() > self._reload_interval
        
    def _load_verses(self):
        """Load verses from the JSON file."""
        try:
            # Try to get the path from Flask's static folder first
            if current_app:
                json_path = os.path.join(current_app.static_folder, 'bible_verses.json')
            else:
                # Fallback to a relative path from the current file
                current_dir = Path(__file__).parent
                json_path = os.path.join(current_dir, '..', 'static', 'bible_verses.json')
            
            logger.info(f"Loading verses from: {json_path}")
            
            if not os.path.exists(json_path):
                logger.error(f"Verses file not found at: {json_path}")
                return []
                
            with open(json_path, 'r') as f:
                data = json.load(f)
                verses = data.get('verses', [])
                if not verses:
                    logger.warning("No verses found in the file")
                    return []
                    
                logger.info(f"Successfully loaded {len(verses)} verses")
                self._last_load_time = datetime.now()
                return verses
                
        except json.JSONDecodeError as e:
            logger.error(f"Error decoding JSON: {str(e)}")
            return []
        except Exception as e:
            logger.error(f"Error loading verses: {str(e)}")
            return []
            
    def get_daily_verse(self):
        """Get today's verse based on the day of the year."""
        try:
            # Check if we need to reload verses
            if self._verses is None or self._should_reload():
                self._verses = self._load_verses()
                
            if not self._verses:
                logger.error("No verses available")
                return None
                
            # Get day of year (1-366)
            day_of_year = datetime.now().timetuple().tm_yday
            
            # Use day of year to select verse (wrap around if needed)
            verse_index = (day_of_year - 1) % len(self._verses)
            verse = self._verses[verse_index]
            
            logger.info(f"Selected verse for day {day_of_year}: {verse['reference']}")
            return verse
            
        except Exception as e:
            logger.error(f"Error getting daily verse: {str(e)}")
            return None

# Create a singleton instance
verse_generator = VerseGenerator() 