import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useLiveRooms, useMyGroups } from '@/features/groups/hooks/useGroups';
import type { PrayerGroup } from '@/types';

export type ActiveCallBanner = {
  groupId: string;
  groupName: string;
  hostName: string;
};

/**
 * Monitors live rooms for the user's groups and shows an in-app banner
 * when someone else starts a call. Server-side push (via push_service)
 * handles background/system notifications, so no local notification here.
 */
export function useGroupCallNotifications() {
  const { user } = useAuthStore();
  const { rooms } = useLiveRooms();
  const { groups } = useMyGroups();
  const seenRoomIds = useRef(new Set<string>());
  const isFirstSnapshot = useRef(true);
  const [banner, setBanner] = useState<ActiveCallBanner | null>(null);

  const dismiss = useCallback(() => setBanner(null), []);

  useEffect(() => {
    if (!user?.uid || groups.length === 0) return;

    const groupMap = new Map<string, PrayerGroup>();
    for (const g of groups) groupMap.set(g.group_id, g);

    const myGroupRooms = rooms.filter(
      (r) => r.group_id && groupMap.has(r.group_id),
    );

    if (isFirstSnapshot.current) {
      isFirstSnapshot.current = false;
      for (const r of myGroupRooms) seenRoomIds.current.add(r.room_id);
      return;
    }

    for (const room of myGroupRooms) {
      if (seenRoomIds.current.has(room.room_id)) continue;
      seenRoomIds.current.add(room.room_id);

      if (room.host_id === user.uid) continue;

      const group = groupMap.get(room.group_id!);
      const groupName = group?.name ?? 'Prayer Group';
      const hostName = room.host_name || 'Someone';

      setBanner({ groupId: room.group_id!, groupName, hostName });
    }

    const activeIds = new Set(myGroupRooms.map((r) => r.room_id));
    for (const id of seenRoomIds.current) {
      if (!activeIds.has(id)) seenRoomIds.current.delete(id);
    }
  }, [rooms, groups, user?.uid]);

  return { banner, dismiss };
}
