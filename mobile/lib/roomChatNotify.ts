import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

/**
 * When the app is not active, show an immediate local notification (if permitted).
 * Mirrors the web idea of alerting when the user is not focused on chat (tab hidden → we use background).
 */
export async function presentPrayerRoomBackgroundNotice(title: string, body: string): Promise<void> {
  if (AppState.currentState === 'active') return;
  ensureNotificationPresentationHandler();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}
