import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  type LayoutChangeEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';

import { verseApi, type VerseContext, type VerseContextOriginalWord } from '@/services/api';
import { useSpeechPlayback } from '@/features/prayer/hooks/useSpeechPlayback';
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
  // The AI sermon / original-language / reflection-questions payload.
  // First-time loads for an uncached verse can take ~5–15s while the server
  // calls Perplexity; subsequent loads come back from Firestore instantly.
  // We keep the query soft (no retries beyond 1, long staleTime) because
  // failure is non-fatal — the reader still works without the sermon.
  const contextQuery = useQuery({
    queryKey: ['verse-context', date],
    queryFn: () => verseApi.getContext(date),
    retry: 1,
    staleTime: 60 * 60 * 1000, // 1h — backend cache-control matches
  });
  const verseContext: VerseContext | undefined = contextQuery.data?.data;

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

  // We render the top bar as an absolutely-positioned overlay so it can never
  // be collapsed by a flex quirk and let the verse text slide up underneath
  // it. We measure its real height on layout and use that to pad the
  // ScrollView so the verse always starts cleanly below it.
  const [headerHeight, setHeaderHeight] = useState<number>(
    (Platform.OS === 'ios' ? Math.max(insets.top, 18) + 14 : insets.top + 16) + 40 + 24
  );
  const onHeaderLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h && Math.abs(h - headerHeight) > 1) setHeaderHeight(h);
  };

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

      {/* ScrollView fills the whole sheet; we pad its top by the measured
          header height so the verse always starts cleanly below the pills. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 22,
          paddingTop: headerHeight + 24,
          paddingBottom: insets.bottom + 120,
        }}
        showsVerticalScrollIndicator={false}
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

        {/* AI-generated "sermon" — summary headline followed by short
            Context / Meaning / Application paragraphs. Renders only after
            the context query lands; while it's loading we show a tiny
            preparing-message cap label instead of a blocking spinner so
            the rest of the reader stays usable. */}
        {verseContext ? (
          <Animated.View entering={FadeInDown.delay(120).duration(420)} style={{ marginTop: 36 }}>
            <Text style={{ ...TYPE.capsLabel, color: verseTheme.accent, marginBottom: 12 }}>
              Today&apos;s Message
            </Text>
            {verseContext.summary ? (
              <Text
                style={{
                  fontFamily: iosFont('500'),
                  fontWeight: '500',
                  fontSize: 19,
                  lineHeight: 27,
                  letterSpacing: -0.2,
                  color: THEME_COLORS.text,
                  marginBottom: 18,
                }}
              >
                {verseContext.summary}
              </Text>
            ) : null}
            <View style={{ gap: 12 }}>
              {(
                [
                  { label: 'Context', body: verseContext.context },
                  { label: 'Meaning', body: verseContext.meaning },
                  { label: 'Application', body: verseContext.application },
                ] as const
              )
                .filter((s) => !!s.body)
                .map((section) => (
                  <GlassCard
                    key={section.label}
                    tone="warm"
                    intensity="card"
                    radius={18}
                    style={{ padding: 16 }}
                  >
                    <Text style={{ ...TYPE.capsLabel, color: verseTheme.accent, marginBottom: 8 }}>
                      {section.label}
                    </Text>
                    <Text style={{ ...TYPE.body, color: THEME_COLORS.text, lineHeight: 24 }}>
                      {section.body}
                    </Text>
                  </GlassCard>
                ))}
            </View>
          </Animated.View>
        ) : contextQuery.isLoading ? (
          <View style={{ marginTop: 36, alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3 }}>
              Preparing today&apos;s message…
            </Text>
          </View>
        ) : null}

        {/* Original-language insights — stacked cards highlighting 2–4
            Hebrew or Greek words the English translation flattens. */}
        {verseContext?.original_words?.length ? (
          <Animated.View entering={FadeInDown.delay(180).duration(420)} style={{ marginTop: 32 }}>
            <Text style={{ ...TYPE.capsLabel, color: verseTheme.accent, marginBottom: 12 }}>
              In the Original Language
            </Text>
            <View style={{ gap: 10 }}>
              {verseContext.original_words.map((w, i) => (
                <OriginalWordCard
                  key={`${w.transliteration}-${i}`}
                  word={w}
                  accent={verseTheme.accent}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}

        {/* Reflect — AI-generated, verse-specific prompts when available;
            otherwise fall back to the three generic ones so the section is
            never empty. */}
        <Animated.View entering={FadeInDown.delay(220).duration(420)} style={{ marginTop: 32 }}>
          <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3, marginBottom: 12 }}>
            Reflect
          </Text>
          <View style={{ gap: 10 }}>
            {(verseContext?.reflection_questions?.length
              ? verseContext.reflection_questions
              : REFLECTION_PROMPTS
            ).map((prompt, i) => (
              <GlassCard
                key={`${i}-${prompt.slice(0, 16)}`}
                tone="warm"
                intensity="card"
                radius={18}
                style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <View
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: 'rgba(176,125,32,0.12)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ ...TYPE.caption2, color: verseTheme.accent, fontWeight: '700', fontFamily: iosFont('700') }}>
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

      {/* Top bar: close + share. Rendered ABSOLUTELY at the top so it always
          stays put, with a soft gradient scrim behind it that fades the verse
          out as it scrolls under. The pill is themed to match the hero card
          so the reader feels like an extension of what was tapped. */}
      <View
        onLayout={onHeaderLayout}
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          paddingTop:
            Platform.OS === 'ios'
              ? Math.max(insets.top, 18) + 14
              : insets.top + 16,
          paddingHorizontal: 16,
          paddingBottom: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(251,242,218,0.85)',
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

      {/* Bottom glass action bar */}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 12, zIndex: 10 }}>
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

/**
 * Compact card for one original-language word from the verse context.
 *
 * Visually: the original script (Hebrew or Greek) is displayed large on the
 * left, with the transliteration · language pill and the English mapping
 * stacked to the right, and the single-sentence gloss running across the
 * bottom. The whole card adopts the verse's mood accent for the language
 * pill so it stays cohesive with the rest of the reader.
 */
function OriginalWordCard({
  word,
  accent,
}: {
  word: VerseContextOriginalWord;
  accent: string;
}) {
  return (
    <GlassCard tone="warm" intensity="card" radius={18} style={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
        <Text
          // Original script; use System on iOS so SF Pro's broad Unicode
          // coverage handles Hebrew / Greek. fontWeight 500 keeps Greek
          // diacritics legible without going heavy.
          style={{
            fontFamily: iosFont('500'),
            fontSize: 30,
            lineHeight: 36,
            color: THEME_COLORS.text,
            minWidth: 88,
          }}
        >
          {word.word}
        </Text>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={{ ...TYPE.headline, color: THEME_COLORS.text }}>
              {word.transliteration}
            </Text>
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                backgroundColor: 'rgba(176,125,32,0.10)',
              }}
            >
              <Text style={{ ...TYPE.capsLabel, color: accent, fontSize: 10, letterSpacing: 0.8 }}>
                {word.language}
              </Text>
            </View>
          </View>
          {word.appears_as ? (
            <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 2 }}>
              appears as <Text style={{ color: THEME_COLORS.text2, fontWeight: '600', fontFamily: iosFont('600') }}>{word.appears_as}</Text>
            </Text>
          ) : null}
        </View>
      </View>
      <Text style={{ ...TYPE.subheadline, color: THEME_COLORS.text, marginTop: 12, lineHeight: 22 }}>
        {word.gloss}
      </Text>
    </GlassCard>
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
