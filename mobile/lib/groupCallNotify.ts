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
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 800, 400, 800, 400, 800, 2000],
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
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
