// Parses the invite strings the app already generates:
//   - the 8-character code shown on the invite sheet (uuid slice, A–F and 0–9)
//   - https://divinebridge.io/join/<groupId>?code=<code>  (QR and share text)
//   - io.divinebridge.app://join/<groupId>?code=<code>
//   - ?join_group=<groupId>&invite_code=<code>  (or &code=)

export type ParsedGroupInvite = {
  groupId: string;
  code: string;
};

const URL_IN_TEXT = /(?:https?:\/\/|io\.divinebridge\.app:\/\/)[^\s<>"']+/gi;
const LABELED_CODE = /\bcode\s*[:=：]?\s*([a-f0-9]{8})\b/i;

function parseInviteUrlString(url: string): ParsedGroupInvite | null {
  try {
    let normalized = url.trim().replace(/[),.;]+$/g, '');
    const scheme = normalized.match(/^io\.divinebridge\.app:\/\//i);
    if (scheme) {
      normalized = `https://placeholder/${normalized.slice(scheme[0].length)}`;
    }
    const u = new URL(normalized);
    const joinGroup = u.searchParams.get('join_group');
    if (joinGroup) {
      return {
        groupId: joinGroup,
        code: u.searchParams.get('invite_code') || u.searchParams.get('code') || '',
      };
    }
    const match = u.pathname.match(/\/join\/([^/?#]+)/);
    if (!match) return null;
    let groupId = match[1];
    try {
      groupId = decodeURIComponent(groupId);
    } catch {
      // Keep the raw path segment when it is not valid percent-encoding.
    }
    return {
      groupId,
      code: u.searchParams.get('code') || u.searchParams.get('invite_code') || '',
    };
  } catch {
    return null;
  }
}

/** Deep link parser. Requires a group id, matching the previous join-link behavior. */
export function parseInviteUrl(url: string | null): ParsedGroupInvite | null {
  if (!url) return null;
  const parsed = parseInviteUrlString(url);
  if (!parsed?.groupId) return null;
  return parsed;
}

/**
 * Typed or pasted invite. Returns the short code alone, or group id plus code
 * when the text contains a join link.
 */
export function parseGroupInviteInput(raw: string | null | undefined): ParsedGroupInvite | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const embedded = text.match(URL_IN_TEXT) ?? [];
  const candidates = embedded.length ? embedded : [text];
  for (const candidate of candidates) {
    const parsed = parseInviteUrlString(candidate);
    if (parsed && (parsed.groupId || parsed.code)) {
      return { groupId: parsed.groupId, code: parsed.code.trim().toUpperCase() };
    }
  }

  const labeled = text.match(LABELED_CODE);
  if (labeled) {
    return { groupId: '', code: labeled[1].toUpperCase() };
  }

  const compact = text.replace(/\s+/g, '');
  if (/^[A-F0-9]{8}$/i.test(compact)) {
    return { groupId: '', code: compact.toUpperCase() };
  }

  return null;
}
