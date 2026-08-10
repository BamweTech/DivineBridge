import React, { useState, useCallback, memo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useGroupUnread } from '@/contexts/GroupUnreadContext';
import { useGroupLiveRooms } from '@/hooks/useGroups';
import { groupApi, scheduledApi, prayerRequestApi, globalWatchApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { PulsingDot } from '@/components/ui/PulsingDot';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle, iosFontStyleItalic } from '@/lib/typography';
import { filterGlobalWatchForFeed } from '@/lib/globalWatchFeed';
import { isHiddenProductionTestWallItem } from '@/lib/qaWallFilters';
import Icon from '@/components/ui/Icon';
import { useAuthStore } from '@/stores/authStore';
import type { PrayerGroup, ScheduledSession } from '@/types';

type Tab = 'mine' | 'prayer-wall';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const d = dayjs(dateStr);
  const diff = dayjs().diff(d, 'minute');
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const hours = Math.floor(diff / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.format('MMM D');
}

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

// ─── PrayerCard ───────────────────────────────────────────────────────────────

interface PrayerPost {
  id: string;
  title?: string;
  content: string;
  summary?: string;
  user_id?: string;
  is_anonymous?: boolean;
  created_at: string;
  analytics?: { prayers?: number; views?: number };
}

interface GlobalWatchPost {
  id: string;
  disaster_type: string;
  disaster_type_display: string;
  affected_countries: string[];
  summary: string;
  /** Short 1-2 sentence prayer generated specifically for the Prayer Wall feed. */
  wall_prayer: string;
  created_at: string;
}

// ─── GlobalWatchCard ──────────────────────────────────────────────────────────

const FADE_IN_ANIMATION = FadeInDown.duration(350);

const GlobalWatchCard = memo(function GlobalWatchCard({
  post,
  onPray,
}: {
  post: GlobalWatchPost;
  /** Must call API; resolves when tracked, rejects on failure. */
  onPray: () => Promise<void>;
}) {
  const [prayed, setPrayed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const countries = post.affected_countries.slice(0, 3);
  const extra = post.affected_countries.length - 3;

  async function handlePray() {
    if (prayed || busy || !post.id) return;
    setBusy(true);
    try {
      await onPray();
      setPrayed(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      const isAuth =
        /unauthorized|401|sign in|authentication/i.test(msg) || msg === 'HTTP 401';
      Alert.alert(
        'Could not record prayer',
        isAuth
          ? 'Your session may have expired. Try again, or sign out and back in if this keeps happening.'
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Animated.View entering={FADE_IN_ANIMATION}>
      <View style={{
        backgroundColor: '#f6f3fc',
        borderWidth: 1,
        borderColor: 'rgba(112,64,184,0.18)',
        borderRadius: 20,
        padding: 16,
        marginBottom: 14,
        overflow: 'hidden',
      }}>
        {/* Subtle glow */}
        <View style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(112,64,184,0.06)' }} pointerEvents="none" />

        {/* Header — avatar-style globe icon + name + badge */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(112,64,184,0.12)', borderWidth: 1.5, borderColor: 'rgba(112,64,184,0.25)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="globe" size={20} color={THEME_COLORS.violet} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 14 }}>
                Global Prayer Watch
              </Text>
              {/* verified-style badge */}
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: THEME_COLORS.violet, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 8, ...iosFontStyle('700'), lineHeight: 14 }}>✓</Text>
              </View>
            </View>
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 11, marginTop: 1 }}>
              {post.disaster_type_display} · {timeAgo(post.created_at)}
            </Text>
          </View>
        </View>

        {/* Wall prayer — the main post body */}
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15, lineHeight: 24, marginBottom: 12 }}>
          {post.wall_prayer}
        </Text>

        {/* Country tags */}
        {countries.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {countries.map((c) => (
              <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 50, backgroundColor: 'rgba(112,64,184,0.07)', borderWidth: 1, borderColor: 'rgba(112,64,184,0.14)' }}>
                <Icon name="globe" size={9} color={THEME_COLORS.violet} />
                <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('500'), fontSize: 11 }}>{c}</Text>
              </View>
            ))}
            {extra > 0 && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 50, backgroundColor: 'rgba(112,64,184,0.07)' }}>
                <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('400'), fontSize: 11 }}>+{extra} more</Text>
              </View>
            )}
          </View>
        )}

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: 'rgba(112,64,184,0.1)', marginBottom: 10 }} />

        {/* Actions */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={handlePray}
            disabled={busy || prayed || !post.id}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50,
              opacity: busy ? 0.65 : 1,
              backgroundColor: prayed
                ? 'rgba(112,64,184,0.16)'
                : pressed ? 'rgba(112,64,184,0.1)' : 'rgba(112,64,184,0.06)',
              borderWidth: 1,
              borderColor: prayed ? 'rgba(112,64,184,0.4)' : 'rgba(112,64,184,0.16)',
            })}
          >
            <Icon name="pray" size={14} color={THEME_COLORS.violet} />
            <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('600'), fontSize: 13 }}>
              {busy ? 'Saving…' : prayed ? 'Prayed 🙏' : 'I Prayed'}
            </Text>
          </Pressable>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 11, flex: 1, textAlign: 'right' }}>
            #GlobalWatch
          </Text>
        </View>
      </View>
    </Animated.View>
  );
});

const PrayerCard = memo(function PrayerCard({
  post,
  currentUserId,
  onPray,
}: {
  post: PrayerPost;
  currentUserId?: string;
  onPray: () => void;
}) {
  const isAnon = Boolean(post.is_anonymous) || !post.user_id;
  const isMe =
    !!currentUserId &&
    !!post.user_id &&
    post.user_id === currentUserId &&
    !post.is_anonymous;
  const prayCount = post.analytics?.prayers ?? 0;

  return (
    <Animated.View entering={FADE_IN_ANIMATION}>
      <View style={{
        backgroundColor: THEME_COLORS.bg2,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
        borderRadius: 20,
        padding: 18,
        marginBottom: 14,
      }}>
        {/* Author row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          {isAnon ? (
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="cross" size={16} color={THEME_COLORS.gold} />
            </View>
          ) : (
            <Avatar name={isMe ? 'Me' : 'Community'} size={38} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: isMe ? THEME_COLORS.gold : THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14 }}>
              {isAnon ? 'Anonymous' : isMe ? 'You' : 'Community Member'}
            </Text>
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 11, marginTop: 1 }}>
              {timeAgo(post.created_at)}
            </Text>
          </View>
          {/* Prayer tag */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 50, backgroundColor: THEME_COLORS.goldDim }}>
            <Icon name="cross" size={8} color={THEME_COLORS.gold} />
            <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('500'), fontSize: 9, letterSpacing: 0.6, textTransform: 'uppercase' }}>Prayer</Text>
          </View>
        </View>

        {/* Prayer content */}
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15, lineHeight: 26, marginBottom: 14 }}>
          {post.content}
        </Text>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: THEME_COLORS.border, marginBottom: 12 }} />

        {/* Actions row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            onPress={onPray}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50,
              backgroundColor: pressed ? THEME_COLORS.sageDim : THEME_COLORS.bg3,
              borderWidth: 1, borderColor: pressed ? 'rgba(74,124,94,0.25)' : THEME_COLORS.border,
            })}
          >
            <Icon name="pray" size={14} color={THEME_COLORS.sage} />
            <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('600'), fontSize: 13 }}>
              I Prayed{prayCount > 0 ? ` · ${prayCount}` : ''}
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
});

// ─── ComposeModal ─────────────────────────────────────────────────────────────

function ComposeModal({
  onClose,
  onPosted,
}: {
  onClose: () => void;
  onPosted: () => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [isAnon, setIsAnon] = useState(false);
  const MAX = 500;

  const submitMutation = useMutation({
    mutationFn: () => prayerRequestApi.submit(text.trim(), isAnon),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['prayer-wall'] });
      onPosted();
    },
    onError: (err: any) => {
      Alert.alert('Could not post prayer', err.message ?? 'Please try again.');
    },
  });

  function handlePost() {
    if (text.trim().length < 10) {
      Alert.alert('Your prayer is too short', 'Write at least 10 characters so the community can pray with you.');
      return;
    }
    submitMutation.mutate();
  }

  const remaining = MAX - text.length;
  const isNearLimit = remaining <= 50;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={{ flex: 1, padding: 24 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Pressable onPress={onClose} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" size={14} color={THEME_COLORS.text2} />
          </Pressable>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 18 }}>Share a Prayer</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* Verse hint */}
        <View style={{ backgroundColor: THEME_COLORS.goldDim2, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="cross" size={12} color={THEME_COLORS.gold} />
          <Text style={{ flex: 1, color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 12, lineHeight: 18, fontStyle: 'italic' }}>
            "Bear one another's burdens, and so fulfill the law of Christ." — Galatians 6:2
          </Text>
        </View>

        {/* Text input */}
        <TextInput
          value={text}
          onChangeText={(v) => { if (v.length <= MAX) setText(v); }}
          placeholder="Write your prayer request here…&#10;Share what's on your heart, or ask for prayer for someone else."
          placeholderTextColor={THEME_COLORS.text3}
          multiline
          autoFocus
          style={{
            flex: 1,
            backgroundColor: THEME_COLORS.bg3,
            borderRadius: 18, borderWidth: 1, borderColor: THEME_COLORS.border,
            color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15,
            lineHeight: 26, paddingHorizontal: 16, paddingVertical: 14,
            textAlignVertical: 'top', marginBottom: 12,
          }}
        />

        {/* Char counter */}
        <Text style={{ color: isNearLimit ? THEME_COLORS.rose : THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, textAlign: 'right', marginBottom: 16 }}>
          {remaining} characters remaining
        </Text>

        {/* Anonymous toggle */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 14, marginBottom: 20, gap: 12 }}>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={15} color={THEME_COLORS.text2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('500'), fontSize: 14 }}>Post anonymously</Text>
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 1 }}>Your name won't appear on this prayer</Text>
          </View>
          <Switch
            value={isAnon}
            onValueChange={setIsAnon}
            thumbColor={THEME_COLORS.gold}
            trackColor={{ false: THEME_COLORS.bg3, true: THEME_COLORS.goldDim }}
          />
        </View>

        {/* Post button */}
        <Button
          label={submitMutation.isPending ? 'Posting…' : 'Post Prayer'}
          onPress={handlePost}
          isLoading={submitMutation.isPending}
          fullWidth
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── PrayerWallFeed ───────────────────────────────────────────────────────────

type FeedItem =
  | { kind: 'community'; data: PrayerPost }
  | { kind: 'global'; data: GlobalWatchPost };

function PrayerWallFeed({
  currentUserId,
  onCompose,
  onPrivateRequest,
}: {
  currentUserId?: string;
  onCompose: () => void;
  onPrivateRequest: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: communityData, isLoading: communityLoading, refetch: refetchCommunity, isFetching: communityFetching } = useQuery({
    queryKey: ['prayer-wall'],
    queryFn: () => prayerRequestApi.list(),
    refetchInterval: 60_000,
  });

  const { data: globalData, isLoading: globalLoading, refetch: refetchGlobal, isFetching: globalFetching } = useQuery({
    queryKey: ['global-watch'],
    queryFn: () => globalWatchApi.list(),
    refetchInterval: 5 * 60_000, // global watch refreshes every 5 min
  });

  const bumpHomePrayMetrics = () => {
    queryClient.setQueryData(
      ['home-prayer-metrics'],
      (old: { wall_pray_last_7_days?: number; wall_pray_streak_days?: number } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          wall_pray_last_7_days: (old.wall_pray_last_7_days ?? 0) + 1,
        };
      }
    );
  };

  const prayMutation = useMutation({
    mutationFn: (id: string) => prayerRequestApi.pray(id),
    onSuccess: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      queryClient.invalidateQueries({ queryKey: ['prayer-wall'] });
      bumpHomePrayMetrics();
      queryClient.invalidateQueries({ queryKey: ['home-prayer-metrics'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      const isAuth =
        /unauthorized|401|sign in|authentication/i.test(msg) || msg === 'HTTP 401';
      Alert.alert(
        'Could not record prayer',
        isAuth
          ? 'Your session may have expired. Try again, or sign out and back in if this keeps happening.'
          : msg
      );
    },
  });

  const globalWatchPrayMutation = useMutation({
    mutationFn: (id: string) => globalWatchApi.pray(id),
    onSuccess: () => {
      bumpHomePrayMetrics();
      queryClient.invalidateQueries({ queryKey: ['home-prayer-metrics'] });
    },
  });

  // Community posts — exclude AI daily prayers (source === 'generated'); hide QA fingerprints
  const communityPosts: PrayerPost[] = (communityData?.prayers ?? []).filter(
    (p: any) =>
      !(p.source === 'generated' && !p.user_id) && !isHiddenProductionTestWallItem(p as Record<string, unknown>)
  );

  // Global watch: max 10, drop AI/meta junk, one card per event (dedupe)
  const globalPosts: GlobalWatchPost[] = filterGlobalWatchForFeed(
    globalData?.prayers ?? []
  );

  // Build interleaved feed: global watch cards appear between every 3 community posts
  const feed: FeedItem[] = [];
  let gi = 0;
  communityPosts.forEach((cp, i) => {
    feed.push({ kind: 'community', data: cp });
    // Insert a global watch card after every 3rd community post
    if ((i + 1) % 3 === 0 && gi < globalPosts.length) {
      feed.push({ kind: 'global', data: globalPosts[gi++] });
    }
  });
  // Append remaining global watch cards at the top if no community posts yet
  if (communityPosts.length === 0) {
    globalPosts.forEach((gp) => feed.push({ kind: 'global', data: gp }));
  } else {
    // Append any leftover global watch cards at the end
    while (gi < globalPosts.length) {
      feed.push({ kind: 'global', data: globalPosts[gi++] });
    }
  }

  const isLoading = communityLoading && globalLoading;
  const isFetching = communityFetching || globalFetching;

  const handleRefresh = useCallback(() => {
    refetchCommunity();
    refetchGlobal();
  }, [refetchCommunity, refetchGlobal]);

  const keyExtractor = useCallback(
    (item: FeedItem, i: number) =>
      `${item.kind}-${item.kind === 'global' ? item.data.id : (item.data as PrayerPost).id}-${i}`,
    []
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) =>
      item.kind === 'global' ? (
        <GlobalWatchCard
          post={item.data as GlobalWatchPost}
          onPray={async () => {
            await globalWatchPrayMutation.mutateAsync((item.data as GlobalWatchPost).id);
          }}
        />
      ) : (
        <PrayerCard
          post={item.data as PrayerPost}
          currentUserId={currentUserId}
          onPray={() => prayMutation.mutate((item.data as PrayerPost).id)}
        />
      ),
    [currentUserId, prayMutation, globalWatchPrayMutation]
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 }}>
        <ActivityIndicator color={THEME_COLORS.gold} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {feed.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={handleRefresh} tintColor={THEME_COLORS.gold} />}
        >
          <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <Icon name="pray" size={36} color={THEME_COLORS.gold} />
          </View>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 20, textAlign: 'center', marginBottom: 10 }}>
            Be the first to pray
          </Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 28 }}>
            Share a prayer request with the community. Your words might be exactly what someone needs today.
          </Text>
          <Button label="Share a Prayer" onPress={onCompose} />
        </ScrollView>
      ) : (
        <FlatList
          data={feed}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={handleRefresh} tintColor={THEME_COLORS.gold} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Animated.View entering={FadeIn.duration(400)} style={{ marginBottom: 16 }}>
              <Pressable
                onPress={onPrivateRequest}
                style={{ backgroundColor: THEME_COLORS.sageDim, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(74,124,94,0.24)', padding: 13, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <Icon name="lock" size={15} color={THEME_COLORS.sage} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('600'), fontSize: 13 }}>Need private prayer?</Text>
                  <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 11, marginTop: 2 }}>Match with a prayer leader in your language</Text>
                </View>
                <Icon name="chevron-r" size={15} color={THEME_COLORS.sage} />
              </Pressable>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, textAlign: 'center' }}>
                Community prayers · Global watch
              </Text>
            </Animated.View>
          }
        />
      )}

      {/* Floating compose button */}
      {feed.length > 0 && (
        <Pressable
          onPress={onCompose}
          style={({ pressed }) => ({
            position: 'absolute', bottom: 96, right: 22,
            width: 52, height: 52, borderRadius: 16,
            backgroundColor: THEME_COLORS.gold,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: THEME_COLORS.gold, shadowOpacity: 0.35,
            shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Icon name="plus" size={22} color="#ffffff" />
        </Pressable>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('mine');

  // Deep link / Activity hub: /(tabs)/groups?tab=prayer-wall
  useEffect(() => {
    if (tabParam === 'prayer-wall' || tabParam === 'mine') {
      setTab(tabParam);
    }
  }, [tabParam]);

  function selectTab(next: Tab) {
    setTab(next);
    router.setParams({ tab: next });
  }
  const [showCreate, setShowCreate] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const { groups: myGroups, isLoadingGroups: myLoading, unreadByGroup, unreadCountByGroup, totalUnread } = useGroupUnread();
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

  if (showCompose) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 8 }}>
        <ComposeModal
          onClose={() => setShowCompose(false)}
          onPosted={() => setShowCompose(false)}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: 16 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 26, letterSpacing: -0.5 }}>
            {tab === 'prayer-wall' ? 'Prayer Wall' : 'Prayer Groups'}
          </Text>
          {/* The + button opens CreateGroup on "mine" tab and Compose on "prayer-wall" tab */}
          <Pressable
            onPress={() => tab === 'prayer-wall' ? setShowCompose(true) : setShowCreate(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 7,
              borderRadius: 50,
              backgroundColor: tab === 'prayer-wall' ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
              borderWidth: 1,
              borderColor: tab === 'prayer-wall' ? THEME_COLORS.goldBorder : THEME_COLORS.border,
            }}
          >
            <Icon name="plus" size={14} color={tab === 'prayer-wall' ? THEME_COLORS.gold : THEME_COLORS.text2} />
            <Text style={{ color: tab === 'prayer-wall' ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 12 }}>
              {tab === 'prayer-wall' ? 'Pray' : 'New Group'}
            </Text>
          </Pressable>
        </View>

        {/* Tab pills */}
        <View style={{ flexDirection: 'row', backgroundColor: THEME_COLORS.bg3, borderRadius: 12, padding: 4 }}>
          {([
            { key: 'mine', label: 'My Groups' },
            { key: 'prayer-wall', label: 'Prayer Wall' },
          ] as { key: Tab; label: string }[]).map((t) => (
            <Pressable
              key={t.key}
              onPress={() => selectTab(t.key)}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 10,
                backgroundColor: tab === t.key ? THEME_COLORS.bg2 : 'transparent',
                alignItems: 'center',
                borderWidth: tab === t.key ? 1 : 0,
                borderColor: THEME_COLORS.border,
                position: 'relative',
              }}
            >
              <Text style={{ color: tab === t.key ? THEME_COLORS.text : THEME_COLORS.text3, ...iosFontStyle(tab === t.key ? '600' : '400'), fontSize: 13 }}>
                {t.label}
              </Text>
              {t.key === 'mine' && totalUnread > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 10,
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: 8,
                    backgroundColor: THEME_COLORS.rose,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 9, ...iosFontStyle('700') }}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
                  
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      </Animated.View>

      {/* Tab content */}
      {tab === 'prayer-wall' ? (
        <PrayerWallFeed
          currentUserId={user?.uid}
          onCompose={() => setShowCompose(true)}
          onPrivateRequest={() => router.push('/prayer-requests' as any)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Upcoming sessions */}
          <UpcomingSessions onJoinRoom={(s) => {
            if (s.active_room_id) router.push(`/room/${s.active_room_id}` as any);
          }} />

          {myLoading ? (
            <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 40 }} />
          ) : myGroups.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 20 }}>
              <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: THEME_COLORS.border }}>
                <Icon name="groups" size={36} color={THEME_COLORS.text3} />
              </View>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 20, marginBottom: 8 }}>
                You're not in any group yet
              </Text>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, textAlign: 'center', maxWidth: 260, lineHeight: 22, marginBottom: 24 }}>
                Prayer is better together. Create your own group or visit the Prayer Wall to connect with the community.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button label="Create Group" onPress={() => setShowCreate(true)} />
                <Button label="Prayer Wall" onPress={() => selectTab('prayer-wall')} variant="secondary" />
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
                    onPress={() => router.push(`/group/${group.group_id}`)}
                  />
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
