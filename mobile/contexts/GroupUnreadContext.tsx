import React, { createContext, useContext, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  useMyGroups,
  useGroupChatLastReads,
  useGroupLatestActivity,
} from '@/hooks/useGroups';

export type GroupUnreadContextValue = {
  groups: ReturnType<typeof useMyGroups>['groups'];
  isLoadingGroups: boolean;
  totalUnread: number;
  unreadByGroup: Record<string, boolean>;
  markGroupChatRead: (groupId: string, atLeastTimestamp?: number) => Promise<void>;
};

const GroupUnreadContext = createContext<GroupUnreadContextValue | null>(null);

export function GroupUnreadProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const { groups, isLoading: isLoadingGroups } = useMyGroups();
  const groupIds = useMemo(() => groups.map((g) => g.group_id), [groups]);
  const { reads, markGroupChatRead } = useGroupChatLastReads();
  const latest = useGroupLatestActivity(groupIds);

  const { totalUnread, unreadByGroup } = useMemo(() => {
    const unreadByGroup: Record<string, boolean> = {};
    if (!user) {
      return { totalUnread: 0, unreadByGroup };
    }
    let totalUnread = 0;
    for (const id of groupIds) {
      const L = latest[id];
      if (!L?.ts) {
        unreadByGroup[id] = false;
        continue;
      }
      const lastRead = reads[id] ?? 0;
      const isUnread = L.userId !== user.uid && L.ts > lastRead;
      unreadByGroup[id] = isUnread;
      if (isUnread) totalUnread += 1;
    }
    return { totalUnread, unreadByGroup };
  }, [user, groupIds, latest, reads]);

  const value = useMemo<GroupUnreadContextValue>(
    () => ({
      groups,
      isLoadingGroups,
      totalUnread,
      unreadByGroup,
      markGroupChatRead,
    }),
    [groups, isLoadingGroups, totalUnread, unreadByGroup, markGroupChatRead]
  );

  return <GroupUnreadContext.Provider value={value}>{children}</GroupUnreadContext.Provider>;
}

export function useGroupUnread(): GroupUnreadContextValue {
  const ctx = useContext(GroupUnreadContext);
  if (!ctx) {
    throw new Error('useGroupUnread must be used within GroupUnreadProvider');
  }
  return ctx;
}
