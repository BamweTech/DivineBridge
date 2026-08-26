import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  useMyGroups,
  useGroupChatLastReads,
  useGroupUnreadCounts,
} from '@/features/groups/hooks/useGroups';
import { syncAppIconBadge } from '@/lib/appBadge';

export type GroupUnreadContextValue = {
  groups: ReturnType<typeof useMyGroups>['groups'];
  isLoadingGroups: boolean;
  totalUnread: number;
  unreadCountByGroup: Record<string, number>;
  unreadByGroup: Record<string, boolean>;
  markGroupChatRead: (groupId: string, atLeastTimestamp?: number) => Promise<void>;
};

const GroupUnreadContext = createContext<GroupUnreadContextValue | null>(null);

export function GroupUnreadProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const { groups, isLoading: isLoadingGroups } = useMyGroups();
  const groupIds = useMemo(() => groups.map((g) => g.group_id), [groups]);
  const { reads, markGroupChatRead } = useGroupChatLastReads();
  const unreadCountByGroup = useGroupUnreadCounts(groupIds, reads);

  const { totalUnread, unreadByGroup } = useMemo(() => {
    const unreadByGroup: Record<string, boolean> = {};
    let totalUnread = 0;
    for (const id of groupIds) {
      const count = unreadCountByGroup[id] ?? 0;
      unreadByGroup[id] = count > 0;
      totalUnread += count;
    }
    return { totalUnread, unreadByGroup };
  }, [groupIds, unreadCountByGroup]);

  useEffect(() => {
    void syncAppIconBadge(user ? totalUnread : 0);
  }, [user?.uid, totalUnread]);

  const value = useMemo<GroupUnreadContextValue>(
    () => ({
      groups,
      isLoadingGroups,
      totalUnread,
      unreadCountByGroup,
      unreadByGroup,
      markGroupChatRead,
    }),
    [groups, isLoadingGroups, totalUnread, unreadCountByGroup, unreadByGroup, markGroupChatRead]
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
