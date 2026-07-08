import { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert, TextInput, Share } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { roomApi, scheduledApi, voiceLinkApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle, iosFontStyleItalic } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import { useLiveRooms } from '@/hooks/useGroups';
import type { PrayerRoom, ScheduledSession } from '@/types';

dayjs.extend(relativeTime);

function LiveRoomCard({ room, onJoin }: { room: PrayerRoom; onJoin: () => void }) {
  const speakerCount = room.participants?.filter((p) => p.role === 'speaker').length ?? 0;
  const listenerCount = room.participants?.filter((p) => p.role === 'listener').length ?? 0;

  return (
    <View style={{ backgroundColor: '#eef5f0', borderWidth: 1, borderColor: 'rgba(74,124,94,0.22)', borderRadius: 20, padding: 18, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {/* Live pill */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: THEME_COLORS.sageDim, borderRadius: 50, paddingHorizontal: 10, paddingVertical: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: THEME_COLORS.sage }} />
              <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('600'), fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>Live</Text>
            </View>
            {room.room_privacy === 'private' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border }}>
                <Icon name="lock" size={10} color={THEME_COLORS.text3} />
                <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 10 }}>Private</Text>
              </View>
            )}
          </View>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 16 }}>
            {room.room_name}
          </Text>
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13, marginTop: 2 }}>
            Hosted by {room.host_name}
          </Text>
        </View>
        <Pressable
          onPress={onJoin}
          style={{ backgroundColor: THEME_COLORS.sage, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ color: '#ffffff', ...iosFontStyle('700'), fontSize: 13 }}>Join</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="mic" size={13} color={THEME_COLORS.text3} />
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12 }}>
            {speakerCount} speaking
          </Text>
        </View>
        {listenerCount > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="radio" size={13} color={THEME_COLORS.text3} />
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12 }}>
              {listenerCount} listening
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function ScheduledCard({ session, onRsvp }: { session: ScheduledSession; onRsvp: () => void }) {
  const isToday = dayjs.unix(session.scheduled_time).isSame(dayjs(), 'day');

  return (
    <View style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 20, padding: 18, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
      {/* Date block */}
      <View style={{ width: 48, alignItems: 'center', backgroundColor: THEME_COLORS.bg3, borderRadius: 12, paddingVertical: 8, flexShrink: 0 }}>
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('700'), fontSize: 20, lineHeight: 22 }}>
          {dayjs.unix(session.scheduled_time).format('D')}
        </Text>
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>
          {dayjs.unix(session.scheduled_time).format('MMM')}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: isToday ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: isToday ? THEME_COLORS.goldBorder : THEME_COLORS.border }}>
            <Text style={{ color: isToday ? THEME_COLORS.gold : THEME_COLORS.text3, ...iosFontStyle('600'), fontSize: 11 }}>
              {isToday ? 'Today' : dayjs.unix(session.scheduled_time).format('ddd')} · {dayjs.unix(session.scheduled_time).format('h:mm A')}
            </Text>
          </View>
          {session.is_recurring && (
            <Icon name="calendar" size={12} color={THEME_COLORS.text3} />
          )}
        </View>
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 15 }}>
          {session.room_name}
        </Text>
        {session.room_description && (
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13, marginTop: 2 }} numberOfLines={1}>
            {session.room_description}
          </Text>
        )}
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 4 }}>
          by {session.host_name} · {session.total_rsvps} RSVP{session.total_rsvps !== 1 ? 's' : ''}
        </Text>
      </View>

      <Pressable
        onPress={onRsvp}
        style={{
          borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
          backgroundColor: session.user_rsvp_status ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          borderWidth: 1,
          borderColor: session.user_rsvp_status ? THEME_COLORS.goldBorder : THEME_COLORS.border,
        }}
      >
        <Text style={{ color: session.user_rsvp_status ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 12 }}>
          {session.user_rsvp_status ? '✓ Going' : 'RSVP'}
        </Text>
      </Pressable>
    </View>
  );
}

function CreateRoomModal({ onCreated, onClose }: { onCreated: (roomId: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    if (name.trim().length < 3) {
      Alert.alert('Room name must be at least 3 characters');
      return;
    }
    setIsCreating(true);
    try {
      const result = await roomApi.create(name.trim(), privacy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated(result.room_id);
    } catch (err: any) {
      Alert.alert('Failed to create room', err.message);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <View style={{ padding: 24 }}>
      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 22, marginBottom: 20 }}>
        Create a Prayer Room
      </Text>
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13, marginBottom: 6 }}>Room Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Evening Worship"
        placeholderTextColor={THEME_COLORS.text3}
        maxLength={60}
        style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 }}
      />
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13, marginBottom: 8 }}>Privacy</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
        {(['public', 'private'] as const).map((opt) => (
          <Pressable
            key={opt}
            onPress={() => setPrivacy(opt)}
            style={{
              flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
              backgroundColor: privacy === opt ? THEME_COLORS.sageDim : THEME_COLORS.bg2,
              borderWidth: 1,
              borderColor: privacy === opt ? THEME_COLORS.sage : THEME_COLORS.border,
            }}
          >
            <Text style={{
              color: privacy === opt ? THEME_COLORS.sage : THEME_COLORS.text2,
              ...iosFontStyle(privacy === opt ? '600' : '400'), fontSize: 14,
              textTransform: 'capitalize',
            }}>
              {opt}
            </Text>
          </Pressable>
        ))}
      </View>
      <Button label="Create Room" onPress={handleCreate} isLoading={isCreating} fullWidth />
      <Button label="Cancel" onPress={onClose} variant="ghost" fullWidth style={{ marginTop: 8 }} />
    </View>
  );
}

export default function RoomsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'live' | 'scheduled'>('live');
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [startingVoiceLink, setStartingVoiceLink] = useState(false);

  // Real-time Firestore listener — no polling delay
  const { rooms: liveRooms, isLoading: liveLoading } = useLiveRooms();

  const onRefreshLive = useCallback(() => {
    setLiveRefreshing(true);
    setTimeout(() => setLiveRefreshing(false), 600);
  }, []);

  const scheduledQuery = useQuery({
    queryKey: ['scheduled-sessions'],
    queryFn: () => scheduledApi.list({ time: 'all', sort: 'soonest' }),
  });

  function handleCreateRoom() {
    if (!user) { Alert.alert('Sign in to create a room'); return; }
    setShowCreate(true);
  }

  async function handleStartVoiceLink() {
    if (!user) { Alert.alert('Sign in to start a voice call'); return; }
    if (startingVoiceLink) return;
    setStartingVoiceLink(true);
    try {
      const result = await voiceLinkApi.create();
      const href =
        `/voice-call/${result.room_id}?code=${encodeURIComponent(result.room_code)}` +
        `&shareUrl=${encodeURIComponent(result.share_url)}`;
      router.push(href as Href);
      try {
        await Share.share({
          message: `Join my voice call on Divine Bridge:\n\n${result.share_url}`,
          url: result.share_url,
        });
      } catch {
        /* user dismissed share sheet — call screen has its own Share button */
      }
    } catch (err: any) {
      Alert.alert('Could not start call', err?.message || 'Please try again.');
    } finally {
      setStartingVoiceLink(false);
    }
  }

  async function handleJoinRoom(roomId: string) {
    router.push(`/room/${roomId}`);
  }

  async function handleRsvp(session: ScheduledSession) {
    if (!user) { Alert.alert('Sign in to RSVP'); return; }
    try {
      if (session.user_rsvp_status) {
        await scheduledApi.removeRsvp(session.scheduled_room_id);
      } else {
        await scheduledApi.rsvp(session.scheduled_room_id, 'going', { reminder_1hour: true, reminder_live: true });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      queryClient.invalidateQueries({ queryKey: ['scheduled-sessions'] });
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  }

  const sessions: ScheduledSession[] = scheduledQuery.data?.sessions ?? [];

  if (showCreate) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <CreateRoomModal
          onCreated={(roomId) => { setShowCreate(false); router.push(`/room/${roomId}`); }}
          onClose={() => setShowCreate(false)}
        />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: 16 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 26, letterSpacing: -0.5 }}>
            Prayer Rooms
          </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={() => void handleStartVoiceLink()}
            disabled={startingVoiceLink}
            style={{
              backgroundColor: THEME_COLORS.goldDim,
              borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
              borderWidth: 1, borderColor: THEME_COLORS.goldBorder,
              opacity: startingVoiceLink ? 0.6 : 1,
            }}
          >
            <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('700'), fontSize: 13 }}>
              {startingVoiceLink ? '…' : 'Voice link'}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleCreateRoom}
            style={{
              backgroundColor: THEME_COLORS.sage,
              borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
            }}
          >
            <Text style={{ color: '#ffffff', ...iosFontStyle('700'), fontSize: 13 }}>+ Create</Text>
          </Pressable>
        </View>
        </View>

        <View style={{ flexDirection: 'row', backgroundColor: THEME_COLORS.bg3, borderRadius: 12, padding: 4 }}>
          {(['live', 'scheduled'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 10,
                backgroundColor: tab === t ? THEME_COLORS.bg2 : 'transparent',
                alignItems: 'center',
                borderWidth: tab === t ? 1 : 0,
                borderColor: THEME_COLORS.border,
              }}
            >
              <Text style={{ color: tab === t ? THEME_COLORS.text : THEME_COLORS.text3, ...iosFontStyle(tab === t ? '600' : '400'), fontSize: 13 }}>
                {t === 'live'
                  ? `Live ${liveRooms.length > 0 ? `(${liveRooms.length})` : ''}`
                  : 'Scheduled'}
              </Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={tab === 'live' ? liveRefreshing : scheduledQuery.isFetching}
            onRefresh={() => {
              if (tab === 'live') onRefreshLive();
              else queryClient.invalidateQueries({ queryKey: ['scheduled-sessions'] });
            }}
            tintColor={THEME_COLORS.gold}
          />
        }
      >
        {tab === 'live' ? (
          liveLoading ? (
            <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 40 }} />
          ) : liveRooms.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: THEME_COLORS.border }}>
                <Icon name="radio" size={32} color={THEME_COLORS.text3} />
              </View>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 18, marginBottom: 8 }}>No live rooms</Text>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, textAlign: 'center', maxWidth: 240, marginBottom: 20 }}>
                Be the first to open a prayer room
              </Text>
              <Button label="Open a Room" onPress={handleCreateRoom} />
            </View>
          ) : (
            liveRooms.map((room, i) => (
              <Animated.View key={room.room_id} entering={FadeInDown.delay(i * 50).duration(400)}>
                <LiveRoomCard room={room} onJoin={() => handleJoinRoom(room.room_id)} />
              </Animated.View>
            ))
          )
        ) : (
          scheduledQuery.isLoading ? (
            <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 40 }} />
          ) : sessions.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: THEME_COLORS.border }}>
                <Icon name="calendar" size={32} color={THEME_COLORS.text3} />
              </View>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 18, marginBottom: 8 }}>No sessions scheduled</Text>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, textAlign: 'center', maxWidth: 240 }}>
                Schedule a recurring prayer session for your group
              </Text>
            </View>
          ) : (
            sessions.map((session, i) => (
              <Animated.View key={session.scheduled_room_id} entering={FadeInDown.delay(i * 50).duration(400)}>
                <ScheduledCard session={session} onRsvp={() => handleRsvp(session)} />
              </Animated.View>
            ))
          )
        )}
      </ScrollView>
    </View>
  );
}
