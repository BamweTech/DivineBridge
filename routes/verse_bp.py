from flask import Blueprint, jsonify, current_app
import logging

logger = logging.getLogger(__name__)
verse_bp = Blueprint('verse', __name__)

@verse_bp.route('/api/today-verse', methods=['GET'])
def get_verse():
    try:
        verse = current_app.verse_cache.get_today_verse()
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