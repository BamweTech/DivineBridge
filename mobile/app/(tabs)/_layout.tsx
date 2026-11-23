import { Tabs, usePathname } from 'expo-router';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME_COLORS } from '@/lib/constants';
import { iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { FLOATING_TAB_RADIUS, GlassTabBar } from '@/components/ui/GlassTabBar';
import { useGroupUnread } from '@/features/groups/contexts/GroupUnreadContext';
import { useAuthStore } from '@/stores/authStore';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'pray', label: 'Pray', icon: 'prayBridge' },
  { name: 'groups', label: 'Groups', icon: 'gathering' },
  { name: 'devotional', label: 'Devotional', icon: 'book' },
  { name: 'profile', label: 'Profile', icon: 'profile' },
] as const;

/** Screens reached from the Pray dashboard. They stay in this navigator so the
 * tab bar remains visible, and the Pray tab returns to the last one opened. */
const PRAY_SCREENS = new Set([
  'pray',
  'prayer-requests',
  'prayer-timer',
  'prayer-reminder',
  'todays-prayer',
  'scheduled-prayer',
  'prayer-wall',
  'personal-prayer',
  'request-prayer',
  'prayer-warrior',
]);

/** Kept as routes. Home and Live are no longer tabs. */
const HIDDEN_TABS = [
  'home',
  'rooms',
  'prayer-requests',
  'prayer-timer',
  'prayer-reminder',
  'todays-prayer',
  'scheduled-prayer',
  'prayer-wall',
  'personal-prayer',
  'request-prayer',
  'prayer-warrior',
  'prayer-warrior-review',
  'activity',
  'group/[id]',
] as const;

function screenName(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? '';
}

function tabOwnsPath(name: string, pathname: string): boolean {
  const screen = screenName(pathname);
  if (name === 'pray') return PRAY_SCREENS.has(screen);
  if (name === 'groups') return pathname === '/groups' || pathname.startsWith('/group/');
  if (name === 'devotional') return pathname === '/devotional' || pathname.startsWith('/devotional/');
  if (name === 'profile') {
    return pathname === '/profile' || pathname === '/activity' || pathname.startsWith('/activity/') || pathname === '/prayer-warrior-review';
  }
  return false;
}

/** Base icon size (dp); spring scale differentiates focused vs idle. */
const ICON_BASE = 31;
const PHOTO_SIZE = 30;

function TabBarIcon({
  icon,
  focused,
  badgeCount,
  photoUrl,
}: {
  icon: IconName;
  focused: boolean;
  badgeCount?: number;
  photoUrl?: string;
}) {
  const scale = useSharedValue(focused ? 1.06 : 0.95);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    setPhotoFailed(false);
  }, [photoUrl]);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.06 : 0.95, { damping: 16, stiffness: 220 });
  }, [focused, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const SLOT_W = 64;

  return (
    <View
      style={{
        flex: 1,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
        width: SLOT_W,
      }}
    >
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, iconStyle]}>
        <View>
          {photoUrl && !photoFailed ? (
            <View
              style={{
                borderRadius: PHOTO_SIZE / 2 + 2,
                borderWidth: focused ? 2 : 1,
                borderColor: focused ? THEME_COLORS.gold : 'rgba(44,36,23,0.16)',
                padding: 1,
              }}
            >
              <Image
                source={{ uri: photoUrl }}
                style={{ width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: PHOTO_SIZE / 2 }}
                contentFit="cover"
                onError={() => setPhotoFailed(true)}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : (
            <Icon
              name={icon}
              size={ICON_BASE}
              color={focused ? THEME_COLORS.gold : THEME_COLORS.text3}
              strokeWidth={focused ? 2.35 : 1.7}
            />
          )}
          {badgeCount != null && badgeCount > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -5,
                right: -12,
                minWidth: 17,
                height: 17,
                paddingHorizontal: 4,
                borderRadius: 9,
                backgroundColor: THEME_COLORS.rose,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: iosFont('700'), fontWeight: '700' }}>
                {badgeCount > 99 ? '99+' : badgeCount}
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { totalUnread } = useGroupUnread();
  const pathname = usePathname();
  const profilePhoto = useAuthStore((state) => state.profile?.photoURL)?.trim();
  const lastPrayScreen = useRef('pray');
  const openPrayScreen = screenName(pathname);
  if (PRAY_SCREENS.has(openPrayScreen)) lastPrayScreen.current = openPrayScreen;

  return (
    <Tabs
      initialRouteName="pray"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          // Background is the floating glass capsule from `tabBarBackground`.
          backgroundColor: 'transparent',
          position: 'absolute',
          borderTopWidth: 0,
          start: 16,
          end: 16,
          bottom: insets.bottom > 0 ? Math.max(insets.bottom - 14, 16) : 12,
          height: FLOATING_TAB_RADIUS * 2,
          paddingTop: 12,
          paddingBottom: 0,
          borderRadius: FLOATING_TAB_RADIUS,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarBackground: () => <GlassTabBar />,
        tabBarShowLabel: false,
        tabBarItemStyle: { justifyContent: 'center', alignItems: 'center' },
        tabBarHideOnKeyboard: true,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          listeners={
            tab.name === 'pray'
              ? ({ navigation }) => ({
                  tabPress: (event) => {
                    const saved = lastPrayScreen.current;
                    if (saved === 'pray') return;
                    const state = navigation.getState();
                    const current = state.routes[state.index];
                    if (current && PRAY_SCREENS.has(current.name)) return;
                    event.preventDefault();
                    navigation.navigate({ name: saved, merge: true } as never);
                  },
                })
              : undefined
          }
          options={{
            tabBarAccessibilityLabel: tab.label,
            tabBarIcon: ({ focused }) => (
              <TabBarIcon
                icon={tab.icon}
                focused={focused || tabOwnsPath(tab.name, pathname)}
                badgeCount={tab.name === 'groups' ? totalUnread : undefined}
                photoUrl={tab.name === 'profile' ? profilePhoto || undefined : undefined}
              />
            ),
          }}
        />
      ))}
      {HIDDEN_TABS.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
