"""Regression: group/public rooms need room_type for mobile live-feed queries."""

from unittest.mock import MagicMock, patch

import pytest

from backend.api.prayer_room import helpers as pr
from backend.api.prayer_room.lifecycle import ensure_group_prayer_session
from backend.api.prayer_room.subscriptions import backfill_missing_live_feed_room_types


class TestLiveFeedRoomTypeHelpers:
    def test_missing_live_feed_room_type(self):
        assert pr._missing_live_feed_room_type({}) is True
        assert pr._missing_live_feed_room_type({"room_type": None}) is True
        assert pr._missing_live_feed_room_type({"room_type": ""}) is True
        assert pr._missing_live_feed_room_type({"room_type": "prayer"}) is False
        assert pr._missing_live_feed_room_type({"room_type": "voice_link"}) is False
        assert pr._missing_live_feed_room_type(None) is False

    def test_live_feed_room_type_update(self):
        assert pr._live_feed_room_type_update({}) == {"room_type": pr.DEFAULT_ROOM_TYPE}
        assert pr._live_feed_room_type_update({"room_type": "prayer"}) == {}
        assert pr._live_feed_room_type_update({"room_type": "matched_prayer_call"}) == {}


@pytest.fixture
def app():
    from flask import Flask

    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    return flask_app


class TestEnsureGroupSessionRoomType:
    def test_creates_room_with_default_room_type(self, app):
        room_ref = MagicMock()
        existing_query = MagicMock()
        existing_query.stream.return_value = []

        group_snap = MagicMock()
        group_snap.exists = True
        group_snap.to_dict.return_value = {"name": "Morning Prayer"}

        db = MagicMock()
        db.collection.return_value.document.return_value.get.return_value = group_snap
        db.collection.return_value.where.return_value.where.return_value.limit.return_value = existing_query
        db.collection.return_value.document.return_value.set = room_ref.set

        with app.test_request_context(
            "/api/prayer-room/group-session",
            method="POST",
            json={"group_id": "group-1"},
        ):
            with (
                patch("backend.api.prayer_room.lifecycle.get_user_from_session") as get_user,
                patch("backend.api.prayer_room.lifecycle.get_firestore_client", return_value=db),
                patch("backend.api.prayer_room.lifecycle._is_group_member", return_value=True),
                patch("backend.api.prayer_room.lifecycle.send_push_to_group"),
            ):
                get_user.return_value = {"user_id": "host-1", "user_name": "Host"}
                response = ensure_group_prayer_session()

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["success"] is True
        assert payload["reused"] is False

        written = None
        for call in db.collection.return_value.document.return_value.set.call_args_list:
            written = call.args[0]
        assert written is not None
        assert written["room_type"] == pr.DEFAULT_ROOM_TYPE
        assert written["group_id"] == "group-1"

    def test_reused_room_backfills_missing_room_type(self, app):
        existing_doc = MagicMock()
        existing_doc.to_dict.return_value = {
            "room_id": "ROOM01",
            "room_name": "Morning Prayer — Live",
            "room_code": "ABCDEFGH",
            "group_id": "group-1",
            "is_active": True,
        }
        existing_query = MagicMock()
        existing_query.stream.return_value = [existing_doc]

        group_snap = MagicMock()
        group_snap.exists = True
        group_snap.to_dict.return_value = {"name": "Morning Prayer"}

        db = MagicMock()
        db.collection.return_value.document.return_value.get.return_value = group_snap
        db.collection.return_value.where.return_value.where.return_value.limit.return_value = existing_query

        with app.test_request_context(
            "/api/prayer-room/group-session",
            method="POST",
            json={"group_id": "group-1"},
        ):
            with (
                patch("backend.api.prayer_room.lifecycle.get_user_from_session") as get_user,
                patch("backend.api.prayer_room.lifecycle.get_firestore_client", return_value=db),
                patch("backend.api.prayer_room.lifecycle._is_group_member", return_value=True),
            ):
                get_user.return_value = {"user_id": "host-1", "user_name": "Host"}
                response = ensure_group_prayer_session()

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["reused"] is True
        existing_doc.reference.update.assert_called_once_with({"room_type": pr.DEFAULT_ROOM_TYPE})


class TestBackfillMissingLiveFeedRoomTypes:
    def test_backfills_only_rooms_missing_room_type(self):
        missing = MagicMock()
        missing.to_dict.return_value = {"is_active": True, "room_name": "Group Live"}
        typed = MagicMock()
        typed.to_dict.return_value = {"is_active": True, "room_type": "prayer"}
        private = MagicMock()
        private.to_dict.return_value = {"is_active": True, "room_type": "matched_prayer_call"}

        db = MagicMock()
        db.collection.return_value.where.return_value.limit.return_value.stream.return_value = [
            missing,
            typed,
            private,
        ]

        with patch(
            "backend.api.prayer_room.subscriptions.get_firestore_client",
            return_value=db,
        ):
            fixed = backfill_missing_live_feed_room_types(limit=10)

        assert fixed == 1
        missing.reference.update.assert_called_once_with({"room_type": pr.DEFAULT_ROOM_TYPE})
        typed.reference.update.assert_not_called()
        private.reference.update.assert_not_called()
