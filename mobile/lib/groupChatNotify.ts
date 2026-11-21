import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

const CHANNEL_ID = 'group-chat';
let channelReady = false;

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  channelReady = true;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Group chat messages',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 200, 100, 200],
    enableVibrate: true,
  });
}

export async function presentGroupChatNotification(
  groupName: string,
  senderName: string,
  messagePreview: string,
  groupId: string,
): Promise<void> {
  ensureNotificationPresentationHandler();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await ensureChannel();

  const body = messagePreview
    ? `${senderName}: ${messagePreview}`
    : `${senderName} sent a message`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: groupName,
      body,
      sound: 'default',
      data: { type: 'group_chat', groupId },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

function presentedGroupId(data: Record<string, unknown> | undefined): string | null {
  if (data?.type !== 'group_chat') return null;
  return typeof data.groupId === 'string' && data.groupId ? data.groupId : null;
}

/** Remove this group's message alerts from the tray without waiting on the server. */
export async function dismissGroupChatNotifications(groupId: string): Promise<void> {
  if (!groupId) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((item) => presentedGroupId(item.request.content.data as Record<string, unknown>) === groupId)
        .map((item) => Notifications.dismissNotificationAsync(item.request.identifier)),
    );
  } catch {
    // The tray is unavailable when notification permission was never granted.
  }
}
