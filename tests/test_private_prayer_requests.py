from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from private_prayer_request_service import _parse_availability
from routes import prayer_room_bp as prayer_room


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
