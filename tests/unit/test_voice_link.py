"""Tests for voice link (1:1 shareable call) helpers and end-room authorization."""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

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


@pytest.fixture
def app():
    from flask import Flask

    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


class TestVoiceLinkHelpers:
    def test_is_voice_link_room(self):
        assert pr._is_voice_link_room({"room_type": "voice_link"}) is True
        assert pr._is_voice_link_room({"room_type": "prayer"}) is False
        assert pr._is_voice_link_room(None) is False

    def test_is_voice_link_expired(self):
        past = datetime.utcnow() - timedelta(minutes=1)
        future = datetime.utcnow() + timedelta(minutes=5)
        assert pr._is_voice_link_expired({"room_type": "voice_link", "expires_at": past}) is True
        assert pr._is_voice_link_expired({"room_type": "voice_link", "expires_at": future}) is False
        assert pr._is_voice_link_expired({"room_type": "voice_link"}) is False
        assert pr._is_voice_link_expired({"room_type": "group"}) is False

        from datetime import timezone

        aware_future = datetime.now(timezone.utc) + timedelta(minutes=5)
        assert pr._is_voice_link_expired({"room_type": "voice_link", "expires_at": aware_future}) is False

    def test_voice_link_timer_starts_on_second_participant(self):
        now = datetime.utcnow()
        room = {"room_type": "voice_link", "expires_at": None}
        host_only = [{"user_id": "host1", "is_active": True}]
        expires_at, fields = pr._voice_link_timer_start_if_needed(room, host_only, now=now)
        assert expires_at is None
        assert fields == {}

        both = [
            {"user_id": "host1", "is_active": True},
            {"user_id": "guest1", "is_active": True},
        ]
        expires_at, fields = pr._voice_link_timer_start_if_needed(room, both, now=now)
        assert expires_at == now + timedelta(minutes=pr.VOICE_LINK_TTL_MINUTES)
        assert fields["expires_at"] == expires_at
        assert fields["call_started_at"] == now

        already_started = {"room_type": "voice_link", "expires_at": now + timedelta(minutes=5)}
        expires_at, fields = pr._voice_link_timer_start_if_needed(already_started, both, now=now)
        assert expires_at is None
        assert fields == {}

    def test_active_participant_count(self):
        participants = [
            {"user_id": "a", "is_active": True},
            {"user_id": "b", "is_active": False},
            {"user_id": "c"},
        ]
        assert pr._active_participant_count(participants) == 2

    def test_is_room_participant(self):
        room = {"participants": [{"user_id": "u1", "is_active": True}]}
        assert pr._is_room_participant(room, "u1") is True
        assert pr._is_room_participant(room, "u2") is False

    def test_voice_link_code_matches(self):
        room = {"room_code": "ABCD1234"}
        assert pr._voice_link_code_matches(room, "abcd1234") is True
        assert pr._voice_link_code_matches(room, "WRONG") is False
        assert pr._voice_link_code_matches(room, "") is False

    def test_is_anonymous_user(self):
        assert pr._is_anonymous_user({"is_anonymous": True}) is True
        assert pr._is_anonymous_user({"is_anonymous": False}) is False
        assert pr._is_anonymous_user(None) is False


class TestAnonymousVoiceLinkAccess:
    @patch("backend.api.prayer_room.lifecycle.get_firestore_client")
    @patch("backend.api.prayer_room.lifecycle.get_user_from_session")
    def test_anonymous_cannot_join_non_voice_link(self, mock_user, mock_db, app):
        mock_user.return_value = {
            "user_id": "anon1",
            "user_name": "Guest",
            "is_anonymous": True,
        }

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "prayer",
            "room_privacy": "public",
            "host_id": "host1",
            "is_active": True,
            "participants": [],
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={}):
            result = pr.join_prayer_room("ROOM01")
            assert result[1] == 403
        room_ref.update.assert_not_called()

    @patch("backend.api.prayer_room.lifecycle.get_firestore_client")
    @patch("backend.api.prayer_room.lifecycle.get_user_from_session")
    def test_guest_join_starts_voice_link_timer(self, mock_user, mock_db, app):
        mock_user.return_value = {
            "user_id": "guest1",
            "user_name": "Guest",
            "is_anonymous": True,
        }

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "room_privacy": "private",
            "room_code": "GOODCODE",
            "host_id": "host1",
            "is_active": True,
            "expires_at": None,
            "participants": [{"user_id": "host1", "is_active": True, "role": "speaker", "is_host": True}],
            "max_speakers": 2,
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={"room_code": "GOODCODE"}):
            result = pr.join_prayer_room("ROOM01")
            status = result[1] if isinstance(result, tuple) else result.status_code
            assert status == 200

        update_args = room_ref.update.call_args[0][0]
        assert update_args.get("expires_at") is not None
        assert update_args.get("call_started_at") is not None
        assert len(update_args["participants"]) == 2

    @patch("backend.api.prayer_room.lifecycle.get_firestore_client")
    @patch("backend.api.prayer_room.lifecycle.get_user_from_session")
    def test_anonymous_voice_link_defaults_guest_name(self, mock_user, mock_db, app):
        mock_user.return_value = {
            "user_id": "anon1",
            "user_name": "Anonymous",
            "is_anonymous": True,
        }

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "room_privacy": "private",
            "room_code": "GOODCODE",
            "host_id": "host1",
            "is_active": True,
            "expires_at": datetime.utcnow() + timedelta(minutes=5),
            "participants": [{"user_id": "host1", "is_active": True, "role": "speaker"}],
            "max_speakers": 2,
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={"room_code": "GOODCODE"}):
            result = pr.join_prayer_room("ROOM01")
            status = result[1] if isinstance(result, tuple) else result.status_code
            assert status == 200
        update_args = room_ref.update.call_args[0][0]
        guest = update_args["participants"][-1]
        assert guest["user_name"] == "Guest"

    @patch("backend.api.prayer_room.lifecycle.get_firestore_client")
    @patch("backend.api.prayer_room.lifecycle.get_user_from_session")
    def test_anonymous_rejected_with_invalid_voice_link_code(self, mock_user, mock_db, app):
        mock_user.return_value = {
            "user_id": "anon1",
            "user_name": "Guest",
            "is_anonymous": True,
        }

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "room_privacy": "private",
            "room_code": "GOODCODE",
            "host_id": "host1",
            "is_active": True,
            "expires_at": datetime.utcnow() + timedelta(minutes=5),
            "participants": [{"user_id": "host1", "is_active": True}],
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={"room_code": "BADCODE", "display_name": "Alex"}):
            result = pr.join_prayer_room("ROOM01")
            assert result[1] == 403
        room_ref.update.assert_not_called()


class TestVoiceLinkCreate:
    @patch("backend.api.prayer_room.voice_link.get_firestore_client")
    @patch("backend.api.prayer_room.voice_link.get_user_from_session")
    def test_create_stores_regional_sfu_for_eu_timezone(self, mock_user, mock_db, app):
        mock_user.return_value = {
            "user_id": "host1",
            "user_name": "Jean",
            "is_anonymous": False,
        }
        mock_db.return_value.collection.return_value.document.return_value.set = MagicMock()

        with app.test_request_context(
            json={"timezone": "Europe/Paris"},
            headers={"CF-IPCountry": "US"},
        ):
            result = pr.create_voice_link_room()
            status = result[1] if isinstance(result, tuple) else result.status_code
            assert status == 200

        room_data = mock_db.return_value.collection.return_value.document.return_value.set.call_args[0][0]
        assert room_data["sfu_region"] == "eu"
        assert "sfu-eu" in room_data["sfu_url"]


class TestGuestJoinSfuMigration:
    @patch("backend.api.prayer_room.lifecycle.get_firestore_client")
    @patch("backend.api.prayer_room.lifecycle.get_user_from_session")
    def test_eu_guest_migrates_us_host_room(self, mock_user, mock_db, app):
        mock_user.return_value = {
            "user_id": "guest1",
            "user_name": "Guest",
            "is_anonymous": True,
        }

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "room_privacy": "private",
            "room_code": "GOODCODE",
            "host_id": "host1",
            "is_active": True,
            "expires_at": None,
            "sfu_region": "us",
            "sfu_url": "wss://sfu.divinebridge.io/ws",
            "participants": [{"user_id": "host1", "is_active": True, "role": "speaker", "is_host": True}],
            "max_speakers": 2,
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(
            json={"room_code": "GOODCODE", "timezone": "Europe/Paris"},
            headers={"CF-IPCountry": "FR"},
        ):
            result = pr.join_prayer_room("ROOM01")
            status = result[1] if isinstance(result, tuple) else result.status_code
            assert status == 200

        update_args = room_ref.update.call_args[0][0]
        assert update_args["sfu_region"] == "eu"
        assert "sfu-eu" in update_args["sfu_url"]
        assert update_args["sfu_selected_by"] == "pair_optimal"


class TestVoiceLinkParticipantDisconnected:
    @patch("backend.api.prayer_room.voice_link.get_firestore_client")
    @patch("backend.api.prayer_room.voice_link.get_user_from_session")
    def test_host_can_deactivate_guest(self, mock_user, mock_db, app):
        mock_user.return_value = {"user_id": "host1", "user_name": "Host"}

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "host_id": "host1",
            "participants": [
                {"user_id": "host1", "is_active": True, "is_host": True},
                {"user_id": "guest1", "is_active": True, "is_host": False, "user_name": "Guest"},
            ],
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={"user_id": "guest1"}):
            result = pr.voice_link_participant_disconnected("ROOM01")
            status = result[1] if isinstance(result, tuple) else result.status_code
            assert status == 200

        update_args = room_ref.update.call_args[0][0]
        guest = next(p for p in update_args["participants"] if p["user_id"] == "guest1")
        assert guest["is_active"] is False
        assert guest["reason_archived"] == "media_disconnected"

    @patch("backend.api.prayer_room.voice_link.get_firestore_client")
    @patch("backend.api.prayer_room.voice_link.get_user_from_session")
    def test_guest_cannot_deactivate_participant(self, mock_user, mock_db, app):
        mock_user.return_value = {"user_id": "guest1", "user_name": "Guest"}

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "host_id": "host1",
            "participants": [
                {"user_id": "host1", "is_active": True},
                {"user_id": "guest1", "is_active": True},
            ],
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={"user_id": "guest1"}):
            result = pr.voice_link_participant_disconnected("ROOM01")
            assert result[1] == 403
        room_ref.update.assert_not_called()


class TestEndRoomVoiceLink:
    @patch("backend.api.prayer_room.rooms.get_firestore_client")
    @patch("backend.api.prayer_room.rooms.get_user_from_session")
    def test_either_participant_can_end_voice_link(self, mock_user, mock_db, app):
        mock_user.return_value = {"user_id": "guest1", "user_name": "Guest"}

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "voice_link",
            "host_id": "host1",
            "participants": [
                {"user_id": "host1", "is_active": True},
                {"user_id": "guest1", "is_active": True},
            ],
            "is_active": True,
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={"ended_reason": "user"}):
            pr.end_room("ROOM01")

        room_ref.update.assert_called_once()
        update_args = room_ref.update.call_args[0][0]
        assert update_args["is_active"] is False
        assert update_args["ended_reason"] == "user"
        assert update_args["ended_by"] == "guest1"

    @patch("backend.api.prayer_room.rooms.get_firestore_client")
    @patch("backend.api.prayer_room.rooms.get_user_from_session")
    def test_non_host_cannot_end_regular_room(self, mock_user, mock_db, app):
        mock_user.return_value = {"user_id": "guest1", "user_name": "Guest"}

        room_ref = MagicMock()
        room_snap = MagicMock()
        room_snap.exists = True
        room_snap.to_dict.return_value = {
            "room_type": "prayer",
            "host_id": "host1",
            "participants": [{"user_id": "guest1", "is_active": True}],
        }
        room_ref.get.return_value = room_snap
        mock_db.return_value.collection.return_value.document.return_value = room_ref

        with app.test_request_context(json={}):
            result = pr.end_room("ROOM01")
            assert result[1] == 403
        room_ref.update.assert_not_called()
