from flask import Blueprint, jsonify, current_app, request
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