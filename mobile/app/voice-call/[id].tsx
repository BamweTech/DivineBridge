import { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useVoiceLink } from '@/hooks/useVoiceLink';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import Icon from '@/components/ui/Icon';

function formatCountdown(seconds: number | null): string {
  if (seconds == null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VoiceCallScreen() {
  const { id, code, shareUrl } = useLocalSearchParams<{
    id: string;
    code?: string;
    shareUrl?: string;
  }>();
  const roomId = Array.isArray(id) ? id[0] : id;
  const roomCode = Array.isArray(code) ? code[0] : code;
  const linkUrl = Array.isArray(shareUrl) ? shareUrl[0] : shareUrl;

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const joinAttempted = useRef(false);
  const wasInCall = useRef(false);

  const {
    room,
    isMuted,
    isJoined,
    joinError,
    audioOutputRoute,
    secondsRemaining,
    isConnected,
    join,
    endCall,
    toggleMute,
    toggleAudioOutput,
  } = useVoiceLink(roomId ?? '', roomCode);

  useEffect(() => {
    if (!roomId || !roomCode || joinAttempted.current) return;
    joinAttempted.current = true;
    join().catch(() => null);
  }, [roomId, roomCode, join]);

  useEffect(() => {
    if (isJoined) wasInCall.current = true;
  }, [isJoined]);

  useEffect(() => {
    if (!room || room.is_active !== false || !wasInCall.current) return;
    const timer = setTimeout(() => {
      router.replace('/(tabs)/rooms' as Href);
    }, 600);
    return () => clearTimeout(timer);
  }, [room?.is_active, room, router]);

  async function handleShare() {
    const url = linkUrl || (room?.room_code
      ? `https://divinebridge.io/call/${roomId}?code=${room.room_code}`
      : '');
    if (!url) return;
    try {
      await Share.share({
        message: `Join my voice call on Divine Bridge:\n\n${url}`,
        url,
      });
    } catch {
      /* user dismissed */
    }
  }

  function handleEnd() {
    Alert.alert(
      'End call?',
      'This will end the call for both participants.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End call',
          style: 'destructive',
          onPress: () => {
            void endCall('user').then(() => router.replace('/(tabs)/rooms' as Href));
          },
        },
      ],
    );
  }

  if (!roomId) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME_COLORS.bg }}>
        <Text style={{ color: THEME_COLORS.text2 }}>Invalid call link.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 24 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={THEME_COLORS.text2} />
        </Pressable>
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 14 }}>Voice call</Text>
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 13, fontVariant: ['tabular-nums'] }}>
          {formatCountdown(secondsRemaining)}
        </Text>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
        {!isJoined ? (
          <>
            <ActivityIndicator color={THEME_COLORS.gold} size="large" />
            <Text style={{ color: THEME_COLORS.text2, marginTop: 16, ...iosFontStyle('400'), fontSize: 15 }}>
              Connecting…
            </Text>
            {joinError ? (
              <Text style={{ color: THEME_COLORS.rose, marginTop: 12, textAlign: 'center' }}>{joinError}</Text>
            ) : null}
          </>
        ) : (
          <>
            <View style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: THEME_COLORS.goldDim,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}>
              <Icon name="audio" size={32} color={THEME_COLORS.gold} />
            </View>
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 22, marginBottom: 8 }}>
              {isConnected ? 'Connected' : 'Waiting for guest'}
            </Text>
            <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 15, textAlign: 'center', marginBottom: 28 }}>
              {isConnected
                ? 'You are in a private 1:1 voice call.'
                : 'Share the link so they can join from any browser.'}
            </Text>
            {!isConnected ? (
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void handleShare(); }}
                style={{
                  backgroundColor: THEME_COLORS.gold,
                  borderRadius: 14,
                  paddingHorizontal: 24,
                  paddingVertical: 14,
                  marginBottom: 12,
                }}
              >
                <Text style={{ color: '#fff', ...iosFontStyle('700'), fontSize: 15 }}>Share call link</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      {isJoined ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28, paddingHorizontal: 20 }}>
          <Pressable onPress={toggleMute} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: isMuted ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Icon name={isMuted ? 'mic-off' : 'mic'} size={22} color={THEME_COLORS.text} />
            </View>
            <Text style={{ color: THEME_COLORS.text3, fontSize: 11 }}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>

          <Pressable onPress={() => void toggleAudioOutput()} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: THEME_COLORS.bg3,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Icon name={audioOutputRoute === 'speaker' ? 'audio' : 'headphones'} size={22} color={THEME_COLORS.text} />
            </View>
            <Text style={{ color: THEME_COLORS.text3, fontSize: 11 }}>
              {audioOutputRoute === 'speaker' ? 'Speaker' : 'Earpiece'}
            </Text>
          </Pressable>

          <Pressable onPress={handleEnd} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: 'rgba(176,90,80,0.12)',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Icon name="leave" size={22} color={THEME_COLORS.rose} />
            </View>
            <Text style={{ color: THEME_COLORS.rose, fontSize: 11 }}>End</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
