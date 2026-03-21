import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS, THEME_COLORS } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { getDisplayName } from '@/lib/userDisplayName';
import { useMyGroups } from '@/hooks/useGroups';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import type { DevotionalPlan } from '@/types';

function SettingRow({
  iconName,
  label,
  value,
  onPress,
  danger,
}: {
  iconName: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 14, paddingHorizontal: 16,
        backgroundColor: THEME_COLORS.bg2,
        borderWidth: 1,
        borderColor: danger ? 'rgba(176,90,80,0.15)' : THEME_COLORS.border,
        borderRadius: 14,
        marginBottom: 8,
        gap: 14,
      }}>
        <View style={{
          width: 32, height: 32, borderRadius: 9,
          backgroundColor: danger ? 'rgba(176,90,80,0.08)' : THEME_COLORS.bg3,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={iconName} size={16} color={danger ? THEME_COLORS.rose : THEME_COLORS.text2} />
        </View>
        <Text style={{ flex: 1, color: danger ? THEME_COLORS.rose : THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14 }}>{label}</Text>
        {value && <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13 }} numberOfLines={1}>{value}</Text>}
        {onPress && <Icon name="chevron-r" size={16} color={danger ? THEME_COLORS.rose : THEME_COLORS.text3} />}
      </View>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_600SemiBold', fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 }}>
      {children}
    </Text>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, logout } = useAuthStore();
  const { groups: myGroups } = useMyGroups();

  // Fetch real devotional stats
  const [devStreak, setDevStreak] = useState<number | null>(null);
  const [planCount, setPlanCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    getDocs(
      query(
        collection(db, COLLECTIONS.DEVOTIONAL_PLANS),
        where('uid', '==', user.uid),
        limit(20)
      )
    )
      .then((snap) => {
        setPlanCount(snap.size);
        const plans = snap.docs.map((d) => d.data() as DevotionalPlan);
        const maxStreak = Math.max(0, ...plans.map((p) => p.streak ?? 0));
        setDevStreak(maxStreak);
      })
      .catch(() => {
        setPlanCount(0);
        setDevStreak(0);
      });
  }, [user?.uid]);

  async function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Page header */}
      <Animated.View entering={FadeInDown.delay(0).duration(400)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 26, letterSpacing: -0.5 }}>Profile</Text>
        <Pressable style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 50, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, backgroundColor: THEME_COLORS.goldDim }}>
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 13 }}>Edit</Text>
        </Pressable>
      </Animated.View>

      {/* Avatar + name */}
      <Animated.View entering={FadeInDown.delay(0).duration(400)} style={{ alignItems: 'center', marginBottom: 24 }}>
        <View style={{ position: 'relative', marginBottom: 14 }}>
          <View style={{ width: 80, height: 80, borderRadius: 26, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: THEME_COLORS.goldBorder, overflow: 'hidden' }}>
            <Avatar name={getDisplayName(profile, user)} photoUrl={profile?.photoURL} size={80} />
          </View>
          <View style={{ position: 'absolute', bottom: -4, right: -4, width: 24, height: 24, borderRadius: 8, backgroundColor: THEME_COLORS.gold, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="edit" size={10} color="#ffffff" />
          </View>
        </View>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20 }}>
          {getDisplayName(profile, user)}
        </Text>
        <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 4 }}>
          {user?.email}
        </Text>
      </Animated.View>

      {/* Stats bar */}
      <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 18, overflow: 'hidden' }}>
          {[
            { num: myGroups.length > 0 ? myGroups.length.toString() : '0', label: 'Groups', icon: 'groups' as IconName },
            { num: devStreak !== null ? devStreak.toString() : '…', label: 'Streak', icon: 'flame' as IconName },
            { num: planCount !== null ? planCount.toString() : '…', label: 'Plans', icon: 'book' as IconName },
          ].map((s, i, arr) => (
            <View key={s.label} style={{ flex: 1, alignItems: 'center', paddingVertical: 16, borderRightWidth: i < arr.length - 1 ? 1 : 0, borderRightColor: THEME_COLORS.border }}>
              <Icon name={s.icon} size={18} color={THEME_COLORS.gold} style={{ marginBottom: 4 }} />
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20 }}>{s.num}</Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 }}>{s.label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Account section */}
      <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{ marginBottom: 20 }}>
        <SectionTitle>Account</SectionTitle>
        <SettingRow iconName="profile" label="Display Name" value={getDisplayName(profile, user)} />
        <SettingRow iconName="email" label="Email" value={user?.email ?? ''} />
        <SettingRow iconName="globe" label="Phone" value={profile?.phone ?? 'Not set'} onPress={() => {}} />
        <SettingRow iconName="share" label="LinkedIn" value={profile?.linkedIn ?? 'Not set'} onPress={() => {}} />
      </Animated.View>

      {/* Notifications section */}
      <Animated.View entering={FadeInDown.delay(160).duration(400)} style={{ marginBottom: 20 }}>
        <SectionTitle>Preferences</SectionTitle>

        {[
          { iconName: 'bell' as IconName, label: 'Daily verse notification' },
          { iconName: 'email' as IconName, label: 'Email devotional' },
          { iconName: 'live' as IconName, label: 'Session reminders' },
        ].map((row) => (
          <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: THEME_COLORS.bg2, borderWidth: 1, borderColor: THEME_COLORS.border, borderRadius: 14, marginBottom: 8, gap: 14 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={row.iconName} size={16} color={THEME_COLORS.text2} />
            </View>
            <Text style={{ flex: 1, color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14 }}>{row.label}</Text>
            <Switch
              thumbColor={THEME_COLORS.gold}
              trackColor={{ false: THEME_COLORS.bg3, true: THEME_COLORS.goldDim }}
              value={true}
            />
          </View>
        ))}
      </Animated.View>

      {/* App section */}
      <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginBottom: 20 }}>
        <SectionTitle>Account Settings</SectionTitle>
        <SettingRow iconName="lock" label="Change Password" onPress={() => {}} />
        <SettingRow iconName="scroll" label="Privacy Policy" onPress={() => {}} />
        <SettingRow iconName="scroll" label="Terms of Service" onPress={() => {}} />
        <SettingRow iconName="chat" label="Help & FAQ" onPress={() => {}} />
        <SettingRow iconName="logout" label="Sign Out" onPress={handleLogout} danger />
      </Animated.View>
    </ScrollView>
  );
}
