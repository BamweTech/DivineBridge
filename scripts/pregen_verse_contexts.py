"""
Pre-generate AI verse context (sermon + original-language words + reflection
questions) for every verse in ``static/bible_verses.json``.

Why this exists
---------------
The mobile verse reader (``mobile/app/verse-reader.tsx``) opens the
``/api/today-verse/context`` endpoint when the user taps the hero verse.
The endpoint lazy-generates on cache miss, but first-time generation can
take 5–15 s while Perplexity composes the JSON, which would be a bad first
impression on day 1. Running this script once after deploy seeds Firestore
so every verse appears instantly from the moment the feature ships, and
the nightly Cloud Scheduler job (``POST /api/today-verse/context/generate``)
only has to cover newly-added verses.

Idempotent: any verse whose ``verse_contexts/{slug}`` doc already exists
is skipped, unless ``--force`` is passed.

Usage
-----
::

    python scripts/pregen_verse_contexts.py             # cache-aware
    python scripts/pregen_verse_contexts.py --force     # regenerate all
    python scripts/pregen_verse_contexts.py --limit 5   # just first 5 verses (smoke test)
"""

import argparse
import json
import logging
import os
import sys
import time
from typing import Any, Dict, List

# Make the project root importable when invoked as a script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from firebase_auth import initialize_firebase  # noqa: E402
from verse_context_generator import (  # noqa: E402
    VerseContextGenerator,
    slugify_reference,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
)
logger = logging.getLogger(__name__)

VERSES_JSON_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'static',
    'bible_verses.json',
)


def load_verses() -> List[Dict[str, str]]:
    """Read ``static/bible_verses.json`` and return its verse list.

    Tolerates either ``{"verses": [...]}`` or a top-level list, since
    contributor edits sometimes flip between the two shapes.
    """
    with open(VERSES_JSON_PATH, 'r', encoding='utf-8') as f:
        data: Any = json.load(f)
    if isinstance(data, dict):
        verses = data.get('verses') or data.get('items') or []
    elif isinstance(data, list):
        verses = data
    else:
        verses = []
    cleaned = []
    for v in verses:
        ref = (v.get('reference') or '').strip()
        text = (v.get('text') or v.get('verse') or '').strip()
        if ref and text:
            cleaned.append({'reference': ref, 'text': text})
    return cleaned


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--force',
        action='store_true',
        help='Regenerate even when a cached doc exists.',
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Only process the first N verses (handy for smoke tests).',
    )
    parser.add_argument(
        '--sleep',
        type=float,
        default=0.5,
        help='Seconds to sleep between successful generations (rate-limit safety).',
    )
    args = parser.parse_args()

    initialize_firebase()
    generator = VerseContextGenerator()

    verses = load_verses()
    if args.limit is not None:
        verses = verses[: args.limit]

    total = len(verses)
    logger.info(
        'Starting verse context pregen: %d verses (force=%s)',
        total,
        args.force,
    )

    counts = {'generated': 0, 'skipped': 0, 'failed': 0}
    errors: List[Dict[str, str]] = []

    for idx, v in enumerate(verses, start=1):
        ref = v['reference']
        text = v['text']
        slug = slugify_reference(ref)

        if not args.force and generator.get_cached(ref):
            logger.info('[%d/%d] SKIP  %-40s (cached)', idx, total, slug)
            counts['skipped'] += 1
            continue

        logger.info('[%d/%d] GEN   %-40s', idx, total, slug)
        try:
            generator.generate_context(text, ref, force=args.force)
            counts['generated'] += 1
            time.sleep(args.sleep)
        except Exception as e:
            counts['failed'] += 1
            errors.append({'slug': slug, 'reference': ref, 'error': str(e)})
            logger.error('[%d/%d] FAIL  %-40s — %s', idx, total, slug, e)

    logger.info(
        'Done: generated=%d skipped=%d failed=%d (total=%d)',
        counts['generated'],
        counts['skipped'],
        counts['failed'],
        total,
    )
    if errors:
        logger.warning('Errors:\n%s', json.dumps(errors, indent=2))

    return 0 if counts['failed'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
