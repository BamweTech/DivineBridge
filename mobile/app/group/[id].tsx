import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  Share,
  ActivityIndicator,
  ActionSheetIOS,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import dayjs from 'dayjs';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import { useGroupChat, useGroupDetails, firestoreTimestampMs } from '@/hooks/useGroups';
import { uploadGroupChatFile } from '@/lib/groupChatUpload';
import { useGroupUnread } from '@/contexts/GroupUnreadContext';
import { usePrayerRoom } from '@/hooks/usePrayerRoom';
import { roomApi } from '@/services/api';
import { isWebRTCAvailable } from '@/lib/sfu';
import { GroupLiveAvPanel } from '@/components/group/GroupLiveAvPanel';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS, MESSAGE_TYPES } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { MessageType, PrayerGroup, GroupChatMessage, GroupChatAttachment } from '@/types';

function normalizeHttpsUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https:\/\//i.test(t)) return t;
  if (/^http:\/\//i.test(t)) return t.replace(/^http:/i, 'https:');
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(t)) return `https://${t}`;
  return null;
}

const MESSAGE_TYPE_OPTIONS: { type: MessageType; label: string }[] = [
  { type: MESSAGE_TYPES.TEXT, label: 'Message' },
  { type: MESSAGE_TYPES.PRAYER_REQUEST, label: 'Prayer Request' },
  { type: MESSAGE_TYPES.SCRIPTURE, label: 'Scripture' },
  { type: MESSAGE_TYPES.PRAISE, label: 'Praise' },
];

const TYPE_COLORS: Record<MessageType, string> = {
  text: 'transparent',
  prayer_request: THEME_COLORS.violetDim,
  scripture: THEME_COLORS.goldDim2,
  praise: THEME_COLORS.sageDim,
  announcement: 'rgba(59,130,246,0.08)',
  system_notification: 'rgba(176,90,80,0.08)',
};

const TYPE_BORDER_COLORS: Record<MessageType, string> = {
  text: 'transparent',
  prayer_request: 'rgba(112,64,184,0.18)',
  scripture: THEME_COLORS.goldBorder,
  praise: 'rgba(74,124,94,0.22)',
  announcement: 'rgba(59,130,246,0.2)',
  system_notification: 'rgba(176,90,80,0.2)',
};

const TYPE_LABEL_COLORS: Record<MessageType, string> = {
  text: THEME_COLORS.text3,
  prayer_request: THEME_COLORS.violet,
  scripture: THEME_COLORS.gold,
  praise: THEME_COLORS.sage,
  announcement: '#3b82f6',
  system_notification: THEME_COLORS.rose,
};

function GroupChatBubble({ msg, userUid }: { msg: GroupChatMessage; userUid?: string }) {
  const isMe = msg.user_id === userUid;
  const isSpecial = msg.message_type !== 'text';
  const bg = isSpecial ? TYPE_COLORS[msg.message_type] : isMe ? THEME_COLORS.goldDim : THEME_COLORS.bg2;
  const borderColor = isSpecial ? TYPE_BORDER_COLORS[msg.message_type] : isMe ? THEME_COLORS.goldBorder : THEME_COLORS.border;
  const attachments = msg.attachments ?? [];
  const showText = (msg.message ?? '').trim().length > 0;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      style={{ marginBottom: 12, alignItems: isMe ? 'flex-end' : 'flex-start' }}
    >
      {!isMe && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, marginLeft: 4 }}>
          <Avatar name={msg.user_name} photoUrl={msg.user_photo} size={20} />
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 11 }}>{msg.user_name}</Text>
        </View>
      )}
      <View style={{
        maxWidth: '82%', backgroundColor: bg, borderRadius: 18,
        borderBottomRightRadius: isMe ? 4 : 18, borderBottomLeftRadius: isMe ? 18 : 4,
        padding: 12, borderWidth: 1, borderColor,
      }}>
        {isSpecial && (
          <Text style={{ fontSize: 10, marginBottom: 4, color: TYPE_LABEL_COLORS[msg.message_type], fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8, textTransform: 'uppercase' }}>
            {msg.message_type.replace('_', ' ')}
          </Text>
        )}
        {!!msg.link_url && (
          <Pressable
            onPress={() => Linking.openURL(msg.link_url!)}
            style={{ marginBottom: showText || attachments.length ? 8 : 0 }}
          >
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 13, textDecorationLine: 'underline' }} numberOfLines={3}>
              {msg.link_url}
            </Text>
          </Pressable>
        )}
        {attachments.map((a: GroupChatAttachment, idx: number) => (
          <Pressable
            key={`${msg.message_id}-att-${idx}`}
            onPress={() => Linking.openURL(a.url)}
            style={{ marginBottom: idx < attachments.length - 1 || showText ? 10 : 0 }}
          >
            {a.content_type.startsWith('image/') ? (
              <Image
                source={{ uri: a.url }}
                style={{ width: 220, height: 160, borderRadius: 12, backgroundColor: THEME_COLORS.bg3 }}
                contentFit="cover"
                accessibilityLabel={a.file_name}
              />
            ) : (
              <View style={{
                paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
                backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border,
              }}>
                <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>PDF</Text>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                  {a.file_name}
                </Text>
                <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 11, marginTop: 6 }}>Tap to open</Text>
              </View>
            )}
          </Pressable>
        ))}
        {showText ? (
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22 }}>
            {msg.message}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, marginTop: 3, marginHorizontal: 6 }}>
        {msg.timestamp
          ? dayjs(
              typeof msg.timestamp === 'number'
                ? msg.timestamp
                : (msg.timestamp as { toMillis?: () => number })?.toMillis?.() ?? Date.now()
            ).format('h:mm A')
          : ''}
      </Text>
    </Animated.View>
  );
}

// ─── InviteSheet ──────────────────────────────────────────────────────────────

function InviteSheet({ group, onClose }: { group: PrayerGroup; onClose: () => void }) {
  const inviteCode = group.invite_code;
  const inviteUrl = inviteCode
    ? `https://divinebridge.io/join/${group.group_id}?code=${inviteCode}`
    : `https://divinebridge.io/join/${group.group_id}`;

  const [copied, setCopied] = useState(false);

  async function handleShare() {
    try {
      await Share.share({
        message: `Join me in "${group.name}" on DivineBridge — a space for prayer and community.\n\n${inviteUrl}`,
        url: inviteUrl,
      });
    } catch {}
  }

  async function handleCopy() {
    await Clipboard.setStringAsync(inviteUrl);
    setCopied(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.55)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: THEME_COLORS.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 48,
          }}
        >
          {/* Handle */}
          <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

          {/* Title */}
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, textAlign: 'center', marginBottom: 4, letterSpacing: -0.3 }}>
            Invite to Group
          </Text>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, textAlign: 'center', marginBottom: 24 }} numberOfLines={1}>
            {group.name}
          </Text>

          {/* QR Code */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View style={{
              backgroundColor: '#ffffff',
              padding: 18,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
            }}>
              <QRCode
                value={inviteUrl}
                size={180}
                color={THEME_COLORS.text}
                backgroundColor="#ffffff"
              />
            </View>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 10 }}>
              Scan to join
            </Text>
          </View>

          {/* Invite code badge */}
          {inviteCode && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 16,
              backgroundColor: THEME_COLORS.goldDim2,
              borderWidth: 1,
              borderColor: THEME_COLORS.goldBorder,
              borderRadius: 14,
              marginBottom: 20,
            }}>
              <Icon name="lock" size={14} color={THEME_COLORS.gold} />
              <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 13 }}>
                Code: <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_700Bold', letterSpacing: 2 }}>{inviteCode}</Text>
              </Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 15,
                borderRadius: 15,
                backgroundColor: copied ? THEME_COLORS.sageDim : THEME_COLORS.bg3,
                borderWidth: 1,
                borderColor: copied ? 'rgba(74,124,94,0.3)' : THEME_COLORS.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Icon name="attach" size={16} color={copied ? THEME_COLORS.sage : THEME_COLORS.text2} />
              <Text style={{ color: copied ? THEME_COLORS.sage : THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                {copied ? 'Copied!' : 'Copy Link'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleShare}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 15,
                borderRadius: 15,
                backgroundColor: THEME_COLORS.gold,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Icon name="share" size={16} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                Share
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const scrollRef = useRef<ScrollView>(null);
  const fsScrollRef = useRef<ScrollView>(null);

  const { group } = useGroupDetails(id!);
  const { messages, sendMessage } = useGroupChat(id!);
  const { markGroupChatRead } = useGroupUnread();
  const [text, setText] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);

  const [liveRoomId, setLiveRoomId] = useState<string | null>(null);
  const [liveRoomCode, setLiveRoomCode] = useState<string | undefined>(undefined);
  const pendingJoinRef = useRef(false);
  const [avFullscreen, setAvFullscreen] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  const [fsChatOpen, setFsChatOpen] = useState(true);
  const [fsChatText, setFsChatText] = useState('');
  const [linkModal, setLinkModal] = useState<{ open: boolean; target: 'main' | 'fs' }>({
    open: false,
    target: 'main',
  });
  const [linkUrlDraft, setLinkUrlDraft] = useState('');
  const [uploading, setUploading] = useState(false);

  const prayer = usePrayerRoom(liveRoomId ?? '');
  const joinRef = useRef(prayer.join);
  joinRef.current = prayer.join;

  const prayerLeaveRef = useRef(prayer.leave);
  prayerLeaveRef.current = prayer.leave;
  const liveRoomIdUnmountRef = useRef<string | null>(null);
  liveRoomIdUnmountRef.current = liveRoomId;

  useEffect(() => {
    if (!liveRoomId || !pendingJoinRef.current) return;
    if (prayer.isJoined) {
      pendingJoinRef.current = false;
      return;
    }
    pendingJoinRef.current = false;
    joinRef.current(liveRoomCode).catch((e: Error & { message?: string }) => {
      Alert.alert('Could not join live room', e?.message ?? 'Try again.');
      setLiveRoomId(null);
      setLiveRoomCode(undefined);
    });
  }, [liveRoomId, prayer.isJoined, liveRoomCode]);

  useEffect(() => {
    return () => {
      if (liveRoomIdUnmountRef.current) {
        prayerLeaveRef.current();
      }
    };
  }, []);

  const participants = prayer.room?.participants ?? [];
  const currentParticipant = participants.find((p) => p.user_id === user?.uid);
  const isSpeaker = currentParticipant?.role === 'speaker';

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const last = messages[messages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      void markGroupChatRead(id, ts);
    }, [id, messages, markGroupChatRead])
  );

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    if (avFullscreen && fsChatOpen && messages.length > 0) {
      setTimeout(() => fsScrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, avFullscreen, fsChatOpen]);

  async function handleSend() {
    if (!text.trim()) return;
    await sendMessage(text.trim(), messageType);
    setText('');
    setMessageType('text');
    setShowTypePicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleFsSend() {
    if (!fsChatText.trim()) return;
    await sendMessage(fsChatText.trim(), 'text');
    setFsChatText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function showAttachMenu(target: 'main' | 'fs') {
    const runPick = () => {
      void pickAndUpload(target === 'fs');
    };
    const runLink = () => {
      setLinkModal({ open: true, target });
      setLinkUrlDraft('');
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Photo or PDF', 'Add link'], cancelButtonIndex: 0 },
        (i) => {
          if (i === 1) runPick();
          if (i === 2) runLink();
        }
      );
    } else {
      Alert.alert('Attach', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Photo or PDF', onPress: runPick },
        { text: 'Add link', onPress: runLink },
      ]);
    }
  }

  async function pickAndUpload(fromFs: boolean) {
    if (!id) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'application/octet-stream';
      if (!mime.startsWith('image/') && mime !== 'application/pdf') {
        Alert.alert('Unsupported file', 'Choose a photo or PDF.');
        return;
      }
      setUploading(true);
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const att = await uploadGroupChatFile(id, blob, mime, asset.name || 'attachment');
      const caption = (fromFs ? fsChatText : text).trim();
      await sendMessage(caption, fromFs ? 'text' : messageType, { attachments: [att] });
      if (fromFs) {
        setFsChatText('');
      } else {
        setText('');
        setMessageType('text');
        setShowTypePicker(false);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setUploading(false);
    }
  }

  async function submitLinkFromModal() {
    const u = normalizeHttpsUrl(linkUrlDraft);
    if (!u) {
      Alert.alert('Invalid link', 'Enter a full URL (e.g. https://example.org).');
      return;
    }
    const fromFs = linkModal.target === 'fs';
    try {
      const caption = (fromFs ? fsChatText : text).trim();
      await sendMessage(caption, fromFs ? 'text' : messageType, { linkUrl: u });
      setLinkModal({ open: false, target: 'main' });
      setLinkUrlDraft('');
      if (fromFs) {
        setFsChatText('');
      } else {
        setText('');
        setMessageType('text');
        setShowTypePicker(false);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Try again.');
    }
  }

  async function handleStartGroupLive() {
    if (!user || !id) return;
    setStartingLive(true);
    try {
      const s = await roomApi.ensureGroupSession(id);
      pendingJoinRef.current = true;
      setLiveRoomId(s.room_id);
      setLiveRoomCode(s.room_code ?? undefined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Could not start live session', msg);
    } finally {
      setStartingLive(false);
    }
  }

  function onLiveHeaderPress() {
    if (!isWebRTCAvailable) {
      Alert.alert(
        'Development build required',
        'Live audio and video need a development build of the app. Expo Go does not include WebRTC.'
      );
      return;
    }
    if (prayer.isJoined) {
      setAvFullscreen(true);
      return;
    }
    handleStartGroupLive();
  }

  async function handleLeaveLive() {
    await prayer.leave();
    setLiveRoomId(null);
    setLiveRoomCode(undefined);
    setAvFullscreen(false);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={{
        paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 12,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        borderBottomWidth: 1, borderBottomColor: THEME_COLORS.border,
        backgroundColor: THEME_COLORS.bg,
      }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="back" size={16} color={THEME_COLORS.text2} />
        </Pressable>

        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="groups" size={16} color={THEME_COLORS.sage} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }} numberOfLines={1}>
            {group?.name ?? 'Group Chat'}
          </Text>
          {group && (
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 }}>
              {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={onLiveHeaderPress}
            disabled={startingLive}
            accessibilityRole="button"
            accessibilityLabel={prayer.isJoined ? 'Open live call full screen' : 'Start or join group live prayer'}
            style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.2)', alignItems: 'center', justifyContent: 'center', opacity: startingLive ? 0.6 : 1 }}
          >
            {startingLive ? (
              <ActivityIndicator size="small" color={THEME_COLORS.sage} />
            ) : (
              <Icon name="live" size={16} color={THEME_COLORS.sage} />
            )}
          </Pressable>
          <Pressable
            onPress={() => setShowInviteSheet(true)}
            accessibilityRole="button"
            accessibilityLabel="Invite members"
            accessibilityHint="Opens share and invite options for this group"
            style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.2)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="user-plus" size={16} color={THEME_COLORS.sage} />
          </Pressable>
        </View>
      </View>

      {prayer.isJoined && !avFullscreen ? (
        <GroupLiveAvPanel
          variant="embedded"
          peers={prayer.peers}
          localStream={prayer.localStream}
          localVideoRevision={prayer.localVideoRevision}
          isVideoOn={prayer.isVideoOn}
          isSpeaker={isSpeaker}
          isMuted={prayer.isMuted}
          userId={user?.uid}
          roomMode={prayer.roomMode}
          modeSwitchToast={prayer.modeSwitchToast}
          audioOutputRoute={prayer.audioOutputRoute}
          onToggleMute={prayer.toggleMute}
          onToggleAudioOutput={() => { void prayer.toggleAudioOutput(); }}
          onToggleVideo={prayer.toggleVideo}
          onLeave={handleLeaveLive}
          onMaximize={() => setAvFullscreen(true)}
          onMinimize={() => setAvFullscreen(false)}
        />
      ) : null}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg) => (
          <GroupChatBubble key={msg.message_id} msg={msg} userUid={user?.uid} />
        ))}
      </ScrollView>

      {/* Message type picker */}
      {showTypePicker && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.bg }}>
          {MESSAGE_TYPE_OPTIONS.map((opt) => (
            <Pressable
              key={opt.type}
              onPress={() => { setMessageType(opt.type); setShowTypePicker(false); }}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: 'center', borderWidth: 1,
                backgroundColor: messageType === opt.type ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
                borderColor: messageType === opt.type ? THEME_COLORS.goldBorder : THEME_COLORS.border,
              }}
            >
              <Text style={{ color: messageType === opt.type ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 10, marginTop: 2 }}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Invite sheet */}
      {showInviteSheet && group && (
        <InviteSheet group={group} onClose={() => setShowInviteSheet(false)} />
      )}

      <Modal
        visible={prayer.isJoined && avFullscreen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setAvFullscreen(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
            paddingBottom: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderBottomWidth: 1,
            borderBottomColor: THEME_COLORS.border,
          }}>
            <Pressable
              onPress={() => setAvFullscreen(false)}
              accessibilityRole="button"
              accessibilityLabel="Minimize live call"
              style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="minimize" size={18} color={THEME_COLORS.text2} />
            </Pressable>
            <Text style={{ flex: 1, color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }} numberOfLines={1}>
              Live — {group?.name ?? 'Group'}
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <View style={{ flex: fsChatOpen ? 1 : 1 }}>
              <GroupLiveAvPanel
                variant="fullscreen"
                peers={prayer.peers}
                localStream={prayer.localStream}
                localVideoRevision={prayer.localVideoRevision}
                isVideoOn={prayer.isVideoOn}
                isSpeaker={isSpeaker}
                isMuted={prayer.isMuted}
                userId={user?.uid}
                roomMode={prayer.roomMode}
                modeSwitchToast={prayer.modeSwitchToast}
                audioOutputRoute={prayer.audioOutputRoute}
                onToggleMute={prayer.toggleMute}
                onToggleAudioOutput={() => { void prayer.toggleAudioOutput(); }}
                onToggleVideo={prayer.toggleVideo}
                onLeave={() => {
                  handleLeaveLive();
                }}
                onMaximize={() => setAvFullscreen(true)}
                onMinimize={() => setAvFullscreen(false)}
              />
            </View>

            <Pressable
              onPress={() => setFsChatOpen((v) => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: THEME_COLORS.border,
                backgroundColor: THEME_COLORS.bg2,
              }}
            >
              <Icon name="chat" size={16} color={THEME_COLORS.gold} />
              <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 13 }}>
                {fsChatOpen ? 'Hide group chat' : 'Show group chat'}
              </Text>
              <Icon name={fsChatOpen ? 'chevron-d' : 'chevron-r'} size={14} color={THEME_COLORS.text3} />
            </Pressable>

            {fsChatOpen ? (
              <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: THEME_COLORS.border }}>
                <ScrollView
                  ref={fsScrollRef}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                >
                  {messages.map((msg) => (
                    <GroupChatBubble key={`fs-${msg.message_id}`} msg={msg} userUid={user?.uid} />
                  ))}
                </ScrollView>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 12,
                  paddingBottom: insets.bottom + 12,
                  gap: 8,
                  borderTopWidth: 1,
                  borderTopColor: THEME_COLORS.border,
                  backgroundColor: THEME_COLORS.bg,
                }}>
                  <Pressable
                    onPress={() => showAttachMenu('fs')}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 11,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1,
                      backgroundColor: THEME_COLORS.bg3,
                      borderColor: THEME_COLORS.border,
                    }}
                  >
                    <Icon name="plus" size={16} color={THEME_COLORS.text2} />
                  </Pressable>
                  <TextInput
                    value={fsChatText}
                    onChangeText={setFsChatText}
                    placeholder="Message the group…"
                    placeholderTextColor={THEME_COLORS.text3}
                    style={{
                      flex: 1,
                      backgroundColor: THEME_COLORS.bg2,
                      borderRadius: 20,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      color: THEME_COLORS.text,
                      fontFamily: 'Geist_400Regular',
                      fontSize: 14,
                      maxHeight: 88,
                      borderWidth: 1,
                      borderColor: THEME_COLORS.border,
                    }}
                    multiline
                    returnKeyType="send"
                    onSubmitEditing={handleFsSend}
                  />
                  <Pressable
                    onPress={handleFsSend}
                    disabled={!fsChatText.trim() || uploading}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: fsChatText.trim() && !uploading ? THEME_COLORS.gold : THEME_COLORS.bg3,
                    }}
                  >
                    <Icon name="send" size={14} color={fsChatText.trim() && !uploading ? '#ffffff' : THEME_COLORS.text3} />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Input bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        padding: 12, paddingBottom: insets.bottom + 8, gap: 8,
        borderTopWidth: showTypePicker ? 0 : 1, borderTopColor: THEME_COLORS.border,
        backgroundColor: THEME_COLORS.bg,
      }}>
        {/* Message type + attach */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable
            onPress={() => setShowTypePicker((v) => !v)}
            style={{
              width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
              backgroundColor: messageType !== 'text' ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
              borderColor: messageType !== 'text' ? THEME_COLORS.goldBorder : THEME_COLORS.border,
            }}
          >
            <Icon name={messageType !== 'text' ? 'pray' : 'attach'} size={14} color={messageType !== 'text' ? THEME_COLORS.gold : THEME_COLORS.text2} />
          </Pressable>
          <Pressable
            onPress={() => showAttachMenu('main')}
            style={{
              width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
              backgroundColor: THEME_COLORS.bg3,
              borderColor: THEME_COLORS.border,
            }}
          >
            <Icon name="plus" size={16} color={THEME_COLORS.text2} />
          </Pressable>
        </View>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={messageType === 'text' ? 'Message the group…' : `Share a ${messageType.replace('_', ' ')}…`}
          placeholderTextColor={THEME_COLORS.text3}
          style={{
            flex: 1, backgroundColor: THEME_COLORS.bg2, borderRadius: 20,
            paddingHorizontal: 16, paddingVertical: 10,
            color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14,
            maxHeight: 100, borderWidth: 1, borderColor: THEME_COLORS.border,
          }}
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || uploading}
          style={{
            width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            backgroundColor: text.trim() && !uploading ? THEME_COLORS.gold : THEME_COLORS.bg3,
          }}
        >
          <Icon name="send" size={14} color={text.trim() && !uploading ? '#ffffff' : THEME_COLORS.text3} />
        </Pressable>
      </View>

      <Modal visible={uploading} transparent animationType="fade">
        <View style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(44,36,22,0.35)',
        }}>
          <View style={{
            padding: 24,
            borderRadius: 16,
            backgroundColor: THEME_COLORS.bg,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
            alignItems: 'center',
            gap: 12,
          }}>
            <ActivityIndicator size="large" color={THEME_COLORS.gold} />
            <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 14 }}>Uploading…</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={linkModal.open} transparent animationType="fade" onRequestClose={() => setLinkModal((m) => ({ ...m, open: false }))}>
        <Pressable
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: 24,
            backgroundColor: 'rgba(44,36,22,0.45)',
          }}
          onPress={() => setLinkModal((m) => ({ ...m, open: false }))}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              borderRadius: 18,
              padding: 20,
              backgroundColor: THEME_COLORS.bg,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
            }}
          >
            <Text style={{ fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: THEME_COLORS.text, marginBottom: 8 }}>
              Add a link
            </Text>
            <Text style={{ fontFamily: 'Geist_400Regular', fontSize: 13, color: THEME_COLORS.text3, marginBottom: 12 }}>
              Paste a web address (https). Your optional message above will be sent as a caption.
            </Text>
            <TextInput
              value={linkUrlDraft}
              onChangeText={setLinkUrlDraft}
              placeholder="https://…"
              placeholderTextColor={THEME_COLORS.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{
                borderWidth: 1,
                borderColor: THEME_COLORS.border,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontFamily: 'Geist_400Regular',
                fontSize: 15,
                color: THEME_COLORS.text,
                marginBottom: 16,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => setLinkModal((m) => ({ ...m, open: false }))}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ fontFamily: 'Geist_600SemiBold', color: THEME_COLORS.text2 }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitLinkFromModal()}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 18,
                  borderRadius: 12,
                  backgroundColor: THEME_COLORS.gold,
                }}
              >
                <Text style={{ fontFamily: 'Geist_600SemiBold', color: '#ffffff' }}>Send</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
