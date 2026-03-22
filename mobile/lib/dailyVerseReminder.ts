import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

const STORAGE_KEY = '@divinebridge:daily_verse_notif_id';
const CHANNEL_ID = 'daily-verse';

/**
 * Enable or disable the repeating local notification (8:00 device time).
 * When enabling, requests OS permission; throws if denied.
 */
export async function syncDailyVerseReminder(wantOn: boolean): Promise<void> {
  ensureNotificationPresentationHandler();

  const existing = await AsyncStorage.getItem(STORAGE_KEY);
  if (existing) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existing);
    } catch {
      /* ignore */
    }
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  if (!wantOn) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    throw new Error('Allow notifications in Settings to use the daily reminder.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Daily verse',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Divine Bridge',
      body: 'Tap for today’s verse and prayer.',
    },
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    },
  });

  await AsyncStorage.setItem(STORAGE_KEY, id);
}
