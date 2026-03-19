import { create } from 'zustand';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  User,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import type { UserProfile } from '@/types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  initialize: () => () => void;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
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

  signup: async (email, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
      const profile: Omit<UserProfile, 'uid'> = {
        displayName,
        email,
        createdAt: Date.now(),
        groups: [],
      };
      await setDoc(doc(db, COLLECTIONS.USERS, credential.user.uid), {
        ...profile,
        createdAt: serverTimestamp(),
      });
      set({ profile: { uid: credential.user.uid, ...profile } });
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
      await sendPasswordResetEmail(auth, email);
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
      const snap = await getDoc(doc(db, COLLECTIONS.USERS, user.uid));
      if (snap.exists()) {
        set({ profile: { uid: user.uid, ...(snap.data() as Omit<UserProfile, 'uid'>) } });
      }
    } catch {
      // non-fatal: profile may not exist yet
    }
  },

  clearError: () => set({ error: null }),
}));
