"""
Verse Context Generator
=======================

Generates an AI-authored "short sermon" for a given Bible verse and persists it
to Firestore keyed by a verse slug (e.g. "1-john-4-11"). The reader experience
in the mobile app pulls this back via ``GET /api/today-verse/context``.

Key design choices
------------------
* **Keyed by verse, not by date.** ``static/bible_verses.json`` is a fixed
  curated rotation (~100 unique verses cycling by day-of-year), so generating
  one context per *unique verse* and caching it indefinitely is dramatically
  cheaper than regenerating per day. Future appearances of the same verse
  reuse the cached doc.
* **Single LLM round-trip.** One JSON-formatted Perplexity call returns
  sermon sections, original-language words, and three verse-specific
  reflection questions. We validate the JSON schema before save.
* **Firestore, not GCS.** Docs are small (<5 KB), keyed lookups are frequent,
  and we want easy admin editing in the Firestore console.
* **Lazy + scheduler-friendly.** ``generate_context()`` returns immediately
  when the doc already exists. The companion scheduler endpoint walks the
  next N days and only generates what's missing, so it's cheap to call
  nightly.

Mirrors the style of :mod:`prayer_generator` and reuses the shared
:func:`perplexity_client.get_perplexity_client` singleton so we don't add a
new model dependency or test query at startup.
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from backend.integrations.firebase_auth import get_firestore_client
from backend.integrations.perplexity_client import get_perplexity_client

logger = logging.getLogger(__name__)


VERSE_CONTEXTS_COLLECTION = "verse_contexts"
SCHEMA_VERSION = 1
DEFAULT_MODEL = "sonar-reasoning-pro"

# Word-count bounds per sermon section (medium depth per the product spec).
SECTION_MIN_WORDS = 50
SECTION_MAX_WORDS = 150

# Bounds on the lists in the response.
ORIGINAL_WORDS_MIN = 2
ORIGINAL_WORDS_MAX = 4
REFLECTION_QUESTIONS_COUNT = 3


def slugify_reference(reference: str) -> str:
    """Turn a verse reference like ``"1 John 4:11"`` into ``"1-john-4-11"``.

    Deterministic and reversible enough for human inspection in the Firestore
    console. We keep digits and ASCII letters; everything else collapses to a
    single dash, then we strip duplicate / trailing dashes.
    """
    if not reference:
        return ""
    s = reference.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


class VerseContextGenerator:
    """Generate, validate, and persist sermon-style context for a single verse."""

    def __init__(self, db=None, client=None, prompt_path: str = "config/verse_context_prompt.txt"):
        self.db = db or get_firestore_client()
        # Reuse the shared LazyPerplexityClient so we don't trigger a test
        # query at import time.
        self.client = client or get_perplexity_client(model=DEFAULT_MODEL)
        self.prompt_path = prompt_path
        self._prompt_template = self._load_prompt_template()

    # ── Prompt loading ────────────────────────────────────────────────────

    def _load_prompt_template(self) -> str:
        try:
            with open(self.prompt_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            logger.warning(
                "Verse context prompt not found at %s, using built-in default",
                self.prompt_path,
            )
            return self._default_prompt_template()

    @staticmethod
    def _default_prompt_template() -> str:
        # Keep in sync with config/verse_context_prompt.txt. The literal braces
        # in the JSON example are doubled so Python's str.format() leaves them
        # alone; only {reference} and {verse_text} interpolate.
        return (
            "You are writing a short Christian devotional sermon for the verse below.\n"
            "Return STRICT JSON only (no prose, no markdown, no code fence).\n\n"
            "Reference: {reference}\n"
            'Verse: "{verse_text}"\n\n'
            "Required JSON schema:\n"
            "{{\n"
            '  "summary": "one-sentence headline (max 22 words)",\n'
            '  "context": "80-130 words on historical, literary, and audience context",\n'
            '  "meaning": "80-130 words on what the verse means in its setting",\n'
            '  "application": "80-130 words on living this out today",\n'
            '  "original_words": [\n'
            "    {{\n"
            '      "word": "original Hebrew or Greek word as it appears in the source language",\n'
            '      "transliteration": "latinized",\n'
            '      "language": "Hebrew" or "Greek",\n'
            '      "appears_as": "the English word or phrase in the verse this maps to",\n'
            '      "gloss": "one sentence on the nuance, range of meaning, and why it matters here"\n'
            "    }}\n"
            "  ],\n"
            '  "reflection_questions": ["...", "...", "..."]\n'
            "}}\n\n"
            "Constraints:\n"
            "- 2 to 4 entries in original_words (Hebrew for OT, Greek for NT, based on the book of the reference).\n"
            '- Exactly 3 reflection_questions, each a single sentence, addressed to "you".\n'
            "- Sermon prose: warm, accessible, Christ-centered; no jargon, no theological camp polemics.\n"
            "- Do NOT cite sources, do NOT include [1] / [2] style footnotes, do NOT add headers.\n"
            "- Output exactly one valid JSON object and nothing else."
        )

    # ── Firestore IO ──────────────────────────────────────────────────────

    def _doc_ref(self, slug: str):
        if not self.db:
            raise RuntimeError("Firestore client unavailable")
        return self.db.collection(VERSE_CONTEXTS_COLLECTION).document(slug)

    def get_cached(self, reference: str) -> Optional[Dict[str, Any]]:
        """Return the stored context for ``reference`` if one exists, else ``None``."""
        slug = slugify_reference(reference)
        if not slug or not self.db:
            return None
        snap = self._doc_ref(slug).get()
        if not snap.exists:
            return None
        return snap.to_dict()

    def _save(self, slug: str, doc: Dict[str, Any]) -> None:
        self._doc_ref(slug).set(doc, merge=False)

    # ── LLM call + parsing ────────────────────────────────────────────────

    def _build_prompt(self, reference: str, verse_text: str) -> str:
        return self._prompt_template.format(
            reference=reference.strip(),
            verse_text=verse_text.strip().replace('"', "'"),
        )

    @staticmethod
    def _strip_to_json(raw: str) -> str:
        """Pull the first JSON object out of a raw LLM response.

        ``sonar-reasoning-pro`` sometimes wraps its answer in ``<think>``
        blocks, fenced code blocks, or a leading sentence. We scan to the
        first ``{`` and back from the last ``}``.
        """
        if not raw:
            return ""
        s = raw.strip()
        # Strip ``<think>...</think>`` blocks if present.
        s = re.sub(r"<think>.*?</think>", "", s, flags=re.DOTALL | re.IGNORECASE)
        # Strip fenced code blocks.
        s = re.sub(r"```[a-zA-Z]*\n?", "", s)
        s = s.replace("```", "")
        start = s.find("{")
        end = s.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return s.strip()
        return s[start : end + 1].strip()

    def _validate(self, payload: Dict[str, Any]) -> None:
        """Raise ``ValueError`` if the payload doesn't satisfy the schema."""
        required = {"summary", "context", "meaning", "application", "original_words", "reflection_questions"}
        missing = required - set(payload.keys())
        if missing:
            raise ValueError(f"Missing required keys: {sorted(missing)}")

        for k in ("summary", "context", "meaning", "application"):
            v = payload.get(k)
            if not isinstance(v, str) or not v.strip():
                raise ValueError(f"'{k}' must be a non-empty string")

        for k in ("context", "meaning", "application"):
            words = len(payload[k].split())
            if words < SECTION_MIN_WORDS or words > SECTION_MAX_WORDS:
                raise ValueError(f"'{k}' has {words} words; expected {SECTION_MIN_WORDS}-{SECTION_MAX_WORDS}")

        words_list = payload.get("original_words")
        if not isinstance(words_list, list) or not (ORIGINAL_WORDS_MIN <= len(words_list) <= ORIGINAL_WORDS_MAX):
            raise ValueError(f"'original_words' must be a list of {ORIGINAL_WORDS_MIN}-{ORIGINAL_WORDS_MAX} entries")
        for i, w in enumerate(words_list):
            if not isinstance(w, dict):
                raise ValueError(f"original_words[{i}] must be an object")
            for key in ("word", "transliteration", "language", "gloss", "appears_as"):
                if not isinstance(w.get(key), str) or not w.get(key, "").strip():
                    raise ValueError(f"original_words[{i}].{key} missing or empty")
            if w["language"].strip().lower() not in ("hebrew", "greek"):
                raise ValueError(f"original_words[{i}].language must be 'Hebrew' or 'Greek'")

        qs = payload.get("reflection_questions")
        if not isinstance(qs, list) or len(qs) != REFLECTION_QUESTIONS_COUNT:
            raise ValueError(f"'reflection_questions' must be a list of exactly {REFLECTION_QUESTIONS_COUNT}")
        for i, q in enumerate(qs):
            if not isinstance(q, str) or not q.strip():
                raise ValueError(f"reflection_questions[{i}] must be a non-empty string")

    def _normalize(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Trim whitespace, dedupe whitespace runs, drop stray citations."""

        def clean(s: str) -> str:
            s = re.sub(r"\[\d+\]", "", s)  # strip [1]-style footnotes
            s = re.sub(r"\s+", " ", s).strip()
            return s

        out = {
            "summary": clean(payload["summary"]),
            "context": clean(payload["context"]),
            "meaning": clean(payload["meaning"]),
            "application": clean(payload["application"]),
            "original_words": [
                {
                    "word": str(w["word"]).strip(),
                    "transliteration": clean(str(w["transliteration"])),
                    "language": clean(str(w["language"])).title(),  # "Hebrew" / "Greek"
                    "appears_as": clean(str(w["appears_as"])),
                    "gloss": clean(str(w["gloss"])),
                }
                for w in payload["original_words"]
            ],
            "reflection_questions": [clean(str(q)) for q in payload["reflection_questions"]],
        }
        return out

    def _call_llm(self, reference: str, verse_text: str, *, max_retries: int = 3) -> Dict[str, Any]:
        system_prompt = (
            "You are a careful, biblically literate devotional writer. "
            "You produce strictly-formatted JSON for downstream rendering. "
            "Never include explanations outside the JSON object."
        )
        last_err: Optional[str] = None
        for attempt in range(1, max_retries + 1):
            user_prompt = self._build_prompt(reference, verse_text)
            if attempt > 1 and last_err:
                user_prompt += f"\n\nPrevious attempt was rejected: {last_err}. Fix it and return only the JSON."

            try:
                raw = self.client.query_with_timeout_and_system(system_prompt, user_prompt, timeout=90.0)
            except Exception as e:
                last_err = f"LLM call failed: {e}"
                logger.warning("verse_context attempt %s LLM error: %s", attempt, e)
                continue

            try:
                json_text = self._strip_to_json(raw or "")
                payload = json.loads(json_text)
            except json.JSONDecodeError as e:
                last_err = f"Invalid JSON ({e})"
                logger.warning("verse_context attempt %s JSON parse error: %s", attempt, e)
                continue

            try:
                self._validate(payload)
                return self._normalize(payload)
            except ValueError as e:
                last_err = str(e)
                logger.warning("verse_context attempt %s validation error: %s", attempt, e)
                continue

        raise RuntimeError(f"verse_context generation failed after {max_retries} attempts: {last_err}")

    # ── Public API ────────────────────────────────────────────────────────

    def generate_context(
        self,
        verse_text: str,
        reference: str,
        *,
        force: bool = False,
    ) -> Dict[str, Any]:
        """Return the context doc for ``reference``, generating if needed.

        Parameters
        ----------
        verse_text:
            The verse body, exactly as stored in ``bible_verses.json``.
        reference:
            Human-readable reference, e.g. ``"1 John 4:11"``. Used to derive
            the slug doc ID.
        force:
            If ``True``, regenerate even if a cached doc exists. Intended
            for admin re-runs after a prompt change.

        Returns
        -------
        dict
            The stored doc shape (see ``_build_doc`` for fields).
        """
        slug = slugify_reference(reference)
        if not slug:
            raise ValueError("reference produces an empty slug")
        if not verse_text or not verse_text.strip():
            raise ValueError("verse_text is required")

        if not force:
            cached = self.get_cached(reference)
            if cached:
                logger.info("verse_context cache hit for %s", slug)
                return cached

        logger.info("verse_context generating for %s", slug)
        body = self._call_llm(reference, verse_text)
        doc = {
            "verse_slug": slug,
            "reference": reference.strip(),
            "verse_text": verse_text.strip(),
            "version": SCHEMA_VERSION,
            "model": getattr(self.client, "model", DEFAULT_MODEL),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            **body,
        }
        self._save(slug, doc)
        logger.info("verse_context saved %s", slug)
        return doc

    def generate_many(
        self,
        verses: List[Dict[str, str]],
        *,
        force: bool = False,
        on_progress=None,
    ) -> Dict[str, Any]:
        """Generate contexts for a list of ``{text, reference}`` dicts.

        Skips any that already exist (unless ``force=True``) so it's safe to
        call repeatedly. ``on_progress(index, total, slug, status)`` is
        invoked after each verse for CLI / scheduler reporting.
        """
        total = len(verses)
        ok, skipped, failed = 0, 0, 0
        errors: List[Dict[str, str]] = []
        for idx, v in enumerate(verses, start=1):
            ref = v.get("reference") or ""
            text = v.get("text") or v.get("verse") or ""
            slug = slugify_reference(ref)
            try:
                if not force and self.get_cached(ref):
                    skipped += 1
                    if on_progress:
                        on_progress(idx, total, slug, "skip")
                    continue
                self.generate_context(text, ref, force=force)
                ok += 1
                if on_progress:
                    on_progress(idx, total, slug, "ok")
            except Exception as e:
                failed += 1
                errors.append({"reference": ref, "slug": slug, "error": str(e)})
                logger.error("verse_context failed for %s: %s", slug, e)
                if on_progress:
                    on_progress(idx, total, slug, "fail")
        return {
            "total": total,
            "generated": ok,
            "skipped": skipped,
            "failed": failed,
            "errors": errors,
        }
