from flask import Blueprint, jsonify, current_app, request, send_file
import logging
from datetime import datetime
from auth_helpers import get_user_from_session
from firebase_auth import get_firestore_client

logger = logging.getLogger(__name__)
verse_bp = Blueprint('verse', __name__)

@verse_bp.route('/today-verse', methods=['GET'])
def get_verse():
    try:
        # Get client's local date from query parameter
        client_date = request.args.get('client_date')
        
        if client_date:
            # Use client's local date to get day of year
            try:
                client_datetime = datetime.strptime(client_date, '%Y-%m-%d')
                day_of_year = client_datetime.timetuple().tm_yday
                logger.info(f"Using client's day of year: {day_of_year} (date: {client_date})")
            except ValueError:
                logger.warning(f"Invalid client_date format: {client_date}, using server time")
                day_of_year = None
        else:
            day_of_year = None
        
        # Get verse (with optional day_of_year override)
        verse = current_app.verse_cache.get_today_verse(day_of_year=day_of_year)
        
        if not verse:
            return jsonify({
                'success': False,
                'error': 'No verse available'
            }), 404
        return jsonify({
            'success': True,
            'data': verse
        }), 200
    except Exception as e:
        logger.error(f"Error getting verse: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to get verse'
        }), 500

@verse_bp.route('/today-verse/download', methods=['GET'])
def download_verse_image():
    """Download today's verse as a JPEG image (with caching)"""
    try:
        # Get client's local date
        client_date = request.args.get('client_date')
        force_regenerate = request.args.get('force', 'false').lower() == 'true'
        
        if client_date:
            try:
                client_datetime = datetime.strptime(client_date, '%Y-%m-%d')
                day_of_year = client_datetime.timetuple().tm_yday
                date_str = client_datetime.strftime('%B %d, %Y')
                cache_date = client_date
            except ValueError:
                day_of_year = None
                date_str = datetime.now().strftime('%B %d, %Y')
                cache_date = datetime.now().strftime('%Y-%m-%d')
        else:
            day_of_year = None
            date_str = datetime.now().strftime('%B %d, %Y')
            cache_date = datetime.now().strftime('%Y-%m-%d')
        
        # Try to get cached image first (unless force regenerate)
        if not force_regenerate:
            cached_image = current_app.storage_handler.get_verse_image(cache_date)
            if cached_image:
                logger.info(f"✅ Serving cached verse image for {cache_date}")
                from io import BytesIO
                image_data = BytesIO(cached_image)
                filename = f"divine_bridge_verse_{client_date or 'today'}.jpg"
                return send_file(
                    image_data,
                    mimetype='image/jpeg',
                    as_attachment=True,
                    download_name=filename
                )
        
        # Cache miss or force regenerate - generate new image
        logger.info(f"🎨 Generating new verse image for {cache_date}")
        
        # Get verse
        verse = current_app.verse_cache.get_today_verse(day_of_year=day_of_year)
        
        if not verse:
            return jsonify({'error': 'No verse available'}), 404
        
        # Generate image
        from image_generator import get_image_generator
        generator = get_image_generator()
        
        image_data = generator.generate_verse_image(
            verse_text=verse['verse'],
            reference=verse['reference'],
            date=date_str
        )
        
        # Save to cache for future requests
        image_bytes = image_data.getvalue()
        current_app.storage_handler.save_verse_image(cache_date, image_bytes)
        logger.info(f"💾 Cached verse image for {cache_date}")
        
        # Reset BytesIO for sending
        image_data.seek(0)
        
        # Send file
        filename = f"divine_bridge_verse_{client_date or 'today'}.jpg"
        return send_file(
            image_data,
            mimetype='image/jpeg',
            as_attachment=True,
            download_name=filename
        )
        
    except Exception as e:
        logger.error(f"Error generating verse image: {e}")
        return jsonify({'error': 'Failed to generate image'}), 500

@verse_bp.route('/today-verse/<date>/image', methods=['GET'])
def get_daily_verse_image(date):
    """Serve daily verse image for sharing (not download)"""
    try:
        # Try to get cached image first
        cached_image = current_app.storage_handler.get_verse_image(date)
        if cached_image:
            logger.info(f"Serving verse image for sharing: {date}")
            from io import BytesIO
            image_data = BytesIO(cached_image)
            return send_file(
                image_data,
                mimetype='image/jpeg',
                as_attachment=False
            )
        
        # If no cached image, generate it
        try:
            client_datetime = datetime.strptime(date, '%Y-%m-%d')
            day_of_year = client_datetime.timetuple().tm_yday
            date_str = client_datetime.strftime('%B %d, %Y')
        except ValueError:
            day_of_year = None
            date_str = datetime.now().strftime('%B %d, %Y')
        
        verse = current_app.verse_cache.get_today_verse(day_of_year=day_of_year)
        if not verse:
            return jsonify({'error': 'No verse available'}), 404
        
        # Generate image
        from image_generator import get_image_generator
        generator = get_image_generator()
        
        image_data = generator.generate_verse_image(
            verse_text=verse['verse'],
            reference=verse['reference'],
            date=date_str
        )
        
        # Save to cache
        image_bytes = image_data.getvalue()
        current_app.storage_handler.save_verse_image(date, image_bytes)
        
        # Reset and send
        image_data.seek(0)
        return send_file(
            image_data,
            mimetype='image/jpeg',
            as_attachment=False
        )
        
    except Exception as e:
        logger.error(f"Error serving verse image: {e}")
        return jsonify({'error': 'Failed to generate image'}), 500

# Daily Verse Interactions Endpoints
@verse_bp.route('/today-verse/<date>/like', methods=['POST', 'DELETE'])
def toggle_daily_verse_like(date):
    """Like or unlike a daily verse"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        user_id = user.get('user_id')
        db = get_firestore_client()
        if not db:
            return jsonify({'error': 'Database unavailable'}), 500
        
        verse_ref = db.collection('daily_verses').document(date)
        likes_ref = verse_ref.collection('likes').document(user_id)
        
        if request.method == 'POST':
            # Like the verse
            likes_ref.set({
                'user_id': user_id,
                'user_name': user.get('user_name', 'Anonymous'),
                'created_at': datetime.now().isoformat()
            })
            logger.info(f"User {user_id} liked daily verse for {date}")
            return jsonify({'message': 'Verse liked', 'liked': True}), 200
        else:
            # Unlike the verse
            likes_ref.delete()
            logger.info(f"User {user_id} unliked daily verse for {date}")
            return jsonify({'message': 'Verse unliked', 'liked': False}), 200
            
    except Exception as e:
        logger.error(f"Error toggling verse like: {e}")
        logger.exception("Full traceback for verse like error:")
        return jsonify({'error': 'Failed to update like'}), 500

@verse_bp.route('/today-verse/<date>/likes', methods=['GET'])
def get_daily_verse_likes(date):
    """Get likes count and check if current user has liked"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({'error': 'Database unavailable'}), 500
        
        verse_ref = db.collection('daily_verses').document(date)
        likes = verse_ref.collection('likes').stream()
        
        likes_list = [like.to_dict() for like in likes]
        likes_count = len(likes_list)
        
        # Check if current user has liked
        user = get_user_from_session()
        user_liked = False
        if user:
            user_id = user.get('user_id')
            user_liked = any(like.get('user_id') == user_id for like in likes_list)
        
        return jsonify({
            'count': likes_count,
            'liked': user_liked
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting verse likes: {e}")
        return jsonify({'error': 'Failed to get likes', 'count': 0, 'liked': False}), 500

@verse_bp.route('/today-verse/<date>/share', methods=['POST'])
def track_daily_verse_share(date):
    """Track a share of a daily verse"""
    try:
        user = get_user_from_session()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        
        user_id = user.get('user_id')
        data = request.get_json() or {}
        platform = data.get('platform', 'unknown')
        
        db = get_firestore_client()
        if not db:
            return jsonify({'error': 'Database unavailable'}), 500
        
        verse_ref = db.collection('daily_verses').document(date)
        share_ref = verse_ref.collection('shares').document()
        
        share_ref.set({
            'user_id': user_id,
            'user_name': user.get('user_name', 'Anonymous'),
            'platform': platform,
            'created_at': datetime.now().isoformat()
        })
        
        logger.info(f"User {user_id} shared daily verse for {date} on {platform}")
        return jsonify({'message': 'Share tracked'}), 200
        
    except Exception as e:
        logger.error(f"Error tracking verse share: {e}")
        return jsonify({'error': 'Failed to track share'}), 500

@verse_bp.route('/today-verse/<date>/shares', methods=['GET'])
def get_daily_verse_shares(date):
    """Get shares count for a daily verse"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({'error': 'Database unavailable'}), 500
        
        verse_ref = db.collection('daily_verses').document(date)
        shares = verse_ref.collection('shares').stream()
        
        shares_count = len(list(shares))
        
        return jsonify({
            'count': shares_count
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting verse shares: {e}")
        return jsonify({'error': 'Failed to get shares', 'count': 0}), 500

@verse_bp.route('/today-verse/<date>/interactions', methods=['GET'])
def get_daily_verse_interactions(date):
    """Get all interaction counts for a daily verse (likes, shares)"""
    try:
        db = get_firestore_client()
        if not db:
            return jsonify({'error': 'Database unavailable'}), 500
        
        verse_ref = db.collection('daily_verses').document(date)
        
        # Get likes
        likes = list(verse_ref.collection('likes').stream())
        likes_count = len(likes)
        
        # Get shares count
        shares = list(verse_ref.collection('shares').stream())
        shares_count = len(shares)
        
        # Check if current user has liked
        user = get_user_from_session()
        user_liked = False
        if user:
            user_id = user.get('user_id')
            user_liked = any(like.to_dict().get('user_id') == user_id for like in likes)
        
        return jsonify({
            'likes': {
                'count': likes_count,
                'liked': user_liked
            },
            'shares': {
                'count': shares_count
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting verse interactions: {e}")
        return jsonify({
            'error': 'Failed to get interactions',
            'likes': {'count': 0, 'liked': False},
            'shares': {'count': 0}
        }), 500

@verse_bp.route('/upcoming-verses', methods=['GET'])
def get_upcoming_verses():
    """Get verses for the next 7 days"""
    try:
        from datetime import timedelta
        
        # Get client's local date from query parameter
        client_date = request.args.get('client_date')
        
        if client_date:
            try:
                base_date = datetime.strptime(client_date, '%Y-%m-%d')
            except ValueError:
                logger.warning(f"Invalid client_date format: {client_date}, using server time")
                base_date = datetime.now()
        else:
            base_date = datetime.now()
        
        # Get verses for next 7 days
        verses_list = []
        for i in range(7):
            date = base_date + timedelta(days=i)
            date_str = date.strftime('%Y-%m-%d')
            day_of_year = date.timetuple().tm_yday
            
            # Get verse for this day
            verse = current_app.verse_cache.get_today_verse(day_of_year=day_of_year)
            
            if verse:
                verses_list.append({
                    'date': date_str,
                    'day_name': date.strftime('%A'),
                    'day_of_year': day_of_year,
                    'verse': verse['verse'],
                    'reference': verse['reference']
                })
            else:
                # Fallback if verse not found
                verses_list.append({
                    'date': date_str,
                    'day_name': date.strftime('%A'),
                    'day_of_year': day_of_year,
                    'verse': 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
                    'reference': 'John 3:16'
                })
        
        return jsonify({
            'success': True,
            'verses': verses_list
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting upcoming verses: {e}")
        return jsonify({
            'success': False,
            'error': 'Failed to get upcoming verses'
        }), 500 