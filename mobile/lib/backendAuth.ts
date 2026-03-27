import { auth } from '@/lib/firebase';
import { API_BASE_URL } from '@/lib/constants';

/**
 * After Firebase email signup, mirror web register.html: create Firestore profile + admin flows via Flask.
 * Mobile ignores the session cookie; server still runs profile creation when token verifies.
 */
export async function syncSignupWithBackend(
  firstName: string,
  lastName: string
): Promise<void> {
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Not signed in');

  let idToken = await firebaseUser.getIdToken(true);
  let attempts = 3;

  while (attempts > 0) {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        isOAuthSignup: true,
        firstName,
        lastName,
      }),
    });

    if (res.ok) return;

    if (res.status === 401 && attempts > 1) {
      await new Promise((r) => setTimeout(r, 800));
      idToken = await firebaseUser.getIdToken(true);
      attempts -= 1;
      continue;
    }

    let msg = 'Could not complete signup';
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === 'string') msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

export async function requestPasswordResetWithBackend(email: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  let message = 'Could not send reset email';
  try {
    const data = (await res.json()) as { error?: string; message?: string };
    if (typeof data.message === 'string') message = data.message;
    if (typeof data.error === 'string') message = data.error;
  } catch {
    /* ignore */
  }

  if (!res.ok) throw new Error(message);
}
