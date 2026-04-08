/**
 * Keeps the prayer call process alive when the app is backgrounded.
 *
 * iOS:  UIBackgroundModes audio+voip (declared in app.config.js) combined with
 *       staysActiveInBackground: true on the expo-av audio session is enough —
 *       the OS won't suspend the app while audio is flowing.
 *
 * Android: We show a sticky ongoing notification so the system treats the app as
 *          a foreground process and won't kill it.  react-native-incall-manager
 *          also holds a partial wake lock while started.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'call-active';
const NOTIFICATION_ID = 'active-call';
let channelReady = false;
let active = false;

async function ensureChannel() {
  if (channelReady || Platform.OS !== 'android') return;
  channelReady = true;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Active call',
    importance: Notifications.AndroidImportance.LOW,
    sound: undefined,
    vibrationPattern: [0],
    enableVibrate: false,
    showBadge: false,
  });
}

export async function startCallKeepAlive(groupName: string): Promise<void> {
  if (active) return;
  active = true;

  if (Platform.OS !== 'android') return;

  await ensureChannel();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'Live Prayer',
      body: `In call — ${groupName}`,
      sticky: true,
      autoDismiss: false,
      data: { type: 'call_keep_alive' },
    },
    // Android 8+: channel is required; `channelId` belongs on the trigger, not `content`.
    trigger: { channelId: CHANNEL_ID },
  });
}

export async function stopCallKeepAlive(): Promise<void> {
  if (!active) return;
  active = false;
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
  } catch {
    /* notification may already be gone */
  }
}
