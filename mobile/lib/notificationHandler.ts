import * as Notifications from 'expo-notifications';

let configured = false;

/** Ensures foreground/background notification presentation behavior (shared by profile + prayer room). */
export function ensureNotificationPresentationHandler() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
