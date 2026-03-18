"""
Devotional plan routes — AI-powered personalized devotional plans via Perplexity.
"""
import uuid
import logging
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, g
from firebase_admin import firestore
from firebase_auth import get_firestore_client
from auth_helpers import require_auth
from perplexity_client import get_perplexity_client, set_client_model

logger = logging.getLogger(__name__)
devotional_bp = Blueprint('devotional', __name__, url_prefix='/api/devotional')

VALID_DURATIONS = {7, 14, 30}
VALID_THEMES = {
    'Faith & Trust', 'Healing & Restoration', 'Peace & Stillness',
    'Purpose & Calling', 'Gratitude & Worship', 'Family & Relationships',
    'Spiritual Growth', 'Hope & Perseverance',
}


def _build_devotional_prompt(theme: str, duration: int, tradition: str) -> str:
    return f"""Create a {duration}-day personal devotional plan on the theme of "{theme}".

Return a JSON object with this exact structure — no markdown, no explanation, pure JSON:
{{
  "title": "Plan title",
  "theme": "{theme}",
  "days": [
    {{
      "day": 1,
      "title": "Day title",
      "scripture": "Full scripture text",
      "scripture_reference": "Book Chapter:Verse",
      "reflection": "150-200 word reflection on the scripture",
      "prayer": "A 50-80 word closing prayer for this day",
      "completed": false
    }}
  ]
}}

Requirements:
- Exactly {duration} day objects in the "days" array
- Each reflection must be 150-200 words, personal and encouraging
- Each prayer must be 50-80 words, addressed to God, intimate and sincere
- Scripture must be from the {tradition} tradition
- Each day must build meaningfully on the previous one
- Tone: warm, pastoral, accessible to everyday believers
"""


@devotional_bp.route('/generate', methods=['POST'])
@require_auth
def generate_devotional():
    """Generate a new AI-powered devotional plan and save it to Firestore."""
    data = request.get_json(silent=True) or {}
    theme = data.get('theme', '').strip()
    duration = data.get('duration', 7)
    tradition = data.get('tradition', 'Protestant/Evangelical')

    if not theme:
        return jsonify({'error': 'theme is required'}), 400
    if duration not in VALID_DURATIONS:
        return jsonify({'error': f'duration must be one of {sorted(VALID_DURATIONS)}'}), 400
    if len(theme) > 100:
        return jsonify({'error': 'theme must be 100 characters or fewer'}), 400

    uid = g.user_id
    set_client_model('sonar-pro')
    client = get_perplexity_client()
    prompt = _build_devotional_prompt(theme, duration, tradition)

    try:
        response = client.query(prompt)
        import json
        # Strip markdown fences if present
        text = response.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        plan_data = json.loads(text)
    except Exception as exc:
        logger.error('Devotional generation failed: %s', exc)
        return jsonify({'error': 'Failed to generate plan. Please try again.'}), 500

    # Validate basic structure
    if 'days' not in plan_data or len(plan_data['days']) != duration:
        return jsonify({'error': 'Generated plan has incorrect structure. Please try again.'}), 500

    db = get_firestore_client()
    plan_id = str(uuid.uuid4())
    doc = {
        'plan_id': plan_id,
        'uid': uid,
        'title': plan_data.get('title', f'{theme} — {duration}-Day Plan'),
        'theme': theme,
        'duration': duration,
        'days': plan_data['days'],
        'current_day': 1,
        'streak': 0,
        'last_completed_at': None,
        'created_at': firestore.SERVER_TIMESTAMP,
    }
    db.collection('devotional_plans').document(plan_id).set(doc)

    return jsonify({'success': True, 'plan_id': plan_id, 'plan': plan_data}), 200


@devotional_bp.route('/<plan_id>/checkin', methods=['POST'])
@require_auth
def check_in(plan_id: str):
    """Mark a day as complete and update streak."""
    data = request.get_json(silent=True) or {}
    day = data.get('day')
    uid = g.user_id

    if not isinstance(day, int) or day < 1:
        return jsonify({'error': 'day must be a positive integer'}), 400

    db = get_firestore_client()
    ref = db.collection('devotional_plans').document(plan_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({'error': 'Plan not found'}), 404

    plan = snap.to_dict()
    if plan.get('uid') != uid:
        return jsonify({'error': 'Forbidden'}), 403

    days = plan.get('days', [])
    for d in days:
        if d.get('day') == day:
            d['completed'] = True
            d['completed_at'] = datetime.now(timezone.utc).isoformat()
            break

    ref.update({
        'days': days,
        'current_day': min(day + 1, plan['duration']),
        'streak': plan.get('streak', 0) + 1,
        'last_completed_at': firestore.SERVER_TIMESTAMP,
    })
    return jsonify({'success': True}), 200
