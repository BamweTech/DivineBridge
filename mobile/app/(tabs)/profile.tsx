import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Switch,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { collection, query, where, getDocs, limit, doc, updateDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { db, auth, storage } from '@/lib/firebase';
import { COLLECTIONS, THEME_COLORS, API_BASE_URL } from '@/lib/constants';
import { iosFontStyle, iosFontStyleItalic } from '@/lib/typography';
import { useAuthStore } from '@/stores/authStore';
import { getDisplayName } from '@/lib/userDisplayName';
import { useGroupUnread } from '@/features/groups/contexts/GroupUnreadContext';
import { Avatar } from '@/components/ui/Avatar';
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import type { DevotionalPlan } from '@/types';
import { emailPrefsApi, profileApi } from '@/services/api';
import { syncDailyVerseReminder } from '@/lib/dailyVerseReminder';

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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 16,
          backgroundColor: THEME_COLORS.bg2,
          borderWidth: 1,
          borderColor: danger ? 'rgba(176,90,80,0.15)' : THEME_COLORS.border,
          borderRadius: 14,
          marginBottom: 8,
          gap: 14,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            backgroundColor: danger ? 'rgba(176,90,80,0.08)' : THEME_COLORS.bg3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={iconName} size={16} color={danger ? THEME_COLORS.rose : THEME_COLORS.text2} />
        </View>
        <Text
          style={{
            flex: 1,
            color: danger ? THEME_COLORS.rose : THEME_COLORS.text,
            ...iosFontStyle('400'),
            fontSize: 14,
          }}
        >
          {label}
        </Text>
        {value ? (
          <Text
            style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, maxWidth: '42%' }}
            numberOfLines={1}
          >
            {value}
          </Text>
        ) : null}
        {onPress ? <Icon name="chevron-r" size={16} color={danger ? THEME_COLORS.rose : THEME_COLORS.text3} /> : null}
      </View>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: THEME_COLORS.text3,
        ...iosFontStyle('600'),
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 10,
        marginTop: 4,
      }}
    >
      {children}
    </Text>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, logout, refreshProfile, resetPassword } = useAuthStore();
  const { groups: myGroups } = useGroupUnread();

  const [devStreak, setDevStreak] = useState<number | null>(null);
  const [planCount, setPlanCount] = useState<number | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedIn, setLinkedIn] = useState('');

  const [emailDevotional, setEmailDevotional] = useState(false);
  const [emailPrefLoading, setEmailPrefLoading] = useState(true);
  const [dailyVerseNotif, setDailyVerseNotif] = useState(false);
  const [sessionReminders, setSessionReminders] = useState(false);
  const [prefBusy, setPrefBusy] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, COLLECTIONS.DEVOTIONAL_PLANS), where('uid', '==', user.uid), limit(20)))
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

  const loadEmailSubscription = useCallback(async () => {
    if (!user) {
      setEmailPrefLoading(false);
      return;
    }
    setEmailPrefLoading(true);
    try {
      const r = await emailPrefsApi.subscriptionStatus();
      setEmailDevotional(!!r.subscribed);
    } catch {
      setEmailDevotional(!!profile?.emailSubscribed);
    } finally {
      setEmailPrefLoading(false);
    }
  }, [user, profile?.emailSubscribed]);

  useEffect(() => {
    void loadEmailSubscription();
  }, [loadEmailSubscription]);

  useEffect(() => {
    if (!profile) return;
    setDailyVerseNotif(!!profile.notifyDailyVerse);
    setSessionReminders(!!profile.sessionRemindersEnabled);
  }, [profile?.notifyDailyVerse, profile?.sessionRemindersEnabled]);

  useEffect(() => {
    if (!user) return;
    if (profile?.notifyDailyVerse) {
      syncDailyVerseReminder(true).catch(() => {});
    } else {
      syncDailyVerseReminder(false).catch(() => {});
    }
  }, [user?.uid, profile?.notifyDailyVerse]);

  const pickProfilePhoto = async () => {
    const u = auth.currentUser;
    if (!u) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploadingPhoto(true);
    try {
      const resp = await fetch(asset.uri);
      const blob = await resp.blob();
      const ext = (asset.fileName?.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
      const fileName = `avatar_${Date.now()}.${ext}`;
      const storageRef = ref(storage, `profile_photos/${u.uid}/${fileName}`);
      await uploadBytes(storageRef, blob, { contentType: asset.mimeType || 'image/jpeg' });
      const downloadUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, COLLECTIONS.USERS, u.uid), { photoURL: downloadUrl });
      await updateProfile(u, { photoURL: downloadUrl });
      await refreshProfile();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Please try again.';
      Alert.alert('Could not update photo', msg);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const openEdit = () => {
    setFirstName(profile?.firstName?.trim() ?? '');
    setLastName(profile?.lastName?.trim() ?? '');
    setPhone(profile?.phone?.trim() ?? '');
    setLinkedIn(profile?.linkedIn?.trim() ?? '');
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const u = auth.currentUser;
    if (!u) return;
    setSavingProfile(true);
    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      const dn = `${fn} ${ln}`.trim() || u.email?.split('@')[0] || 'User';
      await updateDoc(doc(db, COLLECTIONS.USERS, u.uid), {
        firstName: fn,
        lastName: ln,
        displayName: dn,
      });
      await updateProfile(u, { displayName: dn });
      await profileApi.updateBusinessCard({
        phoneNumber: phone.trim(),
        linkedin: linkedIn.trim(),
      });
      await refreshProfile();
      setEditOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Try again.';
      Alert.alert('Could not save profile', msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const onToggleEmailDevotional = async (on: boolean) => {
    if (!user) return;
    setPrefBusy('email');
    try {
      if (on) await emailPrefsApi.subscribeDaily();
      else await emailPrefsApi.unsubscribeDaily();
      setEmailDevotional(on);
      await refreshProfile();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not update email preference.';
      Alert.alert('Email devotional', msg);
    } finally {
      setPrefBusy(null);
    }
  };

  const onToggleDailyVerse = async (on: boolean) => {
    if (!user) return;
    setPrefBusy('verse');
    try {
      if (on) await syncDailyVerseReminder(true);
      else await syncDailyVerseReminder(false);
      await updateDoc(doc(db, COLLECTIONS.USERS, user.uid), { notify_daily_verse: on });
      setDailyVerseNotif(on);
      await refreshProfile();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not update reminder.';
      Alert.alert('Daily verse notification', msg);
    } finally {
      setPrefBusy(null);
    }
  };

  const onToggleSessionReminders = async (on: boolean) => {
    if (!user) return;
    setPrefBusy('session');
    try {
      await updateDoc(doc(db, COLLECTIONS.USERS, user.uid), { session_reminders_enabled: on });
      setSessionReminders(on);
      await refreshProfile();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not save preference.';
      Alert.alert('Session reminders', msg);
    } finally {
      setPrefBusy(null);
    }
  };

  async function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: logout },
    ]);
  }

  function handleDeleteAccount() {
    if (deletingAccount) return;
    Alert.alert(
      'Delete account',
      'This removes your Divine Bridge account and its data, including your profile. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingAccount(true);
              try {
                await profileApi.deleteAccount();
                await logout();
                router.replace('/(auth)/login');
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Could not delete your account.';
                Alert.alert('Could not delete account', message);
              } finally {
                setDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
  }

  const openUrl = (path: string) => {
    const url = `${API_BASE_URL}${path}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', url);
    });
  };

  const handleChangePassword = () => {
    const email = user?.email;
    if (!email) {
      Alert.alert('Change password', 'No email on this account.');
      return;
    }
    const hasPasswordProvider = user?.providerData?.some((p) => p.providerId === 'password');
    if (!hasPasswordProvider) {
      Alert.alert(
        'Change password',
        'You signed in with Google or another provider. To change how you sign in, use your account settings for that provider.'
      );
      return;
    }
    Alert.alert(
      'Change password',
      `We will send a reset link to ${email}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send email',
          onPress: () => {
            resetPassword(email)
              .then(() => {
                Alert.alert('Check your email', 'Use the link to set a new password.');
              })
              .catch((e: Error) => {
                Alert.alert('Could not send reset email', e.message);
              });
          },
        },
      ]
    );
  };

  const phoneDisplay = profile?.phone?.trim() || 'Not set';
  const linkedDisplay = profile?.linkedIn?.trim() || 'Not set';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View
        entering={FadeInDown.delay(0).duration(400)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}
      >
        <Text
          style={{
            color: THEME_COLORS.text,
            ...iosFontStyle('700'),
            fontSize: 26,
            letterSpacing: -0.5,
          }}
        >
          Profile
        </Text>
        <Pressable
          onPress={openEdit}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderRadius: 50,
            borderWidth: 1,
            borderColor: THEME_COLORS.goldBorder,
            backgroundColor: THEME_COLORS.goldDim,
          }}
        >
          <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 13 }}>Edit</Text>
        </Pressable>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(0).duration(400)} style={{ alignItems: 'center', marginBottom: 24 }}>
        <View style={{ position: 'relative', marginBottom: 14 }}>
          <Pressable onPress={pickProfilePhoto} disabled={uploadingPhoto}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 26,
                backgroundColor: THEME_COLORS.bg3,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 0,
                overflow: 'hidden',
              }}
            >
              {uploadingPhoto ? (
                <ActivityIndicator size="small" color={THEME_COLORS.gold} />
              ) : (
                <Avatar name={getDisplayName(profile, user)} photoUrl={profile?.photoURL} size={80} />
              )}
            </View>
          </Pressable>
          <Pressable
            onPress={pickProfilePhoto}
            disabled={uploadingPhoto}
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              width: 28,
              height: 28,
              borderRadius: 10,
              backgroundColor: THEME_COLORS.gold,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: THEME_COLORS.bg,
            }}
          >
            <Icon name="edit" size={10} color="#ffffff" />
          </Pressable>
        </View>
        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 20 }}>
          {getDisplayName(profile, user)}
        </Text>
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, marginTop: 4 }}>
          {user?.email}
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ marginBottom: 20 }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: THEME_COLORS.bg2,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
            borderRadius: 18,
            overflow: 'hidden',
          }}
        >
          {[
            { num: myGroups.length > 0 ? myGroups.length.toString() : '0', label: 'Groups', icon: 'groups' as IconName },
            { num: devStreak !== null ? devStreak.toString() : '…', label: 'Streak', icon: 'flame' as IconName },
            { num: planCount !== null ? planCount.toString() : '…', label: 'Plans', icon: 'book' as IconName },
          ].map((s, i, arr) => (
            <View
              key={s.label}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 16,
                borderRightWidth: i < arr.length - 1 ? 1 : 0,
                borderRightColor: THEME_COLORS.border,
              }}
            >
              <Icon name={s.icon} size={18} color={THEME_COLORS.gold} style={{ marginBottom: 4 }} />
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 20 }}>{s.num}</Text>
              <Text
                style={{
                  color: THEME_COLORS.text3,
                  ...iosFontStyle('400'),
                  fontSize: 10,
                  marginTop: 2,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{ marginBottom: 20 }}>
        <SectionTitle>Account</SectionTitle>
        <SettingRow iconName="profile" label="Display Name" value={getDisplayName(profile, user)} onPress={openEdit} />
        <SettingRow iconName="email" label="Email" value={user?.email ?? ''} />
        <SettingRow iconName="globe" label="Phone" value={phoneDisplay} onPress={openEdit} />
        <SettingRow iconName="share" label="LinkedIn" value={linkedDisplay} onPress={openEdit} />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160).duration(400)} style={{ marginBottom: 20 }}>
        <SectionTitle>Preferences</SectionTitle>
        {[
          {
            iconName: 'bell' as IconName,
            label: 'Daily verse notification',
            subtitle: 'Local reminder at 8:00 on this device',
            value: dailyVerseNotif,
            disabled: prefBusy !== null,
            loading: prefBusy === 'verse',
            onChange: onToggleDailyVerse,
          },
          {
            iconName: 'email' as IconName,
            label: 'Email devotional',
            subtitle: 'Daily prayer & verse by email',
            value: emailDevotional,
            disabled: prefBusy !== null || emailPrefLoading,
            loading: prefBusy === 'email',
            onChange: onToggleEmailDevotional,
          },
          {
            iconName: 'live' as IconName,
            label: 'Session reminders',
            subtitle: 'Saved to your account for upcoming features',
            value: sessionReminders,
            disabled: prefBusy !== null,
            loading: prefBusy === 'session',
            onChange: onToggleSessionReminders,
          },
        ].map((row) => (
          <View
            key={row.label}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              paddingHorizontal: 16,
              backgroundColor: THEME_COLORS.bg2,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
              borderRadius: 14,
              marginBottom: 8,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                backgroundColor: THEME_COLORS.bg3,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name={row.iconName} size={16} color={THEME_COLORS.text2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 14 }}>{row.label}</Text>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 11, marginTop: 2 }}>
                {row.subtitle}
              </Text>
            </View>
            {row.loading ? (
              <ActivityIndicator size="small" color={THEME_COLORS.gold} />
            ) : (
              <Switch
                thumbColor={THEME_COLORS.gold}
                trackColor={{ false: THEME_COLORS.bg3, true: THEME_COLORS.goldDim }}
                value={row.value}
                disabled={row.disabled}
                onValueChange={row.onChange}
              />
            )}
          </View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginBottom: 20 }}>
        <SectionTitle>Account Settings</SectionTitle>
        <SettingRow iconName="lock" label="Change Password" onPress={handleChangePassword} />
        <SettingRow iconName="scroll" label="Privacy Policy" onPress={() => openUrl('/privacy-policy')} />
        <SettingRow iconName="scroll" label="Terms of Service" onPress={() => openUrl('/terms-of-service')} />
        <SettingRow iconName="chat" label="Help & FAQ" onPress={() => openUrl('/faq')} />
        <SettingRow
          iconName="trash"
          label={deletingAccount ? 'Deleting account…' : 'Delete account'}
          onPress={deletingAccount ? undefined : handleDeleteAccount}
          danger
        />
        <SettingRow iconName="logout" label="Sign Out" onPress={handleLogout} danger />
      </Animated.View>

      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setEditOpen(false)} />
          <View
            style={{
              backgroundColor: THEME_COLORS.bg2,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: insets.bottom + 20,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
            }}
          >
            <Text
              style={{
                color: THEME_COLORS.text,
                ...iosFontStyle('700'),
                fontSize: 18,
                marginBottom: 16,
              }}
            >
              Edit profile
            </Text>
            {(
              [
                ['First name', firstName, setFirstName, 'default', false],
                ['Last name', lastName, setLastName, 'default', false],
                ['Phone', phone, setPhone, 'phone-pad', false],
                ['LinkedIn URL or username', linkedIn, setLinkedIn, 'url', false],
              ] as const
            ).map(([label, val, setVal, kb, secure]) => (
              <View key={label} style={{ marginBottom: 12 }}>
                <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 12, marginBottom: 6 }}>
                  {label}
                </Text>
                <TextInput
                  value={val}
                  onChangeText={setVal}
                  placeholderTextColor={THEME_COLORS.text3}
                  keyboardType={kb as 'default' | 'phone-pad' | 'url'}
                  secureTextEntry={secure}
                  autoCapitalize={label === 'LinkedIn URL or username' ? 'none' : 'words'}
                  autoCorrect={false}
                  style={{
                    borderWidth: 1,
                    borderColor: THEME_COLORS.border,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    ...iosFontStyle('400'),
                    fontSize: 15,
                    color: THEME_COLORS.text,
                    backgroundColor: THEME_COLORS.bg,
                  }}
                />
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <Pressable
                onPress={() => setEditOpen(false)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: THEME_COLORS.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 15 }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEdit}
                disabled={savingProfile}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: THEME_COLORS.gold,
                  alignItems: 'center',
                  opacity: savingProfile ? 0.7 : 1,
                }}
              >
                {savingProfile ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', ...iosFontStyle('600'), fontSize: 15 }}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}
