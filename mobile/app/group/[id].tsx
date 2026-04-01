import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
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
  Linking,
  Dimensions,
  StatusBar,
  Animated as RNAnimated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Image as RNImage,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import dayjs from 'dayjs';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import {
  useGroupChat,
  useGroupDetails,
  useGroupMembers,
  useGroupLiveRoom,
  useGroupChatLastReads,
  firestoreTimestampMs,
} from '@/hooks/useGroups';
import { uploadGroupChatFile } from '@/lib/groupChatUpload';
import { useGroupUnread } from '@/contexts/GroupUnreadContext';
import { usePrayerRoom } from '@/hooks/usePrayerRoom';
import { groupApi, roomApi } from '@/services/api';
import { isWebRTCAvailable } from '@/lib/sfu';
import { GroupLiveAvPanel } from '@/components/group/GroupLiveAvPanel';
import { Avatar } from '@/components/ui/Avatar';
import { PulsingDot } from '@/components/ui/PulsingDot';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type {
  MessageType,
  PrayerGroup,
  GroupMember,
  GroupChatMessage,
  GroupChatAttachment,
  GroupChatReplyRef,
} from '@/types';

type PendingUploadBubble = {
  temp_id: string;
  user_name: string;
  user_photo?: string | null;
  message: string;
  local_uri?: string;
  file_name: string;
  content_type: string;
  status: 'uploading' | 'failed';
};

type ViewerMedia = {
  url: string;
  contentType: string;
  fileName: string;
};

type ReactionPopoverState = {
  message: GroupChatMessage;
  anchorX: number;
  anchorY: number;
  align: 'left' | 'right';
};

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

const REACTION_OPTIONS = ['🙏', '❤️', '🙌', '🔥', '😢', '✨'] as const;

type ChatSurface = 'main' | 'fs';

function buildReplyPreviewText(msg: Pick<GroupChatMessage, 'message' | 'link_url' | 'attachments' | 'message_type'>) {
  const body = (msg.message ?? '').trim().replace(/\s+/g, ' ');
  if (body) return body;

  if (msg.link_url?.trim()) return msg.link_url.trim();

  const attachments = msg.attachments ?? [];
  if (attachments.length > 0) {
    const imageCount = attachments.filter((a) => a.content_type.startsWith('image/')).length;
    const videoCount = attachments.filter((a) => a.content_type.startsWith('video/')).length;
    if (imageCount === attachments.length) return imageCount === 1 ? 'Photo' : `${imageCount} photos`;
    if (videoCount === attachments.length) return videoCount === 1 ? 'Video' : `${videoCount} videos`;
    return attachments.length === 1 ? `File: ${attachments[0].file_name}` : `${attachments.length} attachments`;
  }

  if (msg.message_type === 'prayer_request') return 'Prayer request';
  if (msg.message_type === 'scripture') return 'Scripture';
  if (msg.message_type === 'praise') return 'Praise report';
  return 'Message';
}

function normalizeReactions(reactions?: Record<string, string[]>) {
  const next: Record<string, string[]> = {};
  for (const [emoji, users] of Object.entries(reactions ?? {})) {
    if (!emoji || !Array.isArray(users)) continue;
    const filtered = users.filter((uid): uid is string => typeof uid === 'string');
    if (filtered.length > 0) next[emoji] = filtered;
  }
  return next;
}

function applyReactionMutation(
  reactions: Record<string, string[]>,
  emoji: string,
  userUid?: string,
) {
  if (!userUid) return reactions;
  const next = { ...normalizeReactions(reactions) };
  const currentUsers = next[emoji] ?? [];
  const hasReacted = currentUsers.includes(userUid);
  const updatedUsers = hasReacted
    ? currentUsers.filter((uid) => uid !== userUid)
    : [...currentUsers, userUid];

  if (updatedUsers.length > 0) next[emoji] = updatedUsers;
  else delete next[emoji];

  return next;
}

function sameSenderCluster(
  current: GroupChatMessage,
  adjacent?: GroupChatMessage,
) {
  if (!adjacent) return false;
  if (current.user_id !== adjacent.user_id) return false;
  const currentTs = firestoreTimestampMs(current.timestamp);
  const adjacentTs = firestoreTimestampMs(adjacent.timestamp);
  return Math.abs(currentTs - adjacentTs) < 5 * 60 * 1000;
}

function isVisualAttachment(att: GroupChatAttachment) {
  return att.content_type.startsWith('image/') || att.content_type.startsWith('video/');
}

function fileExtensionFromAttachment(att: Pick<GroupChatAttachment, 'file_name' | 'content_type'>) {
  const fromName = (att.file_name.split('.').pop() || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (fromName) return fromName;
  if (att.content_type.startsWith('image/')) return att.content_type.split('/')[1] || 'jpg';
  if (att.content_type.startsWith('video/')) return att.content_type.split('/')[1] || 'mp4';
  return 'bin';
}

async function downloadAttachmentToCache(att: Pick<GroupChatAttachment, 'url' | 'file_name' | 'content_type'>) {
  const baseDir = FileSystem.cacheDirectory;
  if (!baseDir) throw new Error('File cache is unavailable on this device.');
  const ext = fileExtensionFromAttachment(att);
  const safeName =
    att.file_name.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) || `attachment.${ext}`;
  const dest = `${baseDir}${Date.now()}_${safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`}`;
  const result = await FileSystem.downloadAsync(att.url, dest);
  if (result.status !== 200) throw new Error('Could not download file.');
  return result.uri;
}

async function getMediaLibraryModule() {
  try {
    return await import('expo-media-library');
  } catch {
    throw new Error('Media saving needs the latest app build. Please update the app and try again.');
  }
}

function toReplyRef(msg: GroupChatMessage): GroupChatReplyRef {
  return {
    message_id: msg.message_id,
    user_id: msg.user_id,
    user_name: msg.user_name,
    message: buildReplyPreviewText(msg),
  };
}

function ReplyComposerBanner({
  target,
  onCancel,
}: {
  target: GroupChatMessage;
  onCancel: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 8,
        backgroundColor: THEME_COLORS.bg,
      }}
    >
      <View
        style={{
          flex: 1,
          borderLeftWidth: 3,
          borderLeftColor: THEME_COLORS.gold,
          paddingLeft: 10,
        }}
      >
        <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
          Replying to {target.user_name}
        </Text>
        <Text
          numberOfLines={2}
          style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }}
        >
          {buildReplyPreviewText(target)}
        </Text>
      </View>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: THEME_COLORS.bg3,
          borderWidth: 1,
          borderColor: THEME_COLORS.border,
        }}
      >
        <Icon name="cross" size={12} color={THEME_COLORS.text3} />
      </Pressable>
    </View>
  );
}

function AttachmentTray({
  onPickPhoto,
  onTakePhoto,
  onPickVideo,
  onPickDocument,
}: {
  onPickPhoto: () => void;
  onTakePhoto: () => void;
  onPickVideo: () => void;
  onPickDocument: () => void;
}) {
  const options = [
    {
      key: 'photo',
      label: 'Photo',
      sublabel: 'Choose from library',
      icon: 'image' as const,
      iconColor: '#2F7D6B',
      iconBg: 'rgba(47,125,107,0.14)',
      onPress: onPickPhoto,
    },
    {
      key: 'camera',
      label: 'Camera',
      sublabel: 'Take a photo',
      icon: 'camera' as const,
      iconColor: '#C67A12',
      iconBg: 'rgba(198,122,18,0.14)',
      onPress: onTakePhoto,
    },
    {
      key: 'video',
      label: 'Video',
      sublabel: 'Choose a video',
      icon: 'video' as const,
      iconColor: '#8A5CF6',
      iconBg: 'rgba(138,92,246,0.14)',
      onPress: onPickVideo,
    },
    {
      key: 'document',
      label: 'Document',
      sublabel: 'Share a file',
      icon: 'scroll' as const,
      iconColor: '#D3536A',
      iconBg: 'rgba(211,83,106,0.14)',
      onPress: onPickDocument,
    },
  ];

  return (
    <View
      style={{
        marginHorizontal: 12,
        marginTop: 8,
        marginBottom: 4,
        padding: 8,
        borderRadius: 18,
        backgroundColor: THEME_COLORS.bg2,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            onPress={option.onPress}
            style={{
              width: '48%',
              minWidth: 146,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              backgroundColor: THEME_COLORS.bg3,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: option.iconBg,
              }}
            >
              <Icon name={option.icon} size={18} color={option.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 13 }}>
                {option.label}
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 2 }}>
                {option.sublabel}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function AdaptiveImagePreview({
  uri,
  accessibilityLabel,
}: {
  uri: string;
  accessibilityLabel: string;
}) {
  const [ratio, setRatio] = useState(4 / 3);

  useEffect(() => {
    let active = true;
    RNImage.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) setRatio(width / height);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [uri]);

  return (
    <Image
      source={{ uri }}
      style={{ width: 264, aspectRatio: ratio, backgroundColor: THEME_COLORS.bg3 }}
      contentFit="contain"
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function MediaAttachmentCard({
  attachment,
  onOpen,
}: {
  attachment: GroupChatAttachment;
  onOpen: (attachment: GroupChatAttachment) => void;
}) {
  const isVideo = attachment.content_type.startsWith('video/');

  return (
    <Pressable
      onPress={() => onOpen(attachment)}
      style={{
        width: 264,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: THEME_COLORS.bg3,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
      }}
    >
      {isVideo ? (
        <View style={{ position: 'relative' }}>
          <Video
            source={{ uri: attachment.url }}
            style={{ width: 264, height: 220, backgroundColor: '#111' }}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isLooping={false}
            isMuted
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 27,
                backgroundColor: 'rgba(0,0,0,0.45)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="play" size={18} color="#fff" />
            </View>
          </View>
        </View>
      ) : (
        <AdaptiveImagePreview uri={attachment.url} accessibilityLabel={attachment.file_name} />
      )}
    </Pressable>
  );
}

function GroupMembersSheet({
  visible,
  groupName,
  members,
  loading,
  onClose,
}: {
  visible: boolean;
  groupName: string;
  members: GroupMember[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: THEME_COLORS.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 32,
            maxHeight: '72%',
          }}
        >
          <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 18 }} />
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18 }}>
            {groupName}
          </Text>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 4, marginBottom: 14 }}>
            {loading ? 'Loading members...' : `${members.length} ${members.length === 1 ? 'member' : 'members'}`}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 18 }} />
            ) : (
              members.map((member) => (
                <View
                  key={member.uid}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    borderTopWidth: 1,
                    borderTopColor: THEME_COLORS.border,
                  }}
                >
                  <Avatar name={member.display_name} photoUrl={member.photo_url} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                      {member.display_name}
                    </Text>
                    <Text style={{ color: member.role === 'admin' ? THEME_COLORS.gold : THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }}>
                      {member.role === 'admin' ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GroupChatBubble({
  msg,
  surface,
  userUid,
  showSender,
  showTimestamp,
  highlighted,
  onOpenMedia,
  onOpenDoc,
  onReply,
  onToggleReaction,
  onOpenReactions,
  onCopyMessage,
  onDeleteMessage,
  onJumpToReply,
  onLayoutMessage,
}: {
  msg: GroupChatMessage;
  surface: ChatSurface;
  userUid?: string;
  showSender: boolean;
  showTimestamp: boolean;
  highlighted?: boolean;
  onOpenMedia: (attachment: GroupChatAttachment) => void;
  onOpenDoc: (url: string, fileName: string) => void;
  onReply: (message: GroupChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenReactions: (message: GroupChatMessage, anchor: { x: number; y: number; align: 'left' | 'right' }) => void;
  onCopyMessage: (message: GroupChatMessage) => void;
  onDeleteMessage: (messageId: string) => void;
  onJumpToReply: (messageId: string, surface: ChatSurface) => void;
  onLayoutMessage: (messageId: string, y: number, surface: ChatSurface) => void;
}) {
  const swipeRef = useRef<Swipeable | null>(null);
  const isMe = msg.user_id === userUid;
  const isSpecial = msg.message_type !== 'text';
  const bg = highlighted
    ? 'rgba(212, 168, 75, 0.18)'
    : isSpecial
      ? TYPE_COLORS[msg.message_type]
      : isMe
        ? THEME_COLORS.goldDim
        : THEME_COLORS.bg2;
  const borderColor = highlighted
    ? THEME_COLORS.gold
    : isSpecial
      ? TYPE_BORDER_COLORS[msg.message_type]
      : isMe
        ? THEME_COLORS.goldBorder
        : THEME_COLORS.border;
  const attachments = msg.attachments ?? [];
  const showText = (msg.message ?? '').trim().length > 0;
  const mediaAtts = attachments.filter(isVisualAttachment);
  const docAtts = attachments.filter((a) => !isVisualAttachment(a));
  const reactionEntries = Object.entries(msg.reactions ?? {}).filter(
    ([emoji, users]) => emoji && Array.isArray(users) && users.length > 0,
  );
  const hasMessageBubble =
    showText || docAtts.length > 0 || !!msg.reply_to || isSpecial || !!msg.link_url;

  const BUBBLE_W = 264;
  const rTL = 18;
  const rTR = 18;
  const rBR = isMe ? 4 : 18;
  const rBL = isMe ? 18 : 4;

  function handleLongPress(event: { nativeEvent: { pageX: number; pageY: number } }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenReactions(msg, {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
      align: isMe ? 'right' : 'left',
    });
  }

  function handleSwipeReply() {
    swipeRef.current?.close();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply(msg);
  }

  return (
    <View
      onLayout={(event) => onLayoutMessage(msg.message_id, event.nativeEvent.layout.y, surface)}
      style={{ position: 'relative' }}
    >
    <Swipeable
      ref={swipeRef}
      overshootLeft={false}
      overshootRight={false}
      leftThreshold={36}
      rightThreshold={44}
      friction={2}
      renderLeftActions={(_, dragX) => (
        <View style={{ justifyContent: 'center', paddingHorizontal: 8, marginBottom: showTimestamp ? 12 : 4 }}>
          <RNAnimated.View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: THEME_COLORS.sageDim,
              borderWidth: 1,
              borderColor: 'rgba(74,124,94,0.22)',
              opacity: dragX.interpolate({
                inputRange: [0, 16, 48],
                outputRange: [0.1, 0.5, 1],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  translateX: dragX.interpolate({
                    inputRange: [0, 80],
                    outputRange: [-16, 0],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  scale: dragX.interpolate({
                    inputRange: [0, 80],
                    outputRange: [0.85, 1],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            }}
          >
            <Icon name="reply" size={14} color={THEME_COLORS.sage} />
            <Text style={{ color: THEME_COLORS.sage, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
              Reply
            </Text>
          </RNAnimated.View>
        </View>
      )}
      renderRightActions={() => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            paddingLeft: 10,
            marginBottom: showTimestamp ? 12 : 4,
          }}
        >
          <Pressable
            onPress={() => {
              swipeRef.current?.close();
              onCopyMessage(msg);
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: THEME_COLORS.bg3,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
            }}
          >
            <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
              Copy
            </Text>
          </Pressable>
          {isMe ? (
            <Pressable
              onPress={() => {
                swipeRef.current?.close();
                onDeleteMessage(msg.message_id);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 14,
                backgroundColor: 'rgba(176,90,80,0.08)',
                borderWidth: 1,
                borderColor: 'rgba(176,90,80,0.16)',
              }}
            >
              <Text style={{ color: THEME_COLORS.rose, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
                Delete
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
      onSwipeableOpen={(direction) => {
        if (direction === 'left') handleSwipeReply();
      }}
    >
      <Animated.View
        entering={FadeInDown.duration(200)}
        style={{ marginBottom: showTimestamp ? 12 : 4, alignItems: isMe ? 'flex-end' : 'flex-start' }}
      >
        {!isMe && showSender && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, marginLeft: 4 }}>
            <Avatar name={msg.user_name} photoUrl={msg.user_photo} size={20} />
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 11 }}>{msg.user_name}</Text>
          </View>
        )}
        <View style={{ position: 'relative', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
        {mediaAtts.length > 0 && (
          <Pressable onLongPress={handleLongPress} delayLongPress={400}>
            <View style={{ gap: 8, marginBottom: hasMessageBubble ? 8 : 0 }}>
              {mediaAtts.map((a, idx) => (
                <MediaAttachmentCard
                  key={`${msg.message_id}-media-${idx}`}
                  attachment={a}
                  onOpen={onOpenMedia}
                />
              ))}
            </View>
          </Pressable>
        )}
        {hasMessageBubble && (
          <View
            style={{
              maxWidth: BUBBLE_W,
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              position: 'relative',
            }}
          >
            <Pressable onLongPress={handleLongPress} delayLongPress={400}>
              <View style={{
                backgroundColor: bg,
                borderRadius: 18,
                borderTopLeftRadius: rTL, borderTopRightRadius: rTR,
                borderBottomRightRadius: rBR, borderBottomLeftRadius: rBL,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor,
              }}>
                <View style={{ padding: 12 }}>
                  {isSpecial && (
                    <Text style={{ fontSize: 10, marginBottom: 4, color: TYPE_LABEL_COLORS[msg.message_type], fontFamily: 'Geist_600SemiBold', letterSpacing: 0.8, textTransform: 'uppercase' }}>
                      {msg.message_type.replace('_', ' ')}
                    </Text>
                  )}
                  {msg.reply_to && (
                    <Pressable
                      onPress={() => onJumpToReply(msg.reply_to!.message_id, surface)}
                      style={{
                        marginBottom: showText || msg.link_url || docAtts.length > 0 ? 10 : 0,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        backgroundColor: isMe ? 'rgba(255,255,255,0.48)' : THEME_COLORS.bg3,
                        borderLeftWidth: 3,
                        borderLeftColor: TYPE_LABEL_COLORS[msg.message_type] || THEME_COLORS.gold,
                      }}
                    >
                      <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 11 }}>
                        {msg.reply_to.user_name}
                      </Text>
                      <Text numberOfLines={2} style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }}>
                        {msg.reply_to.message}
                      </Text>
                    </Pressable>
                  )}
                  {!!msg.link_url && (
                    <Pressable
                      onPress={() => Linking.openURL(msg.link_url!)}
                      style={{ marginBottom: showText || docAtts.length ? 8 : 0 }}
                    >
                      <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 13, textDecorationLine: 'underline' }} numberOfLines={3}>
                        {msg.link_url}
                      </Text>
                    </Pressable>
                  )}
                  {docAtts.map((a: GroupChatAttachment, idx: number) => (
                    <Pressable
                      key={`${msg.message_id}-doc-${idx}`}
                      onPress={() => onOpenDoc(a.url, a.file_name)}
                      style={{ marginBottom: idx < docAtts.length - 1 || showText ? 10 : 0 }}
                    >
                      <View style={{
                        paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
                        backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border,
                      }}>
                        <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
                          {a.file_name?.toLowerCase().endsWith('.pdf') ? 'PDF' : 'File'}
                        </Text>
                        <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                          {a.file_name}
                        </Text>
                        <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 11, marginTop: 6 }}>Tap to open</Text>
                      </View>
                    </Pressable>
                  ))}
                  {showText ? (
                    <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22 }}>
                      {msg.message}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
            {reactionEntries.length > 0 ? (
              <View
                style={{
                  marginTop: -11,
                  zIndex: 1,
                  elevation: 2,
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 8,
                  alignItems: 'center',
                  justifyContent: isMe ? 'flex-end' : 'flex-start',
                  paddingHorizontal: 2,
                }}
              >
                {reactionEntries.map(([emoji, users]) => {
                  const typedUsers = users.filter((uid): uid is string => typeof uid === 'string');
                  const reactedByMe = !!userUid && typedUsers.includes(userUid);
                  return (
                    <Pressable
                      key={`${msg.message_id}-${emoji}`}
                      onPress={() => onToggleReaction(msg.message_id, emoji)}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
                    >
                      <Text style={{ fontSize: 18, lineHeight: 22 }}>{emoji}</Text>
                      {typedUsers.length > 1 ? (
                        <Text
                          style={{
                            color: reactedByMe ? THEME_COLORS.gold : THEME_COLORS.text3,
                            fontFamily: 'Geist_600SemiBold',
                            fontSize: 12,
                          }}
                        >
                          {typedUsers.length}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}
        {reactionEntries.length > 0 && mediaAtts.length > 0 && !hasMessageBubble && (
          <View
            style={{
              marginTop: 8,
              maxWidth: BUBBLE_W,
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 10,
              alignItems: 'center',
              justifyContent: isMe ? 'flex-end' : 'flex-start',
            }}
          >
            {reactionEntries.map(([emoji, users]) => {
              const typedUsers = users.filter((uid): uid is string => typeof uid === 'string');
              const reactedByMe = !!userUid && typedUsers.includes(userUid);
              return (
                <Pressable
                  key={`${msg.message_id}-media-${emoji}`}
                  onPress={() => onToggleReaction(msg.message_id, emoji)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
                >
                  <Text style={{ fontSize: 18, lineHeight: 22 }}>{emoji}</Text>
                  {typedUsers.length > 1 ? (
                    <Text
                      style={{
                        color: reactedByMe ? THEME_COLORS.gold : THEME_COLORS.text3,
                        fontFamily: 'Geist_600SemiBold',
                        fontSize: 12,
                      }}
                    >
                      {typedUsers.length}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
        </View>
        {showTimestamp && (
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, marginTop: 3, marginHorizontal: 6 }}>
            {msg.timestamp
              ? dayjs(
                  typeof msg.timestamp === 'number'
                    ? msg.timestamp
                    : (msg.timestamp as { toMillis?: () => number })?.toMillis?.() ?? Date.now()
                ).format('h:mm A')
              : ''}
          </Text>
        )}
      </Animated.View>
    </Swipeable>
    </View>
  );
}

function PendingUploadChatBubble({
  item,
  userUid,
}: {
  item: PendingUploadBubble;
  userUid?: string;
}) {
  const isMe = !!userUid;
  const isImage = item.content_type.startsWith('image/');
  const isVideo = item.content_type.startsWith('video/');

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      style={{ marginBottom: 12, alignItems: isMe ? 'flex-end' : 'flex-start', opacity: item.status === 'failed' ? 0.72 : 1 }}
    >
      {(isImage || isVideo) && (
        <View
          style={{
            width: 264,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: THEME_COLORS.bg3,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.border,
            marginBottom: item.message ? 8 : 0,
          }}
        >
          {isVideo ? (
            <View style={{ position: 'relative' }}>
              <Video
                source={{ uri: item.local_uri ?? '' }}
                style={{ width: 264, height: 220, backgroundColor: '#111' }}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isLooping={false}
                isMuted
              />
              <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="play" size={18} color="#fff" />
                </View>
              </View>
            </View>
          ) : (
            <Image
              source={{ uri: item.local_uri ?? '' }}
              style={{ width: 264, aspectRatio: 4 / 3, backgroundColor: THEME_COLORS.bg3 }}
              contentFit="cover"
              accessibilityLabel={item.file_name}
            />
          )}
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_500Medium', fontSize: 12 }} numberOfLines={1}>
              {item.file_name}
            </Text>
            <Text
              style={{
                color: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.text3,
                fontFamily: 'Geist_500Medium',
                fontSize: 11,
                marginTop: 4,
              }}
            >
              {item.status === 'failed' ? 'Upload failed' : 'Uploading...'}
            </Text>
          </View>
        </View>
      )}
      {(!isImage && !isVideo) || item.message ? (
        <View
          style={{
            maxWidth: 264,
            backgroundColor: THEME_COLORS.bg2,
            borderRadius: 18,
            borderBottomRightRadius: isMe ? 4 : 18,
            borderBottomLeftRadius: isMe ? 18 : 4,
            overflow: 'hidden',
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.border,
          }}
        >
          <View style={{ padding: 12 }}>
            {!isImage && !isVideo && (
              <View
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: THEME_COLORS.bg3,
                  borderWidth: 1,
                  borderColor: THEME_COLORS.border,
                  marginBottom: item.message ? 10 : 0,
                }}
              >
                <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
                  File
                </Text>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                  {item.file_name}
                </Text>
              </View>
            )}
            {!!item.message && (
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22 }}>
                {item.message}
              </Text>
            )}
            {!(isImage || isVideo) && (
              <Text
                style={{
                  color: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.text3,
                  fontFamily: 'Geist_500Medium',
                  fontSize: 11,
                  marginTop: 8,
                }}
              >
                {item.status === 'failed' ? 'Upload failed' : 'Uploading...'}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

function UnreadDivider({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: THEME_COLORS.goldBorder }} />
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 999,
          backgroundColor: THEME_COLORS.goldDim,
          borderWidth: 1,
          borderColor: THEME_COLORS.goldBorder,
        }}
      >
        <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 11 }}>
          {count > 0 ? `${count} new message${count === 1 ? '' : 's'}` : 'New messages'}
        </Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: THEME_COLORS.goldBorder }} />
    </View>
  );
}

function JumpToLatestButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        right: 16,
        bottom: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: THEME_COLORS.text,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      <Text style={{ color: '#fff', fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>
        {count > 0 ? `${count} new` : 'Latest'}
      </Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>↓</Text>
    </Pressable>
  );
}

function MessageReactionPopover({
  visible,
  state,
  userUid,
  topInset,
  onClose,
  onReact,
}: {
  visible: boolean;
  state: ReactionPopoverState | null;
  userUid?: string;
  topInset: number;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
}) {
  if (!state) return null;

  const { width, height } = Dimensions.get('window');
  const pickerWidth = Math.min(width - 24, 320);
  const preferredLeft = state.align === 'right'
    ? state.anchorX - pickerWidth + 32
    : state.anchorX - 32;
  const left = Math.min(Math.max(12, preferredLeft), width - pickerWidth - 12);
  const top = state.anchorY > 98
    ? Math.max(topInset + 8, state.anchorY - 70)
    : Math.min(height - 82, state.anchorY + 18);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={{ flex: 1 }}
        onPress={onClose}
      >
        <View pointerEvents="box-none" style={{ flex: 1 }}>
          <Pressable
            onPress={() => {}}
            style={{
              position: 'absolute',
              top,
              left,
              width: pickerWidth,
              paddingHorizontal: 10,
              paddingVertical: 10,
              borderRadius: 18,
              backgroundColor: THEME_COLORS.bg,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
              shadowColor: '#000',
              shadowOpacity: 0.14,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 12,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 4, alignItems: 'center', paddingVertical: 2 }}
            >
              {REACTION_OPTIONS.map((emoji) => {
                const reactedByMe = !!userUid && (state.message.reactions?.[emoji] ?? []).includes(userUid);
                return (
                  <Pressable
                    key={`${state.message.message_id}-picker-${emoji}`}
                    onPress={() => {
                      onReact(state.message.message_id, emoji);
                      onClose();
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    style={{ paddingHorizontal: 6, paddingVertical: 4 }}
                  >
                    <Text
                      style={{
                        fontSize: 26,
                        lineHeight: 30,
                        opacity: reactedByMe ? 1 : 0.92,
                      }}
                    >
                      {emoji}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
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

function LiveSessionBanner({
  participantCount,
  onJoin,
  loading,
}: {
  participantCount: number;
  onJoin: () => void;
  loading: boolean;
}) {
  return (
    <Pressable
      onPress={onJoin}
      disabled={loading}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(52,211,153,0.08)',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(52,211,153,0.18)',
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 10,
      }}
    >
      <PulsingDot size={8} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#34d399', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13 }}>
          Live prayer session
        </Text>
        <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 }}>
          {participantCount > 0
            ? `${participantCount} ${participantCount === 1 ? 'person' : 'people'} praying now`
            : 'Tap to join'}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color="#34d399" />
      ) : (
        <View style={{
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: 10,
          backgroundColor: '#34d399',
        }}>
          <Text style={{ color: '#fff', fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>Join</Text>
        </View>
      )}
    </Pressable>
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
  const { members, isLoading: isLoadingMembers } = useGroupMembers(id!);
  const groupLiveRoom = useGroupLiveRoom(id!);
  const { messages, sendMessage, toggleReaction, deleteMessage } = useGroupChat(id!);
  const { markGroupChatRead, unreadCountByGroup } = useGroupUnread();
  const { reads } = useGroupChatLastReads();
  const [text, setText] = useState('');
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [replyTarget, setReplyTarget] = useState<GroupChatMessage | null>(null);
  const [reactionPopover, setReactionPopover] = useState<ReactionPopoverState | null>(null);
  const [showMembersSheet, setShowMembersSheet] = useState(false);
  const [optimisticReactions, setOptimisticReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [pendingUploads, setPendingUploads] = useState<PendingUploadBubble[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const messageLayoutMapRef = useRef<Record<string, number>>({});
  const fsMessageLayoutMapRef = useRef<Record<string, number>>({});

  const [liveRoomId, setLiveRoomId] = useState<string | null>(null);
  const [liveRoomCode, setLiveRoomCode] = useState<string | undefined>(undefined);
  const pendingJoinRef = useRef(false);
  const [avFullscreen, setAvFullscreen] = useState(false);
  const [startingLive, setStartingLive] = useState(false);
  const [fsChatOpen, setFsChatOpen] = useState(true);
  const [fsChatText, setFsChatText] = useState('');
  const [showAttachTray, setShowAttachTray] = useState<'main' | 'fs' | null>(null);
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [mediaActionBusy, setMediaActionBusy] = useState<'share' | 'save' | null>(null);
  const memberSyncRequestedRef = useRef(false);

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
  const pendingCount = pendingUploads.length;
  const lastReadAt = id ? reads[id] ?? 0 : 0;
  const unreadCount = id ? unreadCountByGroup[id] ?? 0 : 0;

  useEffect(() => {
    if (!id || isLoadingMembers || members.length === 0 || memberSyncRequestedRef.current) return;
    const needsSync = members.some((member) => {
      const name = member.display_name?.trim();
      return !name || name.toLowerCase() === 'unknown' || name === member.uid;
    });
    if (!needsSync) return;
    memberSyncRequestedRef.current = true;
    groupApi.syncMembers(id).catch(() => {
      memberSyncRequestedRef.current = false;
    });
  }, [id, isLoadingMembers, members]);

  const displayedMessages = useMemo(
    () =>
      messages.map((msg) => {
        const override = optimisticReactions[msg.message_id];
        return override ? { ...msg, reactions: override } : msg;
      }),
    [messages, optimisticReactions]
  );

  const firstUnreadIndex = useMemo(() => {
    if (!user?.uid) return -1;
    if (lastReadAt === 0) {
      return displayedMessages.findIndex((msg) => msg.user_id !== user.uid);
    }
    return displayedMessages.findIndex(
      (msg) => msg.user_id !== user.uid && firestoreTimestampMs(msg.timestamp) > lastReadAt
    );
  }, [displayedMessages, lastReadAt, user?.uid]);

  useEffect(() => {
    setOptimisticReactions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const message of messages) {
        const optimistic = prev[message.message_id];
        if (!optimistic) continue;
        const server = normalizeReactions(message.reactions);
        if (JSON.stringify(server) === JSON.stringify(optimistic)) {
          delete next[message.message_id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  const prevMessageLenRef = useRef(0);
  const prevGroupIdRef = useRef(id);
  /** True until the main list has been snapped to bottom once after open / group switch (content-size + layout). */
  const mainAnchorBottomPendingRef = useRef(true);
  /** True until fullscreen chat panel has snapped to bottom after the modal opens. */
  const fsAnchorBottomPendingRef = useRef(false);
  const mainAnchorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsAnchorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (prevGroupIdRef.current !== id) {
      prevGroupIdRef.current = id;
      prevMessageLenRef.current = 0;
      messageLayoutMapRef.current = {};
      fsMessageLayoutMapRef.current = {};
      mainAnchorBottomPendingRef.current = true;
      if (mainAnchorDebounceRef.current) {
        clearTimeout(mainAnchorDebounceRef.current);
        mainAnchorDebounceRef.current = null;
      }
      if (fsAnchorDebounceRef.current) {
        clearTimeout(fsAnchorDebounceRef.current);
        fsAnchorDebounceRef.current = null;
      }
    }
  }, [id]);

  useLayoutEffect(() => {
    if (!avFullscreen) {
      fsAnchorBottomPendingRef.current = false;
    } else {
      fsAnchorBottomPendingRef.current = true;
    }
  }, [avFullscreen]);

  function handleMainContentSizeChange(_w: number, h: number) {
    if (h <= 0 || !mainAnchorBottomPendingRef.current) return;
    scrollRef.current?.scrollToEnd({ animated: false });
    setIsNearBottom(true);
    if (mainAnchorDebounceRef.current) clearTimeout(mainAnchorDebounceRef.current);
    mainAnchorDebounceRef.current = setTimeout(() => {
      mainAnchorDebounceRef.current = null;
      if (!mainAnchorBottomPendingRef.current) return;
      scrollRef.current?.scrollToEnd({ animated: false });
      setIsNearBottom(true);
      mainAnchorBottomPendingRef.current = false;
    }, 180);
  }

  function handleFsContentSizeChange(_w: number, h: number) {
    if (h <= 0 || !fsAnchorBottomPendingRef.current) return;
    if (!avFullscreen || !fsChatOpen) return;
    fsScrollRef.current?.scrollToEnd({ animated: false });
    if (fsAnchorDebounceRef.current) clearTimeout(fsAnchorDebounceRef.current);
    fsAnchorDebounceRef.current = setTimeout(() => {
      fsAnchorDebounceRef.current = null;
      if (!fsAnchorBottomPendingRef.current) return;
      fsScrollRef.current?.scrollToEnd({ animated: false });
      fsAnchorBottomPendingRef.current = false;
    }, 180);
  }

  useLayoutEffect(() => {
    const len = displayedMessages.length;
    const prevLen = prevMessageLenRef.current;

    if (len === 0 && pendingCount === 0) {
      prevMessageLenRef.current = 0;
      mainAnchorBottomPendingRef.current = true;
      return;
    }

    if (mainAnchorBottomPendingRef.current && (len > 0 || pendingCount > 0)) {
      scrollRef.current?.scrollToEnd({ animated: false });
      setIsNearBottom(true);
    }

    if (len > prevLen && prevLen > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
      fsScrollRef.current?.scrollToEnd({ animated: false });
      setIsNearBottom(true);
    }

    prevMessageLenRef.current = len;
  }, [displayedMessages.length, pendingCount, id]);

  useLayoutEffect(() => {
    const len = displayedMessages.length;
    if (len === 0 && pendingCount === 0) return;
    if (fsAnchorBottomPendingRef.current && avFullscreen && fsChatOpen && (len > 0 || pendingCount > 0)) {
      fsScrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [displayedMessages.length, pendingCount, avFullscreen, fsChatOpen]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timeout = setTimeout(() => setHighlightedMessageId(null), 2200);
    return () => clearTimeout(timeout);
  }, [highlightedMessageId]);

  function scrollNearBottomFromEvent(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    return distanceFromBottom < 72;
  }

  function handleMainScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nearBottom = scrollNearBottomFromEvent(event);
    setIsNearBottom(nearBottom);

    if (nearBottom && mainAnchorBottomPendingRef.current) {
      if (mainAnchorDebounceRef.current) {
        clearTimeout(mainAnchorDebounceRef.current);
        mainAnchorDebounceRef.current = null;
      }
      mainAnchorBottomPendingRef.current = false;
    }

    if (nearBottom && id) {
      const last = displayedMessages[displayedMessages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      void markGroupChatRead(id, ts);
    }
  }

  function handleFsScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nearBottom = scrollNearBottomFromEvent(event);
    setIsNearBottom(nearBottom);

    if (nearBottom && fsAnchorBottomPendingRef.current) {
      if (fsAnchorDebounceRef.current) {
        clearTimeout(fsAnchorDebounceRef.current);
        fsAnchorDebounceRef.current = null;
      }
      fsAnchorBottomPendingRef.current = false;
    }

    if (nearBottom && id) {
      const last = displayedMessages[displayedMessages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      void markGroupChatRead(id, ts);
    }
  }

  function scrollToLatest() {
    scrollRef.current?.scrollToEnd({ animated: true });
    fsScrollRef.current?.scrollToEnd({ animated: true });
    setIsNearBottom(true);
    if (id) {
      const last = displayedMessages[displayedMessages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      void markGroupChatRead(id, ts);
    }
  }

  function registerMessageLayout(messageId: string, y: number, surface: ChatSurface) {
    if (surface === 'fs') fsMessageLayoutMapRef.current[messageId] = y;
    else messageLayoutMapRef.current[messageId] = y;
  }

  function jumpToMessage(messageId: string, surface: ChatSurface) {
    const layouts = surface === 'fs' ? fsMessageLayoutMapRef.current : messageLayoutMapRef.current;
    const y = layouts[messageId];
    if (typeof y !== 'number') return;
    const targetY = Math.max(0, y - 120);
    if (surface === 'fs') fsScrollRef.current?.scrollTo({ y: targetY, animated: true });
    else scrollRef.current?.scrollTo({ y: targetY, animated: true });
    setHighlightedMessageId(messageId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleSend() {
    if (!text.trim()) return;
    await sendMessage(text.trim(), 'text', {
      replyTo: replyTarget ? toReplyRef(replyTarget) : null,
    });
    setText('');
    setShowAttachTray(null);
    setReplyTarget(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleFsSend() {
    if (!fsChatText.trim()) return;
    await sendMessage(fsChatText.trim(), 'text', {
      replyTo: replyTarget ? toReplyRef(replyTarget) : null,
    });
    setFsChatText('');
    setShowAttachTray(null);
    setReplyTarget(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleOpenDocument(url: string, _fileName: string) {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
    } catch {
      Linking.openURL(url);
    }
  }

  async function handleShareMedia() {
    if (!viewerMedia) return;
    try {
      setMediaActionBusy('share');
      const localUri = await downloadAttachmentToCache({
        url: viewerMedia.url,
        file_name: viewerMedia.fileName,
        content_type: viewerMedia.contentType,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(localUri, {
          mimeType: viewerMedia.contentType,
          dialogTitle: 'Share media',
        });
      } else {
        await Share.share({ url: localUri, message: viewerMedia.fileName });
      }
    } catch {
      Alert.alert('Could not share file', 'Please try again.');
    } finally {
      setMediaActionBusy(null);
    }
  }

  async function handleSaveMedia() {
    if (!viewerMedia) return;
    try {
      setMediaActionBusy('save');
      const MediaLibrary = await getMediaLibraryModule();
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to save media to your device.');
        return;
      }
      const localUri = await downloadAttachmentToCache({
        url: viewerMedia.url,
        file_name: viewerMedia.fileName,
        content_type: viewerMedia.contentType,
      });
      await MediaLibrary.saveToLibraryAsync(localUri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Could not save file', 'Please try again.');
    } finally {
      setMediaActionBusy(null);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      await deleteMessage(messageId);
      if (replyTarget?.message_id === messageId) setReplyTarget(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Could not delete message. Please try again.');
    }
  }

  function requestDeleteMessage(messageId: string) {
    Alert.alert(
      'Delete Message',
      'This message will be permanently deleted for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void handleDeleteMessage(messageId); } },
      ],
    );
  }

  function handleReplyToMessage(message: GroupChatMessage) {
    setReplyTarget(message);
  }

  function handleOpenReactionPopover(
    message: GroupChatMessage,
    anchor: { x: number; y: number; align: 'left' | 'right' }
  ) {
    setReactionPopover({
      message,
      anchorX: anchor.x,
      anchorY: anchor.y,
      align: anchor.align,
    });
  }

  async function handleCopyMessage(message: GroupChatMessage) {
    const copyValue = (message.message ?? '').trim() || message.link_url?.trim() || buildReplyPreviewText(message);
    await Clipboard.setStringAsync(copyValue);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function handleToggleReaction(messageId: string, emoji: string) {
    const currentMessage = displayedMessages.find((msg) => msg.message_id === messageId);
    if (!currentMessage) return;
    const previous = normalizeReactions(currentMessage.reactions);
    const next = applyReactionMutation(previous, emoji, user?.uid);
    setOptimisticReactions((prev) => ({ ...prev, [messageId]: next }));

    try {
      await toggleReaction(messageId, emoji);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setOptimisticReactions((prev) => {
        const nextState = { ...prev };
        delete nextState[messageId];
        return nextState;
      });
      Alert.alert('Error', 'Could not update the reaction. Please try again.');
    }
  }

  function addPendingUpload(item: PendingUploadBubble) {
    setPendingUploads((prev) => [...prev, item]);
  }

  function updatePendingUpload(tempId: string, status: PendingUploadBubble['status']) {
    setPendingUploads((prev) =>
      prev.map((item) => (item.temp_id === tempId ? { ...item, status } : item))
    );
  }

  function removePendingUpload(tempId: string) {
    setPendingUploads((prev) => prev.filter((item) => item.temp_id !== tempId));
  }

  async function pickPhotoAndUpload(fromFs: boolean) {
    if (!id) return;
    const tempId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'image/jpeg';
      const caption = (fromFs ? fsChatText : text).trim();
      addPendingUpload({
        temp_id: tempId,
        user_name: user?.displayName ?? user?.email ?? 'You',
        user_photo: undefined,
        message: caption,
        local_uri: asset.uri,
        file_name: asset.fileName || `photo_${Date.now()}.jpg`,
        content_type: mime,
        status: 'uploading',
      });
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const name = asset.fileName || `photo_${Date.now()}.jpg`;
      const att = await uploadGroupChatFile(id, blob, mime, name);
      await sendMessage(caption, 'text', {
        attachments: [att],
        replyTo: replyTarget ? toReplyRef(replyTarget) : null,
      });
      if (fromFs) { setFsChatText(''); } else { setText(''); }
      setShowAttachTray(null);
      setReplyTarget(null);
      removePendingUpload(tempId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      updatePendingUpload(tempId, 'failed');
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
    }
  }

  async function takePhotoAndUpload(fromFs: boolean) {
    if (!id) return;
    const tempId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access in Settings.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'image/jpeg';
      const caption = (fromFs ? fsChatText : text).trim();
      addPendingUpload({
        temp_id: tempId,
        user_name: user?.displayName ?? user?.email ?? 'You',
        user_photo: undefined,
        message: caption,
        local_uri: asset.uri,
        file_name: asset.fileName || `photo_${Date.now()}.jpg`,
        content_type: mime,
        status: 'uploading',
      });
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const name = asset.fileName || `photo_${Date.now()}.jpg`;
      const att = await uploadGroupChatFile(id, blob, mime, name);
      await sendMessage(caption, 'text', {
        attachments: [att],
        replyTo: replyTarget ? toReplyRef(replyTarget) : null,
      });
      if (fromFs) { setFsChatText(''); } else { setText(''); }
      setShowAttachTray(null);
      setReplyTarget(null);
      removePendingUpload(tempId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      updatePendingUpload(tempId, 'failed');
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
    }
  }

  async function pickVideoAndUpload(fromFs: boolean) {
    if (!id) return;
    const tempId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 0.8,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'video/mp4';
      const caption = (fromFs ? fsChatText : text).trim();
      addPendingUpload({
        temp_id: tempId,
        user_name: user?.displayName ?? user?.email ?? 'You',
        user_photo: undefined,
        message: caption,
        local_uri: asset.uri,
        file_name: asset.fileName || `video_${Date.now()}.mp4`,
        content_type: mime,
        status: 'uploading',
      });
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const name = asset.fileName || `video_${Date.now()}.mp4`;
      const att = await uploadGroupChatFile(id, blob, mime, name);
      await sendMessage(caption, 'text', {
        attachments: [att],
        replyTo: replyTarget ? toReplyRef(replyTarget) : null,
      });
      if (fromFs) { setFsChatText(''); } else { setText(''); }
      setShowAttachTray(null);
      setReplyTarget(null);
      removePendingUpload(tempId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      updatePendingUpload(tempId, 'failed');
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
    }
  }

  async function pickDocumentAndUpload(fromFs: boolean) {
    if (!id) return;
    const tempId = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
               'application/vnd.ms-excel',
               'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
               'text/plain'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || 'application/octet-stream';
      const caption = (fromFs ? fsChatText : text).trim();
      addPendingUpload({
        temp_id: tempId,
        user_name: user?.displayName ?? user?.email ?? 'You',
        user_photo: undefined,
        message: caption,
        file_name: asset.name || 'document',
        content_type: mime,
        status: 'uploading',
      });
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const att = await uploadGroupChatFile(id, blob, mime, asset.name || 'document');
      await sendMessage(caption, 'text', {
        attachments: [att],
        replyTo: replyTarget ? toReplyRef(replyTarget) : null,
      });
      if (fromFs) { setFsChatText(''); } else { setText(''); }
      setShowAttachTray(null);
      setReplyTarget(null);
      removePendingUpload(tempId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      updatePendingUpload(tempId, 'failed');
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
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

  function renderChatItems(surface: ChatSurface) {
    const nodes: React.ReactNode[] = [];

    displayedMessages.forEach((msg, idx) => {
      const prev = displayedMessages[idx - 1];
      const next = displayedMessages[idx + 1];
      const showSender = !sameSenderCluster(msg, prev);
      const showTimestamp = !sameSenderCluster(msg, next);

      if (idx === firstUnreadIndex) {
        nodes.push(<UnreadDivider key={`${surface}-unread-divider`} count={unreadCount} />);
      }

      nodes.push(
        <GroupChatBubble
          key={`${surface}-${msg.message_id}`}
          msg={msg}
          surface={surface}
          userUid={user?.uid}
          showSender={showSender}
          showTimestamp={showTimestamp}
          highlighted={highlightedMessageId === msg.message_id}
          onOpenMedia={(attachment) =>
            setViewerMedia({
              url: attachment.url,
              contentType: attachment.content_type,
              fileName: attachment.file_name,
            })
          }
          onOpenDoc={handleOpenDocument}
          onReply={handleReplyToMessage}
          onToggleReaction={handleToggleReaction}
          onOpenReactions={handleOpenReactionPopover}
          onCopyMessage={(message) => { void handleCopyMessage(message); }}
          onDeleteMessage={requestDeleteMessage}
          onJumpToReply={jumpToMessage}
          onLayoutMessage={registerMessageLayout}
        />
      );
    });

    pendingUploads.forEach((item) => {
      nodes.push(
        <PendingUploadChatBubble
          key={`${surface}-${item.temp_id}`}
          item={item}
          userUid={user?.uid}
        />
      );
    });

    return nodes;
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

        <Pressable style={{ flex: 1 }} onPress={() => setShowMembersSheet(true)}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }} numberOfLines={1}>
            {group?.name ?? 'Group Chat'}
          </Text>
          {group && (
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 1 }}>
              {group.member_count} {group.member_count === 1 ? 'member' : 'members'}
            </Text>
          )}
        </Pressable>

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

      {/* Live-session banner: visible when a room exists but user hasn't joined yet */}
      {groupLiveRoom && !prayer.isJoined && !avFullscreen ? (
        <LiveSessionBanner
          participantCount={groupLiveRoom.participants?.length ?? 0}
          onJoin={onLiveHeaderPress}
          loading={startingLive}
        />
      ) : null}

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
        contentContainerStyle={{ padding: 16, paddingBottom: 8, overflow: 'visible' as const }}
        showsVerticalScrollIndicator={false}
        onScroll={handleMainScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleMainContentSizeChange}
      >
        {renderChatItems('main')}
      </ScrollView>
      {!isNearBottom && <JumpToLatestButton count={unreadCount} onPress={scrollToLatest} />}

      {/* Invite sheet */}
      {showInviteSheet && group && (
        <InviteSheet group={group} onClose={() => setShowInviteSheet(false)} />
      )}

      <GroupMembersSheet
        visible={showMembersSheet}
        groupName={group?.name ?? 'Group members'}
        members={members}
        loading={isLoadingMembers}
        onClose={() => setShowMembersSheet(false)}
      />

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
            <View style={{ flex: fsChatOpen ? 2 : 1 }}>
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
                  contentContainerStyle={{ padding: 16, paddingBottom: 8, overflow: 'visible' as const }}
                  showsVerticalScrollIndicator={false}
                  onScroll={handleFsScroll}
                  scrollEventThrottle={16}
                  onContentSizeChange={handleFsContentSizeChange}
                >
                  {renderChatItems('fs')}
                </ScrollView>
                {!isNearBottom && <JumpToLatestButton count={unreadCount} onPress={scrollToLatest} />}
                <View style={{ borderTopWidth: 1, borderTopColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.bg }}>
                  {showAttachTray === 'fs' && (
                    <AttachmentTray
                      onPickPhoto={() => { void pickPhotoAndUpload(true); }}
                      onTakePhoto={() => { void takePhotoAndUpload(true); }}
                      onPickVideo={() => { void pickVideoAndUpload(true); }}
                      onPickDocument={() => { void pickDocumentAndUpload(true); }}
                    />
                  )}
                  {replyTarget && <ReplyComposerBanner target={replyTarget} onCancel={() => setReplyTarget(null)} />}
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    paddingBottom: insets.bottom + 12,
                    gap: 8,
                    backgroundColor: THEME_COLORS.bg,
                  }}>
                    <Pressable
                      onPress={() => setShowAttachTray((current) => (current === 'fs' ? null : 'fs'))}
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
                      placeholder={replyTarget ? `Reply to ${replyTarget.user_name}…` : 'Message the group…'}
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
                      disabled={!fsChatText.trim()}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: fsChatText.trim() ? THEME_COLORS.gold : THEME_COLORS.bg3,
                      }}
                    >
                      <Icon name="send" size={14} color={fsChatText.trim() ? '#ffffff' : THEME_COLORS.text3} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Input bar */}
      <View style={{
        borderTopWidth: 1,
        borderTopColor: THEME_COLORS.border,
        backgroundColor: THEME_COLORS.bg,
      }}>
        {showAttachTray === 'main' && (
          <AttachmentTray
            onPickPhoto={() => { void pickPhotoAndUpload(false); }}
            onTakePhoto={() => { void takePhotoAndUpload(false); }}
            onPickVideo={() => { void pickVideoAndUpload(false); }}
            onPickDocument={() => { void pickDocumentAndUpload(false); }}
          />
        )}
        {replyTarget && <ReplyComposerBanner target={replyTarget} onCancel={() => setReplyTarget(null)} />}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          padding: 12, paddingBottom: insets.bottom + 8, gap: 8,
          backgroundColor: THEME_COLORS.bg,
        }}>
          <Pressable
            onPress={() => setShowAttachTray((current) => (current === 'main' ? null : 'main'))}
            style={{
              width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
              backgroundColor: THEME_COLORS.bg3,
              borderColor: THEME_COLORS.border,
            }}
          >
            <Icon name="plus" size={16} color={THEME_COLORS.text2} />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={replyTarget ? `Reply to ${replyTarget.user_name}…` : 'Message the group…'}
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
            disabled={!text.trim()}
            style={{
              width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
              backgroundColor: text.trim() ? THEME_COLORS.gold : THEME_COLORS.bg3,
            }}
          >
            <Icon name="send" size={14} color={text.trim() ? '#ffffff' : THEME_COLORS.text3} />
          </Pressable>
        </View>
      </View>

      <MessageReactionPopover
        visible={!!reactionPopover}
        state={reactionPopover}
        userUid={user?.uid}
        topInset={insets.top}
        onClose={() => setReactionPopover(null)}
        onReact={handleToggleReaction}
      />

      {/* Fullscreen media viewer */}
      <Modal
        visible={!!viewerMedia}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerMedia(null)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}>
          <Pressable
            onPress={() => setViewerMedia(null)}
            style={{
              position: 'absolute', top: insets.top + 8, right: 16, zIndex: 10,
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Close image"
          >
            <Icon name="cross" size={14} color="#fff" />
          </Pressable>
          {viewerMedia && (
            viewerMedia.contentType.startsWith('video/') ? (
              <Video
                source={{ uri: viewerMedia.url }}
                style={{
                  width: Dimensions.get('window').width,
                  height: Dimensions.get('window').height * 0.72,
                  backgroundColor: '#000',
                }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
              />
            ) : (
              <Image
                source={{ uri: viewerMedia.url }}
                style={{
                  width: Dimensions.get('window').width,
                  height: Dimensions.get('window').height * 0.75,
                }}
                contentFit="contain"
                accessibilityLabel="Full-size image"
              />
            )
          )}
          <View
            style={{
              position: 'absolute',
              bottom: insets.bottom + 24,
              flexDirection: 'row',
              gap: 12,
            }}
          >
            <Pressable
              onPress={() => { void handleShareMedia(); }}
              disabled={mediaActionBusy !== null}
              style={{
                paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24,
                backgroundColor: 'rgba(255,255,255,0.12)',
                flexDirection: 'row', alignItems: 'center', gap: 8,
                opacity: mediaActionBusy && mediaActionBusy !== 'share' ? 0.7 : 1,
              }}
            >
              {mediaActionBusy === 'share' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="share" size={16} color="#fff" />
              )}
              <Text style={{ color: '#fff', fontFamily: 'Geist_500Medium', fontSize: 14 }}>Share file</Text>
            </Pressable>
            <Pressable
              onPress={() => { void handleSaveMedia(); }}
              disabled={mediaActionBusy !== null}
              style={{
                paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24,
                backgroundColor: 'rgba(255,255,255,0.12)',
                flexDirection: 'row', alignItems: 'center', gap: 8,
                opacity: mediaActionBusy && mediaActionBusy !== 'save' ? 0.7 : 1,
              }}
            >
              {mediaActionBusy === 'save' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="download" size={16} color="#fff" />
              )}
              <Text style={{ color: '#fff', fontFamily: 'Geist_500Medium', fontSize: 14 }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}
