"""Private mobile prayer-request matching service.

This intentionally does not share storage with the public Prayer Wall.  Private
requests need transactional claiming, restricted access, and short-lived state.
"""

from datetime import datetime, timedelta
import logging
import uuid

from firebase_admin import firestore

from push_service import send_push_to_user


logger = logging.getLogger(__name__)

COLLECTION = 'private_prayer_requests'
REQUEST_TTL = timedelta(days=2)
CALL_DURATION_MINUTES = 15
MAX_DESCRIPTION_LENGTH = 500


def _now():
    return datetime.utcnow()


def _as_naive_utc(value):
    if value is None:
        return None
    if getattr(value, 'tzinfo', None) is not None:
        return datetime.utcfromtimestamp(value.timestamp())
    return value


def _serialize(value):
    if isinstance(value, datetime):
        return value.isoformat() + 'Z'
    if isinstance(value, list):
        return [_serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    return value


def _first_name(profile, fallback_name):
    return (profile.get('firstName') or fallback_name or 'Member').strip().split()[0][:50]


def _parse_availability(availability):
    if not isinstance(availability, list) or not availability:
        raise ValueError('Select at least one availability window for a live call')
    now = _now()
    latest = now + timedelta(days=7)
    normalized = []
    for window in availability[:14]:
        if not isinstance(window, dict):
            raise ValueError('Availability windows are invalid')
        try:
            start = datetime.fromisoformat(str(window.get('start_at', '')).replace('Z', '+00:00')).replace(tzinfo=None)
            end = datetime.fromisoformat(str(window.get('end_at', '')).replace('Z', '+00:00')).replace(tzinfo=None)
        except ValueError as exc:
            raise ValueError('Availability times must be valid ISO dates') from exc
        if start < now or end <= start or end - start < timedelta(minutes=15) or end > latest:
            raise ValueError('Choose a 15-minute window within the next seven days')
        normalized.append({'start_at': start, 'end_at': end})
    return sorted(normalized, key=lambda item: item['start_at'])


def _send(user_id, title, body, data, preference=None, profile=None):
    """Best-effort push; opt-outs do not affect the request transaction."""
    try:
        profile = profile or {}
        if preference and profile.get(preference) is False:
            return
        send_push_to_user(user_id, title, body, data)
    except Exception:
        logger.warning('Prayer-request notification failed for %s', user_id, exc_info=True)


def _request_payload(doc_id, request_data, viewer_id, leader_view=False):
    data = dict(request_data)
    data['id'] = doc_id
    if leader_view:
        return {
            'id': doc_id,
            'status': data.get('status'),
            'requester_first_name': data.get('requester_first_name'),
            'description': data.get('description'),
            'preferred_language': data.get('preferred_language'),
            'wants_live_call': data.get('wants_live_call'),
            'availability': _serialize(data.get('availability', [])),
            'expires_at': _serialize(data.get('expires_at')),
            'created_at': _serialize(data.get('created_at')),
            'prayer_count': data.get('prayer_count', 0),
            'available_to_lead': True,
        }
    if viewer_id not in (data.get('requester_id'), data.get('leader_id')):
        return None
    result = {
        key: value for key, value in data.items()
        if key not in {'requester_id', 'leader_id', 'room_code'}
    }
    if viewer_id == data.get('requester_id'):
        result.pop('leader_first_name', None)
        result['viewer_role'] = 'requester'
    else:
        result['viewer_role'] = 'leader'
    return _serialize(result)


def _get_profile(db, user_id):
    snapshot = db.collection('users').document(user_id).get()
    return snapshot.to_dict() if snapshot.exists else {}


def create_request(db, user, description, preferred_language, wants_live_call, availability):
    if user.get('is_anonymous'):
        raise PermissionError('Sign in is required to request private prayer')
    description = (description or '').strip()
    language = (preferred_language or '').strip().lower()
    if len(description) < 10 or len(description) > MAX_DESCRIPTION_LENGTH:
        raise ValueError('Describe your request in 10 to 500 characters')
    if not language or len(language) > 35:
        raise ValueError('Choose a preferred language')

    parsed_availability = _parse_availability(availability) if wants_live_call else []
    requester_id = user['user_id']
    profile = _get_profile(db, requester_id)
    now = _now()
    request_ref = db.collection(COLLECTION).document()
    data = {
        'requester_id': requester_id,
        'requester_first_name': _first_name(profile, user.get('user_name')),
        'description': description,
        'preferred_language': language,
        'wants_live_call': bool(wants_live_call),
        'availability': parsed_availability,
        'status': 'active',
        'created_at': now,
        'expires_at': now + REQUEST_TTL,
        'leader_id': None,
        'leader_first_name': None,
        'claimed_at': None,
        'scheduled_at': None,
        'room_id': None,
        'room_code': None,
        'prayer_count': 0,
    }
    request_ref.set(data)
    # A request is also the safe, authenticated place to save this preference.
    db.collection('users').document(requester_id).set(
        {'preferred_prayer_language': language}, merge=True
    )

    # Leader status and supported languages are provisioned by trusted staff.
    leaders = db.collection('users').where('is_prayer_leader', '==', True).stream()
    for leader_doc in leaders:
        leader = leader_doc.to_dict() or {}
        languages = [str(item).lower() for item in leader.get('prayer_languages', [])]
        if language in languages:
            _send(
                leader_doc.id,
                'New prayer request',
                'A prayer request is available in a language you serve.',
                {'type': 'private_prayer_request', 'requestId': request_ref.id},
                'notify_prayer_requests',
                leader,
            )
    return _request_payload(request_ref.id, data, requester_id)


def list_for_user(db, user_id):
    profile = _get_profile(db, user_id)
    is_leader = profile.get('is_prayer_leader') is True
    now = _now()
    items = []
    if is_leader:
        languages = [str(item).lower() for item in profile.get('prayer_languages', [])]
        for doc in db.collection(COLLECTION).where('status', '==', 'active').stream():
            data = doc.to_dict() or {}
            if _as_naive_utc(data.get('expires_at')) and _as_naive_utc(data['expires_at']) <= now:
                continue
            if data.get('preferred_language') in languages:
                items.append(_request_payload(doc.id, data, user_id, leader_view=True))
    for doc in db.collection(COLLECTION).where('requester_id', '==', user_id).stream():
        item = _request_payload(doc.id, doc.to_dict() or {}, user_id)
        if item:
            items.append(item)
    for doc in db.collection(COLLECTION).where('leader_id', '==', user_id).stream():
        item = _request_payload(doc.id, doc.to_dict() or {}, user_id)
        if item:
            items.append(item)
    unique = {item['id']: item for item in items}
    return sorted(unique.values(), key=lambda item: item.get('created_at', ''), reverse=True), is_leader


def claim_request(db, request_id, leader, slot_start):
    if leader.get('is_anonymous'):
        raise PermissionError('Sign in is required to lead private prayer')
    leader_profile = _get_profile(db, leader['user_id'])
    if leader_profile.get('is_prayer_leader') is not True:
        raise PermissionError('Prayer leader access is required')
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def claim(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError('Prayer request not found')
        data = snapshot.to_dict() or {}
        now = _now()
        expires_at = _as_naive_utc(data.get('expires_at'))
        if data.get('status') != 'active' or not expires_at or expires_at <= now:
            raise RuntimeError('This prayer request is no longer available')
        if data.get('preferred_language') not in [str(item).lower() for item in leader_profile.get('prayer_languages', [])]:
            raise PermissionError('This request is not in a language you serve')
        scheduled_at = None
        if data.get('wants_live_call'):
            try:
                scheduled_at = datetime.fromisoformat(str(slot_start).replace('Z', '+00:00')).replace(tzinfo=None)
            except ValueError as exc:
                raise ValueError('Choose one of the available times') from exc
            if not any(window['start_at'] == scheduled_at for window in data.get('availability', [])):
                raise ValueError('Choose one of the available times')
        transaction.update(request_ref, {
            'status': 'scheduled' if scheduled_at else 'claimed',
            'leader_id': leader['user_id'],
            'leader_first_name': _first_name(leader_profile, leader.get('user_name')),
            'claimed_at': now,
            'scheduled_at': scheduled_at,
        })
        data.update({
            'status': 'scheduled' if scheduled_at else 'claimed',
            'leader_id': leader['user_id'],
            'leader_first_name': _first_name(leader_profile, leader.get('user_name')),
            'claimed_at': now,
            'scheduled_at': scheduled_at,
        })
        return data

    data = claim(db.transaction())
    _send(
        data['requester_id'],
        'A prayer leader has accepted',
        'A prayer leader is ready to pray with you.',
        {'type': 'private_prayer_request', 'requestId': request_id},
        'notify_prayer_requests',
        _get_profile(db, data['requester_id']),
    )
    return _request_payload(request_id, data, leader['user_id'])


def cancel_request(db, request_id, requester_id):
    """Cancel a request and any generated matched call as one transaction."""
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def cancel(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError('Prayer request not found')
        data = snapshot.to_dict() or {}
        if data.get('requester_id') != requester_id:
            raise PermissionError('Only the requester can cancel this prayer request')
        if data.get('status') == 'cancelled':
            return data, False
        if data.get('status') not in {'active', 'claimed', 'scheduled'}:
            raise RuntimeError('This prayer request can no longer be cancelled')

        now = _now()
        updates = {'status': 'cancelled', 'cancelled_at': now}
        transaction.update(request_ref, updates)
        if data.get('room_id'):
            transaction.update(
                db.collection('prayer_rooms').document(data['room_id']),
                {'is_active': False, 'ended_at': now, 'ended_by': 'requester', 'ended_reason': 'request_cancelled'},
            )
        data.update(updates)
        return data, True

    data, changed = cancel(db.transaction())
    if changed and data.get('leader_id'):
        _send(
            data['leader_id'],
            'Prayer request cancelled',
            'The requester cancelled their private prayer request.',
            {'type': 'private_prayer_request', 'requestId': request_id},
            'notify_prayer_requests',
            _get_profile(db, data['leader_id']),
        )
    return _request_payload(request_id, data, requester_id)


def record_prayer(db, request_id, user_id):
    """Increment the private request's anonymous/count-only prayer total."""
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def increment(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError('Prayer request not found')
        data = snapshot.to_dict() or {}
        if user_id not in (data.get('requester_id'), data.get('leader_id')):
            raise PermissionError('You are not authorized to pray for this request')
        if data.get('status') in {'cancelled', 'expired'}:
            raise RuntimeError('This prayer request is no longer active')
        prayer_count = int(data.get('prayer_count', 0)) + 1
        transaction.update(request_ref, {'prayer_count': prayer_count})
        return prayer_count

    return increment(db.transaction())


def expire_requests(db):
    now = _now()
    expired = 0
    for doc in db.collection(COLLECTION).where('status', '==', 'active').stream():
        data = doc.to_dict() or {}
        if _as_naive_utc(data.get('expires_at')) and _as_naive_utc(data['expires_at']) <= now:
            @firestore.transactional
            def expire(transaction, request_ref):
                snapshot = request_ref.get(transaction=transaction)
                current = snapshot.to_dict() if snapshot.exists else None
                if not current or current.get('status') != 'active':
                    return None
                expires_at = _as_naive_utc(current.get('expires_at'))
                if not expires_at or expires_at > now:
                    return None
                transaction.update(request_ref, {'status': 'expired', 'expired_at': now})
                return current

            expired_request = expire(db.transaction(), doc.reference)
            if not expired_request:
                continue
            _send(
                expired_request['requester_id'],
                'Your prayer request needs your attention',
                'No leader was able to accept it in time. You can submit it again.',
                {'type': 'private_prayer_request', 'requestId': doc.id, 'action': 'resubmit'},
                'notify_prayer_requests',
                _get_profile(db, expired_request['requester_id']),
            )
            expired += 1
    return expired


def open_scheduled_call(db, request_id, user_id):
    """Create the 1:1 voice room only when the booked time is reached."""
    request_ref = db.collection(COLLECTION).document(request_id)

    @firestore.transactional
    def create_room(transaction):
        snapshot = request_ref.get(transaction=transaction)
        if not snapshot.exists:
            raise LookupError('Prayer request not found')
        data = snapshot.to_dict() or {}
        if user_id not in (data.get('requester_id'), data.get('leader_id')):
            raise PermissionError('You are not part of this prayer request')
        if data.get('status') != 'scheduled':
            raise RuntimeError('This request does not have a scheduled call')
        scheduled_at = _as_naive_utc(data.get('scheduled_at'))
        if not scheduled_at or _now() < scheduled_at - timedelta(minutes=10):
            raise RuntimeError('This call is not ready yet')
        if data.get('room_id'):
            return data

        leader_id = data['leader_id']
        leader_profile = _get_profile(db, leader_id)
        leader_name = _first_name(leader_profile, data.get('leader_first_name'))
        room_id = uuid.uuid4().hex[:8].upper()
        room_code = uuid.uuid4().hex[:8].upper()
        room_data = {
            'room_id': room_id,
            'room_name': 'Private prayer call',
            'room_type': 'matched_prayer_call',
            'room_privacy': 'private',
            'room_code': room_code,
            'host_id': leader_id,
            'host_name': leader_name,
            'created_at': _now(),
            'call_started_at': None,
            'call_duration_minutes': CALL_DURATION_MINUTES,
            'media_mode': 'audio_only',
            # Both people are added by the regular join endpoint. Starting
            # empty is important: the voice-link timer must begin only after
            # both have actually joined the media room.
            'participants': [],
            'is_active': True,
            'is_locked': False,
            'settings': {
                'allow_anonymous': False,
                'max_participants': 2,
                'auto_mute_new_participants': False,
            },
            'max_speakers': 2,
            'ended_reason': None,
            'private_prayer_request_id': request_id,
            'participant_ids': [data['requester_id'], leader_id],
        }
        transaction.set(db.collection('prayer_rooms').document(room_id), room_data)
        transaction.update(request_ref, {'room_id': room_id, 'room_code': room_code})
        data.update({'room_id': room_id, 'room_code': room_code})
        return data

    data = create_room(db.transaction())
    return {
        'room_id': data['room_id'],
        'room_code': data['room_code'],
        'duration_minutes': CALL_DURATION_MINUTES,
    }


def send_due_call_reminders(db):
    """Send one-hour and call-start notifications; invoked by Cloud Scheduler."""
    now = _now()
    sent = 0
    for doc in db.collection(COLLECTION).where('status', '==', 'scheduled').stream():
        data = doc.to_dict() or {}
        scheduled_at = _as_naive_utc(data.get('scheduled_at'))
        if not scheduled_at:
            continue
        minutes_until = (scheduled_at - now).total_seconds() / 60
        update = {}
        if 55 <= minutes_until <= 65 and not data.get('reminder_1h_sent_at'):
            update['reminder_1h_sent_at'] = now
            title, body, event = 'Prayer call in one hour', 'Your private prayer call begins in about one hour.', 'reminder'
        elif -2 <= minutes_until <= 2 and not data.get('reminder_live_sent_at'):
            update['reminder_live_sent_at'] = now
            title, body, event = 'Your prayer call is ready', 'Tap to join your private prayer call.', 'call_ready'
        else:
            continue
        doc.reference.update(update)
        for participant_id in (data.get('requester_id'), data.get('leader_id')):
            if participant_id:
                _send(
                    participant_id,
                    title,
                    body,
                    {'type': 'private_prayer_request', 'requestId': doc.id, 'event': event},
                    'session_reminders_enabled',
                    _get_profile(db, participant_id),
                )
        sent += 1
    return sent
