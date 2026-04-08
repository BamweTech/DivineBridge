import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  query,
  onSnapshot,
  where,
  doc,
  deleteDoc,
  serverTimestamp,
  limit,
  orderBy,
  setDoc,
  runTransaction,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useLiveRoomsContext } from '@/contexts/LiveRoomsContext';
import { groupApi } from '@/services/api';
import { getDisplayName } from '@/lib/userDisplayName';
import type {
  PrayerGroup,
  GroupMember,
  GroupChatMessage,
  GroupChatAttachment,
  GroupChatReplyRef,
  PrayerRoom,
} from '@/types';

// useLiveRooms — reads from the shared LiveRoomsContext (single Firestore listener).
export function useLiveRooms() {
  return useLiveRoomsContext();
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

// useGroupDetails — real-time listener for a single group document by ID.
export function useGroupDetails(groupId: string) {
  const [group, setGroup] = useState<PrayerGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!groupId) {
      setIsLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, COLLECTIONS.PRAYER_GROUPS, groupId),
      (snap) => {
        if (snap.exists()) {
          setGroup({ group_id: snap.id, ...snap.data() } as PrayerGroup);
        } else {
          setGroup(null);
        }
        setIsLoading(false);
      },
      () => setIsLoading(false),
    );
    return unsub;
  }, [groupId]);

  return { group, isLoading };
}

export function useGroupMembers(groupId: string) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }

    const ref = collection(db, 'group_members', groupId, 'members');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.docs
          .map((d) => ({ uid: d.id, ...d.data() } as GroupMember))
          .sort((a, b) => {
            const roleScore = (role: GroupMember['role']) => (role === 'admin' ? 0 : 1);
            const byRole = roleScore(a.role) - roleScore(b.role);
            if (byRole !== 0) return byRole;
            return a.display_name.localeCompare(b.display_name);
          });
        setMembers(data);
        setIsLoading(false);
      },
      () => {
        setMembers([]);
        setIsLoading(false);
      }
    );

    return unsub;
  }, [groupId]);

  return { members, isLoading };
}

/** Milliseconds from Firestore Timestamp, number, or 0 if missing. */
export function firestoreTimestampMs(val: unknown): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

const GROUP_CHAT_CACHE_LIMIT = 100;
const groupChatMemoryCache = new Map<string, GroupChatMessage[]>();

function groupChatCacheKey(groupId: string) {
  return `group_chat_cache:${groupId}`;
}

function groupChatSortTimestamp(message: GroupChatMessage) {
  const serverTs = firestoreTimestampMs(message.timestamp);
  if (serverTs > 0) return serverTs;
  const clientTs = (message as GroupChatMessage & { client_sent_at?: unknown }).client_sent_at;
  return typeof clientTs === 'number' && !Number.isNaN(clientTs) ? clientTs : 0;
}

function normalizeGroupChatMessages(messages: GroupChatMessage[]) {
  const deduped = new Map<string, GroupChatMessage>();
  messages.forEach((msg) => {
    if (!msg?.message_id) return;
    const prev = deduped.get(msg.message_id);
    if (!prev || groupChatSortTimestamp(msg) >= groupChatSortTimestamp(prev)) {
      deduped.set(msg.message_id, msg);
    }
  });

  return [...deduped.values()]
    .map((msg) => ({
      ...msg,
      timestamp: firestoreTimestampMs(msg.timestamp),
      reactions: msg.reactions ?? {},
      attachments: msg.attachments ?? [],
      reply_to: msg.reply_to ?? null,
      read_by: msg.read_by ?? [],
    }))
    .sort((a, b) => groupChatSortTimestamp(a) - groupChatSortTimestamp(b))
    .slice(-GROUP_CHAT_CACHE_LIMIT);
}

async function readGroupChatCache(groupId: string) {
  try {
    const raw = await AsyncStorage.getItem(groupChatCacheKey(groupId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const normalized = normalizeGroupChatMessages(
      parsed.filter((item): item is GroupChatMessage => !!item && typeof item === 'object' && 'message_id' in item)
    );
    groupChatMemoryCache.set(groupId, normalized);
    return normalized;
  } catch {
    return null;
  }
}

async function writeGroupChatCache(groupId: string, messages: GroupChatMessage[]) {
  try {
    const normalized = normalizeGroupChatMessages(messages);
    groupChatMemoryCache.set(groupId, normalized);
    await AsyncStorage.setItem(
      groupChatCacheKey(groupId),
      JSON.stringify(normalized)
    );
  } catch {
    // Best-effort cache only.
  }
}

export function useGroupChat(groupId: string) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, profile } = useAuthStore();
  /** Message IDs still waiting to appear in the ordered Firestore query (serverTimestamp ordering gap). */
  const pendingOptimisticIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!groupId) return;
    let active = true;
    let firestoreActive = false;
    pendingOptimisticIdsRef.current.clear();

    const memoryCached = groupChatMemoryCache.get(groupId);
    const hadMemoryCache = memoryCached && memoryCached.length > 0;
    if (hadMemoryCache) {
      setMessages(memoryCached);
      setIsLoading(false);
    } else {
      setMessages([]);
      setIsLoading(true);
    }

    const col = collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages');
    let unsub: (() => void) | undefined;

    function applySnapshot(snap: {
      docs: {
        id: string;
        data: (options?: { serverTimestamps?: 'estimate' | 'previous' | 'none' }) => Record<string, unknown>;
      }[];
    }) {
      const incoming = normalizeGroupChatMessages(
        snap.docs.map((d) => ({
          message_id: d.id,
          group_id: groupId,
          ...d.data({ serverTimestamps: 'estimate' }),
        } as GroupChatMessage)),
      );
      if (!active) return;
      firestoreActive = true;

      setMessages((prev) => {
        for (const row of incoming) {
          pendingOptimisticIdsRef.current.delete(row.message_id);
        }
        // Merge prior UI state (memory / AsyncStorage / optimistic) with the query snapshot.
        // Incoming-only replace dropped cached rows when the first snapshot was partial or lagged
        // behind persistence, which looked like messages "disappearing" on cold launch.
        // normalizeGroupChatMessages dedupes by id and keeps the row with the newer sort timestamp.
        const merged = normalizeGroupChatMessages([...prev, ...incoming]);
        groupChatMemoryCache.set(groupId, merged);
        void writeGroupChatCache(groupId, merged);
        return merged;
      });
      setIsLoading(false);
    }

    if (!hadMemoryCache) {
      void readGroupChatCache(groupId).then((cached) => {
        if (!active || firestoreActive || !cached || cached.length === 0) return;
        setMessages(cached);
        setIsLoading(false);
      });
    }

    const qOrdered = query(col, orderBy('timestamp', 'desc'), limit(100));
    unsub = onSnapshot(
      qOrdered,
      (snap) => applySnapshot(snap),
      (err) => {
        console.warn('[useGroupChat] ordered query failed; using unsorted limit listener', groupId, err);
        unsub?.();
        const qFallback = query(col, limit(100));
        unsub = onSnapshot(
          qFallback,
          (snap) => applySnapshot(snap),
          (err2) => {
            console.warn('[useGroupChat] fallback listener error', groupId, err2);
            if (active) setIsLoading(false);
          },
        );
      },
    );

    return () => {
      active = false;
      unsub?.();
    };
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

    const clientSentAt = Date.now();
    const payload: Record<string, unknown> = {
      user_id: user.uid,
      user_name: getDisplayName(profile, user),
      user_photo: profile?.photoURL ?? null,
      message: body,
      message_type: type,
      timestamp: serverTimestamp(),
      client_sent_at: clientSentAt,
      reactions: {},
      read_by: [user.uid],
    };
    if (link) payload.link_url = link;
    if (atts.length > 0) payload.attachments = atts;
    if (options?.replyTo) payload.reply_to = options.replyTo;

    const messageRef = doc(collection(db, COLLECTIONS.GROUP_CHAT_MESSAGES, groupId, 'messages'));
    const mid = messageRef.id;
    pendingOptimisticIdsRef.current.add(mid);

    const optimisticRow = {
      message_id: mid,
      group_id: groupId,
      user_id: user.uid,
      user_name: getDisplayName(profile, user),
      user_photo: profile?.photoURL ?? undefined,
      message: body,
      message_type: type,
      timestamp: Date.now(),
      client_sent_at: clientSentAt,
      reactions: {},
      read_by: [user.uid],
      ...(link ? { link_url: link } : {}),
      ...(atts.length > 0 ? { attachments: atts } : {}),
      ...(options?.replyTo ? { reply_to: options.replyTo } : {}),
    } as GroupChatMessage;

    setMessages((prev) => {
      const merged = normalizeGroupChatMessages([...prev, optimisticRow]);
      groupChatMemoryCache.set(groupId, merged);
      void writeGroupChatCache(groupId, merged);
      return merged;
    });

    try {
      await setDoc(messageRef, payload);
    } catch (e) {
      pendingOptimisticIdsRef.current.delete(mid);
      setMessages((prev) => {
        const merged = normalizeGroupChatMessages(prev.filter((m) => m.message_id !== mid));
        groupChatMemoryCache.set(groupId, merged);
        void writeGroupChatCache(groupId, merged);
        return merged;
      });
      throw e;
    }

    const senderName = getDisplayName(profile, user);
    const preview = body.length > 80 ? body.slice(0, 77) + '…' : body;
    groupApi.notifyMessage(groupId, senderName, preview).catch(() => {});
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

const readsMemoryCache = new Map<string, Record<string, number>>();

function parseReadsMap(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && !Number.isNaN(v)) result[k] = v;
      else result[k] = firestoreTimestampMs(v);
    }
  }
  return result;
}

/** Subscribes to `users/{uid}.group_chat_last_read_at.{groupId}` map (milliseconds). */
export function useGroupChatLastReads() {
  const { user } = useAuthStore();
  const cached = user?.uid ? readsMemoryCache.get(user.uid) : undefined;
  const [reads, setReads] = useState<Record<string, number>>(cached ?? {});
  const [isReadsReady, setIsReadsReady] = useState(!!cached);

  useEffect(() => {
    if (!user) {
      setReads({});
      setIsReadsReady(true);
      return;
    }
    const uid = user.uid;
    const ref = doc(db, COLLECTIONS.USERS, uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const next = parseReadsMap(snap.data()?.group_chat_last_read_at);
        readsMemoryCache.set(uid, next);
        setReads(next);
        setIsReadsReady(true);
      },
      () => { setReads({}); setIsReadsReady(true); }
    );
    return unsub;
  }, [user?.uid]);

  const markGroupChatRead = useCallback(
    async (groupId: string, atLeastTimestamp?: number) => {
      if (!user?.uid) return;
      const t = atLeastTimestamp ?? Date.now();
      const ref = doc(db, COLLECTIONS.USERS, user.uid);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const rawReads = snap.data()?.group_chat_last_read_at;
        const nextReads = rawReads && typeof rawReads === 'object' && !Array.isArray(rawReads)
          ? { ...(rawReads as Record<string, unknown>) }
          : {};
        const current = firestoreTimestampMs(nextReads[groupId]);
        nextReads[groupId] = Math.max(current, t);
        tx.set(ref, { group_chat_last_read_at: nextReads }, { merge: true });
      });
    },
    [user?.uid]
  );

  return { reads, isReadsReady, markGroupChatRead };
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
