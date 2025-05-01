from flask import Blueprint, jsonify, current_app

verse_bp = Blueprint('verse', __name__)

@verse_bp.route('/verse', methods=['GET'])
def get_verse():
    try:
        verse = current_app.verse_cache.get_verse()
        if not verse:
            return jsonify({'error': 'No verse available'}), 404
        return jsonify({'verse': verse}), 200
    except Exception as e:
        logger.error(f"Error getting verse: {e}")
        return jsonify({'error': 'Failed to get verse'}), 500 