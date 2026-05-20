import {
  ScrollView,
  View,
  Text,
  Pressable,
  RefreshControl,
  Alert,
  LayoutAnimation,
  UIManager,
  Platform,
  AppState,
  useWindowDimensions,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import Animated, {
  FadeInDown,
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  interpolate,
  useAnimatedScrollHandler,
  type SharedValue,
} from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { prayerApi, verseApi, prayerRequestApi } from '@/services/api';
import { shareServerImage } from '@/lib/shareServerImage';
import { getGreetingFirstName } from '@/lib/userDisplayName';
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { pickVerseTheme, type VerseTheme } from '@/lib/verseThemes';
import { AppText } from '@/components/ui/AppText';
import Icon from '@/components/ui/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassPill } from '@/components/ui/GlassPill';
import { GlassActionBar } from '@/components/ui/GlassActionBar';
import { useGroupUnread } from '@/contexts/GroupUnreadContext';
import { useGroupLiveRooms } from '@/hooks/useGroups';
import { useDevotionalStreak } from '@/hooks/useHomeStats';
import { Avatar } from '@/components/ui/Avatar';
import { PulsingDot } from '@/components/ui/PulsingDot';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

// ─── Page ambience — soft drifting tinted blobs behind the scroll ───────────
// Glass blurs whatever is behind it. On a flat cream canvas there is nothing
// to reveal, so cards stop reading as glass. These low-opacity blobs give every
// glass surface on the page real color to filter through — same trick iOS uses
// to make Control Center glass pop on top of the wallpaper.

function HomeAmbience() {
  const d1 = useSharedValue(0);
  const d2 = useSharedValue(0);
  const d3 = useSharedValue(0);

  useEffect(() => {
    d1.value = withRepeat(withTiming(1, { duration: 14000, easing: Easing.inOut(Easing.ease) }), -1, true);
    d2.value = withRepeat(withDelay(900, withTiming(1, { duration: 17000, easing: Easing.inOut(Easing.ease) })), -1, true);
    d3.value = withRepeat(withDelay(1800, withTiming(1, { duration: 19000, easing: Easing.inOut(Easing.ease) })), -1, true);
  }, []);

  const gold = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(d1.value, [0, 1], [-30, 40]) },
      { translateY: interpolate(d1.value, [0, 1], [-20, 30]) },
    ],
  }));
  const sage = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(d2.value, [0, 1], [30, -20]) },
      { translateY: interpolate(d2.value, [0, 1], [10, -30]) },
    ],
  }));
  const rose = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(d3.value, [0, 1], [-15, 25]) },
      { translateY: interpolate(d3.value, [0, 1], [20, -10]) },
    ],
  }));

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      <Animated.View
        style={[
          { position: 'absolute', top: -120, right: -100, width: 360, height: 360, borderRadius: 180, backgroundColor: 'rgba(201,146,48,0.22)' },
          gold,
        ]}
      />
      <Animated.View
        style={[
          { position: 'absolute', top: '38%', left: -120, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(74,124,94,0.16)' },
          sage,
        ]}
      />
      <Animated.View
        style={[
          { position: 'absolute', bottom: -100, right: -80, width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(176,90,80,0.14)' },
          rose,
        ]}
      />
    </View>
  );
}

// ─── Verse hero — animated blobs (parallax-tied) ─────────────────────────────

function VerseHeroBlobs({
  scrollY,
  colors,
}: {
  scrollY: SharedValue<number>;
  colors: [string, string, string];
}) {
  const drift1 = useSharedValue(0);
  const drift2 = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    drift1.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.ease) }), -1, true);
    drift2.value = withRepeat(withDelay(700, withTiming(1, { duration: 11000, easing: Easing.inOut(Easing.ease) })), -1, true);
    pulse.value = withRepeat(withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);

  const blob1 = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift1.value, [0, 1], [0, 28]) },
      { translateY: interpolate(drift1.value, [0, 1], [0, -22]) + scrollY.value * -0.15 },
      { scale: interpolate(pulse.value, [0, 1], [1, 1.14]) },
    ],
    opacity: interpolate(pulse.value, [0, 1], [0.55, 0.78]),
  }));

  const blob2 = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift2.value, [0, 1], [0, -18]) },
      { translateY: interpolate(drift2.value, [0, 1], [0, 14]) + scrollY.value * -0.08 },
    ],
    opacity: interpolate(drift2.value, [0, 1], [0.42, 0.65]),
  }));

  const blob3 = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift1.value, [0, 1], [10, -10]) },
      { translateY: scrollY.value * -0.2 },
    ],
    opacity: 0.35,
  }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={[{ position: 'absolute', top: -60, right: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: colors[0] }, blob1]} />
      <Animated.View style={[{ position: 'absolute', bottom: -30, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: colors[1] }, blob2]} />
      <Animated.View style={[{ position: 'absolute', top: '40%', right: '20%', width: 90, height: 90, borderRadius: 45, backgroundColor: colors[2] }, blob3]} />
    </View>
  );
}

// ─── Audio waveform — shown while TTS is speaking ────────────────────────────

function ListenWaveform({ active, color }: { active: boolean; color: string }) {
  const a = useSharedValue(0.3);
  const b = useSharedValue(0.6);
  const c = useSharedValue(0.4);

  useEffect(() => {
    if (active) {
      a.value = withRepeat(withTiming(1, { duration: 420 }), -1, true);
      b.value = withRepeat(withDelay(120, withTiming(1, { duration: 520 })), -1, true);
      c.value = withRepeat(withDelay(240, withTiming(1, { duration: 360 })), -1, true);
    } else {
      a.value = withTiming(0.3);
      b.value = withTiming(0.6);
      c.value = withTiming(0.4);
    }
  }, [active]);

  const sA = useAnimatedStyle(() => ({ height: interpolate(a.value, [0, 1], [4, 14]) }));
  const sB = useAnimatedStyle(() => ({ height: interpolate(b.value, [0, 1], [6, 16]) }));
  const sC = useAnimatedStyle(() => ({ height: interpolate(c.value, [0, 1], [4, 12]) }));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 }}>
      <Animated.View style={[{ width: 2, borderRadius: 1, backgroundColor: color }, sA]} />
      <Animated.View style={[{ width: 2, borderRadius: 1, backgroundColor: color }, sB]} />
      <Animated.View style={[{ width: 2, borderRadius: 1, backgroundColor: color }, sC]} />
    </View>
  );
}

// ─── Glass action button (used inside the hero action bar) ───────────────────

function HeroActionButton({
  icon,
  label,
  onPress,
  active,
  activeColor,
  showWaveform,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
  /** Color applied to the label, count, and waveform when `active` is true. */
  activeColor?: string;
  showWaveform?: boolean;
  count?: number;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onPressIn = useCallback(() => { scale.value = withTiming(0.94, { duration: 80 }); }, []);
  const onPressOut = useCallback(() => { scale.value = withTiming(1, { duration: 120 }); }, []);

  const activeTint = activeColor ?? THEME_COLORS.gold;

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flex: 1 }}
    >
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 4 }, animatedStyle]}>
        <View style={{ height: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }}>
          {showWaveform
            ? <ListenWaveform active color={active ? activeTint : THEME_COLORS.text2} />
            : icon}
          {count != null && count > 0 ? (
            <Text
              style={{
                ...TYPE.caption2,
                color: active ? activeTint : THEME_COLORS.text2,
                fontVariant: ['tabular-nums'],
              }}
              maxFontSizeMultiplier={1.3}
            >
              {count > 9999 ? `${(count / 1000).toFixed(1)}k` : count.toLocaleString()}
            </Text>
          ) : null}
        </View>
        <Text
          style={{
            ...TYPE.capsLabel,
            color: active ? activeTint : THEME_COLORS.text2,
          }}
          maxFontSizeMultiplier={1.2}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Collapsible prayer card (now on glass) ──────────────────────────────────

const PRAYER_COLLAPSED_LINES = 2;

function CollapsiblePrayer({
  content,
  userLiked,
  likesCount,
  onLike,
  onListen,
  listenLabel,
  isListening,
  onShare,
}: {
  content: string;
  userLiked: boolean;
  likesCount: number;
  onLike: () => void;
  onListen: () => void;
  listenLabel: string;
  isListening: boolean;
  onShare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);

  const chevronRotation = useSharedValue(0);
  useEffect(() => {
    chevronRotation.value = withTiming(expanded ? 1 : 0, { duration: 280, easing: Easing.inOut(Easing.ease) });
  }, [expanded]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(chevronRotation.value, [0, 1], [0, 180])}deg` }],
  }));

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.create(280, 'easeInEaseOut', 'opacity'));
    setExpanded((v) => !v);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <GlassCard tone="warm" intensity="card" radius={22} style={{ padding: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon name="pray" size={12} color={THEME_COLORS.gold} />
        <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.gold }}>Today&apos;s Global Prayer</Text>
      </View>

      <Text
        numberOfLines={expanded ? undefined : PRAYER_COLLAPSED_LINES}
        onTextLayout={(e) => {
          if (!expanded && e.nativeEvent.lines.length >= PRAYER_COLLAPSED_LINES && !needsTruncation) {
            setNeedsTruncation(true);
          }
        }}
        style={{ ...TYPE.subheadline, color: THEME_COLORS.text }}
      >
        {content}
      </Text>

      {needsTruncation && (
        <Pressable
          onPress={toggleExpand}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8 }}
        >
          <Text style={{ ...TYPE.footnote, color: THEME_COLORS.gold, fontWeight: '500', fontFamily: iosFont('500') }}>
            {expanded ? 'Read less' : 'Read more'}
          </Text>
          <Animated.View style={chevronStyle}>
            <Icon name="chevron-d" size={10} color={THEME_COLORS.gold} />
          </Animated.View>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
        <Pressable
          onPress={onLike}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
            backgroundColor: userLiked ? THEME_COLORS.goldDim : 'rgba(255,253,247,0.55)',
            borderWidth: 1,
            borderColor: userLiked ? THEME_COLORS.goldBorder : THEME_COLORS.border,
          }}
        >
          <Icon name="pray" size={12} color={userLiked ? THEME_COLORS.gold : THEME_COLORS.text3} />
          <Text
            style={{
              ...TYPE.caption1,
              color: userLiked ? THEME_COLORS.gold : THEME_COLORS.text3,
              fontWeight: '500',
              fontFamily: iosFont('500'),
              fontVariant: ['tabular-nums'],
            }}
          >
            {likesCount > 0 ? likesCount.toLocaleString() : 'Pray'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onListen}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
            backgroundColor: 'rgba(255,253,247,0.55)',
            borderWidth: 1, borderColor: THEME_COLORS.border,
          }}
        >
          {isListening
            ? <ListenWaveform active color={THEME_COLORS.text2} />
            : <Icon name="audio" size={12} color={THEME_COLORS.text2} />}
          <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text2, fontWeight: '500', fontFamily: iosFont('500') }}>{listenLabel}</Text>
        </Pressable>

        <Pressable
          onPress={onShare}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
            backgroundColor: 'rgba(255,253,247,0.55)',
            borderWidth: 1, borderColor: THEME_COLORS.border,
          }}
        >
          <Icon name="share" size={12} color={THEME_COLORS.text2} />
          <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text2, fontWeight: '500', fontFamily: iosFont('500') }}>Share</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

function SkeletonBlock({ height = 120, radius = 22 }: { height?: number; radius?: number }) {
  return (
    <View style={{ height, backgroundColor: 'rgba(255,253,247,0.55)', borderRadius: radius, borderWidth: 1, borderColor: THEME_COLORS.border }} />
  );
}

// ─── Home screen ─────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, user } = useAuthStore();
  const queryClient = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const { groups: myGroups, totalUnread: groupChatUnread, unreadByGroup, unreadCountByGroup } = useGroupUnread();
  const liveByGroup = useGroupLiveRooms(myGroups.map((g) => g.group_id));
  const { devotionalStreak } = useDevotionalStreak();
  const { height: viewportHeight } = useWindowDimensions();

  const [homeTabActive, setHomeTabActive] = useState(false);
  const [appForeground, setAppForeground] = useState(AppState.currentState === 'active');
  /** Only true during user pull-to-refresh — not background query refetches (avoids layout jump every ~10s). */
  const [pullRefreshing, setPullRefreshing] = useState(false);

  // Parallax for the hero blobs and subtle hero scale-down on scroll.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => { scrollY.value = e.contentOffset.y; },
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      setAppForeground(next === 'active');
    });
    return () => sub.remove();
  }, []);

  const { toggle: speechToggle, stop: stopSpeech, isSpeaking, activeSource } = useSpeechPlayback();

  useFocusEffect(
    useCallback(() => {
      setHomeTabActive(true);
      if (user) {
        queryClient.refetchQueries({ queryKey: ['home-prayer-metrics'] });
      }
      return () => {
        setHomeTabActive(false);
        stopSpeech();
      };
    }, [user, queryClient, stopSpeech])
  );

  const pollMetrics = !!user && homeTabActive && appForeground;

  const homePrayerMetricsQuery = useQuery({
    queryKey: ['home-prayer-metrics'],
    queryFn: () => prayerRequestApi.getHomePrayerMetrics(),
    enabled: !!user,
    staleTime: 8_000,
    refetchInterval: pollMetrics ? 10_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const prayerQuery = useQuery({
    queryKey: ['daily-prayer', today],
    queryFn: () => prayerApi.getToday(today),
  });

  const verseQuery = useQuery({
    queryKey: ['daily-verse', today],
    queryFn: () => verseApi.getToday(today),
  });

  const interactionsQuery = useQuery({
    queryKey: ['prayer-interactions', today],
    queryFn: () => prayerApi.getInteractions(today),
  });

  const verseInteractionsQuery = useQuery({
    queryKey: ['verse-interactions', today],
    queryFn: () => verseApi.getInteractions(today),
  });

  const likeMutation = useMutation({
    mutationFn: (liked: boolean) =>
      liked ? prayerApi.unlike(today) : prayerApi.like(today),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prayer-interactions', today] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert('Sign in to like prayers'),
  });

  type VerseInteractionsCache = {
    likes?: { count: number; liked: boolean };
    shares?: { count: number };
    comments?: { count: number };
  };

  const verseLikeMutation = useMutation({
    mutationFn: (currentlyLiked: boolean) =>
      currentlyLiked ? verseApi.unlike(today) : verseApi.like(today),
    onMutate: async (currentlyLiked) => {
      await queryClient.cancelQueries({ queryKey: ['verse-interactions', today] });
      const previous = queryClient.getQueryData<VerseInteractionsCache>(['verse-interactions', today]);
      queryClient.setQueryData<VerseInteractionsCache>(['verse-interactions', today], (old) => {
        const base = old ?? {};
        const likes = base.likes ?? { count: 0, liked: false };
        const count = typeof likes.count === 'number' ? likes.count : 0;
        if (currentlyLiked) {
          return { ...base, likes: { liked: false, count: Math.max(0, count - 1) } };
        }
        return { ...base, likes: { liked: true, count: count + 1 } };
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['verse-interactions', today], ctx.previous);
      }
      Alert.alert('Sign in to like verses');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['verse-interactions', today] });
    },
  });

  const verseText = verseQuery.data?.data?.verse ?? '';
  const verseRef = verseQuery.data?.data?.reference ?? '';

  // Pick the verse mood theme — drives the hero gradient, accent, and blob
  // colors. Stable per (text, ref, date) so it doesn't flicker on re-renders.
  const verseTheme: VerseTheme = useMemo(
    () => pickVerseTheme(verseText, verseRef, today),
    [verseText, verseRef, today],
  );

  // Hero sized to dominate the first scroll without crowding small phones.
  const heroHeight = useMemo(
    () => Math.min(Math.max(viewportHeight * 0.62, 460), 620),
    [viewportHeight]
  );

  // ─── Heart pop animation on verse like ────────────────────────────────────
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));
  const popHeart = useCallback(() => {
    heartScale.value = withSequence(
      withTiming(1.35, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) })
    );
  }, []);

  async function handleSharePrayer() {
    const content = prayerQuery.data?.prayer?.content;
    const fallback = content
      ? `Today's Prayer from Divine Bridge:\n\n${content}\n\nJoin us at divinebridge.io`
      : `Today's global prayer on Divine Bridge — divinebridge.io`;
    await shareServerImage(
      `/api/prayer/prayer/download?client_date=${encodeURIComponent(today)}`,
      `divine_bridge_prayer_${today}.jpg`,
      fallback
    );
    if (content && user) {
      await prayerApi.share(today).catch(() => null);
    }
  }

  async function handleShareVerse() {
    const fallback =
      verseText && verseRef
        ? `Today's Verse (${verseRef}):\n\n"${verseText}"\n\nDivine Bridge — divinebridge.io`
        : `Today's verse on Divine Bridge — divinebridge.io`;
    await shareServerImage(
      `/api/today-verse/hero-image?client_date=${encodeURIComponent(today)}`,
      `divine_bridge_verse_${today}.jpg`,
      fallback
    );
    if (verseText && user) {
      await verseApi.share(today).catch(() => null);
    }
  }

  function handleListenVerse() {
    if (!verseText) return;
    speechToggle([`Verse. ${verseText}`, `Reference: ${verseRef || 'Scripture'}`], 'verse');
  }

  function handleListenPrayer() {
    const content = prayerQuery.data?.prayer?.content?.trim();
    if (!content) return;
    speechToggle([`Today's prayer. ${content}`], 'prayer');
  }

  function handleVerseLike() {
    if (!user) {
      Alert.alert('Sign in', "Sign in to like today's verse.");
      return;
    }
    popHeart();
    verseLikeMutation.mutate(verseUserLiked);
  }

  function handleOpenVerseReader() {
    if (!verseText) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/verse-reader', params: { client_date: today } } as any);
  }

  const verseIsListening = activeSource === 'verse' && isSpeaking;
  const prayerIsListening = activeSource === 'prayer' && isSpeaking;
  const verseListenLabel = verseIsListening ? 'Stop' : 'Listen';
  const prayerListenLabel = prayerIsListening ? 'Stop' : 'Listen';

  const userLiked = interactionsQuery.data?.likes?.liked ?? false;
  const likesCount = interactionsQuery.data?.likes?.count ?? 0;
  const verseUserLiked = verseInteractionsQuery.data?.likes?.liked ?? false;
  const verseLikesCount = verseInteractionsQuery.data?.likes?.count ?? 0;

  const wallStreakDays = homePrayerMetricsQuery.data?.wall_pray_streak_days ?? 0;
  const wallPrayLast7 = homePrayerMetricsQuery.data?.wall_pray_last_7_days ?? 0;
  const dayStreakCombined = user ? Math.max(devotionalStreak, wallStreakDays) : 0;
  const dayStreakDisplay = user ? String(dayStreakCombined) : '—';
  const prayingWeeklyDisplay =
    !user
      ? '—'
      : homePrayerMetricsQuery.isLoading || homePrayerMetricsQuery.isError
        ? '—'
        : String(wallPrayLast7);

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      {/* Ambient color so glass surfaces have something to filter. */}
      <HomeAmbience />

      <AnimatedScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 96,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
        <RefreshControl
          refreshing={pullRefreshing}
          onRefresh={async () => {
            setPullRefreshing(true);
            try {
              const tasks = [
                queryClient.refetchQueries({ queryKey: ['daily-prayer', today] }),
                queryClient.refetchQueries({ queryKey: ['daily-verse', today] }),
                queryClient.refetchQueries({ queryKey: ['prayer-interactions', today] }),
                queryClient.refetchQueries({ queryKey: ['verse-interactions', today] }),
              ];
              if (user) {
                tasks.push(queryClient.refetchQueries({ queryKey: ['home-prayer-metrics'] }));
              }
              await Promise.all(tasks);
            } finally {
              setPullRefreshing(false);
            }
          }}
          tintColor={THEME_COLORS.gold}
        />
      }
    >
      {/* Compact greeting strip */}
      <Animated.View
        entering={FadeInDown.delay(0).duration(420)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          marginBottom: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3 }}>
            {dayjs().format('dddd, MMMM D').toUpperCase()}
          </Text>
          <Text style={{ ...TYPE.headline, color: THEME_COLORS.text, marginTop: 2 }} numberOfLines={1}>
            Good {dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'},{' '}
            {getGreetingFirstName(profile, user)}
          </Text>
        </View>
        <GlassPill
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/activity');
          }}
          accessibilityLabel="Activity, prayer wall and group chats"
          radius={14}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={8}
        >
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={18} color={THEME_COLORS.text2} />
            {groupChatUnread > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  minWidth: 16,
                  height: 16,
                  paddingHorizontal: 4,
                  borderRadius: 8,
                  backgroundColor: THEME_COLORS.rose,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ ...TYPE.caption2, color: '#fff', fontWeight: '700', fontFamily: iosFont('700') }}>
                  {groupChatUnread > 99 ? '99+' : groupChatUnread}
                </Text>
              </View>
            ) : null}
          </View>
        </GlassPill>
      </Animated.View>

      {/* ─── Verse Hero ────────────────────────────────────────────────────── */}
      <Animated.View
        entering={FadeIn.delay(60).duration(500)}
        style={{ paddingHorizontal: 16, marginBottom: 16 }}
      >
        {verseQuery.isLoading ? (
          <SkeletonBlock height={heroHeight} radius={28} />
        ) : (
          <Pressable onPress={handleOpenVerseReader} accessibilityRole="button" accessibilityLabel="Open verse reader">
            <View
              style={{
                height: heroHeight,
                borderRadius: 28,
                overflow: 'hidden',
                backgroundColor: verseTheme.baseColor,
              }}
            >
              {/* Diagonal mood gradient via react-native-svg (already in the
                  dev client — no native rebuild needed). Stops are sourced
                  from the verse theme so a Hope verse reads as a sunrise,
                  Peace as sage stillness, etc. The SVG id includes the theme
                  id so React Native diff-applies the new gradient cleanly
                  when the verse (and therefore the theme) changes. */}
              <Svg
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              >
                <Defs>
                  <SvgLinearGradient
                    id={`verseHeroGradient-${verseTheme.id}`}
                    x1="0" y1="0" x2="1" y2="1"
                  >
                    <Stop offset="0" stopColor={verseTheme.gradient[0]} stopOpacity="1" />
                    <Stop offset="0.55" stopColor={verseTheme.gradient[1]} stopOpacity="1" />
                    <Stop offset="1" stopColor={verseTheme.gradient[2]} stopOpacity="1" />
                  </SvgLinearGradient>
                </Defs>
                <Rect
                  x="0" y="0" width="100" height="100"
                  fill={`url(#verseHeroGradient-${verseTheme.id})`}
                />
              </Svg>

              {/* Themed parallax blobs */}
              <VerseHeroBlobs scrollY={scrollY} colors={verseTheme.blobs} />

              {/* Top: cap-label pill + share */}
              <View
                style={{
                  position: 'absolute',
                  top: 22,
                  left: 22,
                  right: 22,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <GlassPill tone={verseTheme.pillTone} radius={999} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="cross" size={10} color={verseTheme.accent} />
                    <Text style={{ ...TYPE.capsLabel, color: verseTheme.accent }}>{verseTheme.label}</Text>
                  </View>
                </GlassPill>

                <GlassPill
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    handleShareVerse();
                  }}
                  accessibilityLabel="Share today's verse"
                  radius={14}
                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
                  hitSlop={8}
                >
                  <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="share" size={14} color={THEME_COLORS.text2} />
                  </View>
                </GlassPill>
              </View>

              {/* Verse body — centered vertically */}
              <View
                style={{
                  flex: 1,
                  paddingHorizontal: 28,
                  paddingTop: 72,
                  paddingBottom: 100,
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily: iosFont('600'),
                    fontSize: 30,
                    lineHeight: 38,
                    letterSpacing: -0.5,
                    color: THEME_COLORS.text,
                    fontWeight: '600',
                  }}
                  numberOfLines={9}
                >
                  &ldquo;{verseText || 'For God so loved the world…'}&rdquo;
                </Text>
                <Text
                  style={{
                    ...TYPE.capsLabel,
                    color: verseTheme.accent,
                    marginTop: 18,
                    letterSpacing: 1.4,
                    fontSize: 12,
                  }}
                >
                  — {verseRef || 'John 3:16'}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
                  <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3 }}>
                    Tap to open the reader
                  </Text>
                  <Icon name="chevron-r" size={12} color={THEME_COLORS.text3} />
                </View>
              </View>

              {/* Bottom glass action bar */}
              <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
                <GlassActionBar radius={20}>
                  <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                    <HeroActionButton
                      icon={
                        <Animated.View style={heartStyle}>
                          <Icon
                            name="heart"
                            size={18}
                            color={verseUserLiked ? THEME_COLORS.rose : THEME_COLORS.text2}
                          />
                        </Animated.View>
                      }
                      label={verseUserLiked ? 'Liked' : 'Like'}
                      onPress={handleVerseLike}
                      active={verseUserLiked}
                      activeColor={THEME_COLORS.rose}
                      count={verseLikesCount}
                    />
                    <View style={{ width: 1, marginVertical: 10, backgroundColor: 'rgba(44,36,23,0.08)' }} />
                    <HeroActionButton
                      icon={<Icon name="audio" size={18} color={verseIsListening ? verseTheme.accent : THEME_COLORS.text2} />}
                      label={verseListenLabel}
                      onPress={handleListenVerse}
                      active={verseIsListening}
                      activeColor={verseTheme.accent}
                      showWaveform={verseIsListening}
                    />
                    <View style={{ width: 1, marginVertical: 10, backgroundColor: 'rgba(44,36,23,0.08)' }} />
                    <HeroActionButton
                      icon={<Icon name="book" size={18} color={THEME_COLORS.text2} />}
                      label="Devotional"
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push('/(tabs)/devotional');
                      }}
                    />
                  </View>
                </GlassActionBar>
              </View>
            </View>
          </Pressable>
        )}
      </Animated.View>

      {/* ─── Today's Global Prayer (glass) ─────────────────────────────────── */}
      <Animated.View entering={FadeInDown.delay(140).duration(420)} style={{ paddingHorizontal: 16, marginBottom: 14 }}>
        {prayerQuery.isLoading ? (
          <SkeletonBlock height={140} />
        ) : (
          <CollapsiblePrayer
            content={prayerQuery.data?.prayer?.content ?? "Loading today's prayer..."}
            userLiked={userLiked}
            likesCount={likesCount}
            onLike={() => likeMutation.mutate(userLiked)}
            onListen={handleListenPrayer}
            listenLabel={prayerListenLabel}
            isListening={prayerIsListening}
            onShare={handleSharePrayer}
          />
        )}
      </Animated.View>

      {/* ─── Combined stats + quick actions (glass strip) ──────────────────── */}
      <Animated.View entering={FadeInDown.delay(200).duration(420)} style={{ paddingHorizontal: 16, marginBottom: 14 }}>
        <GlassCard tone="default" intensity="card" radius={22} style={{ padding: 14, gap: 12 }}>
          {/* Stats row */}
          <View style={{ flexDirection: 'row' }}>
            {[
              {
                key: 'groups',
                icon: 'groups' as const,
                label: 'Groups',
                value: myGroups.length.toString(),
                color: THEME_COLORS.sage,
                showDot: groupChatUnread > 0,
              },
              {
                key: 'streak',
                icon: 'flame' as const,
                label: 'Day Streak',
                value: dayStreakDisplay,
                color: THEME_COLORS.gold,
              },
              {
                key: 'pray',
                icon: 'pray' as const,
                label: 'Praying · 7d',
                value: prayingWeeklyDisplay,
                color: THEME_COLORS.rose,
              },
            ].map((s, i) => (
              <View key={s.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {i > 0 && (
                  <View style={{ width: 1, height: 32, backgroundColor: 'rgba(44,36,23,0.08)', marginRight: 10 }} />
                )}
                <View style={{ position: 'relative' }}>
                  <Icon name={s.icon} size={18} color={s.color} />
                  {s.showDot ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: -2,
                        right: -3,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: THEME_COLORS.rose,
                        borderWidth: 1.5,
                        borderColor: '#fff',
                      }}
                    />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      ...TYPE.title3,
                      color: THEME_COLORS.text,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {s.value}
                  </Text>
                  <Text style={{ ...TYPE.caption2, color: THEME_COLORS.text3, textTransform: 'none', letterSpacing: 0 }}>
                    {s.label}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ height: 1, backgroundColor: 'rgba(44,36,23,0.06)' }} />

          {/* Quick actions row */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { icon: 'live' as const, label: 'Join Room', route: '/(tabs)/rooms' as const, qaUnread: false },
              { icon: 'book' as const, label: 'Devotional', route: '/(tabs)/devotional' as const, qaUnread: false },
              { icon: 'groups' as const, label: 'My Groups', route: '/(tabs)/groups' as const, qaUnread: groupChatUnread > 0 },
            ].map((a) => (
              <Pressable
                key={a.label}
                onPress={() => router.push(a.route)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 10,
                  borderRadius: 14,
                  backgroundColor: 'rgba(176,125,32,0.10)',
                  borderWidth: 1,
                  borderColor: 'rgba(176,125,32,0.18)',
                }}
              >
                <View style={{ position: 'relative' }}>
                  <Icon name={a.icon} size={14} color={THEME_COLORS.gold} />
                  {a.qaUnread ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: -3,
                        right: -3,
                        width: 7,
                        height: 7,
                        borderRadius: 3.5,
                        backgroundColor: THEME_COLORS.rose,
                      }}
                    />
                  ) : null}
                </View>
                <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, fontWeight: '600', fontFamily: iosFont('600') }}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </GlassCard>
      </Animated.View>

      {/* ─── My Groups preview (glass rows) ────────────────────────────────── */}
      <Animated.View entering={FadeInDown.delay(260).duration(420)} style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 4 }}>
          <Text style={{ ...TYPE.headline, color: THEME_COLORS.text }}>My Groups</Text>
          <Pressable onPress={() => router.push('/(tabs)/groups')} hitSlop={8}>
            <Text style={{ ...TYPE.footnote, color: THEME_COLORS.gold, fontWeight: '500', fontFamily: iosFont('500') }}>View All</Text>
          </Pressable>
        </View>

        {myGroups.length === 0 ? (
          <Pressable onPress={() => router.push('/(tabs)/groups')}>
            <GlassCard
              tone="default"
              intensity="subtle"
              radius={20}
              bordered={false}
              style={{ padding: 20, alignItems: 'center', borderWidth: 1.5, borderColor: THEME_COLORS.border, borderStyle: 'dashed' }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(44,36,23,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <Icon name="groups" size={20} color={THEME_COLORS.text3} />
              </View>
              <Text style={{ ...TYPE.callout, color: THEME_COLORS.text, marginBottom: 2 }}>No groups yet</Text>
              <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, textAlign: 'center' }}>
                Join a prayer group and start praying together
              </Text>
            </GlassCard>
          </Pressable>
        ) : (
          <View style={{ gap: 10 }}>
            {myGroups.slice(0, 2).map((g) => {
              const isLive = !!liveByGroup[g.group_id];
              return (
                <Pressable
                  key={g.group_id}
                  onPress={() => router.push(`/group/${g.group_id}` as any)}
                >
                  <GlassCard
                    tone={isLive ? 'sage' : 'default'}
                    intensity="card"
                    radius={18}
                    style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  >
                    <View style={{ position: 'relative' }}>
                      <Avatar name={g.name} size={42} />
                      {isLive ? (
                        <View style={{ position: 'absolute', top: -3, right: -3 }}>
                          <PulsingDot size={6} color="#34d399" />
                        </View>
                      ) : unreadByGroup[g.group_id] ? (
                        <View
                          style={{
                            position: 'absolute',
                            top: -2,
                            right: -3,
                            minWidth: 18,
                            height: 18,
                            paddingHorizontal: 4,
                            borderRadius: 9,
                            backgroundColor: THEME_COLORS.rose,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 1.5,
                            borderColor: '#fffaf2',
                          }}
                        >
                          <Text style={{ ...TYPE.caption2, color: '#fff', fontWeight: '700', fontFamily: iosFont('700') }}>
                            {(unreadCountByGroup[g.group_id] ?? 0) > 99 ? '99+' : unreadCountByGroup[g.group_id]}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                        <Text style={{ ...TYPE.callout, color: THEME_COLORS.text, fontWeight: '600', fontFamily: iosFont('600') }} numberOfLines={1}>
                          {g.name}
                        </Text>
                        {isLive && (
                          <View style={{
                            flexDirection: 'row', alignItems: 'center', gap: 4,
                            backgroundColor: 'rgba(52,211,153,0.16)',
                            paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
                          }}>
                            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#34d399' }} />
                            <Text style={{ ...TYPE.capsLabel, color: '#2f855a' }}>LIVE</Text>
                          </View>
                        )}
                      </View>
                      <Text
                        style={{
                          ...TYPE.footnote,
                          color: unreadByGroup[g.group_id] ? THEME_COLORS.rose : THEME_COLORS.text3,
                        }}
                        numberOfLines={1}
                      >
                        {isLive
                          ? `${liveByGroup[g.group_id].participants?.length ?? 0} praying now`
                          : unreadByGroup[g.group_id]
                            ? `${unreadCountByGroup[g.group_id]} unread message${unreadCountByGroup[g.group_id] === 1 ? '' : 's'}`
                            : `${g.member_count} ${g.member_count === 1 ? 'member' : 'members'}`}
                      </Text>
                    </View>
                    <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
                  </GlassCard>
                </Pressable>
              );
            })}
          </View>
        )}
      </Animated.View>
    </AnimatedScrollView>
    </View>
  );
}
