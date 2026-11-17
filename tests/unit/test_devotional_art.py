"""Minimal devotional plan art stays centered and leaves the corners empty."""

from PIL import Image

from backend.services.prayer.devotional_art import (
    motif_for_theme,
    render_devotional_art,
)

PAPER = (250, 246, 239)


def _open(theme, seed="plan-seed-1"):
    return Image.open(render_devotional_art(theme, seed))


def test_theme_picks_a_matching_subject():
    assert motif_for_theme("Peace & Stillness")[0] == "water"
    assert motif_for_theme("Hope & Perseverance")[0] == "dawn"
    assert motif_for_theme("Family & Relationships")[0] == "pair"
    assert motif_for_theme("Something unnamed")[0] == "dawn"


def _near_paper(pixel):
    return all(abs(channel - paper) <= 3 for channel, paper in zip(pixel, PAPER))


def test_art_is_square_with_empty_corners():
    image = _open("Healing & Restoration")
    assert image.size == (1080, 1080)
    for point in ((12, 12), (1067, 12), (12, 1067), (1067, 1067)):
        assert _near_paper(image.getpixel(point))


def test_subject_sits_in_the_center_and_themes_differ():
    peace = _open("Peace & Stillness", "same-plan")
    hope = _open("Hope & Perseverance", "same-plan")
    assert peace.getpixel((540, 540)) != PAPER
    assert list(peace.getdata()) != list(hope.getdata())
