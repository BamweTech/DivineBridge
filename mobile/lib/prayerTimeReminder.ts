import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { ensureNotificationPresentationHandler } from '@/lib/notificationHandler';

const ID_KEY = '@divinebridge:prayer_time_notif_id';
const HOUR_KEY = '@divinebridge:prayer_time_hour';
const MINUTE_KEY = '@divinebridge:prayer_time_minute';
const CHANNEL_ID = 'prayer-time';

export type PrayerTimeReminder = {
  enabled: boolean;
  hour: number;
  minute: number;
};

export async function loadPrayerTimeReminder(): Promise<PrayerTimeReminder> {
  const [id, hourRaw, minuteRaw] = await Promise.all([
    AsyncStorage.getItem(ID_KEY),
    AsyncStorage.getItem(HOUR_KEY),
    AsyncStorage.getItem(MINUTE_KEY),
  ]);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return {
    enabled: !!id,
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 7,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  };
}

/** Daily local reminder at the chosen device time. Throws if notification permission is denied. */
export async function syncPrayerTimeReminder(wantOn: boolean, hour: number, minute: number): Promise<void> {
  ensureNotificationPresentationHandler();

  const existing = await AsyncStorage.getItem(ID_KEY);
  if (existing) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existing);
    } catch {
      /* already gone */
    }
    await AsyncStorage.removeItem(ID_KEY);
  }

  await AsyncStorage.multiSet([
    [HOUR_KEY, String(hour)],
    [MINUTE_KEY, String(minute)],
  ]);

  if (!wantOn) return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let status = existingStatus;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    throw new Error('Allow notifications in Settings to use the prayer reminder.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Prayer time',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Prayer time',
      body: 'A quiet moment is set aside. Come and pray.',
    },
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    },
  });

  await AsyncStorage.setItem(ID_KEY, id);
}
