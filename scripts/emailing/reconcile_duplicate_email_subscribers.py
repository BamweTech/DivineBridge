"""Preview or suppress duplicate opted-in Firestore subscriber profiles."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from firebase_admin import firestore
from backend.integrations.firebase_auth import initialize_firebase


def normalized(email):
    return str(email or '').strip().lower()


def reconcile(apply=False):
    if not initialize_firebase():
        raise RuntimeError('Firebase Admin initialization failed')
    db = firestore.client()
    groups = {}
    for doc in db.collection('users').where('email_subscribed', '==', True).stream():
        data = doc.to_dict() or {}
        email = normalized(data.get('email'))
        if email:
            groups.setdefault(email, []).append((doc, data))

    duplicates = 0
    for email, profiles in groups.items():
        if len(profiles) < 2:
            continue
        duplicates += len(profiles) - 1
        profiles.sort(key=lambda item: str(item[1].get('email_subscribed_at', '')), reverse=True)
        for doc, _ in profiles[1:]:
            if apply:
                doc.reference.set({
                    'email_subscribed': False,
                    'duplicate_email_of': profiles[0][0].id,
                }, merge=True)
        print(f'{email}: retained {profiles[0][0].id}, suppressed {len(profiles) - 1}')
    print(f'{"Suppressed" if apply else "Would suppress"} {duplicates} duplicate subscriber profiles.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    reconcile(parser.parse_args().apply)
