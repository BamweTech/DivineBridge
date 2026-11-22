from datetime import datetime
from unittest.mock import MagicMock

import pytest

from backend.services.prayer import bible_verse_lookup
from backend.services.prayer import personal_prayer_service as saved
from backend.services.prayer.prayer_generator import PrayerGenerator


def test_personal_prayer_returns_text_without_touching_storage():
    generator = PrayerGenerator.__new__(PrayerGenerator)
    generator.client = MagicMock()
    generator.client.query.return_value = """<think>draft</think>
VERSES:
Isaiah 41:10 | Fear not, for I am with you.
Psalm 23:1 | The Lord is my shepherd.
Joshua 1:9 | Be strong and courageous.
John 3:16 | For God so loved the world.
PRAYER:
Heavenly Father, grant peace. Amen.
"""
    generator.storage = MagicMock()

    result = generator.generate_personal_prayer("peace before a hard conversation", "Psalm 23")

    assert result["content"].startswith("Heavenly Father")
    assert "Amen" in result["content"]
    assert "<think>" not in result["content"]
    assert result["references"] == ["Isaiah 41:10", "Psalm 23:1", "Joshua 1:9"]
    assert generator.client.query.call_count == 1
    generator.storage.save_prayer.assert_not_called()
    generator.storage.get_prayer.assert_not_called()


def test_personal_prayer_still_returns_when_no_verse_is_found():
    generator = PrayerGenerator.__new__(PrayerGenerator)
    generator.client = MagicMock()
    generator.client.query.return_value = "Heavenly Father, grant peace. Amen."
    generator.storage = MagicMock()

    result = generator.generate_personal_prayer("peace before a hard conversation")

    assert result["content"].startswith("Heavenly Father")
    assert result["references"] == []


def test_bible_lookup_accepts_any_short_reference_and_loads_the_wording(monkeypatch):
    bible_verse_lookup._cache.clear()
    calls = []

    def fake_get(url, params, timeout, headers):
        calls.append((url, params))
        response = MagicMock()
        response.status_code = 200
        if "Solomon" in url:
            response.json.return_value = {
                "reference": "Song of Solomon 2:1",
                "text": "I am a rose of Sharon,\n  a lily of the valleys.",
            }
        else:
            response.json.return_value = {
                "reference": "Psalm 119:105-107",
                "text": "Your word is a lamp to my feet.",
            }
        return response

    monkeypatch.setattr(bible_verse_lookup.requests, "get", fake_get)

    verses = bible_verse_lookup.lookup_bible_verses(
        [
            "Song of Solomon 2:1",
            "Psalm 119:105-107",
            "Psalm 119:105-110",
            "Genesis",
            "Song of Solomon 2:1",
        ]
    )

    assert verses == [
        {
            "text": "I am a rose of Sharon, a lily of the valleys.",
            "reference": "Song of Solomon 2:1",
            "translation": "WEB",
        },
        {
            "text": "Your word is a lamp to my feet.",
            "reference": "Psalm 119:105-107",
            "translation": "WEB",
        },
    ]
    assert [params for _url, params in calls] == [{"translation": "web"}, {"translation": "web"}]
    assert all("105-110" not in url and "Genesis" not in url for url, _params in calls)


class _Snapshot:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self.exists = data is not None
        self._data = data

    def to_dict(self):
        return None if self._data is None else dict(self._data)


class _Reference:
    def __init__(self, collection, doc_id):
        self.collection = collection
        self.id = doc_id

    def set(self, data):
        self.collection.documents[self.id] = dict(data)

    def get(self):
        return _Snapshot(self.id, self.collection.documents.get(self.id))

    def delete(self):
        self.collection.documents.pop(self.id, None)


class _Query:
    def __init__(self, collection, user_id):
        self.collection = collection
        self.user_id = user_id

    def stream(self):
        for doc_id, data in self.collection.documents.items():
            if data.get("user_id") == self.user_id:
                yield _Snapshot(doc_id, data)


class _Collection:
    def __init__(self):
        self.documents = {}
        self._next = 0

    def document(self, doc_id=None):
        if doc_id is None:
            self._next += 1
            doc_id = f"prayer-{self._next}"
        return _Reference(self, doc_id)

    def where(self, _field, _op, user_id):
        return _Query(self, user_id)


class _Database:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        self.collections.setdefault(name, _Collection())
        return self.collections[name]


def test_saved_personal_prayers_belong_to_one_person_and_can_be_deleted():
    db = _Database()
    older = saved.save_personal_prayer(
        db,
        "jean",
        "peace",
        "Psalm 23",
        "Heavenly Father, grant peace. Amen.",
        [{"text": "The Lord is my shepherd.", "reference": "Psalm 23:1", "translation": "WEB"}],
    )
    older_ref = db.collection(saved.COLLECTION).document(older["id"])
    older_ref.set({**older_ref.get().to_dict(), "created_at": datetime(2026, 11, 20, 12, 0)})
    newer = saved.save_personal_prayer(db, "jean", "hope", "", "Heavenly Father, give hope. Amen.")
    newer_ref = db.collection(saved.COLLECTION).document(newer["id"])
    newer_ref.set({**newer_ref.get().to_dict(), "created_at": datetime(2026, 11, 21, 12, 0)})
    saved.save_personal_prayer(db, "aline", "rest", "", "Heavenly Father, give rest. Amen.")

    listed = saved.list_personal_prayers(db, "jean")

    assert [item["topic"] for item in listed] == ["hope", "peace"]
    assert listed[1]["verses"] == [
        {"text": "The Lord is my shepherd.", "reference": "Psalm 23:1", "translation": "WEB"}
    ]
    assert listed[0]["content"].startswith("Heavenly Father")
    assert "created_at" in listed[0]

    saved.delete_personal_prayer(db, "jean", newer["id"])
    assert [item["id"] for item in saved.list_personal_prayers(db, "jean")] == [older["id"]]
    with pytest.raises(LookupError):
        saved.delete_personal_prayer(db, "aline", older["id"])
    with pytest.raises(LookupError):
        saved.delete_personal_prayer(db, "jean", "missing")
