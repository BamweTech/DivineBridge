"""prayer_room media routes."""
from backend.api.prayer_room._blueprint import prayer_room_bp
from flask import jsonify
import logging
import os
from backend.services.media.sfu_regions import get_sfu_url_for_room
from backend.api.prayer_room.helpers import (
    _is_room_participant,
    _is_voice_link_expired,
    _is_voice_link_room,
    _reject_anonymous_outside_voice_link,
    find_participant,
    get_firestore_client,
    get_user_from_session,
)


@prayer_room_bp.route("/ice-config", methods=["GET"])
def get_ice_config():
    """Return optimized ICE/TURN server configuration for WebRTC.
    Provides multiple STUN servers and TURN servers (UDP/TCP) for maximum reliability.
    Reads TURN settings from environment variables if present; otherwise returns STUN-only.
    Env vars supported:
      TURN_URLS (comma-separated), TURN_USERNAME, TURN_PASSWORD
      STUN_URLS (optional, comma-separated)
    """
    try:
        # Defaults: multiple public Google STUN servers for redundancy
        stun_urls = os.getenv(
            "STUN_URLS", "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302"
        ).split(",")
        turn_urls_env = os.getenv("TURN_URLS", "")
        turn_username = os.getenv("TURN_USERNAME")
        turn_password = os.getenv("TURN_PASSWORD")

        ice_servers = []

        # Add STUN servers first (for NAT discovery)
        for url in stun_urls:
            url = url.strip()
            if url:
                ice_servers.append({"urls": url})

        # Handle TURN URLs - enhance with multiple transport options
        if turn_urls_env and turn_username and turn_password:
            # Parse base TURN URL (e.g., "turn:35.192.126.89:3478")
            base_urls = [url.strip() for url in turn_urls_env.split(",") if url.strip()]

            for base_url in base_urls:
                # Extract host and port from TURN URL
                # Format: turn:host:port or turn:host:port?transport=udp
                if base_url.startswith("turn:"):
                    # Remove 'turn:' prefix
                    url_part = base_url[5:]

                    # Remove any existing transport parameter
                    if "?" in url_part:
                        url_part = url_part.split("?")[0]

                    # Add TURN server with UDP transport (preferred for low latency)
                    ice_servers.append(
                        {
                            "urls": f"turn:{url_part}?transport=udp",
                            "username": turn_username,
                            "credential": turn_password,
                        }
                    )

                    # Add TURN server with TCP transport (fallback for restrictive firewalls)
                    ice_servers.append(
                        {
                            "urls": f"turn:{url_part}?transport=tcp",
                            "username": turn_username,
                            "credential": turn_password,
                        }
                    )

                    # Also add without transport specifier (browser will choose)
                    ice_servers.append(
                        {"urls": f"turn:{url_part}", "username": turn_username, "credential": turn_password}
                    )
        elif turn_urls_env:
            # TURN URLs without credentials (e.g., Twilio format or unauthenticated)
            for url in turn_urls_env.split(","):
                url = url.strip()
                if url:
                    ice_servers.append({"urls": url})

        # If no servers were configured at all, provide a fallback
        if not ice_servers:
            ice_servers = [{"urls": "stun:stun.l.google.com:19302"}, {"urls": "stun:stun1.l.google.com:19302"}]

        logging.info(
            f"Generated ICE Servers. Count: {len(ice_servers)} (STUN: {len([s for s in ice_servers if 'stun:' in s.get('urls', '')])}, TURN: {len([s for s in ice_servers if 'turn:' in s.get('urls', '')])})"
        )
        return jsonify({"iceServers": ice_servers})

    except Exception as e:
        logging.error(f"Error generating ICE config: {str(e)}", exc_info=True)
        # Safe fallback to STUN-only
        fallback_servers = [{"urls": "stun:stun.l.google.com:19302"}, {"urls": "stun:stun1.l.google.com:19302"}]
        return jsonify({"iceServers": fallback_servers}), 200


@prayer_room_bp.route("/sfu-token/<room_id>", methods=["POST"])
def get_sfu_token(room_id):
    """Issue a Firebase Custom Token for the SFU WebSocket server.

    Why Firebase Custom Token instead of a shared JWT secret:
      - Firebase rotates signing keys automatically — zero ops overhead
      - No secret to share, store, or rotate across services
      - The SFU verifies it directly against Firebase's public JWKS
      - roomId is embedded as a custom claim so the SFU can enforce room access

    Flow:
      1. Client calls this endpoint → gets a Firebase custom token
      2. Client calls Firebase Auth signInWithCustomToken() → gets a Firebase ID token
      3. Client presents the ID token to the SFU WebSocket on join
      4. SFU calls firebase_admin.auth().verify_id_token() — no shared secret needed
    """
    try:
        import firebase_admin.auth as fa

        user = get_user_from_session()
        if not user:
            return jsonify({"error": "Authentication required"}), 401

        user_id = user["user_id"]
        user_name = user.get("display_name") or user.get("name") or "Anonymous"

        db = get_firestore_client()
        room_doc = db.collection("prayer_rooms").document(room_id).get()
        if not room_doc.exists:
            return jsonify({"error": "Room not found"}), 404
        room_data = room_doc.to_dict() or {}

        anon_reject = _reject_anonymous_outside_voice_link(user, room_data)
        if anon_reject:
            return anon_reject

        if _is_voice_link_room(room_data):
            err, code = _voice_link_room_access_checks(room_data, user_id)
            if err:
                return jsonify({"error": err}), code
            participant = find_participant(room_data.get("participants", []), user_id)
            if participant and participant.get("user_name"):
                user_name = participant.get("user_name")

        # Embed roomId + userName as custom claims so the SFU can read them
        # without a separate DB lookup.
        custom_token = fa.create_custom_token(
            user_id,
            developer_claims={
                "roomId": room_id,
                "userName": user_name,
            },
        )

        # custom_token is bytes from firebase-admin, decode to string
        if isinstance(custom_token, bytes):
            custom_token = custom_token.decode("utf-8")

        # Use per-room SFU URL for voice_link (multi-region); default for other rooms.
        sfu_url = get_sfu_url_for_room(room_data)

        return jsonify({"customToken": custom_token, "sfuUrl": sfu_url})

    except Exception as e:
        logging.error(f"SFU token error: {e}", exc_info=True)
        return jsonify({"error": "Failed to generate SFU token"}), 500


def _voice_link_room_access_checks(room_data, user_id):
    """Shared guards for voice_link join/sfu-token."""
    if not room_data.get("is_active", False):
        return "Room is not active", 400
    if _is_voice_link_expired(room_data):
        return "This call has expired", 400
    if not _is_room_participant(room_data, user_id):
        return "You are not a participant in this call", 403
    return None, None
