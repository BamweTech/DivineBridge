"""Verse mood themes — Python mirror of mobile/lib/verseThemes.ts.

Keep the two files in lockstep when changing themes or keywords so the
image rendered by the server matches what the mobile hero shows.

The classifier scores the verse body against keyword sets per theme,
nudges with a book-of-origin hint (Psalms -> Joy, Proverbs -> Wisdom,
etc.), and falls back to a day-of-year rotation when there is no signal
so the theme still varies daily.

Colors are stored in PIL-friendly form (hex + alpha) rather than the
rgba() strings used in TS — that's the only intentional divergence.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, List, Tuple, TypedDict

# ─── Types ───────────────────────────────────────────────────────────────────

# Three-stop gradient colors as hex strings; applied diagonally
# (top-left -> bottom-right) at offsets 0, 0.55, 1.
Gradient = Tuple[str, str, str]

# Blob = (hex color, alpha 0-1). Three blobs drift on top of the gradient.
Blob = Tuple[str, float]


class VerseTheme(TypedDict):
    id: str
    label: str
    gradient: Gradient
    base_color: str
    accent: str
    blobs: Tuple[Blob, Blob, Blob]


# ─── Themes ──────────────────────────────────────────────────────────────────

VERSE_THEMES: Dict[str, VerseTheme] = {
    "hope": {
        "id": "hope",
        "label": "Hope",
        "gradient": ("#fff4e0", "#ffd49c", "#ff9a5a"),
        "base_color": "#ffd49c",
        "accent": "#a8460e",
        "blobs": (("#ffba78", 0.34), ("#d97a3a", 0.22), ("#ffdeb2", 0.30)),
    },
    "love": {
        "id": "love",
        "label": "Love",
        "gradient": ("#fff0ec", "#ffc5c0", "#e88378"),
        "base_color": "#ffc5c0",
        "accent": "#9a2920",
        "blobs": (("#e88378", 0.32), ("#c4453d", 0.20), ("#ffc8c1", 0.30)),
    },
    "peace": {
        "id": "peace",
        "label": "Peace",
        "gradient": ("#eef5f0", "#bbd4c7", "#7fa893"),
        "base_color": "#bbd4c7",
        "accent": "#2a4f3d",
        "blobs": (("#7fa893", 0.30), ("#2a4f3d", 0.16), ("#dceae1", 0.30)),
    },
    "strength": {
        "id": "strength",
        "label": "Strength",
        "gradient": ("#fff1d4", "#e6a647", "#8c4a1a"),
        "base_color": "#e6a647",
        "accent": "#5e280b",
        "blobs": (("#e6a647", 0.32), ("#8c4a1a", 0.22), ("#ffe0aa", 0.30)),
    },
    "joy": {
        "id": "joy",
        "label": "Joy",
        "gradient": ("#fffae0", "#ffd762", "#f08a3a"),
        "base_color": "#ffd762",
        "accent": "#964d0c",
        "blobs": (("#ffd762", 0.34), ("#f08a3a", 0.24), ("#fff5c8", 0.32)),
    },
    "wisdom": {
        "id": "wisdom",
        "label": "Wisdom",
        "gradient": ("#f3eff7", "#c8b4d4", "#7e6296"),
        "base_color": "#c8b4d4",
        "accent": "#3e2659",
        "blobs": (("#c8b4d4", 0.32), ("#7e6296", 0.20), ("#f3eff7", 0.30)),
    },
}

THEME_ORDER: List[str] = ["hope", "love", "peace", "strength", "joy", "wisdom"]


# ─── Classifier ──────────────────────────────────────────────────────────────
# Keyword sets per theme. Variants (loved, loves, loving) are listed
# explicitly so we can do clean word-boundary matching without false
# positives like "rest" matching "restoration".

KEYWORDS: Dict[str, List[str]] = {
    "hope": [
        "hope",
        "hopes",
        "hoping",
        "hoped",
        "hopeful",
        "promise",
        "promises",
        "promised",
        "future",
        "plans",
        "await",
        "awaits",
        "expect",
        "expects",
        "restore",
        "restored",
        "restores",
        "restoration",
        "renew",
        "renewed",
        "renews",
        "renewal",
        "mercies",
        "dawn",
        "morning",
        "sunrise",
        "return",
        "returns",
        "new heaven",
        "new earth",
    ],
    "love": [
        "love",
        "loves",
        "loved",
        "loving",
        "lovingkindness",
        "beloved",
        "grace",
        "gracious",
        "mercy",
        "merciful",
        "kindness",
        "kind",
        "compassion",
        "compassionate",
        "tender",
        "tenderness",
        "forgive",
        "forgives",
        "forgiven",
        "forgiveness",
        "embrace",
        "embraced",
    ],
    "peace": [
        "peace",
        "peaceful",
        "rest",
        "restful",
        "rests",
        "still",
        "stillness",
        "quiet",
        "quietness",
        "calm",
        "comfort",
        "comforted",
        "comforter",
        "comforts",
        "refuge",
        "sanctuary",
        "shelter",
        "shepherd",
        "shepherds",
        "pasture",
        "pastures",
        "tranquil",
        "anxious",
        "worry",
    ],
    "strength": [
        "strong",
        "strength",
        "strengthen",
        "strengthens",
        "strengthened",
        "courage",
        "courageous",
        "valiant",
        "mighty",
        "might",
        "fight",
        "fights",
        "fought",
        "overcome",
        "overcomes",
        "overcame",
        "victory",
        "victorious",
        "conquer",
        "conqueror",
        "conquerors",
        "endure",
        "endures",
        "endurance",
        "persevere",
        "perseverance",
        "fortress",
        "rock",
        "shield",
        "defender",
        "fear not",
        "do not fear",
        "do not be afraid",
        "be not afraid",
    ],
    "joy": [
        "joy",
        "joyful",
        "joyous",
        "rejoice",
        "rejoices",
        "rejoicing",
        "sing",
        "sings",
        "song",
        "songs",
        "praise",
        "praises",
        "praising",
        "glad",
        "gladness",
        "celebrate",
        "celebrated",
        "dance",
        "hallelujah",
        "hosanna",
        "exult",
        "exults",
        "glory",
        "glorious",
        "shout",
        "shouts",
        "delight",
        "delights",
        "blessed",
        "blessing",
    ],
    "wisdom": [
        "wisdom",
        "wise",
        "wisely",
        "understanding",
        "understand",
        "understood",
        "knowledge",
        "know",
        "knows",
        "knew",
        "instruct",
        "instructs",
        "instruction",
        "teach",
        "teaches",
        "taught",
        "learn",
        "learns",
        "learned",
        "ponder",
        "ponders",
        "meditate",
        "meditates",
        "meditation",
        "reflect",
        "reflects",
        "consider",
        "considers",
        "lamp",
        "path",
        "paths",
    ],
}


BOOK_HINTS: Dict[str, str] = {
    "psalm": "joy",
    "psalms": "joy",
    "proverbs": "wisdom",
    "ecclesiastes": "wisdom",
    "job": "wisdom",
    "isaiah": "hope",
    "jeremiah": "hope",
    "lamentations": "hope",
    "romans": "love",
    "1 corinthians": "love",
    "2 corinthians": "love",
    "galatians": "love",
    "ephesians": "love",
    "philippians": "joy",
    "colossians": "love",
    "1 john": "love",
    "2 john": "love",
    "3 john": "love",
    "joshua": "strength",
    "judges": "strength",
    "daniel": "strength",
    "1 samuel": "strength",
    "2 samuel": "strength",
    "james": "wisdom",
    "matthew": "peace",
    "mark": "peace",
    "luke": "peace",
    "john": "love",
    "song of solomon": "love",
    "song of songs": "love",
}


_KW_REGEX_CACHE: Dict[str, re.Pattern[str]] = {}


def _keyword_regex(kw: str) -> re.Pattern[str]:
    hit = _KW_REGEX_CACHE.get(kw)
    if hit is not None:
        return hit
    escaped = re.escape(kw)
    # Word-boundary-ish: must be flanked by a non-letter (or string edge).
    # Allows multi-word phrases ("fear not", "do not fear") since the space
    # is a non-letter too.
    pattern = re.compile(f"(^|[^a-z]){escaped}([^a-z]|$)")
    _KW_REGEX_CACHE[kw] = pattern
    return pattern


def _extract_book(reference: str) -> str:
    """Strip the chapter:verse suffix from a reference, returning the book name.

    "John 3:16"          -> "john"
    "1 Corinthians 13:4" -> "1 corinthians"
    "Psalm 23:1-3"       -> "psalm"
    "Song of Songs 2:4"  -> "song of songs"
    """
    m = re.match(r"^(.*?)\s+\d+(?::\d+)?", reference)
    book = (m.group(1) if m and m.group(1) else reference).strip().lower()
    return book


def _day_of_year(iso_date: str) -> int:
    try:
        d = datetime.strptime(iso_date, "%Y-%m-%d")
    except ValueError:
        return 0
    return d.timetuple().tm_yday


def pick_verse_theme(text: str | None, reference: str | None, iso_date: str) -> VerseTheme:
    """Return the best-matching theme for the given verse.

    Mirrors mobile/lib/verseThemes.ts:pickVerseTheme exactly so the
    server-rendered image matches the in-app hero.
    """
    lower = (text or "").lower()
    book = _extract_book(reference or "")

    if not lower and not book:
        # No content (skeleton state on client side); rotate by day so
        # placeholders also vary.
        idx = _day_of_year(iso_date) % len(THEME_ORDER)
        return VERSE_THEMES[THEME_ORDER[idx]]

    scores: Dict[str, int] = {tid: 0 for tid in THEME_ORDER}
    for tid in THEME_ORDER:
        for kw in KEYWORDS[tid]:
            matches = _keyword_regex(kw).findall(lower)
            if matches:
                scores[tid] += len(matches)

    hint = BOOK_HINTS.get(book)
    if hint:
        scores[hint] += 1

    best_id: str | None = None
    best_score = 0
    for tid in THEME_ORDER:
        if scores[tid] > best_score:
            best_score = scores[tid]
            best_id = tid

    if best_id is None:
        idx = _day_of_year(iso_date) % len(THEME_ORDER)
        return VERSE_THEMES[THEME_ORDER[idx]]

    return VERSE_THEMES[best_id]
