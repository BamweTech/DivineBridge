import React from 'react';
import { useGroupCallNotifications } from '@/features/groups/hooks/useGroupCallNotifications';
import { GroupCallBanner } from '@/features/groups/components/GroupCallBanner';

/**
 * Renders at the root layout level. Monitors for new group live calls
 * across all the user's groups and shows a banner + local notification.
 */
export function GroupCallNotificationOverlay() {
  const { banner, dismiss } = useGroupCallNotifications();

  if (!banner) return null;

  return (
    <GroupCallBanner
      groupId={banner.groupId}
      groupName={banner.groupName}
      hostName={banner.hostName}
      onDismiss={dismiss}
    />
  );
}
