import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { auth } from '@/lib/firebase';
import { API_BASE_URL } from '@/lib/constants';

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'divinebridge',
  });

  return tokenData.data;
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

    registerForPushNotifications().then((token) => {
      if (token) {
        sendTokenToBackend(token);
        registered.current = true;
      }
    });
  }, [userId]);
}
