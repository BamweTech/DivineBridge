/**
 * Verse mood themes.
 *
 * Six archetypes cover the major moods that show up in daily-verse rotations:
 *   - Hope     (promise, restoration, dawn)
 *   - Love     (grace, mercy, compassion)
 *   - Peace    (stillness, rest, shepherd)
 *   - Strength (courage, fear not, perseverance)
 *   - Joy      (praise, rejoice, celebration)
 *   - Wisdom   (instruction, light, path)
 *
 * `pickVerseTheme(text, reference, isoDate)` scores the verse body against
 * keyword sets, adds a small bump for books with a strong thematic tradition
 * (Psalms -> Joy, Proverbs -> Wisdom, ...), and falls back to a day-of-year
 * rotation when there is no clear signal. This guarantees:
 *
 *   1. Verses with a clear mood land on a matching color theme.
 *   2. Ambiguous / unknown verses still vary day-to-day instead of being
 *      stuck on one default.
 *
 * Each theme exposes a 3-stop diagonal gradient (top-left -> bottom-right)
 * plus accent colors, the closest GlassPill tone preset, and tinted blobs
 * for the hero parallax layer.
 */

export type VerseThemeId = 'hope' | 'love' | 'peace' | 'strength' | 'joy' | 'wisdom';

export interface VerseTheme {
  id: VerseThemeId;
  /** Human label — currently used for accessibility; can be shown in UI later. */
  label: string;
  /** Three-stop gradient (offsets 0, 0.55, 1) applied diagonally. */
  gradient: [string, string, string];
  /** Solid color used as the View backgroundColor under the SVG gradient. */
  baseColor: string;
  /** Foreground accent for cap labels, the verse reference, active states. */
  accent: string;
  /** Closest matching GlassPill tone preset. */
  pillTone: 'gold' | 'rose' | 'sage' | 'default';
  /** Drifting blob colors layered on top of the gradient (top-right, bottom-left, mid). */
  blobs: [string, string, string];
}

export const VERSE_THEMES: Record<VerseThemeId, VerseTheme> = {
  hope: {
    id: 'hope',
    label: 'Hope',
    gradient: ['#fff4e0', '#ffd49c', '#ff9a5a'],
    baseColor: '#ffd49c',
    accent: '#a8460e',
    pillTone: 'gold',
    blobs: [
      'rgba(255,186,120,0.34)',
      'rgba(217,122,58,0.22)',
      'rgba(255,222,178,0.30)',
    ],
  },
  love: {
    id: 'love',
    label: 'Love',
    gradient: ['#fff0ec', '#ffc5c0', '#e88378'],
    baseColor: '#ffc5c0',
    accent: '#9a2920',
    pillTone: 'rose',
    blobs: [
      'rgba(232,131,120,0.32)',
      'rgba(196,69,61,0.20)',
      'rgba(255,200,193,0.30)',
    ],
  },
  peace: {
    id: 'peace',
    label: 'Peace',
    gradient: ['#eef5f0', '#bbd4c7', '#7fa893'],
    baseColor: '#bbd4c7',
    accent: '#2a4f3d',
    pillTone: 'sage',
    blobs: [
      'rgba(127,168,147,0.30)',
      'rgba(42,79,61,0.16)',
      'rgba(220,234,225,0.30)',
    ],
  },
  strength: {
    id: 'strength',
    label: 'Strength',
    gradient: ['#fff1d4', '#e6a647', '#8c4a1a'],
    baseColor: '#e6a647',
    accent: '#5e280b',
    pillTone: 'gold',
    blobs: [
      'rgba(230,166,71,0.32)',
      'rgba(140,74,26,0.22)',
      'rgba(255,224,170,0.30)',
    ],
  },
  joy: {
    id: 'joy',
    label: 'Joy',
    gradient: ['#fffae0', '#ffd762', '#f08a3a'],
    baseColor: '#ffd762',
    accent: '#964d0c',
    pillTone: 'gold',
    blobs: [
      'rgba(255,215,98,0.34)',
      'rgba(240,138,58,0.24)',
      'rgba(255,245,200,0.32)',
    ],
  },
  wisdom: {
    id: 'wisdom',
    label: 'Wisdom',
    gradient: ['#f3eff7', '#c8b4d4', '#7e6296'],
    baseColor: '#c8b4d4',
    accent: '#3e2659',
    pillTone: 'default',
    blobs: [
      'rgba(200,180,212,0.32)',
      'rgba(126,98,150,0.20)',
      'rgba(243,239,247,0.30)',
    ],
  },
};

/**
 * Keyword sets per theme. Variants (loved, loves, loving) are listed
 * explicitly so we can do clean word-boundary matching without false
 * positives like "rest" matching "restoration".
 */
const KEYWORDS: Record<VerseThemeId, string[]> = {
  hope: [
    'hope', 'hopes', 'hoping', 'hoped', 'hopeful',
    'promise', 'promises', 'promised',
    'future', 'plans', 'await', 'awaits', 'expect', 'expects',
    'restore', 'restored', 'restores', 'restoration',
    'renew', 'renewed', 'renews', 'renewal',
    'mercies', 'dawn', 'morning', 'sunrise',
    'return', 'returns', 'new heaven', 'new earth',
  ],
  love: [
    'love', 'loves', 'loved', 'loving', 'lovingkindness', 'beloved',
    'grace', 'gracious',
    'mercy', 'merciful',
    'kindness', 'kind',
    'compassion', 'compassionate',
    'tender', 'tenderness',
    'forgive', 'forgives', 'forgiven', 'forgiveness',
    'embrace', 'embraced',
  ],
  peace: [
    'peace', 'peaceful',
    'rest', 'restful', 'rests',
    'still', 'stillness',
    'quiet', 'quietness',
    'calm',
    'comfort', 'comforted', 'comforter', 'comforts',
    'refuge', 'sanctuary', 'shelter',
    'shepherd', 'shepherds', 'pasture', 'pastures',
    'tranquil', 'anxious', 'worry',
  ],
  strength: [
    'strong', 'strength', 'strengthen', 'strengthens', 'strengthened',
    'courage', 'courageous',
    'valiant', 'mighty', 'might',
    'fight', 'fights', 'fought',
    'overcome', 'overcomes', 'overcame',
    'victory', 'victorious',
    'conquer', 'conqueror', 'conquerors',
    'endure', 'endures', 'endurance',
    'persevere', 'perseverance',
    'fortress', 'rock', 'shield', 'defender',
    'fear not', 'do not fear', 'do not be afraid', 'be not afraid',
  ],
  joy: [
    'joy', 'joyful', 'joyous',
    'rejoice', 'rejoices', 'rejoicing',
    'sing', 'sings', 'song', 'songs',
    'praise', 'praises', 'praising',
    'glad', 'gladness',
    'celebrate', 'celebrated', 'dance',
    'hallelujah', 'hosanna', 'exult', 'exults',
    'glory', 'glorious',
    'shout', 'shouts', 'delight', 'delights',
    'blessed', 'blessing',
  ],
  wisdom: [
    'wisdom', 'wise', 'wisely',
    'understanding', 'understand', 'understood',
    'knowledge', 'know', 'knows', 'knew',
    'instruct', 'instructs', 'instruction',
    'teach', 'teaches', 'taught',
    'learn', 'learns', 'learned',
    'ponder', 'ponders',
    'meditate', 'meditates', 'meditation',
    'reflect', 'reflects', 'consider', 'considers',
    'lamp', 'path', 'paths',
  ],
};

/**
 * Book-of-origin hints. Each match adds a small boost (1 point) so a verse
 * with weak keyword signal still leans toward the book's traditional mood.
 * Won't overpower a strong keyword match.
 */
const BOOK_HINTS: Record<string, VerseThemeId> = {
  'psalm': 'joy',
  'psalms': 'joy',
  'proverbs': 'wisdom',
  'ecclesiastes': 'wisdom',
  'job': 'wisdom',
  'isaiah': 'hope',
  'jeremiah': 'hope',
  'lamentations': 'hope',
  'romans': 'love',
  '1 corinthians': 'love',
  '2 corinthians': 'love',
  'galatians': 'love',
  'ephesians': 'love',
  'philippians': 'joy',
  'colossians': 'love',
  '1 john': 'love',
  '2 john': 'love',
  '3 john': 'love',
  'joshua': 'strength',
  'judges': 'strength',
  'daniel': 'strength',
  '1 samuel': 'strength',
  '2 samuel': 'strength',
  'james': 'wisdom',
  'matthew': 'peace',
  'mark': 'peace',
  'luke': 'peace',
  'john': 'love',
  'song of solomon': 'love',
  'song of songs': 'love',
};

const THEME_ORDER: VerseThemeId[] = ['hope', 'love', 'peace', 'strength', 'joy', 'wisdom'];

/**
 * Strip the chapter:verse suffix from a reference so we can match the
 * book name only. Handles:
 *   "John 3:16"          -> "john"
 *   "1 Corinthians 13:4" -> "1 corinthians"
 *   "Psalm 23:1-3"       -> "psalm"
 *   "Song of Songs 2:4"  -> "song of songs"
 */
function extractBook(reference: string): string {
  // Remove the first chapter:verse occurrence and everything after it.
  const m = reference.match(/^(.*?)\s+\d+(?::\d+)?/);
  if (m && m[1]) return m[1].trim().toLowerCase();
  return reference.trim().toLowerCase();
}

function dayOfYear(isoDate: string): number {
  // isoDate is "YYYY-MM-DD" from dayjs().format on the caller side.
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return 0;
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

const KW_REGEX_CACHE = new Map<string, RegExp>();
function keywordRegex(kw: string): RegExp {
  const hit = KW_REGEX_CACHE.get(kw);
  if (hit) return hit;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word-boundary-ish: must be flanked by a non-letter (or string edge).
  // Allows multi-word phrases like "fear not" because the space is a non-letter.
  const re = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'g');
  KW_REGEX_CACHE.set(kw, re);
  return re;
}

export function pickVerseTheme(
  text: string | null | undefined,
  reference: string | null | undefined,
  isoDate: string,
): VerseTheme {
  const lower = (text ?? '').toLowerCase();
  const book = extractBook(reference ?? '');

  // No content yet (skeleton state) — pure rotation by day so the
  // placeholder still varies between renders.
  if (!lower && !book) {
    const idx = dayOfYear(isoDate) % THEME_ORDER.length;
    return VERSE_THEMES[THEME_ORDER[idx]];
  }

  // Score each theme via keyword matches in the verse body.
  const scores: Record<VerseThemeId, number> = {
    hope: 0, love: 0, peace: 0, strength: 0, joy: 0, wisdom: 0,
  };

  for (const id of THEME_ORDER) {
    for (const kw of KEYWORDS[id]) {
      const matches = lower.match(keywordRegex(kw));
      if (matches) scores[id] += matches.length;
    }
  }

  // Book-of-origin nudge.
  const bookHint = BOOK_HINTS[book];
  if (bookHint) scores[bookHint] += 1;

  // Pick the highest-scored theme. Tie-break by THEME_ORDER (stable).
  let bestId: VerseThemeId | null = null;
  let bestScore = 0;
  for (const id of THEME_ORDER) {
    if (scores[id] > bestScore) {
      bestScore = scores[id];
      bestId = id;
    }
  }

  // No keyword or book signal at all — rotate by day so we still vary.
  if (!bestId) {
    const idx = dayOfYear(isoDate) % THEME_ORDER.length;
    return VERSE_THEMES[THEME_ORDER[idx]];
  }

  return VERSE_THEMES[bestId];
}
