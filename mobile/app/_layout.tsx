import '../global.css';
console.log('[DivineBridge] _layout.tsx: JS runtime started');
import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from '@expo-google-fonts/geist';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAuthStore } from '@/stores/authStore';
import { GroupUnreadProvider } from '@/contexts/GroupUnreadContext';
import { groupApi } from '@/services/api';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import BrandedSplashOverlay from '@/components/BrandedSplashOverlay';

SplashScreen.preventAutoHideAsync();

const PENDING_INVITE_KEY = '@divinebridge:pending_group_invite';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
});

// Parse a deep link URL and extract groupId + code.
// Handles:
//   io.divinebridge.app://join/<groupId>?code=<code>  (custom scheme)
//   https://divinebridge.io/join/<groupId>?code=<code> (universal link)
function parseInviteUrl(url: string | null): { groupId: string; code: string } | null {
  if (!url) return null;
  try {
    let normalized = url;
    // Normalize custom scheme so URL can be parsed uniformly
    if (url.startsWith('io.divinebridge.app://')) {
      normalized = url.replace('io.divinebridge.app://', 'https://placeholder/');
    }
    const u = new URL(normalized);
    const joinGroup = u.searchParams.get('join_group');
    if (joinGroup) {
      return {
        groupId: joinGroup,
        code:
          u.searchParams.get('invite_code') ||
          u.searchParams.get('code') ||
          '',
      };
    }
    const match = u.pathname.match(/\/join\/([^?/#]+)/);
    if (!match) return null;
    return { groupId: match[1], code: u.searchParams.get('code') || '' };
  } catch {
    return null;
  }
}

// ─── JoinGroupModal ───────────────────────────────────────────────────────────

function JoinGroupModal({
  groupId,
  code,
  onClose,
}: {
  groupId: string;
  code: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [groupInfo, setGroupInfo] = useState<{ name: string; memberCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    groupApi
      .get(groupId)
      .then((data: any) => {
        setGroupInfo({
          name: data.group?.name ?? 'Prayer Group',
          memberCount: data.group?.member_count ?? 0,
        });
      })
      .catch(() => {
        setGroupInfo({ name: 'Prayer Group', memberCount: 0 });
      })
      .finally(() => setLoading(false));
  }, [groupId]);

  async function handleJoin() {
    setJoining(true);
    try {
      await groupApi.join(groupId, code || undefined);
      setJoined(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onClose();
        router.push(`/group/${groupId}` as any);
      }, 800);
    } catch (err: any) {
      Alert.alert('Could not join group', err.message ?? 'Please try again.');
      setJoining(false);
    }
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.55)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: THEME_COLORS.bg,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          paddingHorizontal: 28,
          paddingTop: 20,
          paddingBottom: 48,
        }}>
          {/* Handle bar */}
          <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 28 }} />

          {loading ? (
            <ActivityIndicator color={THEME_COLORS.gold} style={{ paddingVertical: 40 }} />
          ) : joined ? (
            <View style={{ alignItems: 'center', paddingVertical: 28 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon name="groups" size={28} color={THEME_COLORS.sage} />
              </View>
              <Text style={{ color: THEME_COLORS.sage, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, marginBottom: 6 }}>
                Joined!
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 14 }}>
                Taking you to the group…
              </Text>
            </View>
          ) : (
            <>
              <View style={{ alignItems: 'center', marginBottom: 28 }}>
                <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
                  <Icon name="groups" size={32} color={THEME_COLORS.sage} />
                </View>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_500Medium', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                  You've been invited
                </Text>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 24, textAlign: 'center', letterSpacing: -0.5, marginBottom: 10 }}>
                  {groupInfo?.name}
                </Text>
                {groupInfo && groupInfo.memberCount > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: THEME_COLORS.sageDim, borderRadius: 50, borderWidth: 1, borderColor: 'rgba(74,124,94,0.22)' }}>
                    <Icon name="groups" size={12} color={THEME_COLORS.sage} />
                    <Text style={{ color: THEME_COLORS.sage, fontFamily: 'Geist_500Medium', fontSize: 12 }}>
                      {groupInfo.memberCount} {groupInfo.memberCount === 1 ? 'member' : 'members'}
                    </Text>
                  </View>
                )}
              </View>

              <Pressable
                onPress={handleJoin}
                disabled={joining}
                style={({ pressed }) => ({
                  backgroundColor: THEME_COLORS.gold,
                  borderRadius: 16,
                  padding: 18,
                  alignItems: 'center',
                  marginBottom: 12,
                  opacity: joining || pressed ? 0.8 : 1,
                })}
              >
                {joining ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }}>
                    Join Group
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={onClose} style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_500Medium', fontSize: 15 }}>
                  Maybe later
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── AuthGuard ────────────────────────────────────────────────────────────────

function AuthGuard() {
  const { user, isInitialized } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isInitialized) return;
    // Runtime paths vary; expo-router's Segment types omit some roots (e.g. index / empty).
    const seg = segments as readonly string[];
    const inAuthGroup = seg[0] === '(auth)';
    // The root index route (onboarding) is public — don't redirect away from it
    const atRoot = seg.length === 0 || (seg.length === 1 && seg[0] === 'index');
    if (!user && !inAuthGroup && !atRoot) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(tabs)/home');
    } else if (user && atRoot) {
      router.replace('/(tabs)/home');
    }
  }, [user, isInitialized, segments]);

  return null;
}

// ─── RootLayout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  console.log('[DivineBridge] RootLayout: component mounted');
  const initialize = useAuthStore((s) => s.initialize);
  const { user, isInitialized } = useAuthStore();
  const [pendingInvite, setPendingInvite] = useState<{ groupId: string; code: string } | null>(null);
  const [showBrandedSplash, setShowBrandedSplash] = useState(true);
  const onBrandedSplashFinish = useCallback(() => setShowBrandedSplash(false), []);

  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  // Hard safety net: dismiss splash after 3 s regardless of font load state
  const [fontTimeout, setFontTimeout] = useState(false);

  useEffect(() => {
    const unsubscribe = initialize();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // Also call from effect so React has rendered at least one frame before hiding
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // ─── Deep link handling ─────────────────────────────────────────────────────

  function handleIncomingUrl(url: string | null) {
    const parsed = parseInviteUrl(url);
    if (!parsed) return;
    setPendingInvite(parsed);
  }

  // Check for the URL that launched the app (cold start)
  useEffect(() => {
    Linking.getInitialURL().then((url) => handleIncomingUrl(url)).catch(() => {});
  }, []);

  // Listen for URLs while the app is open (warm start / foreground)
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => handleIncomingUrl(url));
    return () => subscription.remove();
  }, []);

  // When user logs in, resume any pending invite saved to AsyncStorage
  useEffect(() => {
    if (!isInitialized || !user) return;
    AsyncStorage.getItem(PENDING_INVITE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { groupId: string; code: string };
        AsyncStorage.removeItem(PENDING_INVITE_KEY);
        setPendingInvite(saved);
      })
      .catch(() => {});
  }, [isInitialized, user?.uid]);

  // If a deep link arrives and user is NOT logged in, save it and let AuthGuard redirect
  useEffect(() => {
    if (!pendingInvite || !isInitialized) return;
    if (!user) {
      AsyncStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(pendingInvite)).catch(() => {});
      setPendingInvite(null);
    }
  }, [pendingInvite, isInitialized, user]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <GroupUnreadProvider>
          <AuthGuard />
          <StatusBar style="dark" backgroundColor="#faf6ef" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#faf6ef' } }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="room/[id]"
              options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="group/[id]"
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="activity"
              options={{ animation: 'slide_from_right' }}
            />
          </Stack>

          {/* Deep link invite modal — shown on top of everything when user is logged in */}
          {pendingInvite && user && (
            <JoinGroupModal
              groupId={pendingInvite.groupId}
              code={pendingInvite.code}
              onClose={() => setPendingInvite(null)}
            />
          )}

          {showBrandedSplash && <BrandedSplashOverlay onFinish={onBrandedSplashFinish} />}
        </GroupUnreadProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
