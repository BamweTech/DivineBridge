import { create } from 'zustand';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { syncSignupWithBackend, requestPasswordResetWithBackend } from '@/lib/backendAuth';
import type { UserProfile } from '@/types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  initialize: () => () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

function normalizeProfile(uid: string, data: Record<string, unknown>): UserProfile {
  const createdAt = data.createdAt;
  let createdNum: number | undefined;
  if (typeof createdAt === 'number') createdNum = createdAt;
  else if (createdAt && typeof (createdAt as { toMillis?: () => number }).toMillis === 'function') {
    createdNum = (createdAt as { toMillis: () => number }).toMillis();
  }

  const phone =
    (data.phone as string | undefined) ||
    (data.phoneNumber as string | undefined);
  const linkedIn =
    (data.linkedIn as string | undefined) ||
    (data.linkedin as string | undefined);

  return {
    uid,
    email: (data.email as string) ?? '',
    displayName: data.displayName as string | undefined,
    firstName: data.firstName as string | undefined,
    lastName: data.lastName as string | undefined,
    photoURL: data.photoURL as string | undefined,
    bio: data.bio as string | undefined,
    phone,
    linkedIn,
    emailSubscribed: Boolean(data.email_subscribed),
    notifyDailyVerse: Boolean(data.notify_daily_verse),
    notifyDevotional: Boolean(data.notify_devotional),
    sessionRemindersEnabled: Boolean(data.session_reminders_enabled),
    preferredPrayerLanguage: data.preferred_prayer_language as string | undefined,
    createdAt: createdNum,
    groups: (data.groups as string[] | undefined) ?? [],
    blockedUserIds: Array.isArray(data.blocked_user_ids)
      ? data.blocked_user_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  isLoading: false,
  isInitialized: false,
  error: null,

  initialize: () => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        set({ user, isInitialized: true });
        await get().refreshProfile();
      } else {
        set({ user: null, profile: null, isInitialized: true });
      }
    });
    return unsubscribe;
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  signup: async (email, password, firstName, lastName) => {
    set({ isLoading: true, error: null });
    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      const displayName = `${fn} ${ln}`.trim();
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
      await new Promise((r) => setTimeout(r, 400));
      await syncSignupWithBackend(fn, ln);
      await get().refreshProfile();
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    await signOut(auth);
    set({ user: null, profile: null });
  },

  resetPassword: async (email) => {
    set({ isLoading: true, error: null });
    try {
      await requestPasswordResetWithBackend(email);
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  refreshProfile: async () => {
    const user = get().user;
    if (!user) return;
    try {
      const ref = doc(db, COLLECTIONS.USERS, user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        set({ profile: normalizeProfile(user.uid, snap.data() as Record<string, unknown>) });
        return;
      }

      // Heal missing Firestore profile from Firebase Auth (legacy / edge cases)
      const rawName = user.displayName?.trim() || user.email?.split('@')[0] || 'User';
      const parts = rawName.split(/\s+/).filter(Boolean);
      const healFirst = parts[0] || 'User';
      const healLast = parts.slice(1).join(' ') || '';
      await setDoc(
        ref,
        {
          email: user.email ?? '',
          displayName: rawName,
          firstName: healFirst,
          lastName: healLast,
          groups: [],
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      const again = await getDoc(ref);
      if (again.exists()) {
        set({ profile: normalizeProfile(user.uid, again.data() as Record<string, unknown>) });
      }
    } catch {
      // non-fatal
    }
  },

  clearError: () => set({ error: null }),
}));
