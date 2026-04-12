#!/usr/bin/env python3
"""
Remove production / QA artifacts from GCS wall data:

- testimonies/  (web Community thanksgiving cards)
- prayer_requests/  (merged into GET /api/prayer/prayers — mobile Prayer Wall)

Uses the same fingerprints as qa_wall_filters.is_hidden_production_test_wall_item.

Usage:
  python3 scripts/delete_production_test_testimonies.py
  python3 scripts/delete_production_test_testimonies.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

os.environ.setdefault("USE_LOCAL_STORAGE", "false")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _blob_id_json(blob_name: str) -> str:
    return blob_name.split("/")[-1].replace(".json", "")


def _scan_prefix(storage, prefix: str, kind: str, is_hidden):
    matches: list[tuple[str, str, str]] = []
    for blob in storage.bucket.list_blobs(prefix=prefix):
        if not blob.name.endswith(".json"):
            continue
        try:
            data = json.loads(blob.download_as_text())
        except Exception as e:
            logger.warning("Skip %s: %s", blob.name, e)
            continue
        if not is_hidden(data):
            continue
        rid = data.get("id") or _blob_id_json(blob.name)
        matches.append((blob.name, rid, kind))
        logger.info(
            "Match [%s]: %s | id=%s | title=%r",
            kind,
            blob.name,
            rid,
            (data.get("title") or "")[:80],
        )
    return matches


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="List matches only")
    args = parser.parse_args()

    from qa_wall_filters import is_hidden_production_test_wall_item
    from storage_handler import StorageHandler

    storage = StorageHandler()

    t_matches = _scan_prefix(storage, "testimonies/", "testimony", is_hidden_production_test_wall_item)
    p_matches = _scan_prefix(storage, "prayer_requests/", "prayer_request", is_hidden_production_test_wall_item)
    matches = t_matches + p_matches

    if not matches:
        logger.info("No production test wall content found (testimonies + prayer_requests).")
        return 0

    if args.dry_run:
        logger.info("Dry run: would delete %d object(s).", len(matches))
        return 0

    deleted = 0
    for blob_name, rid, kind in matches:
        if kind == "testimony":
            if rid and storage.delete_testimony(rid):
                deleted += 1
            else:
                storage.bucket.blob(blob_name).delete()
                logger.info("Deleted testimony by blob path: %s", blob_name)
                deleted += 1
        else:
            if rid and storage.delete_prayer_request(rid):
                deleted += 1
            else:
                storage.bucket.blob(blob_name).delete()
                logger.info("Deleted prayer_request by blob path: %s", blob_name)
                deleted += 1

    logger.info("Deleted %d object(s).", deleted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
