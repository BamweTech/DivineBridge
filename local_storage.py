"""
Local file-based storage system for testing
Mimics the Cloud Storage interface but uses local JSON files
"""
import json
import os
from datetime import datetime
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class LocalStorageHandler:
    """Local file-based storage handler for testing"""
    
    def __init__(self, base_path='local_storage_data'):
        """
        Initialize local storage handler
        
        Args:
            base_path: Base directory for storing all data
        """
        self.base_path = Path(base_path)
        self.base_path.mkdir(exist_ok=True)
        
        # Create subdirectories
        self.prayers_path = self.base_path / 'prayers'
        self.prayers_path.mkdir(exist_ok=True)
        
        self.prayer_requests_path = self.base_path / 'prayer_requests'
        self.prayer_requests_path.mkdir(exist_ok=True)
        
        self.testimonies_path = self.base_path / 'testimonies'
        self.testimonies_path.mkdir(exist_ok=True)
        
        self.images_path = self.base_path / 'images'
        self.images_path.mkdir(exist_ok=True)
        
        self.organizations_path = self.base_path / 'organizations'
        self.organizations_path.mkdir(exist_ok=True)
        
        logger.info(f"LocalStorageHandler initialized at {self.base_path.absolute()}")
    
    # Prayer Request Methods
    def save_prayer_request(self, prayer_data):
        """Save a prayer request locally"""
        date_str = datetime.now().strftime('%Y-%m-%d')
        date_dir = self.prayer_requests_path / date_str
        date_dir.mkdir(exist_ok=True)
        
        prayer_id = prayer_data.get('id')
        file_path = date_dir / f"{prayer_id}.json"
        
        with open(file_path, 'w') as f:
            json.dump(prayer_data, f, indent=2)
        
        logger.info(f"Saved prayer request locally: {file_path}")
        return str(file_path)
    
    def get_prayer_request(self, prayer_id, date_str=None):
        """Get a specific prayer request"""
        if not date_str:
            date_str = datetime.now().strftime('%Y-%m-%d')
        
        date_dir = self.prayer_requests_path / date_str
        file_path = date_dir / f"{prayer_id}.json"
        
        if not file_path.exists():
            logger.warning(f"Prayer request not found: {file_path}")
            return None
        
        with open(file_path, 'r') as f:
            return json.load(f)
    
    def get_all_prayer_requests(self, limit=50):
        """Get all prayer requests, newest first"""
        all_prayers = []
        
        # Get all date directories, sorted newest first
        date_dirs = sorted(self.prayer_requests_path.iterdir(), reverse=True)
        
        for date_dir in date_dirs:
            if not date_dir.is_dir():
                continue
            
            # Get all prayer files in this date directory
            prayer_files = sorted(date_dir.glob('*.json'), 
                                key=lambda x: x.stat().st_mtime, 
                                reverse=True)
            
            for prayer_file in prayer_files:
                with open(prayer_file, 'r') as f:
                    prayer_data = json.load(f)
                    all_prayers.append(prayer_data)
                
                if len(all_prayers) >= limit:
                    return all_prayers
        
        return all_prayers
    
    def update_prayer_request(self, prayer_id, updates, date_str=None):
        """Update a prayer request"""
        if not date_str:
            date_str = datetime.now().strftime('%Y-%m-%d')
        
        prayer_data = self.get_prayer_request(prayer_id, date_str)
        if not prayer_data:
            return False
        
        prayer_data.update(updates)
        
        date_dir = self.prayer_requests_path / date_str
        file_path = date_dir / f"{prayer_id}.json"
        
        with open(file_path, 'w') as f:
            json.dump(prayer_data, f, indent=2)
        
        logger.info(f"Updated prayer request: {file_path}")
        return True
    
    def delete_prayer_request(self, prayer_id, date_str=None):
        """Delete a prayer request"""
        if not date_str:
            # Search in today's directory first, then all directories
            date_str = datetime.now().strftime('%Y-%m-%d')
            date_dir = self.prayer_requests_path / date_str
            file_path = date_dir / f"{prayer_id}.json"
            
            if not file_path.exists():
                # Search all date directories
                for date_dir in self.prayer_requests_path.iterdir():
                    if not date_dir.is_dir():
                        continue
                    file_path = date_dir / f"{prayer_id}.json"
                    if file_path.exists():
                        file_path.unlink()
                        logger.info(f"Deleted prayer request: {file_path}")
                        return True
                return False
        else:
            date_dir = self.prayer_requests_path / date_str
            file_path = date_dir / f"{prayer_id}.json"
        
        if file_path.exists():
            file_path.unlink()
            logger.info(f"Deleted prayer request: {file_path}")
            return True
        
        return False
    
    # Testimony Methods
    def save_testimony(self, testimony_data):
        """Save a testimony locally"""
        date_str = datetime.now().strftime('%Y-%m-%d')
        date_dir = self.testimonies_path / date_str
        date_dir.mkdir(exist_ok=True)
        
        testimony_id = testimony_data.get('id')
        file_path = date_dir / f"{testimony_id}.json"
        
        with open(file_path, 'w') as f:
            json.dump(testimony_data, f, indent=2)
        
        logger.info(f"Saved testimony locally: {file_path}")
        return str(file_path)
    
    def get_testimony(self, testimony_id, date_str=None):
        """Get a specific testimony"""
        if not date_str:
            # Search all directories
            for date_dir in self.testimonies_path.iterdir():
                if not date_dir.is_dir():
                    continue
                file_path = date_dir / f"{testimony_id}.json"
                if file_path.exists():
                    with open(file_path, 'r') as f:
                        return json.load(f)
            return None
        
        date_dir = self.testimonies_path / date_str
        file_path = date_dir / f"{testimony_id}.json"
        
        if not file_path.exists():
            return None
        
        with open(file_path, 'r') as f:
            return json.load(f)
    
    def get_all_testimonies(self, approved_only=True, limit=50):
        """Get all testimonies, newest first"""
        all_testimonies = []
        
        # Get all date directories, sorted newest first
        date_dirs = sorted(self.testimonies_path.iterdir(), reverse=True)
        
        for date_dir in date_dirs:
            if not date_dir.is_dir():
                continue
            
            # Get all testimony files in this date directory
            testimony_files = sorted(date_dir.glob('*.json'), 
                                   key=lambda x: x.stat().st_mtime, 
                                   reverse=True)
            
            for testimony_file in testimony_files:
                with open(testimony_file, 'r') as f:
                    testimony_data = json.load(f)
                    
                    # Filter by approval status if requested
                    if approved_only and not testimony_data.get('approved', False):
                        continue
                    
                    all_testimonies.append(testimony_data)
                
                if len(all_testimonies) >= limit:
                    return all_testimonies
        
        return all_testimonies
    
    def update_testimony(self, testimony_id, updates):
        """Update a testimony"""
        # Find the testimony in any date directory
        for date_dir in self.testimonies_path.iterdir():
            if not date_dir.is_dir():
                continue
            
            file_path = date_dir / f"{testimony_id}.json"
            if file_path.exists():
                with open(file_path, 'r') as f:
                    testimony_data = json.load(f)
                
                testimony_data.update(updates)
                
                with open(file_path, 'w') as f:
                    json.dump(testimony_data, f, indent=2)
                
                logger.info(f"Updated testimony: {file_path}")
                return True
        
        return False
    
    # Daily Prayer Methods
    def save_prayer(self, date_str, prayer_text):
        """Save a daily prayer"""
        file_path = self.prayers_path / f"{date_str}.json"
        
        prayer_data = {
            'date': date_str,
            'prayer': prayer_text,
            'created_at': datetime.now().isoformat()
        }
        
        with open(file_path, 'w') as f:
            json.dump(prayer_data, f, indent=2)
        
        logger.info(f"Saved daily prayer locally: {file_path}")
        return str(file_path)
    
    def get_prayer(self, date_str):
        """Get a daily prayer for a specific date"""
        file_path = self.prayers_path / f"{date_str}.json"
        
        if not file_path.exists():
            return None
        
        with open(file_path, 'r') as f:
            return json.load(f).get('prayer')
    
    def get_prayers(self, limit: int = 50) -> list:
        """Get recent prayers (for compatibility with CloudStorage)"""
        prayers = []
        
        # Get all prayer files, sorted newest first
        prayer_files = sorted(self.prayers_path.glob('*.json'), 
                            key=lambda x: x.stat().st_mtime, 
                            reverse=True)
        
        for prayer_file in prayer_files[:limit]:
            with open(prayer_file, 'r') as f:
                prayer_data = json.load(f)
                prayers.append(prayer_data)
        
        return prayers
    
    def get_prayer_requests(self, limit: int = 50) -> list:
        """Get recent prayer requests (alias for compatibility)"""
        return self.get_all_prayer_requests(limit=limit)
    
    # Image Methods
    def save_verse_image(self, date_str, image_data):
        """Save a verse image"""
        file_path = self.images_path / f"verse_{date_str}.png"
        
        with open(file_path, 'wb') as f:
            f.write(image_data)
        
        logger.info(f"Saved verse image locally: {file_path}")
        return str(file_path)
    
    def get_verse_image(self, date_str):
        """Get a verse image"""
        file_path = self.images_path / f"verse_{date_str}.png"
        
        if not file_path.exists():
            return None
        
        with open(file_path, 'rb') as f:
            return f.read()
    
    def save_prayer_image(self, date_str, image_data):
        """Save a prayer image"""
        file_path = self.images_path / f"prayer_{date_str}.png"
        
        with open(file_path, 'wb') as f:
            f.write(image_data)
        
        logger.info(f"Saved prayer image locally: {file_path}")
        return str(file_path)
    
    def get_prayer_image(self, date_str):
        """Get a prayer image"""
        file_path = self.images_path / f"prayer_{date_str}.png"
        
        if not file_path.exists():
            return None
        
        with open(file_path, 'rb') as f:
            return f.read()
    
    # Statistics
    def get_stats(self):
        """Get storage statistics"""
        stats = {
            'prayer_requests': sum(1 for _ in self.prayer_requests_path.rglob('*.json')),
            'testimonies': sum(1 for _ in self.testimonies_path.rglob('*.json')),
            'daily_prayers': sum(1 for _ in self.prayers_path.glob('*.json')),
            'images': sum(1 for _ in self.images_path.glob('*.png')),
            'storage_path': str(self.base_path.absolute())
        }
        return stats
    
    def clear_all(self):
        """Clear all local storage (use with caution!)"""
        import shutil
        if self.base_path.exists():
            shutil.rmtree(self.base_path)
            self.base_path.mkdir(exist_ok=True)
            logger.warning("Cleared all local storage data")


# Convenience function to get the appropriate storage handler
def get_storage_handler():
    """
    Get the appropriate storage handler based on environment
    Returns LocalStorageHandler for local development, StorageHandler for production
    """
    import os
    
    # Check if we're in local development mode
    if os.getenv('USE_LOCAL_STORAGE', 'false').lower() == 'true':
        logger.info("Using LocalStorageHandler for local development")
        return LocalStorageHandler()
    else:
        from storage_handler import StorageHandler
        logger.info("Using CloudStorageHandler for production")
        return StorageHandler()

