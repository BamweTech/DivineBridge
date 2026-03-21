import type { User } from 'firebase/auth';
import type { UserProfile } from '@/types';

/** Full display string for UI (not necessarily greeting). */
export function getDisplayName(profile: UserProfile | null, user: User | null): string {
  const f = profile?.firstName?.trim();
  const l = profile?.lastName?.trim();
  if (f && l) return `${f} ${l}`;
  if (f) return f;
  if (l) return l;

  const dn = profile?.displayName?.trim() || user?.displayName?.trim();
  if (dn) return dn;

  const email = user?.email || profile?.email;
  if (email) return email.split('@')[0] || 'User';

  return 'User';
}

/** First token for “Good morning, Alex”. */
export function getGreetingFirstName(profile: UserProfile | null, user: User | null): string {
  const full = getDisplayName(profile, user).trim();
  const first = full.split(/\s+/)[0];
  return first || 'friend';
}
