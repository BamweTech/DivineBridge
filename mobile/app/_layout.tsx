import '../global.css';
console.log('[DivineBridge] _layout.tsx: JS runtime started');
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import NetInfo from '@react-native-community/netinfo';
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_400Regular_Italic,
} from '@expo-google-fonts/fraunces';
import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  InterTight_700Bold,
} from '@expo-google-fonts/inter-tight';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Sentry from '@sentry/react-native';
import { useAuthStore } from '@/stores/authStore';
import { GroupUnreadProvider } from '@/contexts/GroupUnreadContext';
import { LiveRoomsProvider } from '@/contexts/LiveRoomsContext';
import { GroupCallNotificationOverlay } from '@/components/group/GroupCallNotificationOverlay';
import { useGroupChatNotifications } from '@/hooks/useGroupChatNotifications';
import { OfflineBanner } from '@/components/OfflineBanner';
import { usePushToken } from '@/hooks/usePushToken';
import { groupApi } from '@/services/api';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import BrandedSplashOverlay from '@/components/BrandedSplashOverlay';

// Sentry crash reporting and performance monitoring
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  tracesSampleRate: 0.2,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
});

// Let React Query know about connectivity for automatic refetch-on-reconnect
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

SplashScreen.preventAutoHideAsync();

const PENDING_INVITE_KEY = '@divinebridge:pending_group_invite';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      gcTime: 1000 * 60 * 60 * 24, // Keep in garbage-collection window for 24h (persisted)
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'DIVINEBRIDGE_QUERY_CACHE',
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
  const [groupName, setGroupName] = useState('Prayer Group');
  const [joining, setJoining] = useState(true);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function autoJoin() {
      // Fetch group name for the confirmation message (best-effort)
      try {
        const data: any = await groupApi.get(groupId);
        if (!cancelled && data.group?.name) setGroupName(data.group.name);
      } catch {}

      // Join immediately
      try {
        await groupApi.join(groupId, code || undefined);
        if (cancelled) return;
        setJoined(true);
        setJoining(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          if (cancelled) return;
          onClose();
          router.push(`/group/${groupId}` as any);
        }, 1200);
      } catch (err: any) {
        if (cancelled) return;
        setJoining(false);
        const msg = err.message ?? 'Please try again.';
        if (/already a member/i.test(msg)) {
          onClose();
          router.push(`/group/${groupId}` as any);
        } else {
          setError(msg);
        }
      }
    }

    autoJoin();
    return () => { cancelled = true; };
  }, [groupId, code]);

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
          <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 28 }} />

          {joining ? (
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <ActivityIndicator color={THEME_COLORS.gold} style={{ marginBottom: 16 }} />
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_600SemiBold', fontSize: 16 }}>
                Joining group…
              </Text>
            </View>
          ) : joined ? (
            <View style={{ alignItems: 'center', paddingVertical: 28 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon name="groups" size={28} color={THEME_COLORS.sage} />
              </View>
              <Text style={{ color: THEME_COLORS.sage, fontFamily: 'Fraunces_700Bold', fontSize: 22, marginBottom: 6 }}>
                You joined {groupName}!
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 14 }}>
                Taking you to the group…
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(180,80,60,0.08)', borderWidth: 1, borderColor: 'rgba(180,80,60,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Icon name="cross" size={28} color="#b4503c" />
              </View>
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Fraunces_700Bold', fontSize: 18, marginBottom: 6, textAlign: 'center' }}>
                Could not join group
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                {error}
              </Text>
              <Pressable onPress={onClose} style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_500Medium', fontSize: 15 }}>
                  Dismiss
                </Text>
              </Pressable>
            </View>
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

function RootLayoutInner() {
  console.log('[DivineBridge] RootLayout: component mounted');
  const initialize = useAuthStore((s) => s.initialize);
  const { user, isInitialized } = useAuthStore();
  const [pendingInvite, setPendingInvite] = useState<{ groupId: string; code: string } | null>(null);
  const [showBrandedSplash, setShowBrandedSplash] = useState(true);
  const onBrandedSplashFinish = useCallback(() => setShowBrandedSplash(false), []);

  // Register push token when user is signed in
  usePushToken(user?.uid);

  // Monitor group chats for new messages and fire local notifications
  useGroupChatNotifications();

  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_400Regular_Italic,
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    InterTight_700Bold,
  });

  // Hard safety net: dismiss splash after 3 s regardless of font load state
  const [fontTimeout, setFontTimeout] = useState(false);
  const routerRef = useRef(useRouter());

  useEffect(() => {
    const unsubscribe = initialize();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if ((data?.type === 'group_live' || data?.type === 'group_chat') && data?.groupId) {
        routerRef.current.push(`/group/${data.groupId}` as any);
      }
    });
    return () => sub.remove();
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
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister, maxAge: 1000 * 60 * 60 * 24 }}
      >
        <LiveRoomsProvider>
        <GroupUnreadProvider>
          <AuthGuard />
          <StatusBar style="dark" backgroundColor="#faf6ef" />
          <OfflineBanner />
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

          <GroupCallNotificationOverlay />

          {pendingInvite && user && (
            <JoinGroupModal
              groupId={pendingInvite.groupId}
              code={pendingInvite.code}
              onClose={() => setPendingInvite(null)}
            />
          )}

          {showBrandedSplash && <BrandedSplashOverlay onFinish={onBrandedSplashFinish} />}
        </GroupUnreadProvider>
        </LiveRoomsProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Wrap with Sentry for crash reporting
const RootLayoutWrapped = Sentry.wrap(RootLayoutInner);
export default function RootLayout() {
  return <RootLayoutWrapped />;
}
