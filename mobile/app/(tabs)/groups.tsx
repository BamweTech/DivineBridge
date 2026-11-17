import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useGroupUnread } from '@/features/groups/contexts/GroupUnreadContext';
import { useGroupLiveRooms } from '@/features/groups/hooks/useGroups';
import { groupApi, scheduledApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { PulsingDot } from '@/components/ui/PulsingDot';
import { THEME_COLORS } from '@/lib/constants';
import { parseGroupInviteInput } from '@/lib/parseGroupInvite';
import { iosFontStyle } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { PrayerGroup, ScheduledSession } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── GroupCard ────────────────────────────────────────────────────────────────

function GroupCard({ group, onPress, unreadCount, isLive, liveCount }: { group: PrayerGroup; onPress: () => void; unreadCount?: number; isLive?: boolean; liveCount?: number }) {
  const hasUnread = (unreadCount ?? 0) > 0;
  return (
    <Pressable onPress={onPress}>
      <View style={{
        backgroundColor: '#f0faf3',
        borderWidth: 1,
        borderColor: isLive ? 'rgba(52,211,153,0.35)' : 'rgba(74,124,94,0.22)',
        borderRadius: 22,
        padding: 18,
        marginBottom: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <View style={{ position: 'relative' }}>
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: THEME_COLORS.sageDim, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="groups" size={18} color={THEME_COLORS.sage} />
            </View>
            {isLive ? (
              <View style={{ position: 'absolute', top: -4, right: -4 }}>
                <PulsingDot size={6} color="#34d399" />
              </View>
            ) : hasUnread ? (
              <View
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -6,
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 4,
                  borderRadius: 9,
                  backgroundColor: THEME_COLORS.rose,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: '#f0faf3',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 9, ...iosFontStyle('700') }}>
                  {(unreadCount ?? 0) > 99 ? '99+' : unreadCount}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 15 }}>
                {group.name}
              </Text>
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
                  <Text style={{ color: '#34d399', ...iosFontStyle('600'), fontSize: 10 }}>LIVE</Text>
                </View>
              )}
            </View>
            {group.description && !isLive && !hasUnread && (
              <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                {group.description}
              </Text>
            )}
            {isLive && (
              <Text style={{ color: '#34d399', ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>
                {(liveCount ?? 0) > 0 ? `${liveCount} praying now` : 'Live session in progress'}
              </Text>
            )}
            {!isLive && hasUnread && (
              <Text style={{ color: THEME_COLORS.rose, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>
                {unreadCount} unread message{unreadCount === 1 ? '' : 's'}
              </Text>
            )}
          </View>
        </View>
        <View style={{ backgroundColor: 'rgba(74,124,94,0.08)', borderWidth: 1, borderColor: 'rgba(74,124,94,0.15)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="groups" size={14} color={THEME_COLORS.text3} />
            <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 13 }}>
              {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
            </Text>
          </View>
          <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
        </View>
      </View>
    </Pressable>
  );
}

// ─── CreateGroupModal ─────────────────────────────────────────────────────────

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    if (name.trim().length < 3) {
      Alert.alert('Group name must be at least 3 characters');
      return;
    }
    setIsCreating(true);
    try {
      await groupApi.create({ name: name.trim(), description: description.trim(), privacy: 'private' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err: any) {
      Alert.alert('Failed to create group', err.message);
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <View style={{ padding: 24 }}>
      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 22, marginBottom: 20 }}>
        Create a Prayer Group
      </Text>
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13, marginBottom: 6 }}>Group Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Morning Prayer Warriors"
        placeholderTextColor={THEME_COLORS.text3}
        maxLength={50}
        style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 }}
      />
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13, marginBottom: 6 }}>Description (optional)</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="What is this group about?"
        placeholderTextColor={THEME_COLORS.text3}
        maxLength={200}
        multiline
        numberOfLines={3}
        style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 24, minHeight: 80, textAlignVertical: 'top' }}
      />
      <Button label="Create Group" onPress={handleCreate} isLoading={isCreating} fullWidth />
      <Button label="Cancel" onPress={onClose} variant="ghost" fullWidth style={{ marginTop: 8 }} />
    </View>
  );
}

// ─── UpcomingSessions ─────────────────────────────────────────────────────────

function UpcomingSessions({ onJoinRoom }: { onJoinRoom: (session: ScheduledSession) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['my-scheduled-rooms'],
    queryFn: () => scheduledApi.myRooms(),
  });

  const sessions: ScheduledSession[] = data?.sessions ?? [];
  const upcoming = sessions
    .filter((s) => s.status === 'scheduled' && s.scheduled_time * 1000 > Date.now())
    .sort((a, b) => a.scheduled_time - b.scheduled_time)
    .slice(0, 3);

  if (!isLoading && upcoming.length === 0) return null;

  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 16, marginBottom: 12 }}>Upcoming Sessions</Text>
      {isLoading ? (
        <ActivityIndicator color={THEME_COLORS.gold} />
      ) : (
        upcoming.map((s) => {
          const t = dayjs(s.scheduled_time * 1000);
          const isToday = t.isSame(dayjs(), 'day');
          return (
            <Pressable
              key={s.scheduled_room_id}
              onPress={() => onJoinRoom(s)}
              style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 18, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 14 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: THEME_COLORS.sageDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="calendar" size={20} color={THEME_COLORS.sage} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14, marginBottom: 3 }} numberOfLines={1}>{s.room_name}</Text>
                <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12 }}>
                  {isToday ? `Today at ${t.format('h:mm A')}` : t.format('ddd, MMM D · h:mm A')}
                  {s.host_name ? ` · ${s.host_name}` : ''}
                </Text>
              </View>
              {s.is_recurring && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: THEME_COLORS.goldDim }}>
                  <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('500'), fontSize: 10 }}>Weekly</Text>
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </View>
  );
}


// ─── Join by invite code ──────────────────────────────────────────────────────

function HeaderPill({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: 'user-plus' | 'plus';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 50,
        backgroundColor: THEME_COLORS.bg3,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={THEME_COLORS.text2} /> : null}
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function JoinGroupByCodeModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [codeInput, setCodeInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  async function handleJoin() {
    const parsed = parseGroupInviteInput(codeInput);
    if (!parsed || (!parsed.groupId && !parsed.code)) {
      Alert.alert(
        'Enter an invite code',
        'Type the 8-character code from the invite, or paste the invite link.',
      );
      return;
    }

    setIsJoining(true);
    try {
      let groupId = parsed.groupId;
      if (parsed.groupId) {
        await groupApi.join(parsed.groupId, parsed.code || undefined);
      } else {
        const result = await groupApi.joinByCode(parsed.code);
        groupId = result.group_id;
      }
      if (!groupId) {
        setIsJoining(false);
        Alert.alert('Could not join group', 'That invite code did not match a group.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
      router.push(`/group/${groupId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? err.message : 'Please try again.';
      if (/already a member/i.test(msg) && parsed.groupId) {
        onClose();
        router.push(`/group/${parsed.groupId}`);
        return;
      }
      setIsJoining(false);
      Alert.alert('Could not join group', msg);
    }
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.55)', justifyContent: 'flex-end' }}
          onPress={onClose}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: THEME_COLORS.bg,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 24,
              paddingTop: 16,
              paddingBottom: 48,
            }}
          >
            <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 20, textAlign: 'center', marginBottom: 4, letterSpacing: -0.3 }}>
              Join group
            </Text>
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 18 }}>
              Enter the 8-character code, or paste the invite link.
            </Text>
            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder="A1B2C3D4"
              placeholderTextColor={THEME_COLORS.text3}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              maxLength={500}
              onSubmitEditing={handleJoin}
              returnKeyType="go"
              style={{
                backgroundColor: THEME_COLORS.bg2,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: THEME_COLORS.border,
                color: THEME_COLORS.text,
                ...iosFontStyle(/[:/]/.test(codeInput) ? '400' : '600'),
                fontSize: /[:/]/.test(codeInput) ? 14 : 18,
                letterSpacing: /[:/]/.test(codeInput) ? 0 : 2,
                paddingHorizontal: 16,
                paddingVertical: 14,
                marginBottom: 20,
                textAlign: /[:/]/.test(codeInput) ? 'left' : 'center',
              }}
            />
            <Button
              label="Join"
              onPress={handleJoin}
              isLoading={isJoining}
              disabled={!codeInput.trim()}
              fullWidth
            />
            <Button label="Cancel" onPress={onClose} variant="ghost" fullWidth style={{ marginTop: 8 }} />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tab: tabParam, compose } = useLocalSearchParams<{ tab?: string; compose?: string }>();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  useEffect(() => {
    if (tabParam !== 'prayer-wall' && compose !== '1') return;
    router.replace(compose === '1' ? '/prayer-wall?compose=1' as never : '/prayer-wall' as never);
  }, [tabParam, compose, router]);

  const { groups: myGroups, isLoadingGroups: myLoading, unreadCountByGroup } = useGroupUnread();
  const liveByGroup = useGroupLiveRooms(myGroups.map((g) => g.group_id));

  // When Create Group or Compose Prayer modal is open, render it fullscreen
  if (showCreate) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 16 }}
      >
        <CreateGroupModal onClose={() => setShowCreate(false)} />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: 16 }}
      >
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 26, letterSpacing: -0.5, marginBottom: 12 }}>
          Prayer Groups
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <HeaderPill label="Join group" icon="user-plus" onPress={() => setShowJoin(true)} />
          <HeaderPill label="New Group" icon="plus" onPress={() => setShowCreate(true)} />
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        <UpcomingSessions onJoinRoom={(s) => {
          if (s.active_room_id) router.push(`/room/${s.active_room_id}` as never);
        }} />

        {myLoading ? (
          <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 40 }} />
        ) : myGroups.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 20 }}>
            <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: THEME_COLORS.border }}>
              <Icon name="gathering" size={36} color={THEME_COLORS.text3} />
            </View>
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 20, marginBottom: 8 }}>
              You're not in any group yet
            </Text>
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, textAlign: 'center', maxWidth: 260, lineHeight: 22, marginBottom: 24 }}>
              Prayer is better together. Join with an invite code, or create your own group.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
              <Button label="Join group" onPress={() => setShowJoin(true)} />
              <Button label="Create Group" onPress={() => setShowCreate(true)} />
            </View>
          </View>
        ) : (
          myGroups.map((group, i) => {
            const liveRoom = liveByGroup[group.group_id];
            return (
              <Animated.View key={group.group_id} entering={FadeInDown.delay(i * 50).duration(400)}>
                <GroupCard
                  group={group}
                  unreadCount={unreadCountByGroup[group.group_id]}
                  isLive={!!liveRoom}
                  liveCount={liveRoom?.participants?.length}
                  onPress={() => router.push(`/group/${group.group_id}` as never)}
                />
              </Animated.View>
            );
          })
        )}
      </ScrollView>
      {showJoin ? <JoinGroupByCodeModal onClose={() => setShowJoin(false)} /> : null}
    </View>
  );
}
