import { useEffect, useRef, useMemo } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  collection,
  query,
  onSnapshot,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useMyGroups, firestoreTimestampMs } from '@/hooks/useGroups';
import { getActiveGroup } from '@/lib/activeGroupStore';

type LatestMsg = {
  ts: number;
  userId: string;
};

const DEBOUNCE_MS = 3000;

/**
 * Monitors all of the user's groups for new chat messages and fires a
 * haptic when a message arrives from someone else while the app is in the
 * foreground. Server-side push (via push_service) handles background/system
 * notifications — no local notification is fired here.
 */
export function useGroupChatNotifications(): void {
  const { user } = useAuthStore();
  const { groups } = useMyGroups();
  const groupIds = useMemo(() => groups.map((g) => g.group_id), [groups]);
  const sortedKey = useMemo(() => [...groupIds].sort().join(','), [groupIds]);

  const latestRef = useRef<Record<string, LatestMsg | null>>({});
  const initialised = useRef(false);
  const lastNotifiedAt = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!user?.uid || groupIds.length === 0) {
      initialised.current = false;
      return;
    }

    const unsubs: (() => void)[] = [];

    for (const gid of groupIds) {
      const q = query(
        collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, gid, 'messages'),
        orderBy('timestamp', 'desc'),
        limit(1),
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (snap.empty) {
            latestRef.current[gid] = null;
            return;
          }
          const d = snap.docs[0].data();
          const ts = firestoreTimestampMs(d.timestamp);
          const userId = typeof d.user_id === 'string' ? d.user_id : '';

          const prev = latestRef.current[gid];
          latestRef.current[gid] = { ts, userId };

          if (!initialised.current) return;
          if (!prev || ts <= prev.ts) return;
          if (userId === user.uid) return;

          const activeGroup = getActiveGroup();
          if (activeGroup === gid && AppState.currentState === 'active') return;

          const now = Date.now();
          const lastNotified = lastNotifiedAt.current[gid] ?? 0;
          if (now - lastNotified < DEBOUNCE_MS) return;
          lastNotifiedAt.current[gid] = now;

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        () => {
          latestRef.current[gid] = null;
        },
      );
      unsubs.push(unsub);
    }

    const initTimer = setTimeout(() => {
      initialised.current = true;
    }, 2000);

    return () => {
      clearTimeout(initTimer);
      initialised.current = false;
      unsubs.forEach((u) => u());
    };
  }, [user?.uid, sortedKey]);
}
