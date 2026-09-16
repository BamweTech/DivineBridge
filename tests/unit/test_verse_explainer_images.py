"""Verse explainer share-pack image generation and route validation."""

from io import BytesIO

from PIL import Image

from backend.services.prayer.image_generator import ImageGenerator
from backend.services.verse.verse_themes import pick_verse_theme

PROSE = (
    "Isaiah speaks to people who felt God had gone quiet and invites them "
    "back into a relationship that was never withdrawn. The call is urgent "
    "but not harsh: seek him while he may be found, call on him while he is "
    "near. That nearness is a gift of mercy, not a loophole that closes at "
    "random. The original hearers were exiles learning to trust God again "
    "in a strange land, and the same invitation still stands for anyone "
    "who has drifted and wants to come home today."
)


def _theme():
    return pick_verse_theme(
        "Seek the Lord while he may be found; call upon him while he is near.",
        "Isaiah 55:6",
        "2026-09-16",
    )


def test_explainer_sections_are_the_four_reader_cards():
    assert ImageGenerator.EXPLAINER_SECTIONS == ("verse", "context", "meaning", "application")


def test_unknown_section_raises():
    gen = ImageGenerator()
    try:
        gen.generate_verse_explainer_image(
            section="reflection",
            verse_text="In the beginning was the Word.",
            reference="John 1:1",
            body="",
            theme=_theme(),
        )
    except ValueError as exc:
        assert "Unknown explainer section" in str(exc)
    else:
        raise AssertionError("expected ValueError for an unknown section")


def test_verse_and_context_cards_are_hero_sized_jpegs():
    gen = ImageGenerator()
    theme = _theme()
    verse_buf = gen.generate_verse_explainer_image(
        section="verse",
        verse_text="Seek the Lord while he may be found; call upon him while he is near.",
        reference="Isaiah 55:6",
        body="",
        theme=theme,
    )
    context_buf = gen.generate_verse_explainer_image(
        section="context",
        verse_text="Seek the Lord while he may be found; call upon him while he is near.",
        reference="Isaiah 55:6",
        body=PROSE,
        theme=theme,
    )

    for buf in (verse_buf, context_buf):
        raw = buf.getvalue()
        assert raw[:2] == b"\xff\xd8"
        img = Image.open(BytesIO(raw))
        assert img.size == (ImageGenerator.HERO_WIDTH, ImageGenerator.HERO_HEIGHT)
        assert img.format == "JPEG"
