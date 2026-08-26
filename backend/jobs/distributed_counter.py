"""
Distributed counter pattern for Firestore.

Firestore has a write limit of ~1 write/second per document. For counters that
many users update simultaneously (likes, shares, views), this module shards
the count across N sub-documents and aggregates on read.

Usage:
    from distributed_counter import increment_counter, get_count

    # When a user likes a prayer:
    increment_counter(db, 'daily_prayers/2026-04-02', 'likes_count', delta=1)

    # When reading the total:
    total = get_count(db, 'daily_prayers/2026-04-02', 'likes_count')
"""

import random
import logging
from google.cloud.firestore_v1 import Increment

logger = logging.getLogger(__name__)

NUM_SHARDS = 10


def _shard_ref(db, doc_path, field, shard_id):
    return db.document(doc_path).collection(f"_shards_{field}").document(str(shard_id))


def increment_counter(db, doc_path, field, delta=1):
    """Increment a distributed counter by `delta` (default 1). Thread-safe."""
    shard_id = random.randint(0, NUM_SHARDS - 1)
    ref = _shard_ref(db, doc_path, field, shard_id)
    ref.set({"count": Increment(delta)}, merge=True)


def get_count(db, doc_path, field):
    """Read the total across all shards. Returns an integer."""
    total = 0
    shards = db.document(doc_path).collection(f"_shards_{field}").stream()
    for shard in shards:
        data = shard.to_dict()
        total += data.get("count", 0)
    return total
