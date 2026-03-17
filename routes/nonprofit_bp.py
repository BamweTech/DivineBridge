"""
Non-Profit Blueprint for Divine Bridge
API routes for organization recommendations and location management.
"""

from flask import Blueprint, jsonify, request, current_app
import logging
import json
from datetime import datetime
from location_service import get_location_service
from nonprofit_service import get_nonprofit_service
from disaster_extractor import get_disaster_extractor

logger = logging.getLogger(__name__)

nonprofit_bp = Blueprint('nonprofit', __name__)


@nonprofit_bp.route('/organizations', methods=['GET'])
def get_organizations():
    """
    Get 6 organizations for current user based on location and today's prayer
    
    Query params:
        - user_id (optional): Firebase user ID from auth
    
    Returns:
        {
          "organizations": [...],
          "user_location": {...},
          "disaster_context": {...}
        }
    """
    try:
        import time
        start_time = time.time()
        
        location_service = get_location_service()
        nonprofit_service = get_nonprofit_service()
        
        # Get user ID from query params (if authenticated)
        user_id = request.args.get('user_id')
        
        t1 = time.time()
        logger.debug(f"⏱️ Init: {(t1-start_time)*1000:.0f}ms")
        
        # For local testing: allow manual location override via query params
        test_city = request.args.get('city')
        test_country = request.args.get('country')
        test_country_code = request.args.get('country_code')
        
        if test_city and test_country and test_country_code:
            # Use test location (for local development)
            logger.info(f"Using test location: {test_city}, {test_country}")
            user_location = {
                'city': test_city,
                'country': test_country,
                'country_code': test_country_code,
                'detection_method': 'test_override'
            }
        else:
            # Get user's IP address
            ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
            if ',' in ip_address:
                ip_address = ip_address.split(',')[0].strip()
            
            # Get user location (will use IP detection in production)
            user_location = location_service.get_user_location(user_id, ip_address)
        
        t2 = time.time()
        logger.debug(f"⏱️ Location: {(t2-t1)*1000:.0f}ms")
        
        # Get today's prayer to extract disasters
        today = datetime.now().strftime('%Y-%m-%d')
        prayer_data = current_app.storage_handler.get_prayer(today)
        
        # Extract disasters from prayer (or use cached metadata)
        prayer_disasters = []
        if prayer_data:
            logger.debug(f"Prayer data keys: {list(prayer_data.keys()) if isinstance(prayer_data, dict) else 'Not a dict'}")
            
            if 'metadata' in prayer_data and 'disasters' in prayer_data['metadata']:
                # Use cached metadata
                prayer_disasters = prayer_data['metadata']['disasters']
                logger.info(f"Using cached disasters from prayer metadata: {len(prayer_disasters)} disasters found")
                
                # Log metadata structure for debugging
                if len(prayer_disasters) == 0:
                    logger.warning(f"Prayer metadata exists but disasters array is empty. Metadata keys: {list(prayer_data['metadata'].keys())}")
                    logger.debug(f"Full metadata: {json.dumps(prayer_data['metadata'], indent=2)[:500]}")
                else:
                    logger.info(f"Disaster details: {[{'type': d.get('type'), 'locations': d.get('locations', [])} for d in prayer_disasters[:3]]}")
            else:
                # Extract on-the-fly (shouldn't happen if integration is working)
                logger.warning("Prayer missing metadata, extracting disasters now...")
                logger.debug(f"Prayer content preview: {prayer_data.get('content', '')[:200] if isinstance(prayer_data, dict) else 'No content'}")
                extractor = get_disaster_extractor()
                metadata = extractor.extract_disasters(prayer_data.get('content', ''))
                prayer_disasters = metadata.get('disasters', [])
                logger.info(f"Extracted {len(prayer_disasters)} disasters from prayer content")
        else:
            logger.warning(f"No prayer data found for today ({today})")
        
        t3 = time.time()
        logger.debug(f"⏱️ Prayer: {(t3-t2)*1000:.0f}ms")
        
        # Get top 2 disasters for organization matching
        extractor = get_disaster_extractor()
        primary_disasters = extractor.get_primary_disasters({'disasters': prayer_disasters}, limit=2)
        
        if primary_disasters:
            # Safely format disaster info for logging
            disaster_info = []
            for d in primary_disasters:
                disaster_type = d.get('type', 'unknown')
                locations = d.get('locations', [])
                # Ensure locations is a list
                if not isinstance(locations, list):
                    locations = []
                location_str = ', '.join(locations) if locations else 'unknown location'
                disaster_info.append(f"{disaster_type} in {location_str}")
            logger.info(f"Found {len(primary_disasters)} primary disasters for organization matching: {disaster_info}")
        else:
            logger.warning(f"No primary disasters found. Total disasters in prayer: {len(prayer_disasters)}")
            if prayer_disasters:
                logger.info(f"Disaster details: {json.dumps(prayer_disasters[:3], indent=2)}")
        
        t4 = time.time()
        logger.debug(f"⏱️ Disasters: {(t4-t3)*1000:.0f}ms")
        
        # Get 6 organizations
        organizations = nonprofit_service.get_organizations_for_user(
            user_location,
            primary_disasters,
            today
        )
        
        t5 = time.time()
        logger.debug(f"⏱️ Organizations: {(t5-t4)*1000:.0f}ms")
        logger.debug(f"⏱️ TOTAL: {(t5-start_time)*1000:.0f}ms")
        
        logger.info(f"Returning {len(organizations)} organizations for {user_location.get('city')}")
        
        return jsonify({
            'organizations': organizations,
            'user_location': {
                'city': user_location.get('city'),
                'country': user_location.get('country'),
                'detection_method': user_location.get('detection_method')
            },
            'disaster_context': {
                'disasters': primary_disasters,
                'prayer_date': today
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting organizations: {e}")
        logger.exception("Full traceback:")
        
        # Try to return fallback organizations instead of failing completely
        try:
            fallback_service = get_nonprofit_service()
            fallback_orgs = fallback_service._get_fallback_organizations()
            import random
            today = datetime.now().strftime('%Y-%m-%d')
            random.seed(today)
            selected_fallback = random.sample(fallback_orgs, min(6, len(fallback_orgs)))
            
            logger.info(f"Returning {len(selected_fallback)} fallback organizations due to error")
            return jsonify({
                'organizations': selected_fallback,
                'user_location': {
                    'city': 'Global',
                    'country': 'Global',
                    'detection_method': 'fallback'
                },
                'disaster_context': {
                    'disasters': [],
                    'prayer_date': today
                }
            }), 200
        except Exception as fallback_error:
            logger.error(f"Even fallback organizations failed: {fallback_error}")
            return jsonify({'error': 'Failed to get organizations'}), 500


@nonprofit_bp.route('/location', methods=['POST'])
def update_location():
    """
    Update user's location preference
    
    Body:
        {
          "user_id": "firebase_uid",
          "city": "Los Angeles",
          "country": "United States",
          "country_code": "US",
          "language": "en" (optional)
        }
    
    Returns:
        {
          "message": "Location updated successfully",
          "location": {...}
        }
    """
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['user_id', 'city', 'country', 'country_code']
        for field in required_fields:
            if not data.get(field):
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        location_service = get_location_service()
        
        # Update user location
        success = location_service.update_user_location(
            user_id=data['user_id'],
            city=data['city'],
            country=data['country'],
            country_code=data['country_code'],
            language=data.get('language')
        )
        
        if success:
            return jsonify({
                'message': 'Location updated successfully',
                'location': {
                    'city': data['city'],
                    'country': data['country']
                }
            }), 200
        else:
            return jsonify({'error': 'Failed to update location'}), 500
            
    except Exception as e:
        logger.error(f"Error updating location: {e}")
        return jsonify({'error': 'Failed to update location'}), 500


@nonprofit_bp.route('/location/<user_id>', methods=['GET'])
def get_user_location_route(user_id):
    """
    Get user's saved location
    
    Returns:
        {
          "location": {...}
        }
    """
    try:
        location_service = get_location_service()
        
        # Get IP as fallback
        ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
        if ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        
        location = location_service.get_user_location(user_id, ip_address)
        
        return jsonify({'location': location}), 200
        
    except Exception as e:
        logger.error(f"Error getting user location: {e}")
        return jsonify({'error': 'Failed to get location'}), 500


@nonprofit_bp.route('/organizations/refresh', methods=['POST'])
def refresh_organizations():
    """
    Force refresh organizations (invalidate cache)
    
    Body:
        {
          "city": "New York",
          "country_code": "US"
        }
    
    Returns:
        {
          "message": "Cache invalidated"
        }
    """
    try:
        # This would invalidate specific cache entries
        # For now, just return success
        # In production, would delete cache files
        
        return jsonify({'message': 'Cache refresh requested'}), 200
        
    except Exception as e:
        logger.error(f"Error refreshing organizations: {e}")
        return jsonify({'error': 'Failed to refresh'}), 500


@nonprofit_bp.route('/organizations/prewarm', methods=['POST'])
def prewarm_organizations():
    """
    Pre-warm organization cache in the background.
    Called when user visits Prayer Room to prepare organizations for home page.
    
    Body:
        {
          "user_id": "firebase_uid" (optional)
        }
    
    Returns:
        {
          "message": "Cache pre-warming started"
        }
    """
    try:
        location_service = get_location_service()
        nonprofit_service = get_nonprofit_service()
        
        # Get user ID from body (if authenticated)
        data = request.get_json() or {}
        user_id = data.get('user_id')
        
        # Get user's IP address
        ip_address = request.headers.get('X-Forwarded-For', request.remote_addr)
        if ',' in ip_address:
            ip_address = ip_address.split(',')[0].strip()
        
        # Get user location
        user_location = location_service.get_user_location(user_id, ip_address)
        
        # Start background pre-warming
        nonprofit_service.prewarm_cache_for_location(user_location)
        
        logger.info(f"Cache pre-warming started for {user_location.get('city')}")
        
        return jsonify({
            'message': 'Cache pre-warming started',
            'location': {
                'city': user_location.get('city'),
                'country': user_location.get('country')
            }
        }), 202  # 202 Accepted (processing in background)
        
    except Exception as e:
        logger.error(f"Error starting cache pre-warming: {e}")
        return jsonify({'error': 'Failed to start pre-warming'}), 500

