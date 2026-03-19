"""
Prayer Groups routes — CRUD for small prayer communities.
Designed per docs/PRAYER_GROUPS_BRAINSTORM.md.
"""
import uuid
import logging
from flask import Blueprint, request, jsonify, g
from firebase_admin import firestore
from firebase_auth import get_firestore_client
from auth_helpers import require_auth

logger = logging.getLogger(__name__)
groups_bp = Blueprint('groups', __name__, url_prefix='/api/groups')

VALID_PRIVACY = {'public', 'private', 'invite_only'}
MAX_NAME_LEN = 50
MAX_DESC_LEN = 200


# ─── Group CRUD ───────────────────────────────────────────────────────────────

@groups_bp.route('', methods=['GET'])
@require_auth
def list_public_groups():
    """Return public groups ordered by member count descending."""
    db = get_firestore_client()
    snaps = (
        db.collection('prayer_groups')
        .where('privacy', '==', 'public')
        .order_by('member_count', direction=firestore.Query.DESCENDING)
        .limit(50)
        .stream()
    )
    groups = [{'group_id': s.id, **s.to_dict()} for s in snaps]
    return jsonify({'success': True, 'groups': groups}), 200


@groups_bp.route('/my', methods=['GET'])
@require_auth
def my_groups():
    """Return groups the current user belongs to."""
    uid = g.user_id
    db = get_firestore_client()
    snaps = (
        db.collection('prayer_groups')
        .where('member_ids', 'array_contains', uid)
        .order_by('created_at', direction=firestore.Query.DESCENDING)
        .stream()
    )
    groups = [{'group_id': s.id, **s.to_dict()} for s in snaps]
    return jsonify({'success': True, 'groups': groups}), 200


@groups_bp.route('', methods=['POST'])
@require_auth
def create_group():
    """Create a new prayer group."""
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip()
    privacy = data.get('privacy', 'public')
    uid = g.user_id

    if len(name) < 3:
        return jsonify({'error': 'Group name must be at least 3 characters'}), 400
    if len(name) > MAX_NAME_LEN:
        return jsonify({'error': f'Group name must be {MAX_NAME_LEN} characters or fewer'}), 400
    if len(description) > MAX_DESC_LEN:
        return jsonify({'error': f'Description must be {MAX_DESC_LEN} characters or fewer'}), 400
    if privacy not in VALID_PRIVACY:
        return jsonify({'error': f'privacy must be one of {sorted(VALID_PRIVACY)}'}), 400

    db = get_firestore_client()

    # Fetch creator's display name
    user_snap = db.collection('users').document(uid).get()
    display_name = user_snap.to_dict().get('displayName', 'Unknown') if user_snap.exists else 'Unknown'

    group_id = str(uuid.uuid4())
    invite_code = str(uuid.uuid4())[:8].upper() if privacy != 'public' else None

    group_doc = {
        'group_id': group_id,
        'name': name,
        'description': description,
        'privacy': privacy,
        'created_by': uid,
        'member_ids': [uid],
        'member_count': 1,
        'invite_code': invite_code,
        'created_at': firestore.SERVER_TIMESTAMP,
        'updated_at': firestore.SERVER_TIMESTAMP,
    }
    db.collection('prayer_groups').document(group_id).set(group_doc)

    # Add creator as admin member
    db.collection('group_members').document(group_id).collection('members').document(uid).set({
        'uid': uid,
        'display_name': display_name,
        'role': 'admin',
        'joined_at': firestore.SERVER_TIMESTAMP,
    })

    return jsonify({
        'success': True,
        'group_id': group_id,
        'invite_code': invite_code,
        'message': f'Group "{name}" created successfully',
    }), 201


@groups_bp.route('/<group_id>', methods=['GET'])
@require_auth
def get_group(group_id: str):
    """Get a single group by ID."""
    db = get_firestore_client()
    snap = db.collection('prayer_groups').document(group_id).get()
    if not snap.exists:
        return jsonify({'error': 'Group not found'}), 404
    group = {'group_id': snap.id, **snap.to_dict()}
    # Omit invite_code for non-members unless they're requesting it
    uid = g.user_id
    if uid not in group.get('member_ids', []):
        group.pop('invite_code', None)
    return jsonify({'success': True, 'group': group}), 200


# ─── Membership ───────────────────────────────────────────────────────────────

@groups_bp.route('/<group_id>/join', methods=['POST'])
@require_auth
def join_group(group_id: str):
    """Join a group (public) or join via invite code (private/invite_only)."""
    data = request.get_json(silent=True) or {}
    provided_code = (data.get('code') or '').strip().upper()
    uid = g.user_id

    db = get_firestore_client()
    ref = db.collection('prayer_groups').document(group_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({'error': 'Group not found'}), 404

    group = snap.to_dict()

    if uid in group.get('member_ids', []):
        return jsonify({'success': True, 'message': 'Already a member'}), 200

    if group['privacy'] != 'public':
        if not provided_code:
            return jsonify({'error': 'An invite code is required to join this group'}), 403
        if provided_code != group.get('invite_code', '').upper():
            return jsonify({'error': 'Invalid invite code'}), 403

    # Fetch display name
    user_snap = db.collection('users').document(uid).get()
    display_name = user_snap.to_dict().get('displayName', 'Unknown') if user_snap.exists else 'Unknown'

    ref.update({
        'member_ids': firestore.ArrayUnion([uid]),
        'member_count': firestore.Increment(1),
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    db.collection('group_members').document(group_id).collection('members').document(uid).set({
        'uid': uid,
        'display_name': display_name,
        'role': 'member',
        'joined_at': firestore.SERVER_TIMESTAMP,
    })

    return jsonify({'success': True, 'message': f'Joined "{group["name"]}"'}), 200


@groups_bp.route('/join-by-code', methods=['POST'])
@require_auth
def join_by_code():
    """Look up a group by invite_code and join it (used when only the code is known)."""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip().upper()

    if not code:
        return jsonify({'error': 'Invite code is required'}), 400

    uid = g.user_id
    db = get_firestore_client()

    # Find the group with this invite code
    snaps = list(
        db.collection('prayer_groups')
        .where('invite_code', '==', code)
        .limit(1)
        .stream()
    )
    if not snaps:
        return jsonify({'error': 'Invalid invite code. Please check and try again.'}), 404

    group_doc = snaps[0]
    group_id = group_doc.id
    group = group_doc.to_dict()

    if uid in group.get('member_ids', []):
        return jsonify({'success': True, 'message': 'Already a member', 'group_id': group_id, 'group_name': group.get('name', '')}), 200

    # Fetch display name
    user_snap = db.collection('users').document(uid).get()
    display_name = user_snap.to_dict().get('displayName', 'Unknown') if user_snap.exists else 'Unknown'

    ref = db.collection('prayer_groups').document(group_id)
    ref.update({
        'member_ids': firestore.ArrayUnion([uid]),
        'member_count': firestore.Increment(1),
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    db.collection('group_members').document(group_id).collection('members').document(uid).set({
        'uid': uid,
        'display_name': display_name,
        'role': 'member',
        'joined_at': firestore.SERVER_TIMESTAMP,
    })

    return jsonify({
        'success': True,
        'message': f'Joined "{group.get("name", "group")}"',
        'group_id': group_id,
        'group_name': group.get('name', ''),
    }), 200


@groups_bp.route('/<group_id>/leave', methods=['POST'])
@require_auth
def leave_group(group_id: str):
    """Leave a group."""
    uid = g.user_id
    db = get_firestore_client()
    ref = db.collection('prayer_groups').document(group_id)
    snap = ref.get()
    if not snap.exists:
        return jsonify({'error': 'Group not found'}), 404

    group = snap.to_dict()
    if uid not in group.get('member_ids', []):
        return jsonify({'error': 'You are not a member of this group'}), 400

    if group.get('created_by') == uid:
        return jsonify({'error': 'Group admins cannot leave. Transfer ownership or delete the group first.'}), 400

    ref.update({
        'member_ids': firestore.ArrayRemove([uid]),
        'member_count': firestore.Increment(-1),
        'updated_at': firestore.SERVER_TIMESTAMP,
    })
    db.collection('group_members').document(group_id).collection('members').document(uid).delete()

    return jsonify({'success': True, 'message': 'Left the group'}), 200
