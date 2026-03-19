import { useEffect, useState } from 'react';
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
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import type { PrayerGroup, GroupChatMessage } from '@/types';

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
    if (!user || !profile) return;
    await addDoc(
      collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages'),
      {
        user_id: user.uid,
        user_name: profile.displayName,
        user_photo: profile.photoURL ?? null,
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
