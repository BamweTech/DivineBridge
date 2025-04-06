import json
import logging
from datetime import datetime
import os
from flask import current_app

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class VerseGenerator:
    def __init__(self):
        self._verses = None
        
    def _load_verses(self):
        """Load verses from the JSON file."""
        try:
            # Use Flask's static folder path
            json_path = os.path.join(current_app.static_folder, 'bible_verses.json')
            logger.info(f"Loading verses from: {json_path}")
            
            with open(json_path, 'r') as f:
                data = json.load(f)
                verses = data.get('verses', [])
                logger.info(f"Successfully loaded {len(verses)} verses")
                return verses
        except Exception as e:
            logger.error(f"Error loading verses: {str(e)}")
            return []
            
    def get_daily_verse(self):
        """Get today's verse based on the day of the year."""
        try:
            # Load verses if not already loaded
            if self._verses is None:
                self._verses = self._load_verses()
                
            if not self._verses:
                logger.error("No verses loaded")
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