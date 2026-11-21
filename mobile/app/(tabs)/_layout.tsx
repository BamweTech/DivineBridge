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
import { GlassTabBar } from '@/components/ui/GlassTabBar';
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
const ICON_BASE = 27;

function TabBarIcon({
  icon,
  label,
  focused,
  badgeCount,
  photoUrl,
}: {
  icon: IconName;
  label: string;
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
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 2,
        paddingBottom: 4,
        width: SLOT_W,
        minHeight: 48,
      }}
    >
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, iconStyle]}>
        <View>
          {photoUrl && !photoFailed ? (
            <View
              style={{
                borderRadius: 15,
                borderWidth: focused ? 2 : 1,
                borderColor: focused ? THEME_COLORS.gold : 'rgba(44,36,23,0.16)',
                padding: 1,
              }}
            >
              <Image
                source={{ uri: photoUrl }}
                style={{ width: 26, height: 26, borderRadius: 13 }}
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
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        allowFontScaling={false}
        style={{
          color: focused ? THEME_COLORS.gold : THEME_COLORS.text3,
          fontFamily: iosFont(focused ? '600' : '400'),
          fontWeight: focused ? '600' : '400',
          fontSize: 9,
          marginTop: 6,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          textAlign: 'center',
          width: SLOT_W,
        }}
      >
        {label}
      </Text>
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
          // Background is rendered by `tabBarBackground` (GlassTabBar). Keep
          // this transparent so the BlurView actually shows the content
          // scrolling underneath.
          backgroundColor: 'transparent',
          position: 'absolute',
          borderTopColor: 'rgba(44,36,23,0.06)',
          borderTopWidth: 0.5,
          height: 70 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 10,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarBackground: () => <GlassTabBar />,
        tabBarShowLabel: false,
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
            tabBarIcon: ({ focused }) => (
              <TabBarIcon
                icon={tab.icon}
                label={tab.label}
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
