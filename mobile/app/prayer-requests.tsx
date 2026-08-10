import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import { privatePrayerRequestApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { PrivatePrayerRequest } from '@/types';

const LANGUAGES = ['English', 'French', 'Spanish', 'Kinyarwanda', 'Swahili', 'Portuguese'];
const HOURS = [9, 12, 18];

function toAvailability(slot: string) {
  const start = dayjs(slot);
  return [{ start_at: start.toISOString(), end_at: start.add(30, 'minute').toISOString() }];
}

function formatSlot(slot: string) {
  return dayjs(slot).format('ddd, MMM D · h:mm A');
}

export default function PrayerRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useAuthStore((state) => state.profile);
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState(profile?.preferredPrayerLanguage || 'English');
  const [needsCall, setNeedsCall] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(true);

  const slots = useMemo(
    () => Array.from({ length: 7 }, (_, day) =>
      HOURS.map((hour) => dayjs().startOf('day').add(day, 'day').hour(hour).minute(0).second(0).millisecond(0).toISOString())
    ).flat().filter((slot) => dayjs(slot).isAfter(dayjs())),
    []
  );
  const requestsQuery = useQuery({
    queryKey: ['private-prayer-requests'],
    queryFn: privatePrayerRequestApi.list,
  });
  const requests = requestsQuery.data?.data ?? [];
  const isLeader = requestsQuery.data?.is_prayer_leader ?? false;

  const submit = useMutation({
    mutationFn: () => privatePrayerRequestApi.submit({
      description: description.trim(),
      preferred_language: language,
      wants_live_call: needsCall,
      availability: needsCall && selectedSlot ? toAvailability(selectedSlot) : [],
    }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['private-prayer-requests'] });
      setDescription('');
      setNeedsCall(false);
      setSelectedSlot(null);
      setShowForm(false);
    },
    onError: (error: Error) => Alert.alert('Could not submit request', error.message),
  });

  const claim = useMutation({
    mutationFn: ({ request, slotStart }: { request: PrivatePrayerRequest; slotStart?: string }) =>
      privatePrayerRequestApi.claim(request.id, slotStart),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['private-prayer-requests'] });
    },
    onError: (error: Error) => Alert.alert('Could not accept request', error.message),
  });

  const openCall = useMutation({
    mutationFn: privatePrayerRequestApi.openCall,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/voice-call/[id]',
        params: { id: data.room_id, code: data.room_code, matchedPrayerCall: '1' },
      });
    },
    onError: (error: Error) => Alert.alert('Call not ready', error.message),
  });

  function submitRequest() {
    if (description.trim().length < 10) {
      Alert.alert('Tell us a little more', 'Please write at least 10 characters so a leader can pray with you.');
      return;
    }
    if (needsCall && !selectedSlot) {
      Alert.alert('Choose a time', 'Select a time when you would be available for a 15-minute prayer call.');
      return;
    }
    submit.mutate();
  }

  const myRequests = requests.filter((item) => item.viewer_role === 'requester');
  const leaderRequests = isLeader ? requests.filter((item) => item.available_to_lead) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: THEME_COLORS.bg }} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: insets.bottom + 36 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={THEME_COLORS.text2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 23 }}>Private prayer</Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>Matched with a prayer leader in your language</Text>
        </View>
      </View>

      {showForm ? (
        <View style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 20, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 18 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 17, marginBottom: 6 }}>How can we pray for you?</Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, lineHeight: 18, marginBottom: 14 }}>Only an eligible prayer leader will see this. Requests expire after two days.</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Share a brief prayer need…"
            placeholderTextColor={THEME_COLORS.text3}
            multiline
            maxLength={500}
            style={{ minHeight: 110, borderRadius: 14, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 14, color: THEME_COLORS.text, ...iosFontStyle('400'), textAlignVertical: 'top' }}
          />
          <Text style={{ color: THEME_COLORS.text3, fontSize: 11, textAlign: 'right', marginTop: 5 }}>{500 - description.length} characters remaining</Text>

          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginTop: 18, marginBottom: 8 }}>Preferred prayer language</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LANGUAGES.map((item) => (
              <Pressable key={item} onPress={() => setLanguage(item)} style={{ paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20, backgroundColor: language === item ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: language === item ? THEME_COLORS.goldBorder : THEME_COLORS.border }}>
                <Text style={{ color: language === item ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 12 }}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14 }}>Live voice prayer</Text>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>Optional · a private 15-minute call</Text>
            </View>
            <Switch value={needsCall} onValueChange={setNeedsCall} trackColor={{ false: THEME_COLORS.bg3, true: THEME_COLORS.goldDim }} thumbColor={needsCall ? THEME_COLORS.gold : THEME_COLORS.text3} />
          </View>

          {needsCall && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginBottom: 8 }}>Choose one time you are available</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {slots.map((slot) => (
                  <Pressable key={slot} onPress={() => setSelectedSlot(slot)} style={{ width: '31%', paddingVertical: 9, paddingHorizontal: 5, borderRadius: 10, backgroundColor: selectedSlot === slot ? THEME_COLORS.sageDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: selectedSlot === slot ? 'rgba(74,124,94,0.35)' : THEME_COLORS.border }}>
                    <Text style={{ color: selectedSlot === slot ? THEME_COLORS.sage : THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 10, textAlign: 'center' }}>{formatSlot(slot)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <Button label={submit.isPending ? 'Sending…' : 'Send private request'} onPress={submitRequest} isLoading={submit.isPending} fullWidth style={{ marginTop: 22 }} />
        </View>
      ) : (
        <Button label="New private request" onPress={() => setShowForm(true)} fullWidth />
      )}

      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 17, marginTop: 26, marginBottom: 10 }}>Your requests</Text>
      {myRequests.length === 0 ? (
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13 }}>Your private prayer requests will appear here.</Text>
      ) : myRequests.map((item) => (
        <RequestCard
          key={item.id}
          request={item}
          onJoin={() => openCall.mutate(item.id)}
          joining={openCall.isPending}
          onResubmit={() => {
            setDescription(item.description);
            setLanguage(item.preferred_language);
            setNeedsCall(item.wants_live_call);
            setSelectedSlot(dayjs(item.availability[0]?.start_at).isAfter(dayjs()) ? item.availability[0]?.start_at ?? null : null);
            setShowForm(true);
          }}
        />
      ))}

      {isLeader && (
        <>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 17, marginTop: 26, marginBottom: 10 }}>Prayer leader inbox</Text>
          {leaderRequests.length === 0 ? (
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13 }}>No compatible requests are waiting right now.</Text>
          ) : leaderRequests.map((item) => (
            <RequestCard
              key={item.id}
              request={item}
              onClaim={(slotStart) => claim.mutate({ request: item, slotStart })}
              claiming={claim.isPending}
              leader
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function RequestCard({ request, onClaim, onJoin, onResubmit, claiming, joining, leader }: {
  request: PrivatePrayerRequest;
  onClaim?: (slotStart?: string) => void;
  onJoin?: () => void;
  onResubmit?: () => void;
  claiming?: boolean;
  joining?: boolean;
  leader?: boolean;
}) {
  const firstSlot = request.availability[0]?.start_at;
  return (
    <View style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 16, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 15, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14, flex: 1 }}>{leader ? `${request.requester_first_name}'s request` : request.status.replace('_', ' ')}</Text>
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 11, textTransform: 'uppercase' }}>{request.preferred_language}</Text>
      </View>
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13, lineHeight: 20, marginTop: 8 }}>{request.description}</Text>
      {request.scheduled_at && <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('500'), fontSize: 12, marginTop: 10 }}>Call scheduled · {formatSlot(request.scheduled_at)}</Text>}
      {leader && request.wants_live_call && firstSlot && <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 10 }}>Available: {formatSlot(firstSlot)}</Text>}
      {leader && onClaim && <Button label={claiming ? 'Accepting…' : request.wants_live_call ? 'Accept & schedule call' : 'Accept request'} onPress={() => onClaim(firstSlot)} isLoading={claiming} fullWidth style={{ marginTop: 14 }} />}
      {request.status === 'scheduled' && onJoin && <Button label={joining ? 'Opening…' : 'Join prayer call'} onPress={onJoin} isLoading={joining} fullWidth style={{ marginTop: 14 }} />}
      {request.status === 'expired' && (
        <>
          <Text style={{ color: THEME_COLORS.rose, ...iosFontStyle('500'), fontSize: 12, marginTop: 10 }}>This request expired. You can submit it again.</Text>
          {onResubmit && <Button label="Resubmit request" onPress={onResubmit} variant="secondary" fullWidth style={{ marginTop: 12 }} />}
        </>
      )}
    </View>
  );
}
