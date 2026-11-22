import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import { privatePrayerRequestApi } from '@/services/api';
import { promptReportContent } from '@/lib/contentSafety';
import { useAuthStore } from '@/stores/authStore';
import type { PrivatePrayerRequest } from '@/types';

const LANGUAGES = ['English', 'Spanish', 'Kirundi'] as const;
const MENU_WIDTH = 0.78;

function MenuLines() {
  return (
    <View style={{ width: 22, height: 16, justifyContent: 'space-between' }}>
      {[0, 1, 2].map((line) => (
        <View key={line} style={{ height: 2, borderRadius: 1, backgroundColor: THEME_COLORS.text2 }} />
      ))}
    </View>
  );
}

function upcomingQuarter(from = dayjs()) {
  const cleared = from.second(0).millisecond(0);
  const remainder = cleared.minute() % 15;
  const next = remainder === 0 ? cleared : cleared.add(15 - remainder, 'minute');
  return next.isAfter(from) ? next : next.add(15, 'minute');
}

function offeredLanguage(value?: string) {
  return LANGUAGES.find((item) => item.toLowerCase() === (value || '').toLowerCase()) ?? 'English';
}

function mergePreferredTime(current: Date, picked: Date, mode: 'date' | 'time') {
  const base = dayjs(current);
  const next = dayjs(picked);
  let merged = mode === 'date'
    ? base.year(next.year()).month(next.month()).date(next.date())
    : base.hour(next.hour()).minute(next.minute());
  const remainder = merged.minute() % 15;
  if (remainder !== 0) merged = merged.add(15 - remainder, 'minute');
  merged = merged.second(0).millisecond(0);
  const earliest = upcomingQuarter();
  const latest = dayjs().add(7, 'day').subtract(15, 'minute');
  if (!merged.isAfter(earliest.subtract(1, 'second'))) return earliest.toDate();
  if (merged.isAfter(latest)) return latest.toDate();
  return merged.toDate();
}

function toAvailability(slot: string) {
  const start = dayjs(slot);
  return [{ start_at: start.toISOString(), end_at: start.add(15, 'minute').toISOString() }];
}

function formatSlot(slot: string) {
  return dayjs(slot).format('ddd, MMM D · h:mm A');
}

export default function PrayerRequestsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const slide = useSharedValue(0);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const profile = useAuthStore((state) => state.profile);
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>(offeredLanguage(profile?.preferredPrayerLanguage));
  const [preferredAt, setPreferredAt] = useState(() => upcomingQuarter().toDate());
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [pickerTick, setPickerTick] = useState(0);
  const [showForm, setShowForm] = useState(mode === 'compose');
  const [menuOpen, setMenuOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'compose') setShowForm(true);
    if (mode === 'inbox') setShowForm(false);
  }, [mode]);

  useEffect(() => {
    if (!picker || Platform.OS !== 'ios') return;
    const id = setTimeout(() => setPicker(null), 3000);
    return () => clearTimeout(id);
  }, [picker, pickerTick]);

  const requestsQuery = useQuery({
    queryKey: ['private-prayer-requests'],
    queryFn: privatePrayerRequestApi.list,
    staleTime: 0,
    refetchInterval: isFocused ? 15_000 : false,
  });
  const requests = requestsQuery.data?.data ?? [];
  const isLeader = requestsQuery.data?.is_prayer_leader ?? false;

  useFocusEffect(useCallback(() => {
    void requestsQuery.refetch();
  }, [requestsQuery.refetch]));

  const submit = useMutation({
    mutationFn: () => privatePrayerRequestApi.submit({
      description: description.trim(),
      preferred_language: language,
      wants_live_call: true,
      preferred_at: preferredAt.toISOString(),
      availability: toAvailability(preferredAt.toISOString()),
    }),
    onSuccess: (result) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.setQueryData(
        ['private-prayer-requests'],
        (current: { success: boolean; data: PrivatePrayerRequest[]; is_prayer_leader: boolean } | undefined) => {
          if (!current) return current;
          return { ...current, data: [result.data, ...current.data.filter((item) => item.id !== result.data.id)] };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['private-prayer-requests'] });
      setDescription('');
      setPreferredAt(upcomingQuarter().toDate());
      setPicker(null);
      setShowForm(false);
      setOpenId(result.data.id);
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
  const cancel = useMutation({
    mutationFn: privatePrayerRequestApi.cancel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['private-prayer-requests'] }),
    onError: (error: Error) => Alert.alert('Could not cancel request', error.message),
  });
  const remove = useMutation({
    mutationFn: privatePrayerRequestApi.remove,
    onSuccess: (_result, requestId) => {
      queryClient.setQueryData(
        ['private-prayer-requests'],
        (current: { success: boolean; data: PrivatePrayerRequest[]; is_prayer_leader: boolean } | undefined) => {
          if (!current) return current;
          return { ...current, data: current.data.filter((item) => item.id !== requestId) };
        },
      );
      if (openId === requestId) setOpenId(null);
    },
    onError: (error: Error) => Alert.alert('Could not delete request', error.message),
  });
  const pray = useMutation({
    mutationFn: privatePrayerRequestApi.pray,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['private-prayer-requests'] }),
    onError: (error: Error) => Alert.alert('Could not record prayer', error.message),
  });

  function submitRequest() {
    if (description.trim().length < 10) {
      Alert.alert('Tell us a little more', 'Please write at least 10 characters so a leader can pray with you.');
      return;
    }
    if (!dayjs(preferredAt).isAfter(dayjs()) || dayjs(preferredAt).isAfter(dayjs().add(7, 'day').subtract(15, 'minute'))) {
      Alert.alert('Choose a time', 'Select a date and time within the next seven days.');
      return;
    }
    submit.mutate();
  }

  const myRequests = requests.filter((item) => item.viewer_role === 'requester');
  const leaderRequests = isLeader ? requests.filter((item) => item.available_to_lead) : [];
  const assignedRequests = isLeader ? requests.filter((item) => item.viewer_role === 'leader') : [];
  const openRequest = myRequests.find((item) => item.id === openId) ?? null;
  const menuWidth = width * MENU_WIDTH;
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value * -menuWidth }],
  }));

  function openMenu() {
    setMenuOpen(true);
    slide.value = withTiming(1, { duration: 280 });
  }

  function closeMenu() {
    slide.value = withTiming(0, { duration: 260 }, (finished) => {
      if (finished) runOnJS(setMenuOpen)(false);
    });
  }

  function openFromMenu(request: PrivatePrayerRequest) {
    setOpenId(request.id);
    setShowForm(false);
    closeMenu();
  }

  function confirmRemove(requestId: string) {
    Alert.alert('Delete this prayer request?', 'This removes it from your previous requests. An active or scheduled request is cancelled too.', [
      { text: 'Keep request', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(requestId) },
    ]);
  }

  function confirmCancel(requestId: string) {
    Alert.alert(
      'Cancel prayer request?',
      'This will remove the request from the leader inbox and end any scheduled call.',
      [
        { text: 'Keep request', style: 'cancel' },
        { text: 'Cancel request', style: 'destructive', onPress: () => cancel.mutate(requestId) },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: menuWidth, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 17, paddingHorizontal: 18, paddingBottom: 8 }}>
          Previous requests
        </Text>
        {requestsQuery.isLoading ? (
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, paddingHorizontal: 18, paddingTop: 8 }}>Loading your requests…</Text>
        ) : myRequests.length === 0 ? (
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, paddingHorizontal: 18, paddingTop: 8 }}>Your private prayer requests will appear here.</Text>
        ) : (
          <ScrollView>
            {myRequests.map((item) => {
              const when = item.preferred_at || item.created_at;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => openFromMenu(item)}
                  accessibilityRole="button"
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    borderTopWidth: 1,
                    borderTopColor: THEME_COLORS.border,
                    backgroundColor: item.id === openId ? THEME_COLORS.goldDim : '#fff',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={2} style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 16 }}>{item.description}</Text>
                    <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 2, textTransform: 'capitalize' }}>
                      {item.status.replace('_', ' ')}{when ? ` · ${dayjs(when).format('MMM D, YYYY')}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => confirmRemove(item.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Delete request"
                  >
                    <Icon name="trash" size={16} color={THEME_COLORS.rose} />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
      <Animated.View style={[{ flex: 1, backgroundColor: THEME_COLORS.bg }, pageStyle, pageShadow]}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: insets.bottom + 96 }}
      refreshControl={<RefreshControl refreshing={requestsQuery.isRefetching} onRefresh={() => void requestsQuery.refetch()} tintColor={THEME_COLORS.gold} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="back" size={22} color={THEME_COLORS.text2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 23 }}>{showForm ? 'Request prayer' : 'Prayer Request'}</Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>A live call at your chosen time, if a warrior is matched</Text>
        </View>
        <Pressable onPress={openMenu} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous requests">
          <MenuLines />
        </Pressable>
      </View>

      {showForm ? (
        <View style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 20, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 18 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 17, marginBottom: 6 }}>How can we pray for you?</Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, lineHeight: 18, marginBottom: 14 }}>If we find a matching prayer warrior, this schedules a live prayer call at the time you choose.</Text>
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

          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginTop: 18, marginBottom: 8 }}>When should we pray for you?</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => setPicker((current) => (current === 'date' ? null : 'date'))}
              accessibilityRole="button"
              accessibilityLabel="Choose a date"
              style={{ flex: 1, borderRadius: 14, backgroundColor: picker === 'date' ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: picker === 'date' ? THEME_COLORS.goldBorder : THEME_COLORS.border, paddingHorizontal: 12, paddingVertical: 12 }}
            >
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 11 }}>Date</Text>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 15, marginTop: 4 }}>{dayjs(preferredAt).format('ddd, MMM D')}</Text>
            </Pressable>
            <Pressable
              onPress={() => setPicker((current) => (current === 'time' ? null : 'time'))}
              accessibilityRole="button"
              accessibilityLabel="Choose a time"
              style={{ flex: 1, borderRadius: 14, backgroundColor: picker === 'time' ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: picker === 'time' ? THEME_COLORS.goldBorder : THEME_COLORS.border, paddingHorizontal: 12, paddingVertical: 12 }}
            >
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 11 }}>Time</Text>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 15, marginTop: 4 }}>{dayjs(preferredAt).format('h:mm A')}</Text>
            </Pressable>
          </View>
          {picker ? (
            <DateTimePicker
              value={preferredAt}
              mode={picker}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minuteInterval={15}
              minimumDate={new Date()}
              maximumDate={dayjs().add(7, 'day').subtract(15, 'minute').toDate()}
              themeVariant="light"
              accentColor={THEME_COLORS.gold}
              onChange={(event: DateTimePickerEvent, date?: Date) => {
                if (Platform.OS === 'android') setPicker(null);
                if (event.type === 'dismissed' || !date) return;
                setPreferredAt((current) => {
                  const next = mergePreferredTime(current, date, picker);
                  return Math.abs(next.getTime() - current.getTime()) < 1000 ? current : next;
                });
                setPickerTick((tick) => tick + 1);
              }}
            />
          ) : null}
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13, lineHeight: 19, marginTop: 14 }}>
            If a matching prayer warrior accepts, a live call is scheduled at this time.
          </Text>
          <Button label={submit.isPending ? 'Sending…' : 'Send private request'} onPress={submitRequest} isLoading={submit.isPending} fullWidth style={{ marginTop: 22 }} />
        </View>
      ) : (
        <Button label="New private request" onPress={() => setShowForm(true)} fullWidth />
      )}

      {openRequest ? (
        <View style={{ marginTop: 22 }}>
          <RequestCard
            request={openRequest}
            onJoin={() => openCall.mutate(openRequest.id)}
            joining={openCall.isPending}
            onCancel={() => confirmCancel(openRequest.id)}
            cancelling={cancel.isPending}
            onDelete={() => confirmRemove(openRequest.id)}
            deleting={remove.isPending}
            onResubmit={() => {
              setDescription(openRequest.description);
              setLanguage(offeredLanguage(openRequest.preferred_language));
              const saved = dayjs(openRequest.preferred_at || openRequest.availability[0]?.start_at);
              setPreferredAt(saved.isAfter(dayjs()) ? saved.toDate() : upcomingQuarter().toDate());
              setPicker(null);
              setShowForm(true);
            }}
          />
        </View>
      ) : null}

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
          {assignedRequests.map((item) => (
            <RequestCard
              key={item.id}
              request={item}
              onJoin={() => openCall.mutate(item.id)}
              onPray={() => pray.mutate(item.id)}
              joining={openCall.isPending}
              praying={pray.isPending}
              canReport
            />
          ))}
        </>
      )}
    </ScrollView>
    {menuOpen ? (
      <Pressable accessibilityLabel="Close previous requests" onPress={closeMenu} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
    ) : null}
      </Animated.View>
    </View>
  );
}

const pageShadow = {
  shadowColor: '#2c2417',
  shadowOffset: { width: 8, height: 0 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 8,
};

function RequestCard({ request, onClaim, onJoin, onResubmit, onCancel, onDelete, onPray, claiming, joining, cancelling, deleting, praying, leader, canReport }: {
  request: PrivatePrayerRequest;
  onClaim?: (slotStart?: string) => void;
  onJoin?: () => void;
  onResubmit?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onPray?: () => void;
  claiming?: boolean;
  joining?: boolean;
  cancelling?: boolean;
  deleting?: boolean;
  praying?: boolean;
  leader?: boolean;
  canReport?: boolean;
}) {
  const firstSlot = request.availability[0]?.start_at;
  return (
    <View style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 16, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 15, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14, flex: 1 }}>{leader ? `${request.requester_first_name}'s request` : request.status.replace('_', ' ')}</Text>
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 11, textTransform: 'uppercase' }}>{request.preferred_language}</Text>
      </View>
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13, lineHeight: 20, marginTop: 8 }}>{request.description}</Text>
      {(request.prayer_count ?? 0) > 0 && <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 8 }}>{request.prayer_count} prayer{request.prayer_count === 1 ? '' : 's'} recorded</Text>}
      {!leader && request.wants_live_call && request.preferred_at && !request.scheduled_at && (
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 10 }}>
          Live call at {formatSlot(request.preferred_at)} if a prayer warrior is matched.
        </Text>
      )}
      {request.scheduled_at && <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('500'), fontSize: 12, marginTop: 10 }}>Call scheduled · {formatSlot(request.scheduled_at)}</Text>}
      {leader && request.wants_live_call && firstSlot && <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 10 }}>Available: {formatSlot(firstSlot)}</Text>}
      {leader || canReport ? (
        <Pressable
          onPress={() =>
            promptReportContent({
              contentType: 'prayer_request',
              contentId: request.id,
            })
          }
          hitSlop={8}
          style={{ marginTop: 12, alignSelf: 'flex-start' }}
        >
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 12 }}>Report</Text>
        </Pressable>
      ) : null}
      {leader && onClaim && <Button label={claiming ? 'Accepting…' : request.wants_live_call ? 'Accept & schedule call' : 'Accept request'} onPress={() => onClaim(firstSlot)} isLoading={claiming} fullWidth style={{ marginTop: 14 }} />}
      {request.status === 'scheduled' && onJoin && <Button label={joining ? 'Opening…' : 'Join prayer call'} onPress={onJoin} isLoading={joining} fullWidth style={{ marginTop: 14 }} />}
      {onPray && !['cancelled', 'expired'].includes(request.status) && <Button label={praying ? 'Saving…' : `I prayed for you${request.prayer_count ? ` · ${request.prayer_count}` : ''}`} onPress={onPray} isLoading={praying} variant="secondary" fullWidth style={{ marginTop: 10 }} />}
      {onCancel && ['active', 'claimed', 'scheduled'].includes(request.status) && <Button label={cancelling ? 'Cancelling…' : 'Cancel request'} onPress={onCancel} isLoading={cancelling} variant="ghost" fullWidth style={{ marginTop: 8 }} />}
      {onDelete && <Button label={deleting ? 'Deleting…' : 'Delete'} onPress={onDelete} isLoading={deleting} variant="ghost" fullWidth style={{ marginTop: 8 }} />}
      {request.status === 'expired' && (
        <>
          <Text style={{ color: THEME_COLORS.rose, ...iosFontStyle('500'), fontSize: 12, marginTop: 10 }}>This request expired. You can submit it again.</Text>
          {onResubmit && <Button label="Resubmit request" onPress={onResubmit} variant="secondary" fullWidth style={{ marginTop: 12 }} />}
        </>
      )}
    </View>
  );
}
