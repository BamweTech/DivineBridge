from unittest.mock import MagicMock

from backend.services.prayer.prayer_generator import PrayerGenerator


def test_personal_prayer_returns_text_without_touching_storage():
    generator = PrayerGenerator.__new__(PrayerGenerator)
    generator.client = MagicMock()
    generator.client.query.return_value = "<think>draft</think>\nHeavenly Father, grant peace. Amen."
    generator.storage = MagicMock()

    text = generator.generate_personal_prayer("peace before a hard conversation", "Psalm 23")

    assert text.startswith("Heavenly Father")
    assert "Amen" in text
    assert "<think>" not in text
    generator.storage.save_prayer.assert_not_called()
    generator.storage.get_prayer.assert_not_called()
