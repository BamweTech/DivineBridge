"""Load real public-domain verse text for references the prayer generator names.

bible-api.com needs no key. It serves the World English Bible and other
public-domain translations for any book, chapter, and verse. Calls stay small:
at most three short passages per prayer, and successful lookups are cached in
this process.
"""

import logging
import re
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)

BIBLE_API_URL = "https://bible-api.com/"
TRANSLATION = "web"
TRANSLATION_LABEL = "WEB"
MAX_VERSES = 3
MAX_SPAN = 3

_REFERENCE = re.compile(
    r"^(?:[1-3]\s+)?[A-Za-z][A-Za-z.'’-]{0,22}(?:\s+[A-Za-z][A-Za-z.'’-]{0,22}){0,3}\s+\d{1,3}:\d{1,3}(?:\s*-\s*\d{1,3})?$"
)
_cache = {}


def normalize_reference(value):
    """Keep a single verse or a passage of at most three verses. Anything else is dropped."""
    line = re.sub(r"\s+", " ", str(value or "").strip())
    line = line.split("|", 1)[0].strip().strip("\"'*")
    if not line or line.upper() == "NONE" or not _REFERENCE.match(line):
        return None
    span = re.search(r":(\d+)\s*-\s*(\d+)$", line)
    if span:
        start, end = int(span.group(1)), int(span.group(2))
        if end < start or end - start + 1 > MAX_SPAN:
            return None
    return line


def lookup_bible_verses(references):
    """Return up to three verses whose wording comes from the Bible API."""
    found = []
    seen = set()
    for raw in references or []:
        reference = normalize_reference(raw)
        if not reference:
            continue
        key = reference.casefold()
        if key in seen:
            continue
        seen.add(key)
        verse = _cache.get(key)
        if verse is None:
            verse = _fetch(reference)
            if verse:
                _cache[key] = verse
        if verse:
            found.append(dict(verse))
        if len(found) == MAX_VERSES:
            break
    return found


def _fetch(reference):
    url = BIBLE_API_URL + quote(reference, safe="")
    try:
        response = requests.get(
            url,
            params={"translation": TRANSLATION},
            timeout=4,
            headers={"Accept": "application/json", "User-Agent": "DivineBridge personal prayer"},
        )
    except requests.RequestException as exc:
        logger.warning("Bible verse lookup failed for %s: %s", reference, exc)
        return None
    if response.status_code != 200:
        logger.info("Bible verse lookup missed %s (%s)", reference, response.status_code)
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    text = " ".join(str(payload.get("text") or "").split())
    resolved = " ".join(str(payload.get("reference") or reference).split())
    if len(text) < 8 or not resolved:
        return None
    return {"text": text, "reference": resolved, "translation": TRANSLATION_LABEL}
