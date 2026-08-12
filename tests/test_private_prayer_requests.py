from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

import private_prayer_request_service as private_requests
from private_prayer_request_service import _parse_availability
from routes import prayer_room_bp as prayer_room


def test_serializes_timezone_aware_timestamps_as_valid_iso_utc():
    timestamp = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)

    assert private_requests._serialize(timestamp) == '2026-08-12T12:00:00Z'


class _FakeDocument:
    def __init__(self, data, doc_id='request-1'):
        self.data = data
        self.id = doc_id
        self.exists = data is not None
        self.reference = self

    def get(self, transaction=None):
        return self

    def to_dict(self):
        return dict(self.data) if self.data is not None else None


class _FakeCollection:
    def __init__(self, documents):
        self.documents = documents

    def document(self, doc_id):
        return self.documents[doc_id]

    def where(self, *_args):
        return self

    def stream(self):
        return self.documents.values()


class _FakeTransaction:
    def update(self, reference, updates):
        reference.data.update(updates)


class _FakeDb:
    def __init__(self, collections):
        self.collections = collections

    def collection(self, name):
        return self.collections[name]

    def transaction(self):
        return _FakeTransaction()


def test_availability_accepts_future_fifteen_minute_window():
    start = datetime.utcnow() + timedelta(hours=2)
    windows = _parse_availability([
        {
            'start_at': start.isoformat() + 'Z',
            'end_at': (start + timedelta(minutes=30)).isoformat() + 'Z',
        }
    ])

    assert len(windows) == 1
    assert windows[0]['end_at'] - windows[0]['start_at'] == timedelta(minutes=30)


def test_availability_rejects_windows_outside_next_week():
    start = datetime.utcnow() + timedelta(days=8)

    with pytest.raises(ValueError, match='next seven days'):
        _parse_availability([
            {
                'start_at': start.isoformat() + 'Z',
                'end_at': (start + timedelta(minutes=30)).isoformat() + 'Z',
            }
        ])


def test_notifies_only_eligible_leaders_of_private_request_changes():
    english_leader = _FakeDocument(
        {'is_prayer_leader': True, 'prayer_languages': ['english']},
        doc_id='english-leader',
    )
    french_leader = _FakeDocument(
        {'is_prayer_leader': True, 'prayer_languages': ['french']},
        doc_id='french-leader',
    )
    db = _FakeDb({'users': _FakeCollection({
        'english-leader': english_leader,
        'french-leader': french_leader,
    })})

    with patch.object(private_requests, '_send') as send:
        private_requests._notify_eligible_leaders(
            db,
            'request-1',
            {'preferred_language': 'english', 'status': 'cancelled'},
            'Prayer request cancelled',
            'This request is no longer available in your inbox.',
            'cancelled',
        )

    assert send.call_count == 1
    assert send.call_args.args[0] == 'english-leader'
    assert send.call_args.args[3]['event'] == 'cancelled'


def test_private_prayer_call_uses_fifteen_minute_timer():
    now = datetime.utcnow()
    room = {'room_type': 'matched_prayer_call', 'call_duration_minutes': 15}
    participants = [
        {'user_id': 'leader', 'is_active': True},
        {'user_id': 'requester', 'is_active': True},
    ]

    expires_at, _ = prayer_room._voice_link_timer_start_if_needed(room, participants, now=now)

    assert expires_at == now + timedelta(minutes=15)


@patch('routes.prayer_room_bp.get_firestore_client')
@patch('routes.prayer_room_bp.get_user_from_session')
def test_private_call_details_hide_join_code_and_request_link(mock_user, mock_db):
    from flask import Flask

    app = Flask(__name__)
    mock_user.return_value = {'user_id': 'requester'}
    room_ref = MagicMock()
    room_doc = MagicMock()
    room_doc.exists = True
    room_doc.to_dict.return_value = {
        'room_type': 'matched_prayer_call',
        'participant_ids': ['requester', 'leader'],
        'room_code': 'SECRET',
        'private_prayer_request_id': 'request-1',
        'participants': [],
        'created_at': datetime.utcnow(),
    }
    room_ref.get.return_value = room_doc
    mock_db.return_value.collection.return_value.document.return_value = room_ref

    with app.test_request_context():
        result = prayer_room.get_room_details('ROOM01')
        payload = result.get_json()

    assert result.status_code == 200
    assert 'room_code' not in payload['room']
    assert 'private_prayer_request_id' not in payload['room']


@patch('routes.prayer_room_bp.get_firestore_client')
@patch('routes.prayer_room_bp.get_user_from_session')
def test_unmatched_user_cannot_join_private_prayer_call(mock_user, mock_db):
    from flask import Flask

    app = Flask(__name__)
    mock_user.return_value = {'user_id': 'outsider', 'user_name': 'Outsider', 'is_anonymous': False}
    room_ref = MagicMock()
    room_doc = MagicMock()
    room_doc.exists = True
    room_doc.to_dict.return_value = {
        'room_type': 'matched_prayer_call',
        'participant_ids': ['requester', 'leader'],
        'room_code': 'SECRET',
        'is_active': True,
        'is_locked': False,
        'participants': [],
    }
    room_ref.get.return_value = room_doc
    mock_db.return_value.collection.return_value.document.return_value = room_ref

    with app.test_request_context(json={'room_code': 'SECRET'}):
        result = prayer_room.join_prayer_room('ROOM01')

    assert result[1] == 403
    room_ref.update.assert_not_called()


def test_requester_cancellation_ends_created_private_call():
    request = _FakeDocument({
        'requester_id': 'requester',
        'leader_id': 'leader',
        'status': 'scheduled',
        'room_id': 'room-1',
    })
    room = _FakeDocument({'is_active': True}, doc_id='room-1')
    db = _FakeDb({
        private_requests.COLLECTION: _FakeCollection({'request-1': request}),
        'prayer_rooms': _FakeCollection({'room-1': room}),
        'users': _FakeCollection({'leader': _FakeDocument({})}),
    })

    with patch.object(private_requests.firestore, 'transactional', new=lambda fn: fn), \
         patch.object(private_requests, '_send'):
        result = private_requests.cancel_request(db, 'request-1', 'requester')

    assert result['status'] == 'cancelled'
    assert request.data['status'] == 'cancelled'
    assert room.data['is_active'] is False


def test_private_prayer_count_requires_authorized_participant():
    request = _FakeDocument({
        'requester_id': 'requester',
        'leader_id': 'leader',
        'status': 'claimed',
        'prayer_count': 2,
    })
    db = _FakeDb({private_requests.COLLECTION: _FakeCollection({'request-1': request})})

    with patch.object(private_requests.firestore, 'transactional', new=lambda fn: fn):
        assert private_requests.record_prayer(db, 'request-1', 'leader') == 3
        with pytest.raises(PermissionError):
            private_requests.record_prayer(db, 'request-1', 'outsider')
