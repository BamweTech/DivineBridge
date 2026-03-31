import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection,
  query,
  onSnapshot,
  where,
  doc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  limit,
  getDoc,
  orderBy,
  setDoc,
  runTransaction,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { getDisplayName } from '@/lib/userDisplayName';
import type {
  PrayerGroup,
  GroupChatMessage,
  GroupChatAttachment,
  GroupChatReplyRef,
  PrayerRoom,
} from '@/types';

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

// useGroupLiveRooms — real-time map of group_id → active PrayerRoom (if any).
// Reuses the global useLiveRooms listener and filters to the supplied group IDs.
export function useGroupLiveRooms(groupIds: string[]) {
  const { rooms } = useLiveRooms();
  return useMemo(() => {
    const map: Record<string, PrayerRoom> = {};
    if (!groupIds.length) return map;
    const idSet = new Set(groupIds);
    for (const r of rooms) {
      if (r.group_id && idSet.has(r.group_id) && !map[r.group_id]) {
        map[r.group_id] = r;
      }
    }
    return map;
  }, [rooms, groupIds]);
}

// useGroupLiveRoom — single-group convenience wrapper around useLiveRooms.
export function useGroupLiveRoom(groupId: string) {
  const { rooms } = useLiveRooms();
  return useMemo(
    () => rooms.find((r) => r.group_id === groupId) ?? null,
    [rooms, groupId],
  );
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

  async function sendMessage(
    text: string,
    type: GroupChatMessage['message_type'] = 'text',
    options?: {
      linkUrl?: string;
      attachments?: GroupChatAttachment[];
      replyTo?: GroupChatReplyRef | null;
    }
  ) {
    if (!user) return;
    const body = text.trim();
    const link = options?.linkUrl?.trim();
    const atts = options?.attachments?.filter((a) => a?.url && a?.content_type && a?.file_name) ?? [];
    if (!body && !link && atts.length === 0) return;

    const payload: Record<string, unknown> = {
      user_id: user.uid,
      user_name: getDisplayName(profile, user),
      user_photo: profile?.photoURL ?? null,
      message: body,
      message_type: type,
      timestamp: serverTimestamp(),
      reactions: {},
      read_by: [user.uid],
    };
    if (link) payload.link_url = link;
    if (atts.length > 0) payload.attachments = atts;
    if (options?.replyTo) payload.reply_to = options.replyTo;

    await addDoc(collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages'), payload);
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!user?.uid || !groupId || !emoji.trim()) return;

    const ref = doc(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages', messageId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;

      const data = snap.data() as { reactions?: Record<string, unknown> };
      const nextReactions: Record<string, string[]> = {};
      const rawReactions = data.reactions ?? {};

      for (const [key, value] of Object.entries(rawReactions)) {
        if (!Array.isArray(value)) continue;
        const users = value.filter((item): item is string => typeof item === 'string');
        if (users.length > 0) nextReactions[key] = users;
      }

      const currentUsers = nextReactions[emoji] ?? [];
      const hasReacted = currentUsers.includes(user.uid);
      const updatedUsers = hasReacted
        ? currentUsers.filter((uid) => uid !== user.uid)
        : [...currentUsers, user.uid];

      if (updatedUsers.length > 0) nextReactions[emoji] = updatedUsers;
      else delete nextReactions[emoji];

      tx.update(ref, { reactions: nextReactions });
    });
  }

  async function deleteMessage(messageId: string) {
    if (!user || !groupId) return;
    await deleteDoc(doc(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages', messageId));
  }

  return { messages, isLoading, sendMessage, toggleReaction, deleteMessage };
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
      const t = atLeastTimestamp ?? Date.now();
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

/**
 * One listener per group for unread message counts since the user's last read timestamp.
 * Counts only messages from other users so your own sends do not badge the UI.
 */
export function useGroupUnreadCounts(groupIds: string[], reads: Record<string, number>) {
  const { user } = useAuthStore();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const sortedKey = useMemo(() => [...groupIds].sort().join(','), [groupIds]);
  const readsKey = useMemo(
    () =>
      [...groupIds]
        .sort()
        .map((id) => `${id}:${reads[id] ?? 0}`)
        .join('|'),
    [groupIds, reads]
  );

  useEffect(() => {
    if (!user?.uid || !groupIds.length) {
      setCounts({});
      return;
    }

    const nextBase: Record<string, number> = {};
    for (const gid of groupIds) nextBase[gid] = 0;
    setCounts(nextBase);

    const unsubs: Array<() => void> = [];

    for (const gid of groupIds) {
      const lastRead = reads[gid] ?? 0;
      const ref = collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, gid, 'messages');
      const unsub = onSnapshot(
        ref,
        (snap) => {
          let unread = 0;
          snap.forEach((d) => {
            const data = d.data() as { user_id?: string; timestamp?: unknown };
            if (data.user_id === user.uid) return;
            if (firestoreTimestampMs(data.timestamp) > lastRead) unread += 1;
          });
          setCounts((prev) => ({ ...prev, [gid]: unread }));
        },
        () => setCounts((prev) => ({ ...prev, [gid]: 0 }))
      );
      unsubs.push(unsub);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user?.uid, sortedKey, readsKey]);

  return counts;
}
