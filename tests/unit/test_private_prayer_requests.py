from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from backend.services.prayer.private_prayer_request_service import _parse_availability
import backend.services.prayer.private_prayer_request_service as private_requests
from backend.api.prayer_room import helpers as pr
from backend.api.prayer_room.lifecycle import join_prayer_room, leave_prayer_room
from backend.api.prayer_room.rooms import end_room, get_room_details
from backend.api.prayer_room.voice_link import (
    create_voice_link_room,
    voice_link_participant_disconnected,
)

pr.join_prayer_room = join_prayer_room
pr.leave_prayer_room = leave_prayer_room
pr.end_room = end_room
pr.get_room_details = get_room_details
pr.create_voice_link_room = create_voice_link_room
pr.voice_link_participant_disconnected = voice_link_participant_disconnected
prayer_room = pr


def test_serializes_timezone_aware_timestamps_as_valid_iso_utc():
    timestamp = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)

    assert private_requests._serialize(timestamp) == "2026-08-12T12:00:00Z"


class _FakeDocument:
    def __init__(self, data, doc_id="request-1"):
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
    windows = _parse_availability(
        [
            {
                "start_at": start.isoformat() + "Z",
                "end_at": (start + timedelta(minutes=30)).isoformat() + "Z",
            }
        ]
    )

    assert len(windows) == 1
    assert windows[0]["end_at"] - windows[0]["start_at"] == timedelta(minutes=30)


def test_availability_rejects_windows_outside_next_week():
    start = datetime.utcnow() + timedelta(days=8)

    with pytest.raises(ValueError, match="next seven days"):
        _parse_availability(
            [
                {
                    "start_at": start.isoformat() + "Z",
                    "end_at": (start + timedelta(minutes=30)).isoformat() + "Z",
                }
            ]
        )


def test_notifies_only_eligible_leaders_of_private_request_changes():
    wednesday_evening = {
        "timezone": "UTC",
        "slots": [{"weekday": "wed", "start_minute": 18 * 60, "end_minute": 20 * 60}],
    }
    english_leader = _FakeDocument(
        {"is_prayer_leader": True, "prayer_languages": ["english"], "prayer_availability": wednesday_evening},
        doc_id="english-leader",
    )
    busy_leader = _FakeDocument(
        {
            "is_prayer_leader": True,
            "prayer_languages": ["english"],
            "prayer_availability": {
                "timezone": "UTC",
                "slots": [{"weekday": "wed", "start_minute": 19 * 60, "end_minute": 20 * 60}],
            },
        },
        doc_id="busy-leader",
    )
    french_leader = _FakeDocument(
        {"is_prayer_leader": True, "prayer_languages": ["french"], "prayer_availability": wednesday_evening},
        doc_id="french-leader",
    )
    db = _FakeDb(
        {
            "users": _FakeCollection(
                {
                    "english-leader": english_leader,
                    "busy-leader": busy_leader,
                    "french-leader": french_leader,
                }
            )
        }
    )

    with patch.object(private_requests, "_send") as send:
        private_requests._notify_eligible_leaders(
            db,
            "request-1",
            {
                "preferred_language": "english",
                "status": "cancelled",
                "preferred_at": datetime(2026, 11, 18, 18, 15),
            },
            "Prayer request cancelled",
            "This request is no longer available in your inbox.",
            "cancelled",
        )

    assert send.call_count == 1
    assert send.call_args.args[0] == "english-leader"
    assert send.call_args.args[3]["event"] == "cancelled"


def test_private_prayer_call_uses_fifteen_minute_timer():
    now = datetime.utcnow()
    room = {"room_type": "matched_prayer_call", "call_duration_minutes": 15}
    participants = [
        {"user_id": "leader", "is_active": True},
        {"user_id": "requester", "is_active": True},
    ]

    expires_at, _ = prayer_room._voice_link_timer_start_if_needed(room, participants, now=now)

    assert expires_at == now + timedelta(minutes=15)


@patch("backend.api.prayer_room.helpers.get_rtdb_client")
def test_prayer_room_chat_mirror_uses_message_id_as_rtdb_key(mock_rtdb_client):
    rtdb = MagicMock()
    mock_rtdb_client.return_value = rtdb

    prayer_room._mirror_chat_message_to_rtdb(
        "room-1",
        "message-1",
        "user-1",
        "Member",
        "Hello",
    )

    rtdb.reference.assert_called_once_with("/rooms/room-1/chat/message-1")
    rtdb.reference.return_value.set.assert_called_once()


@patch("backend.api.prayer_room.rooms.get_firestore_client")
@patch("backend.api.prayer_room.rooms.get_user_from_session")
def test_private_call_details_hide_join_code_and_request_link(mock_user, mock_db):
    from flask import Flask

    app = Flask(__name__)
    mock_user.return_value = {"user_id": "requester"}
    room_ref = MagicMock()
    room_doc = MagicMock()
    room_doc.exists = True
    room_doc.to_dict.return_value = {
        "room_type": "matched_prayer_call",
        "participant_ids": ["requester", "leader"],
        "room_code": "SECRET",
        "private_prayer_request_id": "request-1",
        "participants": [],
        "created_at": datetime.utcnow(),
    }
    room_ref.get.return_value = room_doc
    mock_db.return_value.collection.return_value.document.return_value = room_ref

    with app.test_request_context():
        result = prayer_room.get_room_details("ROOM01")
        payload = result.get_json()

    assert result.status_code == 200
    assert "room_code" not in payload["room"]
    assert "private_prayer_request_id" not in payload["room"]


@patch("backend.api.prayer_room.lifecycle.get_firestore_client")
@patch("backend.api.prayer_room.lifecycle.get_user_from_session")
def test_unmatched_user_cannot_join_private_prayer_call(mock_user, mock_db):
    from flask import Flask

    app = Flask(__name__)
    mock_user.return_value = {"user_id": "outsider", "user_name": "Outsider", "is_anonymous": False}
    room_ref = MagicMock()
    room_doc = MagicMock()
    room_doc.exists = True
    room_doc.to_dict.return_value = {
        "room_type": "matched_prayer_call",
        "participant_ids": ["requester", "leader"],
        "room_code": "SECRET",
        "is_active": True,
        "is_locked": False,
        "participants": [],
    }
    room_ref.get.return_value = room_doc
    mock_db.return_value.collection.return_value.document.return_value = room_ref

    with app.test_request_context(json={"room_code": "SECRET"}):
        result = prayer_room.join_prayer_room("ROOM01")

    assert result[1] == 403
    room_ref.update.assert_not_called()


def test_requester_cancellation_ends_created_private_call():
    request = _FakeDocument(
        {
            "requester_id": "requester",
            "leader_id": "leader",
            "status": "scheduled",
            "room_id": "room-1",
        }
    )
    room = _FakeDocument({"is_active": True}, doc_id="room-1")
    db = _FakeDb(
        {
            private_requests.COLLECTION: _FakeCollection({"request-1": request}),
            "prayer_rooms": _FakeCollection({"room-1": room}),
            "users": _FakeCollection({"leader": _FakeDocument({})}),
        }
    )

    with patch.object(private_requests.firestore, "transactional", new=lambda fn: fn), patch.object(
        private_requests, "_send"
    ):
        result = private_requests.cancel_request(db, "request-1", "requester")

    assert result["status"] == "cancelled"
    assert request.data["status"] == "cancelled"
    assert room.data["is_active"] is False


def test_private_prayer_count_requires_authorized_participant():
    request = _FakeDocument(
        {
            "requester_id": "requester",
            "leader_id": "leader",
            "status": "claimed",
            "prayer_count": 2,
        }
    )
    db = _FakeDb({private_requests.COLLECTION: _FakeCollection({"request-1": request})})

    with patch.object(private_requests.firestore, "transactional", new=lambda fn: fn):
        assert private_requests.record_prayer(db, "request-1", "leader") == 3
        with pytest.raises(PermissionError):
            private_requests.record_prayer(db, "request-1", "outsider")


def test_preferred_at_accepts_a_time_in_the_next_week():
    when = datetime.utcnow() + timedelta(hours=3)

    parsed = private_requests._parse_preferred_at(when.replace(tzinfo=timezone.utc).isoformat())

    assert parsed.hour == when.hour


def test_preferred_at_rejects_a_past_time():
    when = datetime.utcnow() - timedelta(hours=1)

    with pytest.raises(ValueError):
        private_requests._parse_preferred_at(when.isoformat())


class _SettableDocument(_FakeDocument):
    def set(self, data, merge=False):
        if merge and self.data:
            merged = dict(self.data)
            merged.update(data)
            self.data = merged
        else:
            self.data = dict(data)
        self.exists = True


class _MutableCollection(_FakeCollection):
    def document(self, doc_id):
        if doc_id not in self.documents:
            self.documents[doc_id] = _SettableDocument(None, doc_id)
        return self.documents[doc_id]


def test_warrior_application_stays_pending_until_an_admin_enrolls_the_person():
    users = _MutableCollection({"member": _SettableDocument({"firstName": "Aline"}, "member")})
    applications = _MutableCollection({})
    db = _FakeDb({"users": users, "prayer_warrior_applications": applications})
    user = {"user_id": "member", "user_name": "Aline", "is_anonymous": False}

    assert private_requests.get_warrior_application(db, "member")["status"] == "none"
    result = private_requests.submit_warrior_application(
        db,
        user,
        ["Spanish", "spanish", "Kirundi"],
        "I can pray with people in Spanish and Kirundi.",
        "Grace Chapel",
        {
            "timezone": "America/Chicago",
            "slots": [
                {"weekday": "wed", "start_minute": 9 * 60, "end_minute": 11 * 60},
                {"weekday": "wed", "start_minute": 18 * 60, "end_minute": 20 * 60},
                {"weekday": "wed", "start_minute": 18 * 60, "end_minute": 20 * 60},
            ],
        },
    )

    assert result["status"] == "pending"
    assert result["languages"] == ["spanish", "kirundi"]
    assert result["church"] == "Grace Chapel"
    assert result["availability"]["slots"] == [
        {"weekday": "wed", "start_minute": 9 * 60, "end_minute": 11 * 60},
        {"weekday": "wed", "start_minute": 18 * 60, "end_minute": 20 * 60},
    ]
    stored = applications.documents["member"].data
    assert stored["status"] == "pending"
    assert stored["church"] == "Grace Chapel"
    assert users.documents["member"].data["prayer_availability"]["timezone"] == "America/Chicago"
    assert users.documents["member"].data["firstName"] == "Aline"
    assert "is_prayer_leader" not in users.documents["member"].data


def test_warrior_range_must_end_later_the_same_day():
    with pytest.raises(ValueError, match="later the same day"):
        private_requests._parse_warrior_availability(
            {
                "timezone": "UTC",
                "slots": [{"weekday": "wed", "start_minute": 4 * 60, "end_minute": 3 * 60}],
            }
        )


def test_warrior_availability_uses_the_warrior_local_time():
    # 00:15 UTC on Thursday is 18:15 Wednesday in Chicago during standard time.
    when = datetime(2026, 11, 19, 0, 15)
    profile = {
        "prayer_availability": {
            "timezone": "America/Chicago",
            "slots": [
                {"weekday": "wed", "start_minute": 9 * 60, "end_minute": 11 * 60},
                {"weekday": "wed", "start_minute": 18 * 60, "end_minute": 20 * 60},
            ],
        }
    }

    assert private_requests._available_for_call(profile, when) is True
    assert private_requests._available_for_call(profile, when.replace(hour=2, minute=0)) is False
    assert private_requests._available_for_call({}, when) is False


def test_allowlisted_admin_is_marked_and_can_accept_or_decline():
    users = _MutableCollection(
        {
            "admin": _SettableDocument({"email": "dev@bamwe.com"}, "admin"),
            "applicant": _SettableDocument({"firstName": "Aline"}, "applicant"),
            "other": _SettableDocument({"firstName": "No"}, "other"),
        }
    )
    applications = _MutableCollection(
        {
            "applicant": _SettableDocument(
                {
                    "status": "pending",
                    "first_name": "Aline",
                    "languages": ["spanish"],
                    "note": "I can pray on Wednesday evenings.",
                    "church": "Grace Chapel",
                    "availability": {
                        "timezone": "America/Chicago",
                        "slots": [{"weekday": "wed", "start_minute": 18 * 60, "end_minute": 20 * 60}],
                    },
                    "submitted_at": datetime(2026, 11, 19, 12, 0),
                },
                "applicant",
            ),
            "other": _SettableDocument({"status": "declined", "languages": ["english"]}, "other"),
        }
    )
    db = _FakeDb({"users": users, "prayer_warrior_applications": applications})

    assert private_requests.is_platform_admin({"email": " Kubjca@gmail.com "}) is True
    assert private_requests.is_platform_admin({"email": "person@example.com"}) is False
    assert private_requests.mark_platform_admin(db, {"user_id": "admin", "email": "dev@bamwe.com"}) is True
    assert users.documents["admin"].data["is_admin"] is True

    pending = private_requests.list_pending_warrior_applications(db)
    assert [item["user_id"] for item in pending] == ["applicant"]
    assert pending[0]["church"] == "Grace Chapel"

    declined = private_requests.review_warrior_application(db, "admin", "applicant", "decline")
    assert declined["status"] == "declined"
    assert "is_prayer_leader" not in users.documents["applicant"].data

    applications.documents["applicant"].data["status"] = "pending"
    accepted = private_requests.review_warrior_application(db, "admin", "applicant", "accept")
    assert accepted["status"] == "enrolled"
    assert users.documents["applicant"].data["is_prayer_leader"] is True
    assert users.documents["applicant"].data["prayer_languages"] == ["spanish"]
    assert users.documents["applicant"].data["firstName"] == "Aline"

    with pytest.raises(ValueError, match="already been reviewed"):
        private_requests.review_warrior_application(db, "admin", "applicant", "accept")
    with pytest.raises(ValueError, match="Application not found"):
        private_requests.review_warrior_application(db, "admin", "missing", "decline")


def test_enrolled_warrior_cannot_apply_again():
    db = _FakeDb(
        {
            "users": _MutableCollection(
                {"leader": _SettableDocument({"is_prayer_leader": True, "prayer_languages": ["english"]}, "leader")}
            ),
            "prayer_warrior_applications": _MutableCollection({}),
        }
    )

    status = private_requests.get_warrior_application(db, "leader")
    assert status["status"] == "enrolled"
    with pytest.raises(RuntimeError):
        private_requests.submit_warrior_application(
            db,
            {"user_id": "leader", "user_name": "Leader"},
            ["english"],
            "I already serve as a prayer warrior.",
        )
