import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { privatePrayerRequestApi } from '@/services/api';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import type { PrivatePrayerRequest } from '@/types';

function whenLabel(item: PrivatePrayerRequest): string | null {
  const raw = item.scheduled_at || item.preferred_at || item.availability?.[0]?.start_at;
  if (!raw) return null;
  return dayjs(raw).format('ddd, MMM D · h:mm A');
}

function isUpcoming(item: PrivatePrayerRequest): boolean {
  const raw = item.scheduled_at || item.preferred_at || item.availability?.[0]?.start_at;
  if (!raw) return false;
  if (item.status !== 'active' && item.status !== 'claimed' && item.status !== 'scheduled') return false;
  return dayjs(raw).isAfter(dayjs().subtract(30, 'minute'));
}

export default function ScheduledPrayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isFocused = useIsFocused();
  const requestsQuery = useQuery({
    queryKey: ['private-prayer-requests'],
    queryFn: privatePrayerRequestApi.list,
    refetchInterval: isFocused ? 15_000 : false,
  });
  const openCall = useMutation({
    mutationFn: privatePrayerRequestApi.openCall,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/voice-call/[id]',
        params: { id: data.room_id, code: data.room_code, matchedPrayerCall: '1' },
      });
    },
  });

  const requests = requestsQuery.data?.data ?? [];
  const mine = requests.filter((item) => item.viewer_role === 'requester' && isUpcoming(item));
  const assigned = requests.filter((item) => item.viewer_role === 'leader' && isUpcoming(item));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 96 }}
      refreshControl={<RefreshControl refreshing={requestsQuery.isRefetching} onRefresh={() => void requestsQuery.refetch()} tintColor={THEME_COLORS.gold} />}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginBottom: 16 }}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <Text style={{ ...TYPE.title2, color: THEME_COLORS.text }}>Scheduled prayer</Text>
      <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 6, marginBottom: 20 }}>
        Upcoming private matches. Open requests waiting for a warrior stay in Prayer Request.
      </Text>

      <Section title="Your requests" empty="When you ask for private prayer, the time you chose shows up here." items={mine} onJoin={(id) => openCall.mutate(id)} joining={openCall.isPending} />
      <Section title="Assigned to you" empty="Calls a warrior has accepted show up here." items={assigned} leader onJoin={(id) => openCall.mutate(id)} joining={openCall.isPending} />
    </ScrollView>
  );
}

function Section({
  title,
  empty,
  items,
  leader,
  onJoin,
  joining,
}: {
  title: string;
  empty: string;
  items: PrivatePrayerRequest[];
  leader?: boolean;
  onJoin: (id: string) => void;
  joining: boolean;
}) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('700'), fontSize: 17, marginBottom: 10 }}>{title}</Text>
      {items.length === 0 ? (
        <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3 }}>{empty}</Text>
      ) : items.map((item) => (
        <View key={item.id} style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 16, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 15, marginBottom: 10 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontSize: 15 }}>
            {leader ? `${item.requester_first_name}'s request` : item.status.replace('_', ' ')}
          </Text>
          <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, marginTop: 6 }}>{whenLabel(item)}</Text>
          <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text2, marginTop: 8 }}>{item.description}</Text>
          {item.status === 'scheduled' ? (
            <Button label={joining ? 'Opening…' : 'Join prayer call'} onPress={() => onJoin(item.id)} isLoading={joining} fullWidth style={{ marginTop: 12 }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}
