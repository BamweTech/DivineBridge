/**
 * Call-style ringtone + repeating vibration for incoming group prayer session alerts.
 *
 * Audio:  react-native-incall-manager plays the device's native ringtone on loop.
 * Vibration: React Native Vibration API (Android) / expo-haptics (iOS) for
 *            a repeating call-like vibration pattern.
 *
 * If InCallManager is unavailable (e.g. Expo Go), vibration still works standalone.
 */

import { Vibration, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const ANDROID_CALL_PATTERN = [0, 800, 400, 800, 400, 800, 2000];
const RINGTONE_DURATION_SEC = 15;

let active = false;
let iosInterval: ReturnType<typeof setInterval> | null = null;

function getInCallManager(): {
  startRingtone: (
    ringtone: string,
    vibrate_pattern: number | number[],
    ios_category: string,
    seconds: number,
  ) => void;
  stopRingtone: () => void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-incall-manager').default;
  } catch {
    return null;
  }
}

export function startCallRingtone(): void {
  if (active) return;
  active = true;

  const icm = getInCallManager();
  if (icm) {
    try {
      icm.startRingtone(
        '_DEFAULT_',
        ANDROID_CALL_PATTERN,
        'playback',
        RINGTONE_DURATION_SEC,
      );
    } catch {
      /* InCallManager may not be linked in dev builds — vibration still works */
    }
  }

  if (Platform.OS === 'android') {
    Vibration.vibrate(ANDROID_CALL_PATTERN, true);
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    iosInterval = setInterval(() => {
      if (!active) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 2400);
  }
}

export function stopCallRingtone(): void {
  if (!active) return;
  active = false;

  const icm = getInCallManager();
  if (icm) {
    try {
      icm.stopRingtone();
    } catch {
      /* noop */
    }
  }

  if (Platform.OS === 'android') {
    Vibration.cancel();
  }
  if (iosInterval !== null) {
    clearInterval(iosInterval);
    iosInterval = null;
  }
}
