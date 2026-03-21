import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp, SlideInDown, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { RTCView, isWebRTCAvailable } from '@/lib/sfu';
import { VideoStreamView } from '@/components/room/VideoStreamView';
import { usePrayerRoom } from '@/hooks/usePrayerRoom';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS, ROOM_MODES } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { Participant } from '@/types';
import dayjs from 'dayjs';

import type { IconName } from '@/components/ui/Icon';

function ControlButton({
  iconName,
  label,
  onPress,
  active,
  danger,
}: {
  iconName: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => { scale.value = withSpring(0.9); }}
      onPressOut={() => { scale.value = withSpring(1); }}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }}
      style={{ alignItems: 'center', gap: 6 }}
    >
      <Animated.View
        style={[
          {
            width: 52,
            height: 52,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: danger
              ? 'rgba(176,90,80,0.08)'
              : active
              ? THEME_COLORS.sageDim
              : THEME_COLORS.bg3,
            borderWidth: 1,
            borderColor: danger
              ? 'rgba(176,90,80,0.2)'
              : active
              ? 'rgba(74,124,94,0.3)'
              : THEME_COLORS.border,
          },
          style,
        ]}
      >
        <Icon
          name={iconName}
          size={18}
          color={danger ? THEME_COLORS.rose : active ? THEME_COLORS.sage : THEME_COLORS.text2}
        />
      </Animated.View>
      <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10 }}>{label}</Text>
    </Pressable>
  );
}

function ParticipantTile({ participant, isActiveSpeaker }: { participant: Participant; isActiveSpeaker: boolean }) {
  return (
    <View style={{ alignItems: 'center', width: 72, marginHorizontal: 6 }}>
      <View style={{
        borderWidth: isActiveSpeaker && participant.role === 'speaker' ? 2 : 0,
        borderColor: THEME_COLORS.sage,
        borderRadius: 16,
        padding: isActiveSpeaker ? 2 : 0,
      }}>
        <Avatar
          name={participant.user_name}
          size={52}
          showSpeakingRing={isActiveSpeaker && participant.role === 'speaker'}
        />
      </View>
      <Text
        numberOfLines={1}
        style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 4, textAlign: 'center' }}
      >
        {participant.user_name.split(' ')[0]}
      </Text>
      {participant.is_host && (
        <View style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: THEME_COLORS.goldDim, marginTop: 2 }}>
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 8, letterSpacing: 0.5 }}>HOST</Text>
        </View>
      )}
      {participant.is_muted && (
        <Icon name="mic-off" size={10} color={THEME_COLORS.text3} style={{ marginTop: 2 }} />
      )}
    </View>
  );
}

function ModeTransitionToast({ message }: { message: string }) {
  return (
    <Animated.View
      entering={FadeInUp.duration(300)}
      style={{
        position: 'absolute',
        top: 80,
        alignSelf: 'center',
        backgroundColor: THEME_COLORS.gold,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        zIndex: 100,
      }}
    >
      <Text style={{ color: '#ffffff', fontFamily: 'Geist_600SemiBold', fontSize: 13 }}>
        {message}
      </Text>
    </Animated.View>
  );
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const scrollRef = useRef<ScrollView>(null);

  const {
    room,
    messages,
    peers,
    localStream,
    localVideoRevision,
    isMuted,
    isVideoOn,
    roomMode,
    activeSpeakers,
    modeSwitchToast,
    isJoined,
    join,
    leave,
    toggleMute,
    toggleVideo,
    sendMessage,
  } = usePrayerRoom(id!);

  const [chatText, setChatText] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    if (scrollRef.current && messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function handleJoin() {
    setIsJoining(true);
    try {
      await join();
    } catch {
      Alert.alert('Failed to join room');
    } finally {
      setIsJoining(false);
    }
  }

  async function handleLeave() {
    await leave();
    router.back();
  }

  async function handleSend() {
    if (!chatText.trim()) return;
    await sendMessage(chatText.trim());
    setChatText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const isGroupCall = roomMode === ROOM_MODES.GROUP_CALL;
  const participants = room?.participants ?? [];
  const speakers = participants.filter((p) => p.role === 'speaker');
  const currentUser = participants.find((p) => p.user_id === user?.uid);
  const isSpeaker = currentUser?.role === 'speaker';

  // Expo Go guard — WebRTC native module not available
  if (!isWebRTCAvailable) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: THEME_COLORS.bg3, alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 1, borderColor: THEME_COLORS.border }}>
          <Icon name="settings" size={32} color={THEME_COLORS.text3} />
        </View>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, textAlign: 'center', marginBottom: 12 }}>
          Development Build Required
        </Text>
        <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 28 }}>
          Live prayer rooms use native audio/video not available in Expo Go.{'\n\n'}
          Build the dev client to use this feature:{'\n'}
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold' }}>
            npx eas build --profile development
          </Text>
        </Text>
        <Pressable onPress={() => router.back()} style={{ backgroundColor: THEME_COLORS.gold, borderRadius: 50, paddingHorizontal: 28, paddingVertical: 14 }}>
          <Text style={{ color: '#ffffff', fontFamily: 'Geist_700Bold', fontSize: 15 }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // Pre-join screen
  if (!isJoined) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        {modeSwitchToast && <ModeTransitionToast message={modeSwitchToast} />}
        <View style={{ width: 80, height: 80, borderRadius: 26, backgroundColor: THEME_COLORS.sageDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(74,124,94,0.22)', marginBottom: 20 }}>
          <Icon name="live" size={36} color={THEME_COLORS.sage} />
        </View>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 26, textAlign: 'center', marginBottom: 8 }}>
          {room?.room_name ?? 'Prayer Room'}
        </Text>
        <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 15, textAlign: 'center', marginBottom: 32 }}>
          {participants.length} {participants.length === 1 ? 'person' : 'people'} inside
        </Text>
        <Pressable
          onPress={handleJoin}
          disabled={isJoining}
          style={{ backgroundColor: THEME_COLORS.sage, borderRadius: 50, paddingHorizontal: 40, paddingVertical: 16, marginBottom: 16 }}
        >
          {isJoining ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={{ color: '#ffffff', fontFamily: 'Geist_700Bold', fontSize: 16 }}>Join Room</Text>
          )}
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_500Medium', fontSize: 14 }}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {modeSwitchToast && <ModeTransitionToast message={modeSwitchToast} />}

      {/* Header */}
      <View style={{
        paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderBottomWidth: 1, borderBottomColor: THEME_COLORS.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <Pressable onPress={() => router.back()} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" size={16} color={THEME_COLORS.text2} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }} numberOfLines={1}>
              {room?.room_name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: THEME_COLORS.sage }} />
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11 }}>
                {participants.length} · {isGroupCall ? 'Group Call' : 'Prayer Room'}
              </Text>
            </View>
          </View>
        </View>
        <Pressable
          onPress={() => setShowChat((v) => !v)}
          style={{
            width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
            backgroundColor: showChat ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
            borderColor: showChat ? THEME_COLORS.goldBorder : THEME_COLORS.border,
          }}
        >
          <Icon name="chat" size={16} color={showChat ? THEME_COLORS.gold : THEME_COLORS.text2} />
        </Pressable>
      </View>

      {/* Hidden RTCViews for audio-only peers — react-native-webrtc needs
          an RTCView mounted to activate audio playback on iOS/Android.
          Placed outside the chat/participants toggle so audio stays alive
          regardless of which tab is active. */}
      {Array.from(peers.values()).map((peer) => (
        peer.userId !== user?.uid && peer.stream && !peer.isVideoEnabled ? (
          <RTCView
            key={`audio-${peer.userId}`}
            streamURL={peer.stream.toURL()}
            style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
          />
        ) : null
      ))}

      {/* Main content */}
      <View style={{ flex: 1 }}>
        {showChat ? (
          /* Chat panel */
          <View style={{ flex: 1 }}>
            <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
              {messages.map((msg, i) => {
                const isMe = msg.user_id === user?.uid;
                return (
                  <Animated.View key={msg.message_id} entering={FadeInDown.duration(200)} style={{ marginBottom: 10, alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                    {!isMe && (
                      <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 11, marginBottom: 3, marginLeft: 4 }}>
                        {msg.user_name}
                      </Text>
                    )}
                    <View style={{
                      maxWidth: '80%', borderRadius: 18,
                      borderBottomRightRadius: isMe ? 4 : 18, borderBottomLeftRadius: isMe ? 18 : 4,
                      padding: 12, borderWidth: 1,
                      backgroundColor: isMe ? THEME_COLORS.goldDim : THEME_COLORS.bg2,
                      borderColor: isMe ? THEME_COLORS.goldBorder : THEME_COLORS.border,
                    }}>
                      <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 20 }}>
                        {msg.message}
                      </Text>
                    </View>
                    <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, marginTop: 3, marginHorizontal: 4 }}>
                      {dayjs(msg.timestamp).format('h:mm A')}
                    </Text>
                  </Animated.View>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: THEME_COLORS.border }}>
              <TextInput
                value={chatText}
                onChangeText={setChatText}
                placeholder="Say something..."
                placeholderTextColor={THEME_COLORS.text3}
                style={{ flex: 1, backgroundColor: THEME_COLORS.bg2, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, borderWidth: 1, borderColor: THEME_COLORS.border }}
                returnKeyType="send"
                onSubmitEditing={handleSend}
              />
              <Pressable onPress={handleSend} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: THEME_COLORS.gold, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="send" size={14} color="#ffffff" />
              </Pressable>
            </View>
          </View>
        ) : (
          /* Participants / video panel */
          <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>

            {/* Video views (group call mode) */}
            {isGroupCall && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {isSpeaker && isVideoOn ? (
                  <View
                    key={`local-${localVideoRevision}`}
                    style={{ width: '48%', aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: THEME_COLORS.bg3 }}
                  >
                    <VideoStreamView
                      stream={localStream}
                      style={{ flex: 1 }}
                      objectFit="cover"
                      mirror
                      label="You"
                    />
                  </View>
                ) : null}
                {Array.from(peers.values()).map((peer) => (
                  peer.userId !== user?.uid && peer.stream && peer.isVideoEnabled ? (
                    <View key={peer.userId} style={{ width: '48%', aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: THEME_COLORS.bg3 }}>
                      <VideoStreamView
                        stream={peer.stream}
                        style={{ flex: 1 }}
                        objectFit="cover"
                        label={peer.userName?.split(' ')[0] ?? 'Participant'}
                      />
                    </View>
                  ) : null
                ))}
              </View>
            )}

            {/* Speakers grid */}
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_600SemiBold', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 }}>
              {speakers.length} {speakers.length === 1 ? 'Speaker' : 'Speakers'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
              {speakers.map((p) => (
                <ParticipantTile key={p.user_id} participant={p} isActiveSpeaker={activeSpeakers.includes(p.user_id)} />
              ))}
            </ScrollView>

            {/* Listeners */}
            {participants.filter((p) => p.role === 'listener').length > 0 && (
              <>
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_600SemiBold', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>
                  {participants.filter((p) => p.role === 'listener').length} Listening
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {participants.filter((p) => p.role === 'listener').map((p) => (
                    <View key={p.user_id} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border }}>
                      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 12 }}>
                        {p.user_name.split(' ')[0]}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </View>

      {/* Controls bar */}
      <View style={{
        paddingBottom: insets.bottom + 12, paddingHorizontal: 24, paddingTop: 16,
        flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
        borderTopWidth: 1, borderTopColor: THEME_COLORS.border,
        backgroundColor: THEME_COLORS.bg,
      }}>
        <ControlButton iconName={isMuted ? 'mic-off' : 'mic'} label={isMuted ? 'Unmute' : 'Mute'} onPress={toggleMute} active={!isMuted} />
        {isSpeaker && isGroupCall && (
          <ControlButton iconName={isVideoOn ? 'video' : 'video'} label={isVideoOn ? 'Stop Video' : 'Video'} onPress={toggleVideo} active={isVideoOn} />
        )}
        <ControlButton iconName="chat" label="Chat" onPress={() => setShowChat((v) => !v)} active={showChat} />
        <ControlButton iconName="leave" label="Leave" onPress={handleLeave} danger />
      </View>
    </KeyboardAvoidingView>
  );
}
