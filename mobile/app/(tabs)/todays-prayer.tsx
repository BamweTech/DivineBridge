import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { prayerApi } from '@/services/api';
import { shareServerImage } from '@/lib/shareServerImage';
import { useSpeechPlayback } from '@/features/prayer/hooks/useSpeechPlayback';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { GlassCard } from '@/components/ui/GlassCard';
import Icon from '@/components/ui/Icon';

export default function TodaysPrayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const today = dayjs().format('YYYY-MM-DD');
  const { toggle, isSpeaking, activeSource } = useSpeechPlayback();
  const prayerQuery = useQuery({
    queryKey: ['daily-prayer', today],
    queryFn: () => prayerApi.getToday(today),
  });
  const interactionsQuery = useQuery({
    queryKey: ['prayer-interactions', today],
    queryFn: () => prayerApi.getInteractions(today),
  });
  const content = prayerQuery.data?.prayer?.content ?? '';
  const liked = interactionsQuery.data?.likes?.liked ?? false;
  const likes = interactionsQuery.data?.likes?.count ?? 0;
  const listening = activeSource === 'prayer' && isSpeaking;

  const likeMutation = useMutation({
    mutationFn: (currentlyLiked: boolean) => (currentlyLiked ? prayerApi.unlike(today) : prayerApi.like(today)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prayer-interactions', today] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert('Sign in to like prayers'),
  });

  async function sharePrayer() {
    const fallback = content
      ? `Today's Prayer from Divine Bridge:\n\n${content}\n\nJoin us at divinebridge.io`
      : `Today's global prayer on Divine Bridge — divinebridge.io`;
    await shareServerImage(
      `/api/prayer/prayer/download?client_date=${encodeURIComponent(today)}`,
      `divine_bridge_prayer_${today}.jpg`,
      fallback,
    );
    if (content && user) {
      await prayerApi.share(today).catch(() => null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 96 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginBottom: 16 }}>
          <Icon name="back" size={22} color={THEME_COLORS.text2} />
        </Pressable>
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, letterSpacing: 1.2 }}>TODAY'S PRAYER</Text>
        <Text style={{ ...TYPE.title2, color: THEME_COLORS.text, marginTop: 6 }}>{dayjs().format('dddd, MMMM D')}</Text>
        <GlassCard tone="warm" intensity="card" radius={22} style={{ padding: 18, marginTop: 18 }}>
          <Text style={{ ...TYPE.body, color: THEME_COLORS.text }}>
            {prayerQuery.isLoading ? 'Loading today’s prayer…' : content || 'Today’s prayer is not ready yet.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <Pressable onPress={() => likeMutation.mutate(liked)} style={action}>
              <Icon name="heart" size={14} color={liked ? THEME_COLORS.rose : THEME_COLORS.text2} />
              <Text style={actionText}>{liked ? 'Liked' : 'Like'}{likes ? ` ${likes}` : ''}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!content) return;
                toggle([`Today's prayer. ${content}`], 'prayer');
              }}
              style={action}
            >
              <Icon name="audio" size={14} color={THEME_COLORS.text2} />
              <Text style={actionText}>{listening ? 'Stop' : 'Listen'}</Text>
            </Pressable>
            <Pressable onPress={() => { void sharePrayer(); }} style={action}>
              <Icon name="share" size={14} color={THEME_COLORS.text2} />
              <Text style={actionText}>Share</Text>
            </Pressable>
          </View>
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const action = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 6,
  paddingVertical: 8,
  paddingHorizontal: 10,
  borderRadius: 12,
  backgroundColor: 'rgba(255,255,255,0.55)',
};

const actionText = {
  ...TYPE.caption1,
  color: THEME_COLORS.text2,
  fontFamily: iosFont('600'),
  fontWeight: '600' as const,
};
