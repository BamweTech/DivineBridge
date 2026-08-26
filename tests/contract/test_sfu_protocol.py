"""SFU protocol parity across media-server, mobile, and browser clients."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "contracts" / "sfu-protocol.json").read_text())


def _read(rel: str) -> str:
    return (ROOT / rel).read_text()


def test_media_server_protocol_exports_match_fixture():
    protocol_js = _read("media-server/src/protocol.js")
    for action in FIXTURE["actions"]:
        assert f"'{action}'" in protocol_js
    for event in FIXTURE["events"]:
        assert f"'{event}'" in protocol_js
    assert f"GROUP_CALL_MAX_PARTICIPANTS = {FIXTURE['thresholds']['groupCallMaxParticipants']}" in protocol_js
    assert f"GROUP_CALL: '{FIXTURE['roomModes']['GROUP_CALL']}'" in protocol_js
    assert f"PRAYER_ROOM: '{FIXTURE['roomModes']['PRAYER_ROOM']}'" in protocol_js


def test_mobile_room_mode_thresholds_match_fixture():
    constants = _read("mobile/lib/constants.ts")
    assert (
        f"GROUP_CALL: '{FIXTURE['roomModes']['GROUP_CALL']}'" in constants
        or f'GROUP_CALL: "{FIXTURE["roomModes"]["GROUP_CALL"]}"' in constants
    )
    assert (
        f"PRAYER_ROOM: '{FIXTURE['roomModes']['PRAYER_ROOM']}'" in constants
        or f'PRAYER_ROOM: "{FIXTURE["roomModes"]["PRAYER_ROOM"]}"' in constants
    )
    assert f"GROUP_CALL_MAX_PARTICIPANTS = {FIXTURE['thresholds']['groupCallMaxParticipants']}" in constants
    assert f"PRAYER_ROOM_MAX_SPEAKERS = {FIXTURE['thresholds']['prayerRoomMaxSpeakers']}" in constants
    assert "ACTIVE_SPEAKER_MAX_CONNECTIONS = " f"{FIXTURE['thresholds']['activeSpeakerMaxConnections']}" in constants


def test_clients_reference_core_sfu_actions():
    """Web and mobile clients must request the core SFU actions from the fixture."""
    required = {
        "join",
        "setRtpCapabilities",
        "createTransport",
        "connectTransport",
        "produce",
        "readyToConsume",
        "resumeConsumer",
        "ping",
    }
    web = _read("web/static/js/sfu-client.js")
    mobile = _read("mobile/lib/sfu.ts")
    for action in required:
        assert action in FIXTURE["actions"]
        pattern = re.compile(rf"['\"]{re.escape(action)}['\"]")
        assert pattern.search(web), f"web client missing action {action}"
        assert pattern.search(mobile), f"mobile client missing action {action}"


def test_clients_handle_core_sfu_events():
    required = {
        "peerJoined",
        "peerLeft",
        "newConsumer",
        "consumerClosed",
        "activeSpeakers",
    }
    web = _read("web/static/js/sfu-client.js")
    mobile = _read("mobile/lib/sfu.ts")
    for event in required:
        assert event in FIXTURE["events"]
        pattern = re.compile(rf"['\"]{re.escape(event)}['\"]")
        assert pattern.search(web), f"web client missing event {event}"
        assert pattern.search(mobile), f"mobile client missing event {event}"
