import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import { prayerWarriorApi, voiceLinkApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { HolyHalo, haloConceptForUser } from '@/features/prayer/components/HolyHalo';

type MenuItem = {
  key: string;
  label: string;
  detail: string;
  icon: IconName;
  href?: string;
  action?: 'voice';
};

function WarriorInviteCard({ pending, onPress }: { pending: boolean; onPress: () => void }) {
  const breath = useSharedValue(0);

  useEffect(() => {
    if (pending) {
      cancelAnimation(breath);
      breath.value = 0;
      return;
    }
    breath.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(breath);
  }, [breath, pending]);

  const cardStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(breath.value, [0, 1], ['rgba(176,125,32,0.28)', 'rgba(176,125,32,0.7)']),
  }));

  return (
    <Animated.View
      style={[
        {
          borderRadius: 22,
          borderWidth: 1,
          backgroundColor: '#fff',
        },
        cardStyle,
      ]}
    >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={pending ? 'Prayer warrior application' : 'Enroll as Prayer Warrior'}
          style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 16,
              backgroundColor: THEME_COLORS.goldDim,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="kneel" size={20} color={THEME_COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontWeight: '600', fontSize: 16, lineHeight: 21 }}>
              {pending ? 'Application received' : 'Enroll as Prayer Warrior'}
            </Text>
            <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 4, lineHeight: 17 }}>
              {pending ? 'We will let you know when you are enrolled.' : 'Pray with people who ask for a private prayer.'}
            </Text>
          </View>
        </Pressable>
    </Animated.View>
  );
}

const MENU: MenuItem[] = [
  { key: 'inbox', label: 'Prayer Request', detail: 'Your requests and the warrior inbox', icon: 'hand', href: '/prayer-requests?mode=inbox' },
  { key: 'today', label: "Today's Prayer", detail: 'The global prayer for today', icon: 'sunrise', href: '/todays-prayer' },
  { key: 'scheduled', label: 'Scheduled prayer', detail: 'Upcoming private matches', icon: 'calendar', href: '/scheduled-prayer' },
  { key: 'wall', label: 'Prayer Wall', detail: 'Public prayer requests', icon: 'church', href: '/prayer-wall' },
  { key: 'reminder', label: 'Prayer reminder', detail: 'A daily time to come and pray', icon: 'bell', href: '/prayer-reminder' },
  { key: 'timer', label: 'Prayer timer', detail: 'Start and stop a quiet time', icon: 'play', href: '/prayer-timer' },
  { key: 'generator', label: 'Personal Prayer Generator', detail: 'Write a prayer and keep it', icon: 'sparkle', href: '/personal-prayer' },
  { key: 'voice', label: 'Voice Link', detail: 'Start a private voice call', icon: 'audio', action: 'voice' },
];

export default function PrayScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const concept = useMemo(() => haloConceptForUser(user?.uid), [user?.uid]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startingVoice, setStartingVoice] = useState(false);
  const [inviteHeight, setInviteHeight] = useState(0);
  const dragY = useSharedValue(0);
  const applicationQuery = useQuery({
    queryKey: ['prayer-warrior-application'],
    queryFn: prayerWarriorApi.get,
    enabled: menuOpen,
  });
  const application = applicationQuery.data?.data;
  const showWarriorInvite = application?.status !== 'enrolled';

  function openMenu() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuOpen(true);
  }

  const pan = Gesture.Pan()
    .activeOffsetY(16)
    .onUpdate((event) => {
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > 72) {
        runOnJS(openMenu)();
      }
      dragY.value = withSpring(0, { damping: 16, stiffness: 180 });
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd(() => {
      runOnJS(openMenu)();
    });

  const haloGesture = Gesture.Race(tap, pan);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value * 0.65 }],
  }));

  async function startVoiceLink() {
    if (!user) {
      Alert.alert('Sign in to start a voice call');
      return;
    }
    if (startingVoice) return;
    setStartingVoice(true);
    try {
      const result = await voiceLinkApi.create({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      const href =
        `/voice-call/${result.room_id}?code=${encodeURIComponent(result.room_code)}` +
        `&shareUrl=${encodeURIComponent(result.share_url)}`;
      setMenuOpen(false);
      setStartingVoice(false);
      router.push(href as never);
      try {
        await Share.share({
          message: `Join my voice call on Divine Bridge:\n\n${result.share_url}`,
          url: result.share_url,
        });
      } catch {
        /* dismissed */
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      Alert.alert('Could not start call', message);
      setStartingVoice(false);
    }
  }

  const cardWidth = (width - 20 * 2 - 12) / 2;

  function choose(item: MenuItem) {
    if (item.action === 'voice') {
      void startVoiceLink();
      return;
    }
    if (!item.href) return;
    router.push(item.href as never);
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <View style={{ position: 'absolute', top: -80, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: concept.washTop }} />
      <View style={{ position: 'absolute', bottom: -36, left: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: concept.washBottom }} />

      {!menuOpen ? (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          Holy ground
        </Text>
        <GestureDetector gesture={haloGesture}>
          <Animated.View style={[{ marginTop: 28 }, haloStyle]}>
            <HolyHalo concept={concept} />
          </Animated.View>
        </GestureDetector>
        <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 22, textAlign: 'center', paddingHorizontal: 48 }}>
          The bush burned, and it was not consumed.
        </Text>
        <Text style={{ ...TYPE.caption2, color: THEME_COLORS.gold, marginTop: 8, letterSpacing: 1.2 }}>
          EXODUS 3
        </Text>
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3, marginTop: 28 }}>
          Tap the halo, or drag it down
        </Text>
      </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
          <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 8, backgroundColor: THEME_COLORS.bg, zIndex: 2 }}>
            <Pressable
              onPress={() => setMenuOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Back to holy ground"
              hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 8 }}
            >
              <Icon name="back" size={16} color={THEME_COLORS.gold} />
              <Text style={{ ...TYPE.headline, color: THEME_COLORS.gold }}>Holy ground</Text>
            </Pressable>
            <Text style={{ ...TYPE.title2, color: THEME_COLORS.text, marginTop: 8 }}>Prayer</Text>
            <Text style={{ ...TYPE.subheadline, color: THEME_COLORS.text3, marginTop: 4 }}>
              Choose where to begin
            </Text>
          </View>
          <View style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 12,
              paddingHorizontal: 20,
              paddingTop: (showWarriorInvite ? inviteHeight : 0) + 12,
              paddingBottom: insets.bottom + 96,
            }}
            showsVerticalScrollIndicator={false}
          >
            {MENU.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => choose(item)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={{
                  width: cardWidth,
                  minHeight: 168,
                  backgroundColor: '#fff',
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: 'rgba(44,36,23,0.06)',
                  padding: 16,
                  paddingBottom: 18,
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 20,
                    backgroundColor: 'rgba(176,125,32,0.2)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 16,
                  }}
                >
                  <Icon name={item.icon} size={30} color={THEME_COLORS.gold} />
                </View>
                <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontWeight: '600', fontSize: 16, lineHeight: 21, textAlign: 'center' }} numberOfLines={2}>
                  {item.label}
                </Text>
                <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 6, lineHeight: 17, textAlign: 'center' }} numberOfLines={3}>
                  {item.key === 'voice' && startingVoice ? 'Starting…' : item.detail}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {showWarriorInvite ? (
            <View
              onLayout={(event) => {
                const next = Math.ceil(event.nativeEvent.layout.height);
                setInviteHeight((current) => (current === next ? current : next));
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 2,
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 8,
                backgroundColor: THEME_COLORS.bg,
              }}
            >
              <WarriorInviteCard
                pending={application?.status === 'pending'}
                onPress={() => router.push('/prayer-warrior' as never)}
              />
            </View>
          ) : null}
          </View>
        </View>
      )}
    </View>
  );
}
