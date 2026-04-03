import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

const STORAGE_KEY = '@divinebridge:devotional_reminder_id';
const CHANNEL_ID = 'devotional-reminder';

export async function syncDevotionalReminder(wantOn: boolean): Promise<void> {
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
    throw new Error('Allow notifications in Settings to use the devotional reminder.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Devotional reminder',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Divine Bridge',
      body: 'Time for your devotional \u2014 continue your journey.',
      data: { screen: 'devotional' },
    },
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour: 7,
      minute: 30,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    },
  });

  await AsyncStorage.setItem(STORAGE_KEY, id);
}
