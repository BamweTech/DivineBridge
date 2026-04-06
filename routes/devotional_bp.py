"""
Devotional plan routes — AI-powered personalized devotional plans via Perplexity.
"""
import json
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

BATCH_SIZE = 7


def _build_batch_prompt(theme: str, batch_start: int, batch_end: int,
                        total_duration: int, tradition: str,
                        prior_titles: list[str] | None = None) -> str:
    """Build a prompt for a single batch of days within a larger plan."""
    count = batch_end - batch_start + 1
    context = ""
    if prior_titles:
        summary = "; ".join(f"Day {i+1}: {t}" for i, t in enumerate(prior_titles))
        context = (
            f"\nThis is part of a {total_duration}-day plan. "
            f"Days already written: [{summary}]. "
            f"Continue building on those themes — do not repeat the same scriptures.\n"
        )

    return f"""Create days {batch_start} through {batch_end} of a {total_duration}-day personal devotional plan on the theme of "{theme}".
{context}
Return a JSON object with this exact structure — no markdown, no explanation, pure JSON:
{{
  "days": [
    {{
      "day": {batch_start},
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
- Exactly {count} day objects in the "days" array (days {batch_start}–{batch_end})
- Each reflection must be 150-200 words, personal and encouraging
- Each prayer must be 50-80 words, addressed to God, intimate and sincere
- Scripture must be from the {tradition} tradition
- Each day must build meaningfully on the previous one
- Tone: warm, pastoral, accessible to everyday believers
"""


def _parse_ai_response(text: str) -> dict:
    """Strip markdown fences and parse JSON from the AI response."""
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    return json.loads(text)


def _generate_plan_batched(client, theme: str, duration: int, tradition: str) -> dict:
    """Generate a devotional plan in batches of BATCH_SIZE days."""
    all_days = []
    prior_titles = []
    batch_start = 1

    while batch_start <= duration:
        batch_end = min(batch_start + BATCH_SIZE - 1, duration)
        prompt = _build_batch_prompt(
            theme, batch_start, batch_end, duration, tradition,
            prior_titles=prior_titles if prior_titles else None,
        )

        timeout = 120.0
        response = client.query_with_timeout(prompt, timeout=timeout)
        batch_data = _parse_ai_response(response)

        batch_days = batch_data.get('days', [])
        if len(batch_days) != (batch_end - batch_start + 1):
            raise ValueError(
                f"Batch {batch_start}-{batch_end}: expected {batch_end - batch_start + 1} days, "
                f"got {len(batch_days)}"
            )

        all_days.extend(batch_days)
        prior_titles.extend(d.get('title', '') for d in batch_days)
        batch_start = batch_end + 1

    return {
        'title': f'{theme} — {duration}-Day Plan',
        'theme': theme,
        'days': all_days,
    }


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

    try:
        plan_data = _generate_plan_batched(client, theme, duration, tradition)
    except Exception as exc:
        logger.error('Devotional generation failed: %s', exc)
        return jsonify({'error': 'Failed to generate plan. Please try again.'}), 500

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
    """Mark a day as complete and update streak with calendar integrity."""
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
    already_done = False
    for d in days:
        if d.get('day') == day:
            already_done = d.get('completed', False)
            d['completed'] = True
            d['completed_at'] = datetime.now(timezone.utc).isoformat()
            break

    now = datetime.now(timezone.utc)
    update = {
        'days': days,
        'current_day': min(day + 1, plan['duration']),
        'last_completed_at': firestore.SERVER_TIMESTAMP,
    }

    if not already_done:
        last_raw = plan.get('last_completed_at')
        if last_raw is not None:
            if hasattr(last_raw, 'timestamp'):
                last_dt = last_raw
            elif isinstance(last_raw, str):
                last_dt = datetime.fromisoformat(last_raw.replace('Z', '+00:00'))
            else:
                last_dt = None
            gap_too_large = last_dt and (now - last_dt).total_seconds() > 48 * 3600
        else:
            gap_too_large = False
        update['streak'] = 1 if gap_too_large else plan.get('streak', 0) + 1

    if day >= plan.get('duration', 0):
        update['completed_at'] = firestore.SERVER_TIMESTAMP

    ref.update(update)
    return jsonify({'success': True, 'plan_completed': day >= plan.get('duration', 0)}), 200


@devotional_bp.route('/<plan_id>/journal', methods=['POST'])
@require_auth
def save_journal(plan_id: str):
    """Save a personal journal entry for a specific day."""
    data = request.get_json(silent=True) or {}
    day = data.get('day')
    text = data.get('text', '')
    uid = g.user_id

    if not isinstance(day, int) or day < 1:
        return jsonify({'error': 'day must be a positive integer'}), 400
    if len(text) > 2000:
        return jsonify({'error': 'Journal text must be 2000 characters or fewer'}), 400

    db = get_firestore_client()
    ref = db.collection('devotional_plans').document(plan_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({'error': 'Plan not found'}), 404

    plan = snap.to_dict()
    if plan.get('uid') != uid:
        return jsonify({'error': 'Forbidden'}), 403

    days = plan.get('days', [])
    found = False
    for d in days:
        if d.get('day') == day:
            d['journal'] = text
            found = True
            break

    if not found:
        return jsonify({'error': 'Day not found in plan'}), 404

    ref.update({'days': days})
    return jsonify({'success': True}), 200
