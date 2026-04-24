import { ScrollView, View, Text, Pressable, RefreshControl, Alert, LayoutAnimation, UIManager, Platform, AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { useState, useEffect, useCallback } from 'react';
import { prayerApi, verseApi, prayerRequestApi } from '@/services/api';
import { shareServerImage } from '@/lib/shareServerImage';
import { getGreetingFirstName } from '@/lib/userDisplayName';
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import { useGroupUnread } from '@/contexts/GroupUnreadContext';
import { useGroupLiveRooms } from '@/hooks/useGroups';
import { useDevotionalStreak } from '@/hooks/useHomeStats';
import { Avatar } from '@/components/ui/Avatar';
import { PulsingDot } from '@/components/ui/PulsingDot';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ── Floating geometric shapes for the Daily Verse card ── */
function FloatingGeometrics() {
  const drift1 = useSharedValue(0);
  const drift2 = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    drift1.value = withRepeat(
      withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
    drift2.value = withRepeat(
      withDelay(600, withTiming(1, { duration: 10000, easing: Easing.inOut(Easing.ease) })),
      -1, true,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
      -1, true,
    );
  }, []);

  const circle1 = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift1.value, [0, 1], [0, 18]) },
      { translateY: interpolate(drift1.value, [0, 1], [0, -14]) },
      { scale: interpolate(pulse.value, [0, 1], [1, 1.12]) },
    ],
    opacity: interpolate(pulse.value, [0, 1], [0.36, 0.62]),
  }));

  const circle2 = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift2.value, [0, 1], [0, -12]) },
      { translateY: interpolate(drift2.value, [0, 1], [0, 10]) },
    ],
    opacity: interpolate(drift2.value, [0, 1], [0.3, 0.55]),
  }));

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      {/* Large glow — top right */}
      <Animated.View style={[{
        position: 'absolute', top: -40, right: -40,
        width: 142, height: 142, borderRadius: 71,
        backgroundColor: 'rgba(176,125,32,0.2)',
      }, circle1]} />
      {/* Small circle — bottom left */}
      <Animated.View style={[{
        position: 'absolute', bottom: 12, left: 16,
        width: 50, height: 50, borderRadius: 25,
        backgroundColor: 'rgba(176,125,32,0.16)',
      }, circle2]} />
    </View>
  );
}

/* ── Collapsible prayer card ── */
const PRAYER_COLLAPSED_LINES = 3;

function CollapsiblePrayer({
  content,
  userLiked,
  likesCount,
  onLike,
  onListen,
  listenLabel,
  onShare,
}: {
  content: string;
  userLiked: boolean;
  likesCount: number;
  onLike: () => void;
  onListen: () => void;
  listenLabel: string;
  onShare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const [fullHeight, setFullHeight] = useState(0);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const measured = fullHeight > 0 && collapsedHeight > 0;

  const chevronRotation = useSharedValue(0);
  useEffect(() => {
    chevronRotation.value = withTiming(expanded ? 1 : 0, { duration: 300, easing: Easing.inOut(Easing.ease) });
  }, [expanded]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(chevronRotation.value, [0, 1], [0, 180])}deg` }],
  }));

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.create(300, 'easeInEaseOut', 'opacity'));
    setExpanded((v) => !v);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <View style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 20, padding: 20 }}>
      {/* Hidden full-text measurer */}
      {!measured && (
        <Text
          style={{ position: 'absolute', opacity: 0, top: 0, left: 20, right: 20, fontFamily: 'InterTight_400Regular', fontSize: 15, lineHeight: 26 }}
          onLayout={(e) => { if (fullHeight === 0) setFullHeight(e.nativeEvent.layout.height); }}
        >
          {content}
        </Text>
      )}
      {!measured && (
        <Text
          numberOfLines={PRAYER_COLLAPSED_LINES}
          style={{ position: 'absolute', opacity: 0, top: 0, left: 20, right: 20, fontFamily: 'InterTight_400Regular', fontSize: 15, lineHeight: 26 }}
          onLayout={(e) => {
            if (collapsedHeight === 0) {
              setCollapsedHeight(e.nativeEvent.layout.height);
            }
          }}
          onTextLayout={(e) => {
            if (e.nativeEvent.lines.length >= PRAYER_COLLAPSED_LINES) setNeedsTruncation(true);
          }}
        >
          {content}
        </Text>
      )}

      <Text
        numberOfLines={expanded ? undefined : PRAYER_COLLAPSED_LINES}
        style={{ color: THEME_COLORS.text, fontFamily: 'InterTight_400Regular', fontSize: 15, lineHeight: 26 }}
      >
        {content}
      </Text>

      {needsTruncation && (
        <Pressable
          onPress={toggleExpand}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8 }}
        >
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'InterTight_500Medium', fontSize: 13 }}>
            {expanded ? 'Read less' : 'Read more'}
          </Text>
          <Animated.View style={chevronStyle}>
            <Icon name="chevron-d" size={10} color={THEME_COLORS.gold} />
          </Animated.View>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 8, flexWrap: 'wrap' }}>
        <Pressable
          onPress={onLike}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
            backgroundColor: userLiked ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
            borderWidth: 1,
            borderColor: userLiked ? THEME_COLORS.goldBorder : THEME_COLORS.border,
          }}
        >
          <Icon name="pray" size={14} color={userLiked ? THEME_COLORS.gold : THEME_COLORS.text3} />
          <Text style={{ color: userLiked ? THEME_COLORS.gold : THEME_COLORS.text3, fontFamily: 'InterTight_500Medium', fontSize: 13 }}>
            {likesCount > 0 ? likesCount.toLocaleString() : 'Pray'}
          </Text>
        </Pressable>

        <Pressable
          onPress={onListen}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
            backgroundColor: THEME_COLORS.bg3,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
          }}
        >
          <Icon name="audio" size={14} color={THEME_COLORS.text2} />
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'InterTight_500Medium', fontSize: 13 }}>{listenLabel}</Text>
        </Pressable>

        <Pressable
          onPress={onShare}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
            backgroundColor: THEME_COLORS.bg3,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
          }}
        >
          <Icon name="share" size={14} color={THEME_COLORS.text2} />
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'InterTight_500Medium', fontSize: 13 }}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SkeletonBlock({ height = 120 }: { height?: number }) {
  return (
    <View style={{ height, backgroundColor: THEME_COLORS.bg3, borderRadius: 20, marginBottom: 16 }} />
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, user } = useAuthStore();
  const queryClient = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const { groups: myGroups, totalUnread: groupChatUnread, unreadByGroup, unreadCountByGroup } = useGroupUnread();
  const liveByGroup = useGroupLiveRooms(myGroups.map((g) => g.group_id));
  const { devotionalStreak } = useDevotionalStreak();

  const [homeTabActive, setHomeTabActive] = useState(false);
  const [appForeground, setAppForeground] = useState(AppState.currentState === 'active');
  /** Only true during user pull-to-refresh — not background query refetches (avoids layout jump every ~10s). */
  const [pullRefreshing, setPullRefreshing] = useState(false);

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
          return {
            ...base,
            likes: { liked: false, count: Math.max(0, count - 1) },
          };
        }
        return {
          ...base,
          likes: { liked: true, count: count + 1 },
        };
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
      `/api/today-verse/download?client_date=${encodeURIComponent(today)}`,
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

  const verseListenLabel = activeSource === 'verse' && isSpeaking ? 'Stop' : 'Listen';
  const prayerListenLabel = activeSource === 'prayer' && isSpeaking ? 'Stop' : 'Listen';

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
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 80,
      }}
      showsVerticalScrollIndicator={false}
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
      {/* Greeting row */}
      <Animated.View
        entering={FadeInDown.delay(0).duration(500)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 22,
          marginBottom: 4,
        }}
      >
        <View>
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'InterTight_400Regular', fontSize: 13 }}>
            {dayjs().format('dddd, MMMM D')}
          </Text>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_700Bold', fontSize: 22, marginTop: 2 }}>
            Good {dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'},{' '}
            {getGreetingFirstName(profile, user)}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/activity');
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Activity, prayer wall and group chats"
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: THEME_COLORS.bg3,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <Icon name="bell" size={18} color={THEME_COLORS.text2} />
          {groupChatUnread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 4,
                borderRadius: 9,
                backgroundColor: THEME_COLORS.rose,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'InterTight_700Bold' }}>
                {groupChatUnread > 99 ? '99+' : groupChatUnread}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>

      {/* Daily Verse Card */}
      <Animated.View entering={FadeInDown.delay(80).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 16, marginTop: 16 }}>
        {verseQuery.isLoading ? (
          <SkeletonBlock height={140} />
        ) : (
          <View
            style={{
              backgroundColor: '#f5edd8',
              borderWidth: 1,
              borderColor: THEME_COLORS.goldBorder,
              borderRadius: 24,
              padding: 22,
              overflow: 'hidden',
            }}
          >
            <FloatingGeometrics />
            {/* Pill label */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                backgroundColor: THEME_COLORS.goldDim, borderRadius: 50,
                paddingHorizontal: 10, paddingVertical: 4,
              }}>
                <Icon name="cross" size={9} color={THEME_COLORS.gold} />
                <Text style={{ color: THEME_COLORS.gold, fontFamily: 'InterTight_500Medium', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>Daily Verse</Text>
              </View>
            </View>

            <Text style={{ color: THEME_COLORS.text, fontFamily: 'InterTight_400Regular', fontSize: 15, fontStyle: 'italic', lineHeight: 26, marginBottom: 10 }}>
              "{verseQuery.data?.data?.verse ?? 'For God so loved the world...'}"
            </Text>
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'InterTight_600SemiBold', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
              — {verseQuery.data?.data?.reference ?? 'John 3:16'}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <Pressable
                onPress={() => {
                  if (!user) {
                    Alert.alert('Sign in', 'Sign in to like today’s verse.');
                    return;
                  }
                  verseLikeMutation.mutate(verseUserLiked);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                hitSlop={8}
              >
                <Icon name="heart" size={16} color={verseUserLiked ? THEME_COLORS.rose : THEME_COLORS.text3} />
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_500Medium', fontSize: 13 }}>
                  {verseLikesCount > 0 ? verseLikesCount.toLocaleString() : 'Like'}
                </Text>
              </Pressable>
            </View>

            {/* Action row */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {[
                { key: 'devotional', icon: 'book' as const, label: 'Devotional', onPress: () => router.push('/(tabs)/devotional') },
                { key: 'listen', icon: 'audio' as const, label: verseListenLabel, onPress: handleListenVerse },
                { key: 'share', icon: 'share' as const, label: 'Share', onPress: handleShareVerse },
              ].map((a) => (
                <Pressable
                  key={a.key}
                  onPress={a.onPress}
                  style={{ flex: 1, backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 12, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }}
                >
                  <Icon name={a.icon} size={10} color={THEME_COLORS.gold} />
                  <Text style={{ color: THEME_COLORS.gold, fontFamily: 'InterTight_500Medium', fontSize: 10 }}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </Animated.View>

      {/* Today's Global Prayer */}
      <Animated.View entering={FadeInDown.delay(160).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_700Bold', fontSize: 16 }}>Today's Global Prayer</Text>
        </View>
        {prayerQuery.isLoading ? (
          <SkeletonBlock height={180} />
        ) : (
          <CollapsiblePrayer
            content={prayerQuery.data?.prayer?.content ?? "Loading today's prayer..."}
            userLiked={userLiked}
            likesCount={likesCount}
            onLike={() => likeMutation.mutate(userLiked)}
            onListen={handleListenPrayer}
            listenLabel={prayerListenLabel}
            onShare={handleSharePrayer}
          />
        )}
      </Animated.View>

      {/* Stats row — Groups; Day streak (devotional vs Prayer Wall, higher wins); Wall "I prayed" taps (7 days) */}
      <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            {
              icon: 'groups' as const,
              label: 'Groups',
              hint: groupChatUnread > 0 ? `${groupChatUnread} new message${groupChatUnread === 1 ? '' : 's'}` : 'Your circles',
              value: myGroups.length.toString(),
              color: THEME_COLORS.sage,
              showUnreadDot: groupChatUnread > 0,
            },
            {
              icon: 'flame' as const,
              label: 'Day streak',
              hint: 'Devotional · Wall',
              value: dayStreakDisplay,
              color: THEME_COLORS.gold,
              showUnreadDot: false,
            },
            {
              icon: 'pray' as const,
              label: 'Praying',
              hint: 'Wall · 7 days',
              value: prayingWeeklyDisplay,
              color: THEME_COLORS.rose,
              showUnreadDot: false,
            },
          ].map((s) => (
            <View key={s.label} style={{ flex: 1, backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 16, padding: 14, alignItems: 'center' }}>
              <View style={{ position: 'relative', marginBottom: 6 }}>
                <Icon name={s.icon} size={20} color={s.color} />
                {s.showUnreadDot ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -4,
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: THEME_COLORS.rose,
                      borderWidth: 1.5,
                      borderColor: THEME_COLORS.bg2,
                    }}
                  />
                ) : null}
              </View>
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_700Bold', fontSize: 20 }}>{s.value}</Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 10, marginTop: 1, textAlign: 'center' }}>{s.label}</Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 8, marginTop: 2, opacity: 0.85, textAlign: 'center' }}>{s.hint}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Quick Actions */}
      <Animated.View entering={FadeInDown.delay(240).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 24 }}>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_700Bold', fontSize: 16, marginBottom: 12 }}>Quick Actions</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { icon: 'live' as const, label: 'Join a Room', sub: 'Live prayer rooms', route: '/(tabs)/rooms' as const, qaUnread: false },
            { icon: 'book' as const, label: 'Devotional', sub: 'AI-powered plan', route: '/(tabs)/devotional' as const, qaUnread: false },
            {
              icon: 'groups' as const,
              label: 'My Groups',
              sub: groupChatUnread > 0 ? `${groupChatUnread} unread chat${groupChatUnread === 1 ? '' : 's'}` : 'Prayer circles',
              route: '/(tabs)/groups' as const,
              qaUnread: groupChatUnread > 0,
            },
          ].map((a) => (
            <Pressable key={a.label} onPress={() => router.push(a.route)} style={{ flex: 1 }}>
              <View style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 16, padding: 14, alignItems: 'center' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 8, position: 'relative' }}>
                  <Icon name={a.icon} size={18} color={THEME_COLORS.gold} />
                  {a.qaUnread ? (
                    <View
                      style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: THEME_COLORS.rose,
                        borderWidth: 2,
                        borderColor: THEME_COLORS.bg3,
                      }}
                    />
                  ) : null}
                </View>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'InterTight_600SemiBold', fontSize: 12, textAlign: 'center' }}>{a.label}</Text>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 10, textAlign: 'center', marginTop: 2 }}>{a.sub}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      {/* My Groups preview */}
      <Animated.View entering={FadeInDown.delay(300).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_700Bold', fontSize: 16 }}>My Groups</Text>
          <Pressable onPress={() => router.push('/(tabs)/groups')}>
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'InterTight_500Medium', fontSize: 13 }}>View All</Text>
          </Pressable>
        </View>

        {myGroups.length === 0 ? (
          <Pressable
            onPress={() => router.push('/(tabs)/groups')}
            style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1.5, borderColor: THEME_COLORS.border, borderRadius: 20, padding: 20, alignItems: 'center', borderStyle: 'dashed' }}
          >
            <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Icon name="groups" size={22} color={THEME_COLORS.text3} />
            </View>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'InterTight_600SemiBold', fontSize: 14, marginBottom: 4 }}>No groups yet</Text>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 12, textAlign: 'center' }}>Join a prayer group and start praying together</Text>
          </Pressable>
        ) : (
          <View style={{ gap: 10 }}>
            {myGroups.slice(0, 2).map((g) => {
              const isLive = !!liveByGroup[g.group_id];
              return (
                <Pressable
                  key={g.group_id}
                  onPress={() => router.push(`/group/${g.group_id}` as any)}
                  style={{
                    backgroundColor: THEME_COLORS.bg2,
                    borderWidth: 1,
                    borderColor: isLive ? 'rgba(52,211,153,0.3)' : THEME_COLORS.border,
                    borderRadius: 18,
                    padding: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{ position: 'relative' }}>
                    <Avatar name={g.name} size={44} />
                    {isLive ? (
                      <View style={{ position: 'absolute', top: -4, right: -4 }}>
                        <PulsingDot size={6} color="#34d399" />
                      </View>
                    ) : unreadByGroup[g.group_id] ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: -2,
                          right: -4,
                          minWidth: 18,
                          height: 18,
                          paddingHorizontal: 4,
                          borderRadius: 9,
                          backgroundColor: THEME_COLORS.rose,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1.5,
                          borderColor: THEME_COLORS.bg2,
                        }}
                      >
                        <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'InterTight_700Bold' }}>
                          {(unreadCountByGroup[g.group_id] ?? 0) > 99 ? '99+' : unreadCountByGroup[g.group_id]}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <Text style={{ color: THEME_COLORS.text, fontFamily: 'InterTight_600SemiBold', fontSize: 15 }}>{g.name}</Text>
                      {isLive && (
                        <View style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          backgroundColor: 'rgba(52,211,153,0.12)',
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                          borderRadius: 6,
                        }}>
                          <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#34d399' }} />
                          <Text style={{ color: '#34d399', fontFamily: 'InterTight_600SemiBold', fontSize: 10 }}>LIVE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: unreadByGroup[g.group_id] ? THEME_COLORS.rose : THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 12 }}>
                      {isLive
                        ? `${liveByGroup[g.group_id].participants?.length ?? 0} praying now`
                        : unreadByGroup[g.group_id]
                          ? `${unreadCountByGroup[g.group_id]} unread message${unreadCountByGroup[g.group_id] === 1 ? '' : 's'}`
                        : `${g.member_count} ${g.member_count === 1 ? 'member' : 'members'}`}
                    </Text>
                  </View>
                  <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
                </Pressable>
              );
            })}
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}
