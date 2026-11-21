import React, { useState, useCallback, memo } from 'react';
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
  Modal,
} from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { prayerRequestApi, globalWatchApi } from '@/services/api';
import { promptBlockUser, promptReportContent } from '@/lib/contentSafety';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle, iosFontStyleItalic } from '@/lib/typography';
import { filterGlobalWatchForFeed } from '@/lib/globalWatchFeed';
import { isHiddenProductionTestWallItem } from '@/lib/qaWallFilters';
import Icon from '@/components/ui/Icon';
import { useAuthStore } from '@/stores/authStore';

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
  onReport,
  onBlock,
}: {
  post: PrayerPost;
  currentUserId?: string;
  onPray: () => void;
  onReport: (post: PrayerPost) => void;
  onBlock: (post: PrayerPost) => void;
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
          {!isMe ? (
            <Pressable onPress={() => onReport(post)} hitSlop={8}>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 12 }}>Report</Text>
            </Pressable>
          ) : null}
          {!isMe && !isAnon && post.user_id ? (
            <Pressable onPress={() => onBlock(post)} hitSlop={8}>
              <Text style={{ color: THEME_COLORS.rose, ...iosFontStyle('500'), fontSize: 12 }}>Block</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
});

// ─── ComposeModal ─────────────────────────────────────────────────────────────

export function ComposeModal({
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

export function PrayerWallFeed({
  currentUserId,
  onCompose,
}: {
  currentUserId?: string;
  onCompose: () => void;
}) {
  const queryClient = useQueryClient();
  const blockedUserIds = useAuthStore((state) => state.profile?.blockedUserIds);
  const refreshProfile = useAuthStore((state) => state.refreshProfile);

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
  const blockedIds = new Set(blockedUserIds ?? []);
  const communityPosts: PrayerPost[] = (communityData?.prayers ?? []).filter(
    (p: any) =>
      !(p.source === 'generated' && !p.user_id) &&
      !isHiddenProductionTestWallItem(p as Record<string, unknown>) &&
      !(typeof p.user_id === 'string' && p.user_id && blockedIds.has(p.user_id))
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
          onReport={(post) =>
            promptReportContent({
              contentType: 'prayer_request',
              contentId: post.id,
              targetUserId: post.user_id,
            })
          }
          onBlock={(post) => {
            if (!post.user_id) return;
            promptBlockUser(post.user_id, () => refreshProfile());
          }}
        />
      ),
    [currentUserId, prayMutation, globalWatchPrayMutation, refreshProfile]
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
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 4, paddingBottom: 150 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={handleRefresh} tintColor={THEME_COLORS.gold} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Animated.View entering={FadeIn.duration(400)} style={{ marginBottom: 16 }}>
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
