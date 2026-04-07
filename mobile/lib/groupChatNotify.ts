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
