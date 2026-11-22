"""Saved personal prayers. These are separate from today's global prayer."""

from datetime import datetime

COLLECTION = "personal_prayers"


def _iso(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def _clean_verses(value):
    if not isinstance(value, list):
        return []
    verses = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        reference = str(item.get("reference") or "").strip()
        translation = str(item.get("translation") or "").strip()
        if text and reference:
            verse = {"text": text, "reference": reference}
            if translation:
                verse["translation"] = translation[:40]
            verses.append(verse)
        if len(verses) == 3:
            break
    return verses


def _payload(doc_id, data):
    return {
        "id": doc_id,
        "topic": data.get("topic") or "",
        "scripture": data.get("scripture") or "",
        "verses": _clean_verses(data.get("verses")),
        "content": data.get("content") or "",
        "created_at": _iso(data.get("created_at")),
    }


def save_personal_prayer(db, user_id, topic, scripture, content, verses=None):
    """Store one generated prayer for this person. The text is not editable later."""
    now = datetime.utcnow()
    ref = db.collection(COLLECTION).document()
    data = {
        "user_id": user_id,
        "topic": topic,
        "scripture": scripture or "",
        "verses": _clean_verses(verses or []),
        "content": content,
        "created_at": now,
    }
    ref.set(data)
    return _payload(ref.id, data)


def list_personal_prayers(db, user_id):
    """Newest saved prayers for this person."""
    items = []
    for doc in db.collection(COLLECTION).where("user_id", "==", user_id).stream():
        data = doc.to_dict() or {}
        if data.get("user_id") != user_id:
            continue
        items.append(_payload(doc.id, data))
    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return items


def delete_personal_prayer(db, user_id, prayer_id):
    """Remove one saved prayer. Someone else's prayer is treated as missing."""
    ref = db.collection(COLLECTION).document(prayer_id)
    snapshot = ref.get()
    if not snapshot.exists:
        raise LookupError("Prayer not found")
    data = snapshot.to_dict() or {}
    if data.get("user_id") != user_id:
        raise LookupError("Prayer not found")
    ref.delete()
