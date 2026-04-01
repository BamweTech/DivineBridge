import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

const CHANNEL_ID = 'group-live';
let channelReady = false;

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  channelReady = true;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Group prayer calls',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
  });
}

export async function presentGroupCallNotification(
  groupName: string,
  hostName: string,
  groupId: string,
): Promise<void> {
  ensureNotificationPresentationHandler();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await ensureChannel();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${groupName} — Live Prayer`,
      body: `${hostName} started a live prayer session. Tap to join.`,
      sound: 'default',
      data: { type: 'group_live', groupId },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}
