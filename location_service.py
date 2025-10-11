"""
Location Service for Divine Bridge
Handles user location detection and management using IP geolocation and user profiles.
"""

import requests
import logging
from datetime import datetime
import json
import hashlib
from typing import Optional, Dict, Tuple
from storage_handler import StorageHandler

logger = logging.getLogger(__name__)


class LocationService:
    """Handle user location detection and management"""
    
    def __init__(self, storage_handler=None):
        """Initialize the LocationService"""
        self.storage = storage_handler or StorageHandler()
        # IP geolocation API (using ipapi.co free tier)
        self.geolocation_api = "https://ipapi.co/{ip}/json/"
        self.default_location = {
            "country": "United States",
            "country_code": "US",
            "city": "New York",
            "state": "NY",
            "latitude": 40.7128,
            "longitude": -74.0060
        }
    
    def get_user_location(self, user_id: Optional[str] = None, ip_address: Optional[str] = None) -> Dict:
        """
        Get user location from profile or IP detection
        
        Args:
            user_id: Firebase user ID (optional)
            ip_address: User's IP address (optional)
        
        Returns:
            Dictionary containing location data
        """
        try:
            # Try to get from user profile first
            if user_id:
                profile_location = self._get_location_from_profile(user_id)
                if profile_location:
                    logger.info(f"Using location from profile for user {user_id}")
                    return profile_location
            
            # Fall back to IP detection
            if ip_address and ip_address not in ['127.0.0.1', 'localhost', '::1']:
                ip_location = self.detect_location_from_ip(ip_address)
                if ip_location:
                    logger.info(f"Detected location from IP: {ip_location.get('city')}, {ip_location.get('country')}")
                    return ip_location
            
            # Use default location as last resort
            logger.warning("Using default location (New York, US)")
            return {
                **self.default_location,
                "detection_method": "default",
                "detected_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting user location: {e}")
            return {
                **self.default_location,
                "detection_method": "error_fallback",
                "detected_at": datetime.now().isoformat()
            }
    
    def detect_location_from_ip(self, ip_address: str) -> Optional[Dict]:
        """
        Detect user location from IP address using ipapi.co
        
        Args:
            ip_address: User's IP address
        
        Returns:
            Location dictionary or None if detection fails
        """
        try:
            # Skip local/private IPs
            if self._is_private_ip(ip_address):
                logger.debug(f"Skipping private IP: {ip_address}")
                return None
            
            # Call IP geolocation API
            url = self.geolocation_api.format(ip=ip_address)
            response = requests.get(url, timeout=3)
            
            if response.status_code == 200:
                data = response.json()
                
                # Check if we got valid data
                if data.get('error'):
                    logger.warning(f"IP geolocation error: {data.get('reason')}")
                    return None
                
                location = {
                    "country": data.get('country_name', 'Unknown'),
                    "country_code": data.get('country_code', 'XX'),
                    "city": data.get('city', 'Unknown'),
                    "state": data.get('region', ''),
                    "latitude": data.get('latitude'),
                    "longitude": data.get('longitude'),
                    "detection_method": "ip",
                    "ip_address_hash": self._hash_ip(ip_address),
                    "detected_at": datetime.now().isoformat()
                }
                
                logger.info(f"Successfully detected location: {location['city']}, {location['country']}")
                return location
            else:
                logger.warning(f"IP geolocation API returned status {response.status_code}")
                return None
                
        except requests.exceptions.Timeout:
            logger.warning("IP geolocation API timeout")
            return None
        except Exception as e:
            logger.error(f"Error detecting location from IP: {e}")
            return None
    
    def save_user_location(self, user_id: str, location_data: Dict) -> bool:
        """
        Save user location to their profile
        
        Args:
            user_id: Firebase user ID
            location_data: Location dictionary
        
        Returns:
            True if successful, False otherwise
        """
        try:
            # Add timestamps
            location_data['updated_at'] = datetime.now().isoformat()
            if 'created_at' not in location_data:
                location_data['created_at'] = location_data['updated_at']
            
            # Save to Cloud Storage
            file_path = f"user_locations/{user_id}.json"
            success = self.storage.save_json_to_storage(file_path, location_data)
            
            if success:
                logger.info(f"Saved location for user {user_id}: {location_data.get('city')}, {location_data.get('country')}")
            else:
                logger.error(f"Failed to save location for user {user_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error saving user location: {e}")
            return False
    
    def update_user_location(self, user_id: str, city: str, country: str, 
                           country_code: str, language: Optional[str] = None) -> bool:
        """
        Update user's manually provided location
        
        Args:
            user_id: Firebase user ID
            city: City name
            country: Country name
            country_code: ISO country code (e.g., 'US')
            language: User's preferred language (optional)
        
        Returns:
            True if successful
        """
        try:
            location_data = {
                "country": country,
                "country_code": country_code.upper(),
                "city": city,
                "state": "",  # Can be added later if needed
                "latitude": None,  # Could geocode if needed
                "longitude": None,
                "detection_method": "user_provided",
                "language": language,
                "updated_at": datetime.now().isoformat()
            }
            
            # Get existing location to preserve created_at
            existing = self._get_location_from_profile(user_id)
            if existing and 'created_at' in existing:
                location_data['created_at'] = existing['created_at']
            else:
                location_data['created_at'] = location_data['updated_at']
            
            return self.save_user_location(user_id, location_data)
            
        except Exception as e:
            logger.error(f"Error updating user location: {e}")
            return False
    
    def _get_location_from_profile(self, user_id: str) -> Optional[Dict]:
        """
        Retrieve user's saved location from their profile
        
        Args:
            user_id: Firebase user ID
        
        Returns:
            Location dictionary or None if not found
        """
        try:
            file_path = f"user_locations/{user_id}.json"
            location_data = self.storage.get_json_from_storage(file_path)
            
            if location_data:
                logger.debug(f"Found location for user {user_id}: {location_data.get('city')}")
                return location_data
            
            return None
            
        except Exception as e:
            logger.debug(f"No location found for user {user_id}: {e}")
            return None
    
    def _is_private_ip(self, ip_address: str) -> bool:
        """
        Check if IP address is private/local
        
        Args:
            ip_address: IP address to check
        
        Returns:
            True if private IP
        """
        private_ranges = [
            '127.',      # Localhost
            '10.',       # Private Class A
            '172.16.',   # Private Class B
            '172.17.',
            '172.18.',
            '172.19.',
            '172.20.',
            '172.21.',
            '172.22.',
            '172.23.',
            '172.24.',
            '172.25.',
            '172.26.',
            '172.27.',
            '172.28.',
            '172.29.',
            '172.30.',
            '172.31.',
            '192.168.',   # Private Class C
            '::1',        # IPv6 localhost
            'fe80:',      # IPv6 link-local
        ]
        
        return any(ip_address.startswith(prefix) for prefix in private_ranges)
    
    def _hash_ip(self, ip_address: str) -> str:
        """
        Create a privacy-preserving hash of IP address
        
        Args:
            ip_address: IP address to hash
        
        Returns:
            SHA256 hash of the IP
        """
        # Use a fixed salt for consistency (should be from config in production)
        salt = "divinebridge_location_salt_2025"
        return hashlib.sha256(f"{ip_address}{salt}".encode()).hexdigest()
    
    def get_city_slug(self, city: str) -> str:
        """
        Convert city name to URL-safe slug
        
        Args:
            city: City name
        
        Returns:
            Lowercase, hyphenated slug
        """
        return city.lower().replace(' ', '-').replace(',', '').replace('.', '')
    
    def get_location_string(self, location: Dict) -> str:
        """
        Get human-readable location string
        
        Args:
            location: Location dictionary
        
        Returns:
            Formatted string like "New York, United States"
        """
        city = location.get('city', 'Unknown')
        country = location.get('country', 'Unknown')
        return f"{city}, {country}"


# Singleton instance
_location_service = None

def get_location_service():
    """Get the LocationService singleton instance"""
    global _location_service
    if _location_service is None:
        _location_service = LocationService()
    return _location_service

