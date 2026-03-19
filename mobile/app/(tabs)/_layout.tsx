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
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'home',       label: 'Home',       icon: 'home' },
  { name: 'groups',     label: 'Groups',     icon: 'groups' },
  { name: 'rooms',      label: 'Live',       icon: 'live' },
  { name: 'devotional', label: 'Devotional', icon: 'book' },
  { name: 'profile',    label: 'Profile',    icon: 'profile' },
] as const;

function TabBarIcon({
  icon,
  label,
  focused,
}: {
  icon: IconName;
  label: string;
  focused: boolean;
}) {
  const scale = useSharedValue(focused ? 1.05 : 0.9);
  const pillOpacity = useSharedValue(focused ? 1 : 0);
  const pillScale = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.05 : 0.9, { damping: 12 });
    pillOpacity.value = withSpring(focused ? 1 : 0, { damping: 12 });
    pillScale.value = withSpring(focused ? 1 : 0, { damping: 12 });
  }, [focused]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillOpacity.value,
    transform: [{ scale: pillScale.value }],
  }));

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 8, paddingBottom: 4, width: 64 }}>
      <Animated.View
        style={[
          {
            width: 42,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: focused ? THEME_COLORS.goldDim : 'transparent',
          },
          pillStyle,
        ]}
      />
      <Animated.View style={[{ position: 'absolute', top: 8 }, iconStyle]}>
        <Icon
          name={icon}
          size={20}
          color={focused ? THEME_COLORS.gold : THEME_COLORS.text3}
          strokeWidth={focused ? 2.0 : 1.6}
        />
      </Animated.View>
      <Text
        style={{
          color: focused ? THEME_COLORS.gold : THEME_COLORS.text3,
          fontFamily: focused ? 'Geist_600SemiBold' : 'Geist_400Regular',
          fontSize: 9,
          marginTop: 20,
          letterSpacing: 0.5,
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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(250,246,239,0.97)',
          borderTopColor: THEME_COLORS.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          elevation: 0,
          shadowOpacity: 0,
        },
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
              <TabBarIcon icon={tab.icon} label={tab.label} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
