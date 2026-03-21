/**
 * Activity hub — entry point from the home notification bell.
 * Routes to Prayer Wall (community / shared-group context) and group chats.
 * Push notification deep links can target these same paths later.
 */
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import { useMyGroups } from '@/hooks/useGroups';
import { Avatar } from '@/components/ui/Avatar';

export default function ActivityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { groups: myGroups, isLoading } = useMyGroups();

  function goToPrayerWall() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace('/(tabs)/groups?tab=prayer-wall' as any);
  }

  function goToGroupChat(groupId: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/group/${groupId}` as any);
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 22,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.duration(400)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 12 }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            hitSlop={12}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: THEME_COLORS.bg3,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="back" size={18} color={THEME_COLORS.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, letterSpacing: -0.3 }}>
              Activity
            </Text>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 2 }}>
              Prayer wall & group chats
            </Text>
          </View>
        </Animated.View>

        {/* Prayer Wall shortcut */}
        <Animated.View entering={FadeInDown.delay(40).duration(400)}>
          <Pressable onPress={goToPrayerWall}>
            <View
              style={{
                backgroundColor: THEME_COLORS.bg2,
                borderWidth: 1,
                borderColor: THEME_COLORS.goldBorder,
                borderRadius: 20,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                marginTop: 20,
                marginBottom: 10,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor: THEME_COLORS.goldDim,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="pray" size={22} color={THEME_COLORS.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 16, marginBottom: 4 }}>
                  Prayer Wall
                </Text>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 }}>
                  See prayer requests from the community — including people you may share groups with.
                </Text>
              </View>
              <Icon name="chevron-r" size={18} color={THEME_COLORS.text3} />
            </View>
          </Pressable>
        </Animated.View>

        {/* Group chats */}
        <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ marginTop: 24 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, marginBottom: 12 }}>
            Group chats
          </Text>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 20, marginBottom: 14 }}>
            Open a group to read messages and prayer requests shared in your circles.
          </Text>

          {isLoading ? (
            <ActivityIndicator color={THEME_COLORS.gold} style={{ marginVertical: 24 }} />
          ) : myGroups.length === 0 ? (
            <View
              style={{
                backgroundColor: THEME_COLORS.bg2,
                borderWidth: 1,
                borderColor: THEME_COLORS.border,
                borderRadius: 18,
                padding: 22,
                alignItems: 'center',
              }}
            >
              <Icon name="groups" size={32} color={THEME_COLORS.text3} style={{ marginBottom: 10 }} />
              <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 14, textAlign: 'center' }}>
                You’re not in any groups yet. Join or create one from the Groups tab.
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.replace('/(tabs)/groups' as any);
                }}
                style={{ marginTop: 14, paddingVertical: 8, paddingHorizontal: 14 }}
              >
                <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>Go to Groups</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {myGroups.map((g, i) => (
                <Animated.View key={g.group_id} entering={FadeInDown.delay(100 + i * 40).duration(350)}>
                  <Pressable onPress={() => goToGroupChat(g.group_id)}>
                    <View
                      style={{
                        backgroundColor: THEME_COLORS.bg2,
                        borderWidth: 1,
                        borderColor: THEME_COLORS.border,
                        borderRadius: 18,
                        padding: 16,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <Avatar name={g.name} size={44} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 15, marginBottom: 2 }} numberOfLines={1}>
                          {g.name}
                        </Text>
                        <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12 }}>
                          Open chat
                        </Text>
                      </View>
                      <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
                    </View>
                  </Pressable>
                </Animated.View>
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}
