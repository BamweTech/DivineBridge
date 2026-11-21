import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

/**
 * When the app is not active, show an immediate local notification (if permitted).
 * Mirrors the web idea of alerting when the user is not focused on chat (tab hidden → we use background).
 */
export async function presentPrayerRoomBackgroundNotice(
  title: string,
  body: string,
  roomId?: string,
): Promise<void> {
  if (AppState.currentState === 'active') return;
  ensureNotificationPresentationHandler();
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      ...(roomId ? { data: { type: 'room_chat', roomId } } : {}),
    },
    trigger: null,
  });
}

export async function dismissRoomChatNotifications(roomId: string): Promise<void> {
  if (!roomId) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((item) => {
          const data = item.request.content.data as Record<string, unknown> | undefined;
          return data?.type === 'room_chat' && data.roomId === roomId;
        })
        .map((item) => Notifications.dismissNotificationAsync(item.request.identifier)),
    );
  } catch {
    // The tray is unavailable when notification permission was never granted.
  }
}
