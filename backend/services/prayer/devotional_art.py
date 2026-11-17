"""Minimal plan art: one centered subject, wide paper margin, theme-matched."""

from io import BytesIO

from PIL import Image, ImageDraw

PAPER = (250, 246, 239, 255)
INK = (44, 36, 23, 255)
SIZE = 1080

_GOLD = (176, 125, 32)
_SAGE = (74, 124, 94)
_ROSE = (176, 90, 80)

# First matching keyword wins. The subject stays small and centered.
_MOTIFS = (
    (("peace", "still", "quiet", "rest"), "water", _SAGE),
    (("heal", "restor"), "leaf", _SAGE),
    (("faith", "trust"), "door", _GOLD),
    (("hope", "persev"), "dawn", _GOLD),
    (("gratitud", "worship", "praise"), "cup", _GOLD),
    (("family", "relation", "marriage"), "pair", _ROSE),
    (("purpose", "calling"), "star", _GOLD),
    (("growth", "spirit"), "seed", _SAGE),
    (("grief", "comfort", "lament"), "candle", _ROSE),
    (("kingdom", "prayer", "fire"), "flame", _GOLD),
)


def motif_for_theme(theme: str):
    """Return (motif name, wash color) for a plan theme."""
    text = (theme or "").lower()
    for words, motif, accent in _MOTIFS:
        if any(word in text for word in words):
            return motif, accent
    return "dawn", _GOLD


def _shift(seed: str) -> int:
    total = 0
    for ch in seed or "plan":
        total = (total * 33 + ord(ch)) % 17
    return total - 8


def _line(draw, start, end, width=7):
    draw.line([start, end], fill=INK, width=width)


def _draw_subject(draw, motif, cx, cy):
    if motif == "water":
        _line(draw, (cx - 72, cy - 22), (cx + 72, cy - 22), 6)
        _line(draw, (cx - 48, cy), (cx + 48, cy), 6)
        _line(draw, (cx - 26, cy + 22), (cx + 26, cy + 22), 6)
    elif motif == "leaf":
        draw.ellipse([cx - 26, cy - 72, cx + 26, cy + 72], outline=INK, width=7)
        _line(draw, (cx, cy - 58), (cx, cy + 58), 4)
    elif motif == "door":
        draw.arc([cx - 42, cy - 56, cx + 42, cy + 28], 180, 360, fill=INK, width=7)
        _line(draw, (cx - 42, cy - 14), (cx - 42, cy + 64))
        _line(draw, (cx + 42, cy - 14), (cx + 42, cy + 64))
    elif motif == "cup":
        draw.arc([cx - 40, cy - 16, cx + 40, cy + 64], 0, 180, fill=INK, width=7)
        _line(draw, (cx - 40, cy + 24), (cx - 40, cy - 12))
        _line(draw, (cx + 40, cy + 24), (cx + 40, cy - 12))
    elif motif == "pair":
        draw.ellipse([cx - 58, cy - 28, cx - 2, cy + 28], outline=INK, width=7)
        draw.ellipse([cx + 2, cy - 28, cx + 58, cy + 28], outline=INK, width=7)
    elif motif == "star":
        for dx, dy, length in (
            (0, -1, 48),
            (0, 1, 48),
            (-1, 0, 48),
            (1, 0, 48),
            (-1, -1, 30),
            (1, -1, 30),
            (-1, 1, 30),
            (1, 1, 30),
        ):
            _line(draw, (cx, cy), (cx + dx * length, cy + dy * length), 5)
    elif motif == "seed":
        _line(draw, (cx, cy + 46), (cx, cy - 8))
        draw.ellipse([cx - 24, cy - 52, cx + 2, cy - 6], outline=INK, width=6)
        draw.ellipse([cx - 2, cy - 52, cx + 24, cy - 6], outline=INK, width=6)
        draw.ellipse([cx - 8, cy + 34, cx + 8, cy + 50], outline=INK, width=5)
    elif motif == "candle":
        _line(draw, (cx, cy + 52), (cx, cy - 14))
        draw.ellipse([cx - 14, cy - 50, cx + 14, cy - 10], outline=INK, width=6)
    elif motif == "flame":
        draw.line(
            [
                (cx, cy - 76),
                (cx + 34, cy - 8),
                (cx + 16, cy + 40),
                (cx, cy + 16),
                (cx - 16, cy + 40),
                (cx - 34, cy - 8),
                (cx, cy - 76),
            ],
            fill=INK,
            width=7,
        )
    else:
        _line(draw, (cx - 70, cy + 34), (cx + 70, cy + 34))
        draw.arc([cx - 34, cy - 30, cx + 34, cy + 38], 180, 360, fill=INK, width=7)
        _line(draw, (cx, cy - 16), (cx, cy - 52), 5)
        _line(draw, (cx - 28, cy - 6), (cx - 52, cy - 28), 5)
        _line(draw, (cx + 28, cy - 6), (cx + 52, cy - 28), 5)


def render_devotional_art(theme: str, seed: str = "") -> BytesIO:
    """Square JPEG. The subject sits in the middle; the corners stay paper."""
    motif, accent = motif_for_theme(theme)
    image = Image.new("RGBA", (SIZE, SIZE), PAPER)
    wash = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    wash_draw = ImageDraw.Draw(wash)
    radius = 200
    cx = cy = SIZE // 2
    nudge = _shift(seed)
    wash_draw.ellipse(
        [cx - radius + nudge, cy - radius, cx + radius + nudge, cy + radius],
        fill=(*accent, 40),
    )
    image.alpha_composite(wash)
    _draw_subject(ImageDraw.Draw(image), motif, cx, cy)

    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=90)
    buffer.seek(0)
    return buffer
