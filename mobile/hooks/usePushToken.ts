import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { auth } from '@/lib/firebase';
import { API_BASE_URL } from '@/lib/constants';

const EAS_PROJECT_ID =
  Constants.easConfig?.projectId ??
  Constants.expoConfig?.extra?.eas?.projectId;

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice || isRunningInExpoGo()) return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (!EAS_PROJECT_ID) return null;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID,
    });

    return tokenData.data;
  } catch {
    // Common on iOS when the binary has no aps-environment entitlement
    // (local prebuild without a Push capability). Retry on the next launch.
    return null;
  }
}

async function sendTokenToBackend(pushToken: string) {
  const user = auth.currentUser;
  if (!user) return;

  const idToken = await user.getIdToken();
  try {
    await fetch(`${API_BASE_URL}/api/auth/push-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        pushToken,
        platform: Platform.OS,
      }),
    });
  } catch {
    // Best-effort — will retry on next app launch
  }
}

/**
 * Registers the device push token with the backend whenever the user is signed in.
 * Call once from the root layout.
 */
export function usePushToken(userId: string | undefined) {
  const registered = useRef(false);

  useEffect(() => {
    if (!userId || registered.current) return;

    registerForPushNotifications()
      .then((token) => {
        if (token) {
          sendTokenToBackend(token);
          registered.current = true;
        }
      })
      .catch(() => {});
  }, [userId]);
}
