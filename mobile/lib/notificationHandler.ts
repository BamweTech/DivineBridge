import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getActiveGroup } from '@/lib/activeGroupStore';

let configured = false;

function isViewingGroupChat(data: Record<string, unknown> | undefined): boolean {
  if (data?.type !== 'group_chat' || AppState.currentState !== 'active') return false;
  const groupId = typeof data.groupId === 'string' ? data.groupId : '';
  return !!groupId && getActiveGroup() === groupId;
}

/** Ensures foreground/background notification presentation behavior (shared by profile + prayer room). */
export function ensureNotificationPresentationHandler() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      if (isViewingGroupChat(notification.request.content.data as Record<string, unknown>)) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    },
  });
}
