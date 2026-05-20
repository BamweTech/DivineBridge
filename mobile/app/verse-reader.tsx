import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';

import { verseApi } from '@/services/api';
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback';
import { useAuthStore } from '@/stores/authStore';
import { shareServerImage } from '@/lib/shareServerImage';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { pickVerseTheme } from '@/lib/verseThemes';
import Icon from '@/components/ui/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassPill } from '@/components/ui/GlassPill';
import { GlassActionBar } from '@/components/ui/GlassActionBar';

/**
 * Immersive read view for today's verse.
 *
 * Presented as a `formSheet` on iOS (pull-down dismisses), and as a regular
 * slide-up modal on Android. Reuses the same `daily-verse` and
 * `verse-interactions` React Query keys as the home screen so the like state
 * stays in sync without an extra fetch.
 */

type VerseInteractionsCache = {
  likes?: { count: number; liked: boolean };
  shares?: { count: number };
  comments?: { count: number };
};

const REFLECTION_PROMPTS = [
  'What does this verse reveal about God\u2019s character?',
  'How can I live this out today?',
  'Who in my life needs to hear this?',
];

export default function VerseReaderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ client_date?: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const date = useMemo(
    () => params.client_date || dayjs().format('YYYY-MM-DD'),
    [params.client_date]
  );

  const verseQuery = useQuery({
    queryKey: ['daily-verse', date],
    queryFn: () => verseApi.getToday(date),
  });
  const interactionsQuery = useQuery({
    queryKey: ['verse-interactions', date],
    queryFn: () => verseApi.getInteractions(date),
  });

  const { toggle: speechToggle, isSpeaking, activeSource } = useSpeechPlayback();
  const isListening = activeSource === 'verse' && isSpeaking;

  const verseText = verseQuery.data?.data?.verse ?? '';
  const verseRef = verseQuery.data?.data?.reference ?? '';
  const liked = interactionsQuery.data?.likes?.liked ?? false;
  const likesCount = interactionsQuery.data?.likes?.count ?? 0;
  // Use the same mood theme as the hero card so the reader feels like a
  // natural extension of what was just tapped.
  const verseTheme = useMemo(
    () => pickVerseTheme(verseText, verseRef, date),
    [verseText, verseRef, date]
  );

  const likeMutation = useMutation({
    mutationFn: (currentlyLiked: boolean) =>
      currentlyLiked ? verseApi.unlike(date) : verseApi.like(date),
    onMutate: async (currentlyLiked) => {
      await queryClient.cancelQueries({ queryKey: ['verse-interactions', date] });
      const previous = queryClient.getQueryData<VerseInteractionsCache>(['verse-interactions', date]);
      queryClient.setQueryData<VerseInteractionsCache>(['verse-interactions', date], (old) => {
        const base = old ?? {};
        const likes = base.likes ?? { count: 0, liked: false };
        const count = typeof likes.count === 'number' ? likes.count : 0;
        if (currentlyLiked) return { ...base, likes: { liked: false, count: Math.max(0, count - 1) } };
        return { ...base, likes: { liked: true, count: count + 1 } };
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['verse-interactions', date], ctx.previous);
      }
      Alert.alert('Sign in to like verses');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['verse-interactions', date] });
    },
  });

  function onListen() {
    if (!verseText) return;
    speechToggle([`Verse. ${verseText}`, `Reference: ${verseRef || 'Scripture'}`], 'verse');
  }

  async function onShare() {
    const fallback =
      verseText && verseRef
        ? `Today's Verse (${verseRef}):\n\n"${verseText}"\n\nDivine Bridge — divinebridge.io`
        : `Today's verse on Divine Bridge — divinebridge.io`;
    await shareServerImage(
      `/api/today-verse/hero-image?client_date=${encodeURIComponent(date)}`,
      `divine_bridge_verse_${date}.jpg`,
      fallback
    );
    if (verseText && user) {
      await verseApi.share(date).catch(() => null);
    }
  }

  function onLike() {
    if (!user) {
      Alert.alert('Sign in', "Sign in to like today's verse.");
      return;
    }
    likeMutation.mutate(liked);
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fbf2da' }}>
      {/* Soft warm wash anchored to the bottom — gives the sheet a hint of depth
          without needing a native gradient module. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%',
          backgroundColor: 'rgba(246,230,192,0.55)',
        }}
      />

      {/* Top bar: close + share. The pill is themed to match the hero card so
          the reader feels like an extension of what was tapped.
          We floor the top padding on iOS so the row always clears the sheet
          grabber, even when `insets.top` is reported as 0 inside the formSheet. */}
      <View
        style={{
          paddingTop:
            Platform.OS === 'ios'
              ? Math.max(insets.top, 18) + 14
              : insets.top + 16,
          paddingHorizontal: 16,
          paddingBottom: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <GlassPill
          onPress={() => router.back()}
          accessibilityLabel="Close verse reader"
          radius={14}
          hitSlop={8}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevron-d" size={18} color={THEME_COLORS.text2} />
          </View>
        </GlassPill>
        <GlassPill tone={verseTheme.pillTone} radius={999} style={{ paddingHorizontal: 14, paddingVertical: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="cross" size={11} color={verseTheme.accent} />
            <Text style={{ ...TYPE.capsLabel, color: verseTheme.accent }}>
              {dayjs(date).format('MMM D')} · {verseTheme.label}
            </Text>
          </View>
        </GlassPill>
        <GlassPill
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onShare();
          }}
          accessibilityLabel="Share today's verse"
          radius={14}
          hitSlop={8}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="share" size={16} color={THEME_COLORS.text2} />
          </View>
        </GlassPill>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: 56,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
        // Prevent iOS from silently shifting our top content up under the
        // header pill via automatic content inset adjustment inside the sheet.
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      >
        {/* Verse */}
        <Animated.View entering={FadeIn.delay(80).duration(450)}>
          <Text
            style={{
              fontFamily: iosFont('700'),
              fontWeight: '700',
              fontSize: 32,
              lineHeight: 42,
              letterSpacing: -0.6,
              color: THEME_COLORS.text,
            }}
          >
            &ldquo;{verseText || 'Loading today\u2019s verse\u2026'}&rdquo;
          </Text>
          <Text
            style={{
              ...TYPE.capsLabel,
              fontSize: 13,
              letterSpacing: 1.6,
              color: verseTheme.accent,
              marginTop: 22,
            }}
          >
            — {verseRef || ''}
          </Text>
        </Animated.View>

        {/* Reflection prompts */}
        <Animated.View entering={FadeInDown.delay(160).duration(420)} style={{ marginTop: 36 }}>
          <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3, marginBottom: 12 }}>
            Reflect
          </Text>
          <View style={{ gap: 10 }}>
            {REFLECTION_PROMPTS.map((prompt, i) => (
              <GlassCard key={i} tone="warm" intensity="card" radius={18} style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: 'rgba(176,125,32,0.12)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ ...TYPE.caption2, color: THEME_COLORS.gold, fontWeight: '700', fontFamily: iosFont('700') }}>
                    {i + 1}
                  </Text>
                </View>
                <Text style={{ ...TYPE.subheadline, color: THEME_COLORS.text, flex: 1 }}>
                  {prompt}
                </Text>
              </GlassCard>
            ))}
          </View>
        </Animated.View>

        {/* Stats */}
        <Animated.View entering={FadeInDown.delay(240).duration(420)} style={{ marginTop: 28 }}>
          <GlassCard tone="default" intensity="card" radius={18} style={{ padding: 14, flexDirection: 'row' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ ...TYPE.title3, color: THEME_COLORS.text, fontVariant: ['tabular-nums'] }}>
                {likesCount.toLocaleString()}
              </Text>
              <Text style={{ ...TYPE.caption2, color: THEME_COLORS.text3, textTransform: 'none', letterSpacing: 0 }}>
                Hearts today
              </Text>
            </View>
            <View style={{ width: 1, marginVertical: 8, backgroundColor: 'rgba(44,36,23,0.08)' }} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ ...TYPE.title3, color: THEME_COLORS.text }}>
                {dayjs(date).format('ddd').toUpperCase()}
              </Text>
              <Text style={{ ...TYPE.caption2, color: THEME_COLORS.text3, textTransform: 'none', letterSpacing: 0 }}>
                {dayjs(date).format('MMMM D, YYYY')}
              </Text>
            </View>
          </GlassCard>
        </Animated.View>
      </ScrollView>

      {/* Bottom glass action bar */}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 12 }}>
        <GlassActionBar radius={22}>
          <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
            <ReaderActionButton
              icon={<Icon name="heart" size={20} color={liked ? THEME_COLORS.rose : THEME_COLORS.text2} />}
              label={liked ? 'Liked' : 'Like'}
              onPress={onLike}
              active={liked}
              count={likesCount}
            />
            <View style={{ width: 1, marginVertical: 12, backgroundColor: 'rgba(44,36,23,0.08)' }} />
            <ReaderActionButton
              icon={<Icon name="audio" size={20} color={isListening ? verseTheme.accent : THEME_COLORS.text2} />}
              label={isListening ? 'Stop' : 'Listen'}
              onPress={onListen}
              active={isListening}
              activeColor={verseTheme.accent}
            />
            <View style={{ width: 1, marginVertical: 12, backgroundColor: 'rgba(44,36,23,0.08)' }} />
            <ReaderActionButton
              icon={<Icon name="share" size={20} color={THEME_COLORS.text2} />}
              label="Share"
              onPress={onShare}
            />
          </View>
        </GlassActionBar>
      </View>
    </View>
  );
}

function ReaderActionButton({
  icon,
  label,
  onPress,
  active,
  count,
  activeColor,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  active?: boolean;
  count?: number;
  activeColor?: string;
}) {
  const accent = activeColor ?? THEME_COLORS.gold;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flex: 1, paddingVertical: 14, alignItems: 'center', gap: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        {count != null && count > 0 ? (
          <Text
            style={{
              ...TYPE.caption2,
              color: active ? accent : THEME_COLORS.text2,
              fontVariant: ['tabular-nums'],
              textTransform: 'none',
              letterSpacing: 0,
              fontWeight: '600',
              fontFamily: iosFont('600'),
            }}
          >
            {count > 9999 ? `${(count / 1000).toFixed(1)}k` : count.toLocaleString()}
          </Text>
        ) : null}
      </View>
      <Text style={{ ...TYPE.capsLabel, color: active ? accent : THEME_COLORS.text2 }}>
        {label}
      </Text>
    </Pressable>
  );
}
