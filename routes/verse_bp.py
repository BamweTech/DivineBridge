from flask import Blueprint, jsonify, current_app, request, send_file
import logging
from datetime import datetime

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