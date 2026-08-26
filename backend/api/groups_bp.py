"""
Prayer Groups routes — CRUD for small prayer communities.
Designed per docs/PRAYER_GROUPS_BRAINSTORM.md.
"""
import datetime
import time
import uuid
import logging
from flask import Blueprint, request, jsonify, g
from firebase_admin import firestore
from backend.integrations.firebase_auth import get_firestore_client
from backend.core.auth.helpers import require_auth
from backend.integrations.push_service import send_push_to_group

logger = logging.getLogger(__name__)
groups_bp = Blueprint("groups", __name__, url_prefix="/api/groups")

VALID_PRIVACY = {"public", "private", "invite_only"}
MAX_NAME_LEN = 50
MAX_DESC_LEN = 200


def _created_at_sort_ts(row):
    """Sort key for group dicts (newest first). Avoids Firestore composite index on array_contains + order_by."""
    ts = row.get("created_at")
    if ts is None:
        return 0.0
    if isinstance(ts, datetime.datetime):
        return ts.timestamp()
    return 0.0


def _user_group_member_fields(db, uid: str):
    """Resolve the user fields we persist on a group member doc."""
    user_snap = db.collection("users").document(uid).get()
    data = user_snap.to_dict() or {}
    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    display_name = " ".join(part for part in [first_name, last_name] if part).strip()
    if not display_name:
        display_name = (data.get("displayName") or "").strip()
    if not display_name:
        email = (data.get("email") or "").strip()
        display_name = email.split("@")[0] if email else "Unknown"
    return {
        "display_name": display_name or "Unknown",
        "photo_url": data.get("photoURL") or None,
    }


# ─── Group CRUD ───────────────────────────────────────────────────────────────


@groups_bp.route("", methods=["GET"])
@require_auth
def list_public_groups():
    """Return public groups ordered by member count descending."""
    db = get_firestore_client()
    # Equality-only query (no order_by) so no composite index is required; sort in Python.
    snaps = db.collection("prayer_groups").where("privacy", "==", "public").stream()
    groups = [{"group_id": s.id, **(s.to_dict() or {})} for s in snaps]
    groups.sort(key=lambda g: int(g.get("member_count") or 0), reverse=True)
    groups = groups[:50]
    return jsonify({"success": True, "groups": groups}), 200


@groups_bp.route("/my", methods=["GET"])
@require_auth
def my_groups():
    """Return groups the current user belongs to."""
    uid = g.user_id
    db = get_firestore_client()
    # array_contains alone uses automatic indexing; order_by(created_at) needs a composite index and caused 500s.
    snaps = db.collection("prayer_groups").where("member_ids", "array_contains", uid).stream()
    groups = [{"group_id": s.id, **(s.to_dict() or {})} for s in snaps]
    groups.sort(key=_created_at_sort_ts, reverse=True)
    return jsonify({"success": True, "groups": groups}), 200


@groups_bp.route("", methods=["POST"])
@require_auth
def create_group():
    """Create a new prayer group."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()
    privacy = data.get("privacy", "private")
    uid = g.user_id

    if len(name) < 3:
        return jsonify({"error": "Group name must be at least 3 characters"}), 400
    if len(name) > MAX_NAME_LEN:
        return jsonify({"error": f"Group name must be {MAX_NAME_LEN} characters or fewer"}), 400
    if len(description) > MAX_DESC_LEN:
        return jsonify({"error": f"Description must be {MAX_DESC_LEN} characters or fewer"}), 400
    if privacy not in VALID_PRIVACY:
        return jsonify({"error": f"privacy must be one of {sorted(VALID_PRIVACY)}"}), 400
    if privacy == "public":
        return jsonify({"error": "Public groups are not available yet. Use private or invite_only."}), 400

    db = get_firestore_client()

    member_fields = _user_group_member_fields(db, uid)

    group_id = str(uuid.uuid4())
    invite_code = str(uuid.uuid4())[:8].upper() if privacy != "public" else None

    group_doc = {
        "group_id": group_id,
        "name": name,
        "description": description,
        "privacy": privacy,
        "created_by": uid,
        "member_ids": [uid],
        "member_count": 1,
        "invite_code": invite_code,
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
    }
    db.collection("prayer_groups").document(group_id).set(group_doc)

    # Add creator as admin member
    db.collection("group_members").document(group_id).collection("members").document(uid).set(
        {
            "uid": uid,
            **member_fields,
            "role": "admin",
            "joined_at": firestore.SERVER_TIMESTAMP,
        }
    )

    return (
        jsonify(
            {
                "success": True,
                "group_id": group_id,
                "invite_code": invite_code,
                "message": f'Group "{name}" created successfully',
            }
        ),
        201,
    )


@groups_bp.route("/<group_id>", methods=["GET"])
@require_auth
def get_group(group_id: str):
    """Get a single group by ID."""
    db = get_firestore_client()
    snap = db.collection("prayer_groups").document(group_id).get()
    if not snap.exists:
        return jsonify({"error": "Group not found"}), 404
    group = {"group_id": snap.id, **snap.to_dict()}
    # Omit invite_code for non-members unless they're requesting it
    uid = g.user_id
    if uid not in group.get("member_ids", []):
        group.pop("invite_code", None)
    return jsonify({"success": True, "group": group}), 200


# ─── Membership ───────────────────────────────────────────────────────────────


@groups_bp.route("/<group_id>/join", methods=["POST"])
@require_auth
def join_group(group_id: str):
    """Join a group (public) or join via invite code (private/invite_only)."""
    data = request.get_json(silent=True) or {}
    provided_code = (data.get("code") or "").strip().upper()
    uid = g.user_id

    db = get_firestore_client()
    ref = db.collection("prayer_groups").document(group_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({"error": "Group not found"}), 404

    group = snap.to_dict()

    if uid in group.get("member_ids", []):
        return jsonify({"success": True, "message": "Already a member"}), 200

    if group["privacy"] != "public":
        if not provided_code:
            return jsonify({"error": "An invite code is required to join this group"}), 403
        if provided_code != group.get("invite_code", "").upper():
            return jsonify({"error": "Invalid invite code"}), 403

    member_fields = _user_group_member_fields(db, uid)

    ref.update(
        {
            "member_ids": firestore.ArrayUnion([uid]),
            "member_count": firestore.Increment(1),
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
    )
    db.collection("group_members").document(group_id).collection("members").document(uid).set(
        {
            "uid": uid,
            **member_fields,
            "role": "member",
            "joined_at": firestore.SERVER_TIMESTAMP,
        }
    )

    return jsonify({"success": True, "message": f'Joined "{group["name"]}"'}), 200


@groups_bp.route("/join-by-code", methods=["POST"])
@require_auth
def join_by_code():
    """Look up a group by invite_code and join it (used when only the code is known)."""
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()

    if not code:
        return jsonify({"error": "Invite code is required"}), 400

    uid = g.user_id
    db = get_firestore_client()

    # Find the group with this invite code
    snaps = list(db.collection("prayer_groups").where("invite_code", "==", code).limit(1).stream())
    if not snaps:
        return jsonify({"error": "Invalid invite code. Please check and try again."}), 404

    group_doc = snaps[0]
    group_id = group_doc.id
    group = group_doc.to_dict()

    if uid in group.get("member_ids", []):
        return (
            jsonify(
                {
                    "success": True,
                    "message": "Already a member",
                    "group_id": group_id,
                    "group_name": group.get("name", ""),
                }
            ),
            200,
        )

    member_fields = _user_group_member_fields(db, uid)

    ref = db.collection("prayer_groups").document(group_id)
    ref.update(
        {
            "member_ids": firestore.ArrayUnion([uid]),
            "member_count": firestore.Increment(1),
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
    )
    db.collection("group_members").document(group_id).collection("members").document(uid).set(
        {
            "uid": uid,
            **member_fields,
            "role": "member",
            "joined_at": firestore.SERVER_TIMESTAMP,
        }
    )

    return (
        jsonify(
            {
                "success": True,
                "message": f'Joined "{group.get("name", "group")}"',
                "group_id": group_id,
                "group_name": group.get("name", ""),
            }
        ),
        200,
    )


@groups_bp.route("/<group_id>/members/sync", methods=["POST"])
@require_auth
def sync_group_members(group_id: str):
    """Backfill member profile fields from users docs for this group."""
    uid = g.user_id
    db = get_firestore_client()
    group_ref = db.collection("prayer_groups").document(group_id)
    group_snap = group_ref.get()
    if not group_snap.exists:
        return jsonify({"error": "Group not found"}), 404

    group = group_snap.to_dict() or {}
    if uid not in group.get("member_ids", []):
        return jsonify({"error": "Forbidden"}), 403

    member_refs = list(db.collection("group_members").document(group_id).collection("members").stream())
    batch = db.batch()
    updated = 0

    for member_snap in member_refs:
        current = member_snap.to_dict() or {}
        next_fields = _user_group_member_fields(db, member_snap.id)
        if current.get("display_name") == next_fields.get("display_name") and current.get(
            "photo_url"
        ) == next_fields.get("photo_url"):
            continue

        batch.set(member_snap.reference, next_fields, merge=True)
        updated += 1

    if updated:
        batch.commit()

    return jsonify({"success": True, "updated": updated}), 200


@groups_bp.route("/<group_id>/leave", methods=["POST"])
@require_auth
def leave_group(group_id: str):
    """Leave a group."""
    uid = g.user_id
    db = get_firestore_client()
    ref = db.collection("prayer_groups").document(group_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({"error": "Group not found"}), 404

    group = snap.to_dict()
    if uid not in group.get("member_ids", []):
        return jsonify({"error": "You are not a member of this group"}), 400

    if group.get("created_by") == uid:
        return jsonify({"error": "Group admins cannot leave. Transfer ownership or delete the group first."}), 400

    ref.update(
        {
            "member_ids": firestore.ArrayRemove([uid]),
            "member_count": firestore.Increment(-1),
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
    )
    db.collection("group_members").document(group_id).collection("members").document(uid).delete()

    return jsonify({"success": True, "message": "Left the group"}), 200


# ── Group chat message push notifications ─────────────────────────────────────

_chat_push_cooldown: dict[str, float] = {}
CHAT_PUSH_COOLDOWN_SEC = 30


@groups_bp.route("/<group_id>/notify-message", methods=["POST"])
@require_auth
def notify_group_message(group_id: str):
    """Send a push notification to group members for a new chat message.

    Rate-limited to one push per group per 30 seconds so active
    conversations don't spam members.
    """
    uid = g.user_id
    data = request.get_json(silent=True) or {}
    sender_name = (data.get("sender_name") or "Someone")[:30]
    preview = (data.get("preview") or "")[:100]

    now = time.monotonic()
    last_push = _chat_push_cooldown.get(group_id, 0)
    if now - last_push < CHAT_PUSH_COOLDOWN_SEC:
        return jsonify({"success": True, "throttled": True}), 200
    _chat_push_cooldown[group_id] = now

    db = get_firestore_client()
    group_snap = db.collection("prayer_groups").document(group_id).get()
    group_name = "Prayer Group"
    if group_snap.exists:
        group_name = (group_snap.to_dict().get("name") or group_name).strip()

    body = f"{sender_name}: {preview}" if preview else f"{sender_name} sent a message"

    try:
        send_push_to_group(
            group_id,
            title=group_name,
            body=body,
            data={"type": "group_chat", "groupId": group_id},
            exclude_user=uid,
            priority="high",
            channel_id="group-chat",
        )
    except Exception as e:
        logger.warning(f"Group chat push failed (non-fatal): {e}")

    return jsonify({"success": True, "throttled": False}), 200
