import { Alert, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { verseApi } from '@/services/api';
import { shareServerImage } from '@/lib/shareServerImage';
import { useSpeechPlayback } from '@/features/prayer/hooks/useSpeechPlayback';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { GlassCard } from '@/components/ui/GlassCard';
import Icon from '@/components/ui/Icon';

/** Today's verse, shown at the top of the Devotional tab. */
export function TodaysVerseCard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const today = dayjs().format('YYYY-MM-DD');
  const { toggle, isSpeaking, activeSource } = useSpeechPlayback();
  const verseQuery = useQuery({
    queryKey: ['daily-verse', today],
    queryFn: () => verseApi.getToday(today),
  });
  const interactionsQuery = useQuery({
    queryKey: ['verse-interactions', today],
    queryFn: () => verseApi.getInteractions(today),
  });
  const verseText = verseQuery.data?.data?.verse ?? '';
  const verseRef = verseQuery.data?.data?.reference ?? '';
  const liked = interactionsQuery.data?.likes?.liked ?? false;
  const likes = interactionsQuery.data?.likes?.count ?? 0;
  const listening = activeSource === 'verse' && isSpeaking;

  const likeMutation = useMutation({
    mutationFn: (currentlyLiked: boolean) => (currentlyLiked ? verseApi.unlike(today) : verseApi.like(today)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verse-interactions', today] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: () => Alert.alert('Sign in to like verses'),
  });

  async function shareVerse() {
    const fallback = verseText
      ? `Today's Verse (${verseRef}):\n\n"${verseText}"\n\nDivine Bridge — divinebridge.io`
      : `Today's verse on Divine Bridge — divinebridge.io`;
    await shareServerImage(
      `/api/today-verse/hero-image?client_date=${encodeURIComponent(today)}`,
      `divine_bridge_verse_${today}.jpg`,
      fallback,
    );
    if (verseText && user) {
      await verseApi.share(today).catch(() => null);
    }
  }

  return (
    <Pressable
      onPress={() => {
        if (!verseText) return;
        router.push({ pathname: '/verse-reader', params: { client_date: today } } as never);
      }}
      accessibilityRole="button"
      accessibilityLabel="Open verse reader"
    >
      <GlassCard tone="gold" intensity="card" radius={22} style={{ padding: 18, marginBottom: 16 }}>
        <Text style={{ ...TYPE.caption2, color: THEME_COLORS.gold, letterSpacing: 1.2 }}>TODAY'S VERSE</Text>
        <Text style={{ ...TYPE.title3, color: THEME_COLORS.text, marginTop: 10 }}>
          {verseQuery.isLoading ? 'Loading today’s verse…' : `“${verseText || 'For God so loved the world…'}”`}
        </Text>
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, marginTop: 10 }}>{verseRef || 'John 3:16'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <Pressable onPress={() => likeMutation.mutate(liked)} style={actionStyle}>
            <Icon name="heart" size={14} color={liked ? THEME_COLORS.rose : THEME_COLORS.text2} />
            <Text style={actionLabel}>{liked ? 'Liked' : 'Like'}{likes ? ` ${likes}` : ''}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              if (!verseText) return;
              toggle([`Verse. ${verseText}`, `Reference: ${verseRef || 'Scripture'}`], 'verse');
            }}
            style={actionStyle}
          >
            <Icon name="audio" size={14} color={THEME_COLORS.text2} />
            <Text style={actionLabel}>{listening ? 'Stop' : 'Listen'}</Text>
          </Pressable>
          <Pressable onPress={() => { void shareVerse(); }} style={actionStyle}>
            <Icon name="share" size={14} color={THEME_COLORS.text2} />
            <Text style={actionLabel}>Share</Text>
          </Pressable>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const actionStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 6,
  paddingVertical: 8,
  paddingHorizontal: 10,
  borderRadius: 12,
  backgroundColor: 'rgba(255,255,255,0.55)',
};

const actionLabel = {
  ...TYPE.caption1,
  color: THEME_COLORS.text2,
  fontFamily: iosFont('600'),
  fontWeight: '600' as const,
};
