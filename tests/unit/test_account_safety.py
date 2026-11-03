"""Account deletion and content-report routes."""

from unittest.mock import MagicMock, patch

import pytest
from google.api_core.exceptions import NotFound


@pytest.fixture
def client():
    from flask import Flask

    from backend.api.auth_bp import auth_bp
    from backend.core.extensions import limiter

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
    app.config["RATELIMIT_ENABLED"] = False
    limiter.init_app(app)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    return app.test_client()


def _user(uid="user-1"):
    return {
        "user_id": uid,
        "user_name": "Ada",
        "name": "Ada",
        "email": "ada@example.com",
    }


def test_delete_account_requires_auth(client):
    response = client.post("/api/auth/delete-account", json={})

    assert response.status_code == 401
    assert response.get_json()["error"] == "Authentication required"


def test_delete_account_rejects_another_uid(client):
    with patch("backend.core.auth.helpers.get_user_from_session", return_value=_user("user-1")):
        with patch("backend.api.auth_bp.delete_user") as delete_user:
            response = client.post("/api/auth/delete-account", json={"uid": "someone-else"})

    assert response.status_code == 403
    assert response.get_json()["error"] == "You can only delete your own account"
    delete_user.assert_not_called()


def test_delete_account_success_ignores_missing_photos(client):
    user_ref = MagicMock()
    user_ref.get.return_value = MagicMock(exists=True)
    db = MagicMock()
    db.collection.return_value.document.return_value = user_ref

    missing_blob = MagicMock()
    missing_blob.delete.side_effect = NotFound("already gone")
    bucket = MagicMock()
    bucket.list_blobs.return_value = [missing_blob]

    with patch("backend.core.auth.helpers.get_user_from_session", return_value=_user("user-1")):
        with patch("backend.api.auth_bp.get_firestore_client", return_value=db):
            with patch("firebase_admin.storage.bucket", return_value=bucket):
                with patch("backend.api.auth_bp.delete_user", return_value=True) as delete_user:
                    response = client.post("/api/auth/delete-account", json={"user_id": "user-1"})

    assert response.status_code == 200
    assert response.get_json()["success"] is True
    delete_user.assert_called_once_with("user-1")
    user_ref.delete.assert_called_once()
    missing_blob.delete.assert_called_once()
    db.collection.assert_called_with("users")
    db.collection.return_value.document.assert_called_with("user-1")


def test_content_report_uses_authenticated_reporter(client):
    report_ref = MagicMock()
    report_ref.id = "report-1"
    reports = MagicMock()
    reports.add.return_value = (None, report_ref)
    db = MagicMock()
    db.collection.return_value = reports

    with patch("backend.core.auth.helpers.get_user_from_session", return_value=_user("reporter-1")):
        with patch("backend.api.auth_bp.get_firestore_client", return_value=db):
            response = client.post(
                "/api/auth/content-reports",
                json={
                    "reporter_uid": "forged-user",
                    "target_user_id": "author-2",
                    "content_type": "group_message",
                    "content_id": "message-9",
                    "reason": "spam",
                },
            )

    assert response.status_code == 201
    stored = reports.add.call_args.args[0]
    assert stored["reporter_uid"] == "reporter-1"
    assert stored["target_user_id"] == "author-2"
    assert stored["content_type"] == "group_message"
    assert stored["content_id"] == "message-9"
    assert response.get_json()["data"]["id"] == "report-1"
