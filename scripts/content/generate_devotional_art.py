#!/usr/bin/env python3
"""Generate theme artwork for existing devotional plans.

Writes one JPEG per plan to the same cache the API serves
(``images/devotional-art/{plan_id}.jpg``). Plans that already have art are
skipped unless ``--force`` is set.

Usage:
    python -m scripts.content.generate_devotional_art
    python -m scripts.content.generate_devotional_art --dry-run
    python -m scripts.content.generate_devotional_art --force
    python -m scripts.content.generate_devotional_art --plan-id PLAN_ID
"""

import argparse
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.integrations.firebase_auth import get_firestore_client
from backend.integrations.storage_handler import StorageHandler
from backend.services.prayer.devotional_art import render_devotional_art

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

_PLAN_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


def plan_theme(data: dict) -> str:
    """Theme string the artwork is drawn from."""
    theme = str(data.get("theme") or data.get("title") or "Faith").strip()
    return theme or "Faith"


def generate_art(dry_run: bool = False, force: bool = False, plan_id: str = "") -> dict:
    """Render and store artwork for each existing plan.

    Returns counts for generated, skipped, and failed plans.
    """
    db = get_firestore_client()
    if db is None:
        raise RuntimeError("Firestore is not available")

    storage = StorageHandler()
    counts = {"generated": 0, "skipped": 0, "failed": 0}

    query = db.collection("devotional_plans")
    if plan_id:
        snaps = [query.document(plan_id).get()]
    else:
        snaps = query.stream()

    for snap in snaps:
        if not snap.exists:
            logger.error("[MISS] %s — plan not found", plan_id or snap.id)
            counts["failed"] += 1
            continue

        current_id = snap.id
        if not _PLAN_ID_RE.match(current_id or ""):
            logger.warning("[SKIP] %s — plan id cannot be used as an image name", current_id)
            counts["skipped"] += 1
            continue

        data = snap.to_dict() or {}
        theme = plan_theme(data)
        title = (data.get("title") or theme).strip()

        if not force and storage.get_devotional_art(current_id):
            logger.info("[SKIP] %s — artwork already stored (%s)", current_id, title)
            counts["skipped"] += 1
            continue

        if dry_run:
            logger.info("[DRY]  %s — would draw %r (%s)", current_id, theme, title)
            counts["generated"] += 1
            continue

        try:
            image_bytes = render_devotional_art(theme, current_id).getvalue()
            if not storage.save_devotional_art(current_id, image_bytes):
                raise RuntimeError("storage save returned false")
            logger.info("[SAVE] %s — %r (%s)", current_id, theme, title)
            counts["generated"] += 1
        except Exception as exc:
            logger.error("[FAIL] %s — %s", current_id, exc)
            counts["failed"] += 1

    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate artwork for existing devotional plans")
    parser.add_argument("--dry-run", action="store_true", help="List plans that would be drawn")
    parser.add_argument("--force", action="store_true", help="Replace artwork that already exists")
    parser.add_argument("--plan-id", default="", help="Generate one plan instead of every plan")
    args = parser.parse_args()

    counts = generate_art(dry_run=args.dry_run, force=args.force, plan_id=args.plan_id.strip())
    logger.info(
        "Done. generated=%d skipped=%d failed=%d",
        counts["generated"],
        counts["skipped"],
        counts["failed"],
    )
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
