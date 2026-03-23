/**
 * Global Prayer Watch — client-side feed shaping for the mobile prayer wall.
 * Filters meta/AI refusal text, dedupes by event signature, caps list size.
 */

export const GLOBAL_WATCH_FEED_LIMIT = 10;

/** Minimal shape from GET /api/prayer/global-watch */
export type GlobalWatchPostLike = {
  id: string;
  disaster_type: string;
  disaster_type_display: string;
  affected_countries: string[];
  summary: string;
  wall_prayer: string;
  created_at: string;
  updated_at?: string;
};

/** Align with disaster_prayer_service._normalize_disaster_type */
const DISASTER_TYPE_NORMALIZE: Record<string, string> = {
  hurricane: 'typhoon',
  cyclone: 'typhoon',
  storm: 'typhoon',
  flooding: 'flood',
  wildfire: 'fire',
  volcanic_eruption: 'volcano',
  pandemic: 'epidemic',
  war: 'conflict',
  refugee_crisis: 'conflict',
  'mass shooting': 'mass_shooting',
  'gun violence': 'mass_shooting',
};

/** Align with disaster_prayer_service._canonical_country_slug */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'united states',
  us: 'united states',
  'u s': 'united states',
  'u s a': 'united states',
  'united states of america': 'united states',
  uk: 'united kingdom',
  'u k': 'united kingdom',
  'great britain': 'united kingdom',
  britain: 'united kingdom',
  'republic of korea': 'south korea',
  'south korea': 'south korea',
  hawaii: 'united states',
};

function normalizeDisasterType(t: string): string {
  const x = (t || '').toLowerCase().trim();
  return DISASTER_TYPE_NORMALIZE[x] ?? x;
}

function canonicalCountrySlug(raw: string): string {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\u2019/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return COUNTRY_ALIASES[s] ?? s;
}

/**
 * Stable key for "same underlying event" — normalized disaster type + canonical country set.
 * Matches server-side merge/dedupe so hourly updates replace one card instead of stacking copies.
 * API order is newest-first; first occurrence per key wins (latest content).
 */
export function globalWatchEventDedupKey(post: GlobalWatchPostLike): string {
  const dt = normalizeDisasterType(post.disaster_type ?? '');
  const countries = [
    ...new Set((post.affected_countries ?? []).map((c) => canonicalCountrySlug(String(c)))),
  ]
    .filter(Boolean)
    .sort()
    .join(',');
  if (!countries) {
    return `${dt}||${post.id ?? ''}`;
  }
  return `${dt}|${countries}`;
}

/**
 * Reject wall text that reads like model meta/refusal rather than an actual prayer.
 */
export function isPlausibleGlobalWatchPrayer(wallPrayer: string, summary?: string): boolean {
  const wp = (wallPrayer ?? '').trim();
  if (wp.length < 24) return false;

  const text = `${wp} ${summary ?? ''}`.toLowerCase();

  const bad =
    /\bas an ai\b/.test(text) ||
    /\bi'?m an ai\b/.test(text) ||
    /\bi am an artificial\b/.test(text) ||
    /\bartificial intelligence\b/.test(text) ||
    /\bchatgpt\b/.test(text) ||
    /\bopenai\b/.test(text) ||
    /\blanguage model\b/.test(text) ||
    /\bvirtual assistant\b/.test(text) ||
    /\bgenerative ai\b/.test(text) ||
    /\bi cannot (?:generate|write|create|offer|provide)\b/.test(text) ||
    /\bi can'?t (?:generate|write|create|offer|provide)\b/.test(text) ||
    /\bi'?m not able to (?:generate|write|create|pray)\b/.test(text) ||
    /\bi don'?t have (?:the ability|permission) to\b/.test(text) ||
    /\bi'?m unable to (?:generate|write|create|comply)\b/.test(text) ||
    /\bcannot fulfill (?:this|your) request\b/.test(text) ||
    /\bi can help you (?:write|craft|create|compose)\b/.test(text) ||
    /\bhere (?:is|are) (?:a |some )(?:template|example|steps|guidelines)\b/.test(text) ||
    /\binstead,?\s+i (?:can|could|will) (?:offer|help|suggest)\b/.test(text) ||
    /\bas a (?:helpful )?assistant\b/.test(text) ||
    /\bi apologize,? but (?:i |as )\b/.test(text) ||
    /\bnot (?:able|equipped) to (?:generate|produce|create)\b/.test(text) ||
    /\bwould you like me to (?:write|help|draft)\b/.test(text) ||
    /\blet me know (?:if|what) (?:you|i should)\b/.test(text) ||
    /\bi'?m happy to (?:help|assist) (?:you )?(?:with|to)\b/.test(text) ||
    /\bfeel free to (?:ask|let me know)\b/.test(text);

  return !bad;
}

/**
 * API returns newest first; keep first occurrence per event key (newest wins).
 */
export function filterGlobalWatchForFeed<T extends GlobalWatchPostLike>(posts: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const p of posts) {
    if (!isPlausibleGlobalWatchPrayer(p.wall_prayer, p.summary)) continue;
    const key = globalWatchEventDedupKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= GLOBAL_WATCH_FEED_LIMIT) break;
  }

  return out;
}
