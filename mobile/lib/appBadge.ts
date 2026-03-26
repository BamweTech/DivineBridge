import * as Notifications from 'expo-notifications';

function normalizeBadgeCount(count: number) {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.trunc(count));
}

export async function syncAppIconBadge(count: number): Promise<boolean> {
  const badgeCount = normalizeBadgeCount(count);

  try {
    const perms = await Notifications.getPermissionsAsync();
    const isGranted = perms.granted || perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

    if (!isGranted) {
      if (badgeCount === 0 || !perms.canAskAgain) return false;
      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      const requestedGranted =
        requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
      if (!requestedGranted) return false;
    }

    return await Notifications.setBadgeCountAsync(badgeCount);
  } catch {
    return false;
  }
}

export async function clearAppIconBadge(): Promise<boolean> {
  return syncAppIconBadge(0);
}
