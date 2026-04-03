"""
Server-side push notification service using Expo Push API.

Sends push notifications to mobile users for group messages,
live prayer room invites, daily prayer reminders, etc.
"""

import logging
import os

logger = logging.getLogger(__name__)

_expo_client = None


def _get_client():
    global _expo_client
    if _expo_client is not None:
        return _expo_client
    try:
        from exponent_server_sdk import PushClient
        _expo_client = PushClient()
        return _expo_client
    except ImportError:
        logger.warning("expo-server-sdk not installed; push notifications disabled")
        return None


def send_push(tokens, title, body, data=None, badge=None):
    """Send a push notification to one or more Expo push tokens.

    Args:
        tokens: A single token string or list of token strings.
        title: Notification title.
        body: Notification body text.
        data: Optional dict of extra data attached to the notification.
        badge: Optional badge count.
    """
    client = _get_client()
    if client is None:
        return

    if isinstance(tokens, str):
        tokens = [tokens]

    # Filter valid Expo push tokens
    tokens = [t for t in tokens if t and t.startswith('ExponentPushToken[')]
    if not tokens:
        return

    try:
        from exponent_server_sdk import PushMessage
        messages = [
            PushMessage(
                to=token,
                title=title,
                body=body,
                data=data or {},
                badge=badge,
                sound='default',
            )
            for token in tokens
        ]
        responses = client.publish_multiple(messages)
        for i, response in enumerate(responses):
            if response.status != 'ok':
                logger.warning(f"Push to {tokens[i]} failed: {response.message}")
    except Exception as e:
        logger.error(f"Push notification error: {e}")


def send_push_to_user(user_id, title, body, data=None):
    """Look up a user's push token from Firestore and send a notification."""
    try:
        from firebase_admin import firestore
        db = firestore.client()
        doc = db.collection('users').document(user_id).get()
        if not doc.exists:
            return
        user_data = doc.to_dict()
        token = user_data.get('pushToken')
        if token:
            send_push(token, title, body, data)
    except Exception as e:
        logger.error(f"Error sending push to user {user_id}: {e}")


def send_push_to_group(group_id, title, body, data=None, exclude_user=None):
    """Send push notification to all members of a prayer group."""
    try:
        from firebase_admin import firestore
        db = firestore.client()
        members_ref = db.collection('group_members').document(group_id).collection('members')
        members = members_ref.stream()

        tokens = []
        for member in members:
            member_data = member.to_dict()
            member_id = member_data.get('userId', member.id)
            if exclude_user and member_id == exclude_user:
                continue
            user_doc = db.collection('users').document(member_id).get()
            if user_doc.exists:
                token = user_doc.to_dict().get('pushToken')
                if token:
                    tokens.append(token)

        if tokens:
            send_push(tokens, title, body, data)
    except Exception as e:
        logger.error(f"Error sending push to group {group_id}: {e}")
