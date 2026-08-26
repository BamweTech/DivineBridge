"""
Pre-generate canonical devotional plans for all suggested themes × durations.

Writes 24 documents (8 themes × 3 durations) to the Firestore
'devotional_templates' collection so the /api/devotional/generate route can
serve suggested themes instantly without an AI round-trip.

Usage:
    python scripts/pregen_devotional_templates.py           # skip fresh templates
    python scripts/pregen_devotional_templates.py --force   # regenerate all

Run once on first deploy, then monthly (see /admin/api/refresh-devotional-templates).
"""

import argparse
import logging
import sys
import os

# Add the project root to the Python path so we can import app modules.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.core.config import get_config
from backend.integrations.firebase_auth import initialize_firebase, get_firestore_client
from backend.integrations.perplexity_client import get_perplexity_client, set_client_model
from backend.api.devotional_bp import (
    SUGGESTED_THEMES,
    VALID_DURATIONS,
    DEFAULT_TRADITION,
    TEMPLATE_MAX_AGE_DAYS,
    _template_key,
    _load_template,
    _save_template,
    _generate_plan_batched,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
)
logger = logging.getLogger(__name__)


def pregen_templates(force: bool = False) -> dict:
    """
    Generate and store templates for every SUGGESTED_THEMES × VALID_DURATIONS
    combination.

    Args:
        force: If True, regenerate even when a fresh template already exists.

    Returns:
        Dict with 'generated', 'skipped', and 'failed' counts.
    """
    config = get_config()
    initialize_firebase()
    db = get_firestore_client()

    set_client_model('sonar-pro')
    client = get_perplexity_client()

    counts = {'generated': 0, 'skipped': 0, 'failed': 0}
    total = len(SUGGESTED_THEMES) * len(VALID_DURATIONS)
    logger.info('Starting pre-generation: %d templates total (force=%s)', total, force)

    for theme in sorted(SUGGESTED_THEMES):
        for duration in sorted(VALID_DURATIONS):
            key = _template_key(theme, duration)

            if not force:
                cached = _load_template(db, key)
                if cached is not None:
                    logger.info('[SKIP] %s — fresh template exists', key)
                    counts['skipped'] += 1
                    continue

            logger.info('[GEN]  %s — generating %d-day plan…', key, duration)
            try:
                plan_data = _generate_plan_batched(client, theme, duration, DEFAULT_TRADITION)
                if 'days' not in plan_data or len(plan_data['days']) != duration:
                    raise ValueError(
                        f"Expected {duration} days, got {len(plan_data.get('days', []))}"
                    )
                _save_template(db, key, theme, duration, plan_data['days'])
                logger.info('[OK]   %s — saved (%d days)', key, duration)
                counts['generated'] += 1
            except Exception as exc:
                logger.error('[FAIL] %s — %s', key, exc)
                counts['failed'] += 1

    logger.info(
        'Done. generated=%d skipped=%d failed=%d',
        counts['generated'], counts['skipped'], counts['failed'],
    )
    return counts


def main():
    parser = argparse.ArgumentParser(description='Pre-generate devotional templates.')
    parser.add_argument(
        '--force', action='store_true',
        help=f'Regenerate all templates, even those younger than {TEMPLATE_MAX_AGE_DAYS} days.',
    )
    args = parser.parse_args()

    counts = pregen_templates(force=args.force)
    if counts['failed'] > 0:
        logger.error('%d template(s) failed to generate.', counts['failed'])
        sys.exit(1)


if __name__ == '__main__':
    main()
