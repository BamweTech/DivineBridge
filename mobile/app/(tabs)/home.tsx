import { ScrollView, View, Text, Pressable, RefreshControl, Share, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import { prayerApi, verseApi, prayerRequestApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import { useMyGroups } from '@/hooks/useGroups';
import { Avatar } from '@/components/ui/Avatar';

function SkeletonBlock({ height = 120 }: { height?: number }) {
  return (
    <View style={{ height, backgroundColor: THEME_COLORS.bg3, borderRadius: 20, marginBottom: 16 }} />
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuthStore();
  const queryClient = useQueryClient();
  const today = dayjs().format('YYYY-MM-DD');
  const { groups: myGroups } = useMyGroups();

  const prayerQuery = useQuery({
    queryKey: ['daily-prayer', today],
    queryFn: () => prayerApi.getToday(today),
  });

  const verseQuery = useQuery({
    queryKey: ['daily-verse', today],
    queryFn: () => verseApi.getToday(today),
  });

  const interactionsQuery = useQuery({
    queryKey: ['prayer-interactions', today],
    queryFn: () => prayerApi.getInteractions(today),
  });

  const likeMutation = useMutation({
    mutationFn: (liked: boolean) =>
      liked ? prayerApi.unlike(today) : prayerApi.like(today),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prayer-interactions', today] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert('Sign in to like prayers'),
  });

  const prayMutation = useMutation({
    mutationFn: () => prayerRequestApi.submit('', false),
  });

  async function handleShare() {
    if (!prayerQuery.data?.prayer?.content) return;
    await Share.share({
      message: `Today's Prayer from Divine Bridge:\n\n${prayerQuery.data.prayer.content}\n\nJoin us at divinebridge.io`,
    });
    await prayerApi.share(today).catch(() => null);
  }

  const userLiked = interactionsQuery.data?.likes?.liked ?? false;
  const likesCount = interactionsQuery.data?.likes?.count ?? 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 80,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={prayerQuery.isFetching}
          onRefresh={() => {
            queryClient.invalidateQueries({ queryKey: ['daily-prayer'] });
            queryClient.invalidateQueries({ queryKey: ['daily-verse'] });
          }}
          tintColor={THEME_COLORS.gold}
        />
      }
    >
      {/* Greeting row */}
      <Animated.View
        entering={FadeInDown.delay(0).duration(500)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 22,
          marginBottom: 4,
        }}
      >
        <View>
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 13 }}>
            {dayjs().format('dddd, MMMM D')}
          </Text>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, marginTop: 2 }}>
            Good {dayjs().hour() < 12 ? 'morning' : dayjs().hour() < 17 ? 'afternoon' : 'evening'},{' '}
            {profile?.displayName?.split(' ')[0] ?? 'friend'}
          </Text>
        </View>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            backgroundColor: THEME_COLORS.bg3,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <Icon name="bell" size={18} color={THEME_COLORS.text2} />
          {/* Notification dot */}
          <View style={{
            position: 'absolute',
            top: 7,
            right: 8,
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: THEME_COLORS.gold,
            borderWidth: 1.5,
            borderColor: THEME_COLORS.bg3,
          }} />
        </View>
      </Animated.View>

      {/* Daily Verse Card */}
      <Animated.View entering={FadeInDown.delay(80).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 16, marginTop: 16 }}>
        {verseQuery.isLoading ? (
          <SkeletonBlock height={140} />
        ) : (
          <View
            style={{
              backgroundColor: '#f5edd8',
              borderWidth: 1,
              borderColor: THEME_COLORS.goldBorder,
              borderRadius: 24,
              padding: 22,
              overflow: 'hidden',
            }}
          >
            {/* Decorative glow */}
            <View
              style={{
                position: 'absolute',
                top: -40,
                right: -40,
                width: 140,
                height: 140,
                borderRadius: 70,
                backgroundColor: 'rgba(176,125,32,0.15)',
              }}
              pointerEvents="none"
            />
            {/* Pill label */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                backgroundColor: THEME_COLORS.goldDim, borderRadius: 50,
                paddingHorizontal: 10, paddingVertical: 4,
              }}>
                <Icon name="cross" size={9} color={THEME_COLORS.gold} />
                <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>Daily Verse</Text>
              </View>
            </View>

            <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 15, fontStyle: 'italic', lineHeight: 26, marginBottom: 10 }}>
              "{verseQuery.data?.data?.verse ?? 'For God so loved the world...'}"
            </Text>
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
              — {verseQuery.data?.data?.reference ?? 'John 3:16'}
            </Text>

            {/* Action row */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {[
                { icon: 'book' as const, label: 'Reading', onPress: () => router.push('/(tabs)/devotional') },
                { icon: 'audio' as const, label: 'Listen', onPress: () => {} },
                { icon: 'share' as const, label: 'Share', onPress: handleShare },
              ].map((a) => (
                <Pressable
                  key={a.label}
                  onPress={a.onPress}
                  style={{ flex: 1, backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 12, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 }}
                >
                  <Icon name={a.icon} size={10} color={THEME_COLORS.gold} />
                  <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 10 }}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </Animated.View>

      {/* Today's Global Prayer */}
      <Animated.View entering={FadeInDown.delay(160).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }}>Today's Global Prayer</Text>
        </View>
        {prayerQuery.isLoading ? (
          <SkeletonBlock height={180} />
        ) : (
          <View style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 20, padding: 20 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 15, lineHeight: 26 }}>
              {prayerQuery.data?.prayer?.content ?? "Loading today's prayer..."}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 10 }}>
              <Pressable
                onPress={() => likeMutation.mutate(userLiked)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: userLiked ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
                  borderWidth: 1,
                  borderColor: userLiked ? THEME_COLORS.goldBorder : THEME_COLORS.border,
                }}
              >
                <Icon name="pray" size={14} color={userLiked ? THEME_COLORS.gold : THEME_COLORS.text3} />
                <Text style={{ color: userLiked ? THEME_COLORS.gold : THEME_COLORS.text3, fontFamily: 'Geist_500Medium', fontSize: 13 }}>
                  {likesCount > 0 ? likesCount.toLocaleString() : 'Pray'}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleShare}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: THEME_COLORS.bg3,
                  borderWidth: 1,
                  borderColor: THEME_COLORS.border,
                }}
              >
                <Icon name="share" size={14} color={THEME_COLORS.text2} />
                <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>Share</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Stats row */}
      <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { icon: 'groups' as const, label: 'Groups', value: myGroups.length.toString(), color: THEME_COLORS.sage },
            { icon: 'flame' as const, label: 'Day Streak', value: (profile as any)?.devotionalStreak?.toString() ?? '—', color: THEME_COLORS.gold },
            { icon: 'pray' as const, label: 'Praying', value: (likesCount > 0 ? likesCount.toLocaleString() : '—'), color: THEME_COLORS.rose },
          ].map((s) => (
            <View key={s.label} style={{ flex: 1, backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 16, padding: 14, alignItems: 'center' }}>
              <Icon name={s.icon} size={20} color={s.color} style={{ marginBottom: 6 }} />
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20 }}>{s.value}</Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, marginTop: 1 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Quick Actions */}
      <Animated.View entering={FadeInDown.delay(240).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 24 }}>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, marginBottom: 12 }}>Quick Actions</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            { icon: 'live' as const, label: 'Join a Room', sub: 'Live prayer rooms', route: '/(tabs)/rooms' as const },
            { icon: 'book' as const, label: 'Devotional', sub: 'AI-powered plan', route: '/(tabs)/devotional' as const },
            { icon: 'groups' as const, label: 'My Groups', sub: 'Prayer circles', route: '/(tabs)/groups' as const },
          ].map((a) => (
            <Pressable key={a.label} onPress={() => router.push(a.route)} style={{ flex: 1 }}>
              <View style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 16, padding: 14, alignItems: 'center' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                  <Icon name={a.icon} size={18} color={THEME_COLORS.gold} />
                </View>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 12, textAlign: 'center' }}>{a.label}</Text>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, textAlign: 'center', marginTop: 2 }}>{a.sub}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      {/* My Groups preview */}
      <Animated.View entering={FadeInDown.delay(300).duration(500)} style={{ paddingHorizontal: 22, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }}>My Groups</Text>
          <Pressable onPress={() => router.push('/(tabs)/groups')}>
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 13 }}>View All</Text>
          </Pressable>
        </View>

        {myGroups.length === 0 ? (
          <Pressable
            onPress={() => router.push('/(tabs)/groups')}
            style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1.5, borderColor: THEME_COLORS.border, borderRadius: 20, padding: 20, alignItems: 'center', borderStyle: 'dashed' }}
          >
            <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Icon name="groups" size={22} color={THEME_COLORS.text3} />
            </View>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 14, marginBottom: 4 }}>No groups yet</Text>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, textAlign: 'center' }}>Join a prayer group and start praying together</Text>
          </Pressable>
        ) : (
          <View style={{ gap: 10 }}>
            {myGroups.slice(0, 2).map((g) => (
              <Pressable
                key={g.group_id}
                onPress={() => router.push(`/group/${g.group_id}` as any)}
                style={{ backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <Avatar name={g.name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 15, marginBottom: 2 }}>{g.name}</Text>
                  <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12 }}>
                    {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                  </Text>
                </View>
                <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
              </Pressable>
            ))}
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}
