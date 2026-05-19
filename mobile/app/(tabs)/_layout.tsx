import { Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME_COLORS } from '@/lib/constants';
import { iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { GlassTabBar } from '@/components/ui/GlassTabBar';
import { useGroupUnread } from '@/contexts/GroupUnreadContext';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'home', label: 'Home', icon: 'home' },
  { name: 'groups', label: 'Pray', icon: 'prayBridge' },
  { name: 'rooms', label: 'Live', icon: 'live' },
  { name: 'devotional', label: 'Devotional', icon: 'book' },
  { name: 'profile', label: 'Profile', icon: 'profile' },
] as const;

/** Base icon size (dp); spring scale differentiates focused vs idle. */
const ICON_BASE = 27;

function TabBarIcon({
  icon,
  label,
  focused,
  badgeCount,
}: {
  icon: IconName;
  label: string;
  focused: boolean;
  badgeCount?: number;
}) {
  const scale = useSharedValue(focused ? 1.06 : 0.95);

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
          <Icon
            name={icon}
            size={ICON_BASE}
            color={focused ? THEME_COLORS.gold : THEME_COLORS.text3}
            strokeWidth={focused ? 2.35 : 1.7}
          />
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
        style={{
          color: focused ? THEME_COLORS.gold : THEME_COLORS.text3,
          fontFamily: iosFont(focused ? '600' : '400'),
          fontWeight: focused ? '600' : '400',
          fontSize: 9,
          marginTop: 6,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
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

  return (
    <Tabs
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
          options={{
            tabBarIcon: ({ focused }) => (
              <TabBarIcon
                icon={tab.icon}
                label={tab.label}
                focused={focused}
                badgeCount={tab.name === 'groups' ? totalUnread : undefined}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
