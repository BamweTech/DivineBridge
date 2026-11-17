import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { voiceLinkApi } from '@/services/api';
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

const MENU: MenuItem[] = [
  { key: 'request', label: 'Request prayer', detail: 'Public wall or a private warrior', icon: 'pray', href: '/request-prayer' },
  { key: 'timer', label: 'Prayer timer', detail: 'Start and stop a quiet time', icon: 'play', href: '/prayer-timer' },
  { key: 'reminder', label: 'Prayer reminder', detail: 'A daily time to come and pray', icon: 'bell', href: '/prayer-reminder' },
  { key: 'today', label: "Today's Prayer", detail: 'The global prayer for today', icon: 'sunrise', href: '/todays-prayer' },
  { key: 'scheduled', label: 'Scheduled prayer', detail: 'Upcoming private matches', icon: 'calendar', href: '/scheduled-prayer' },
  { key: 'inbox', label: 'Request Prayers', detail: 'Your requests and the warrior inbox', icon: 'hand', href: '/prayer-requests?mode=inbox' },
  { key: 'wall', label: 'Prayer Wall', detail: 'Public prayer requests', icon: 'church', href: '/prayer-wall' },
  { key: 'generator', label: 'Personal Prayer Generator', detail: 'A prayer for what is on your heart', icon: 'sparkle', href: '/personal-prayer' },
  { key: 'voice', label: 'Voice Link', detail: 'Start a private voice call', icon: 'audio', action: 'voice' },
];

export default function PrayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const concept = useMemo(() => haloConceptForUser(user?.uid), [user?.uid]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startingVoice, setStartingVoice] = useState(false);
  const dragY = useSharedValue(0);

  function openMenu() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuOpen(true);
  }

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > 72) {
        runOnJS(openMenu)();
      }
      dragY.value = withSpring(0, { damping: 16, stiffness: 180 });
    });

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

  function choose(item: MenuItem) {
    if (item.action === 'voice') {
      void startVoiceLink();
      return;
    }
    if (!item.href) return;
    setMenuOpen(false);
    router.push(item.href as never);
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <View style={{ position: 'absolute', top: -80, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: concept.washTop }} />
      <View style={{ position: 'absolute', bottom: 80, left: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: concept.washBottom }} />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          Holy ground
        </Text>
        <GestureDetector gesture={pan}>
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
          Drag the halo down
        </Text>
      </View>

      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(44,36,23,0.4)' }}
            onPress={() => setMenuOpen(false)}
          />
          <View
            style={{
              maxHeight: '78%',
              backgroundColor: THEME_COLORS.bg,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingTop: 10,
              paddingBottom: insets.bottom + 12,
            }}
          >
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: THEME_COLORS.border, alignSelf: 'center', marginBottom: 12 }} />
            <Text style={{ ...TYPE.headline, color: THEME_COLORS.text, paddingHorizontal: 22, marginBottom: 8 }}>Prayer</Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
              {MENU.map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => choose(item)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderRadius: 16,
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: THEME_COLORS.goldDim, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={item.icon} size={18} color={THEME_COLORS.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontWeight: '600', fontSize: 16 }}>
                      {item.label}
                    </Text>
                    <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 2 }}>
                      {item.key === 'voice' && startingVoice ? 'Starting…' : item.detail}
                    </Text>
                  </View>
                  <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
