import React from 'react';
import { useGroupCallNotifications } from '@/hooks/useGroupCallNotifications';
import { GroupCallBanner } from '@/components/group/GroupCallBanner';

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
