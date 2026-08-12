"""Grant every current Firebase Auth user English prayer-leader access.

Run with --apply to perform writes. Without it, the script only reports how
many Firebase Auth accounts would be updated.
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from firebase_admin import auth, firestore

from config import get_config
from firebase_auth import initialize_firebase


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BATCH_SIZE = 450
LEADER_FIELDS = {
    "is_prayer_leader": True,
    "prayer_languages": firestore.ArrayUnion(["english"]),
}


def iter_users():
    page = auth.list_users()
    while page:
        yield from page.users
        page = page.get_next_page()


def grant_access(apply=False):
    """Report or grant English prayer-leader access to every Auth user."""
    get_config()
    if not initialize_firebase():
        raise RuntimeError("Firebase Admin initialization failed")

    db = firestore.client()
    total = 0
    batch = db.batch()
    pending = 0

    for user in iter_users():
        total += 1
        if not apply:
            continue

        batch.set(db.collection("users").document(user.uid), LEADER_FIELDS, merge=True)
        pending += 1
        if pending == BATCH_SIZE:
            batch.commit()
            logger.info("Updated %d users", total)
            batch = db.batch()
            pending = 0

    if apply and pending:
        batch.commit()

    action = "Updated" if apply else "Would update"
    logger.info(
        "%s %d Firebase Auth users with prayer-leader access for English.",
        action,
        total,
    )
    return total


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Perform the Firestore writes. Omit for a read-only preview.",
    )
    args = parser.parse_args()
    grant_access(apply=args.apply)
