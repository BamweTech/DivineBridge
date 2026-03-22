import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  addDoc,
  serverTimestamp,
  limit,
  getDoc,
  orderBy,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { getDisplayName } from '@/lib/userDisplayName';
import type { PrayerGroup, GroupChatMessage, PrayerRoom } from '@/types';

// useLiveRooms — real-time Firestore listener for active prayer rooms.
// Rooms appear instantly when created without polling.
export function useLiveRooms() {
  const [rooms, setRooms] = useState<PrayerRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.PRAYER_ROOMS),
      where('is_active', '==', true)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data: PrayerRoom[] = snap.docs.map((d) => {
          const raw = d.data();
          return {
            ...raw,
            room_id: d.id,
          } as PrayerRoom;
        });
        // Sort newest first client-side (avoids composite index requirement)
        data.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        setRooms(data);
        setIsLoading(false);
      },
      () => {
        setRooms([]);
        setIsLoading(false);
      }
    );
    return unsub;
  }, []);

  return { rooms, isLoading };
}

// useMyGroups — removes orderBy to avoid composite index requirement.
// Results are sorted client-side by created_at descending.
export function useMyGroups() {
  const [groups, setGroups] = useState<PrayerGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    const q = query(
      collection(db, COLLECTIONS.PRAYER_GROUPS),
      where('member_ids', 'array-contains', user.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs
          .map((d) => ({ group_id: d.id, ...d.data() } as PrayerGroup))
          .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
        setGroups(data);
        setIsLoading(false);
      },
      () => {
        // permission-denied or other error — return empty list gracefully
        setGroups([]);
        setIsLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  return { groups, isLoading };
}

// usePublicGroups — removes orderBy to avoid composite index requirement.
// Sorted client-side by member_count descending.
export function usePublicGroups() {
  const [groups, setGroups] = useState<PrayerGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, isInitialized } = useAuthStore();

  useEffect(() => {
    if (!isInitialized || !user) {
      if (isInitialized) setIsLoading(false);
      return;
    }
    const q = query(
      collection(db, COLLECTIONS.PRAYER_GROUPS),
      where('privacy', '==', 'public'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs
          .map((d) => ({ group_id: d.id, ...d.data() } as PrayerGroup))
          .sort((a, b) => (b.member_count ?? 0) - (a.member_count ?? 0));
        setGroups(data);
        setIsLoading(false);
      },
      () => {
        setGroups([]);
        setIsLoading(false);
      }
    );
    return unsub;
  }, [isInitialized, user?.uid]);

  return { groups, isLoading };
}

// useGroupDetails — fetches a single group document by ID.
export function useGroupDetails(groupId: string) {
  const [group, setGroup] = useState<PrayerGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!groupId) {
      setIsLoading(false);
      return;
    }
    getDoc(doc(db, COLLECTIONS.PRAYER_GROUPS, groupId))
      .then((snap) => {
        if (snap.exists()) {
          setGroup({ group_id: snap.id, ...snap.data() } as PrayerGroup);
        }
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [groupId]);

  return { group, isLoading };
}

export function useGroupChat(groupId: string) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, profile } = useAuthStore();

  useEffect(() => {
    if (!groupId) return;
    const q = query(
      collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages'),
      limit(100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs
          .map((d) => ({ message_id: d.id, group_id: groupId, ...d.data() } as GroupChatMessage))
          .sort((a, b) => {
            const ta = typeof a.timestamp === 'number' ? a.timestamp : (a.timestamp as any)?.toMillis?.() ?? 0;
            const tb = typeof b.timestamp === 'number' ? b.timestamp : (b.timestamp as any)?.toMillis?.() ?? 0;
            return ta - tb;
          });
        setMessages(data);
        setIsLoading(false);
      },
      () => {
        setMessages([]);
        setIsLoading(false);
      }
    );
    return unsub;
  }, [groupId]);

  async function sendMessage(text: string, type: GroupChatMessage['message_type'] = 'text') {
    if (!user) return;
    await addDoc(
      collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages'),
      {
        user_id: user.uid,
        user_name: getDisplayName(profile, user),
        user_photo: profile?.photoURL ?? null,
        message: text.trim(),
        message_type: type,
        timestamp: serverTimestamp(),
        reactions: {},
        read_by: [user.uid],
      }
    );
  }

  return { messages, isLoading, sendMessage };
}

// ── Group chat unread (latest message vs per-group last read on user doc) ─────

export function firestoreTimestampMs(val: unknown): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/** Subscribes to `users/{uid}.group_chat_last_read_at.{groupId}` map (milliseconds). */
export function useGroupChatLastReads() {
  const { user } = useAuthStore();
  const [reads, setReads] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) {
      setReads({});
      return;
    }
    const ref = doc(db, COLLECTIONS.USERS, user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const raw = snap.data()?.group_chat_last_read_at;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof v === 'number' && !Number.isNaN(v)) next[k] = v;
            else next[k] = firestoreTimestampMs(v);
          }
          setReads(next);
        } else {
          setReads({});
        }
      },
      () => setReads({})
    );
    return unsub;
  }, [user?.uid]);

  const markGroupChatRead = useCallback(
    async (groupId: string, atLeastTimestamp?: number) => {
      if (!user?.uid) return;
      const t = Math.max(Date.now(), atLeastTimestamp ?? 0);
      // setDoc+merge: works if user doc is missing; nested map keys merge with existing reads
      await setDoc(
        doc(db, COLLECTIONS.USERS, user.uid),
        { group_chat_last_read_at: { [groupId]: t } },
        { merge: true }
      );
    },
    [user?.uid]
  );

  return { reads, markGroupChatRead };
}

export type GroupLatestMeta = { ts: number; userId: string } | null;

/**
 * One listener per group: latest message timestamp + sender (for unread from others).
 */
export function useGroupLatestActivity(groupIds: string[]) {
  const [latest, setLatest] = useState<Record<string, GroupLatestMeta>>({});
  const sortedKey = useMemo(() => [...groupIds].sort().join(','), [groupIds]);

  useEffect(() => {
    if (!groupIds.length) {
      setLatest({});
      return;
    }

    const unsubs: (() => void)[] = [];

    for (const gid of groupIds) {
      const q = query(
        collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, gid, 'messages'),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          if (snap.empty) {
            setLatest((prev) => ({ ...prev, [gid]: null }));
            return;
          }
          const d = snap.docs[0].data();
          const ts = firestoreTimestampMs(d.timestamp);
          const userId = typeof d.user_id === 'string' ? d.user_id : '';
          setLatest((prev) => ({ ...prev, [gid]: { ts, userId } }));
        },
        () => setLatest((prev) => ({ ...prev, [gid]: null }))
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [sortedKey]);

  return latest;
}
