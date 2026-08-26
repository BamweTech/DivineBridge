import { useRef, useMemo } from 'react';
import { View, Text, Pressable, Animated as RNAnimated } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import * as Haptics from 'expo-haptics';
import dayjs from 'dayjs';
import type { ChatSurface } from '@/features/groups/components/groupChatUtils';
import {
  BUBBLE_W,
  chatPreviewUrl,
  isVisualAttachment,
  stripMatchingPreviewUrl,
  TYPE_BORDER_COLORS,
  TYPE_COLORS,
  TYPE_LABEL_COLORS,
} from '@/features/groups/components/groupChatUtils';
import { MediaAttachmentCard } from '@/features/groups/components/MediaAttachmentCard';
import { AudioMessageBubble } from '@/features/groups/components/AudioMessageBubble';
import { LinkPreviewCard } from '@/features/groups/components/LinkPreviewCard';
import { Avatar } from '@/components/ui/Avatar';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import type { GroupChatAttachment, GroupChatMessage } from '@/types';

export function GroupChatBubble({
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
  onOpenMedia: (attachment: GroupChatAttachment, sourceMessage: GroupChatMessage) => void;
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

  const previewUrl = useMemo(
    () => chatPreviewUrl(msg.link_url, msg.message ?? ''),
    [msg.link_url, msg.message],
  );
  const displayMessage = useMemo(() => {
    const raw = msg.message ?? '';
    if (!previewUrl) return raw;
    return stripMatchingPreviewUrl(raw, previewUrl);
  }, [msg.message, previewUrl]);
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
  const showText = displayMessage.trim().length > 0;
  const mediaAtts = attachments.filter(isVisualAttachment);
  const audioAtts = attachments.filter((a) => a.content_type.startsWith('audio/'));
  const docAtts = attachments.filter((a) => !isVisualAttachment(a) && !a.content_type.startsWith('audio/'));
  const reactionEntries = Object.entries(msg.reactions ?? {}).filter(
    ([emoji, users]) => emoji && Array.isArray(users) && users.length > 0,
  );
  const hasMessageBubble =
    showText || docAtts.length > 0 || !!msg.reply_to || isSpecial;

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
            <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('600'), fontSize: 12 }}>
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
            <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 12 }}>
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
              <Text style={{ color: THEME_COLORS.rose, ...iosFontStyle('600'), fontSize: 12 }}>
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
      <View
        style={{ marginBottom: showTimestamp ? 12 : 4, alignItems: isMe ? 'flex-end' : 'flex-start' }}
      >
        {!isMe && showSender && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, marginLeft: 4 }}>
            <Avatar name={msg.user_name} photoUrl={msg.user_photo} size={20} />
            <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('500'), fontSize: 11 }}>{msg.user_name}</Text>
          </View>
        )}
        <View style={{ position: 'relative', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
        {mediaAtts.length > 0 && (
          <Pressable onLongPress={handleLongPress} delayLongPress={400}>
            <View style={{ gap: 8, marginBottom: hasMessageBubble || audioAtts.length > 0 || previewUrl ? 8 : 0 }}>
              {mediaAtts.map((a, idx) => (
                <MediaAttachmentCard
                  key={`${msg.message_id}-media-${idx}`}
                  attachment={a}
                  onOpen={(att) => onOpenMedia(att, msg)}
                />
              ))}
            </View>
          </Pressable>
        )}
        {audioAtts.length > 0 && (
          <View style={{ gap: 6, marginBottom: hasMessageBubble || previewUrl ? 8 : 0 }}>
            {audioAtts.map((a: GroupChatAttachment, idx: number) => (
              <AudioMessageBubble
                key={`${msg.message_id}-audio-${idx}`}
                uri={a.url}
                isMe={isMe}
              />
            ))}
          </View>
        )}
        {!!previewUrl && (
          <Pressable
            onLongPress={handleLongPress}
            delayLongPress={400}
            style={{
              maxWidth: BUBBLE_W,
              alignSelf: isMe ? 'flex-end' : 'flex-start',
              marginBottom: hasMessageBubble ? 8 : 0,
            }}
          >
            <LinkPreviewCard url={previewUrl} />
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
                    <Text style={{ fontSize: 10, marginBottom: 4, color: TYPE_LABEL_COLORS[msg.message_type], ...iosFontStyle('600'), letterSpacing: 0.8, textTransform: 'uppercase' }}>
                      {msg.message_type.replace('_', ' ')}
                    </Text>
                  )}
                  {msg.reply_to && (
                    <Pressable
                      onPress={() => onJumpToReply(msg.reply_to!.message_id, surface)}
                      style={{
                        marginBottom: showText || previewUrl || docAtts.length > 0 ? 10 : 0,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        backgroundColor: isMe ? 'rgba(255,255,255,0.48)' : THEME_COLORS.bg3,
                        borderLeftWidth: 3,
                        borderLeftColor: TYPE_LABEL_COLORS[msg.message_type] || THEME_COLORS.gold,
                      }}
                    >
                      <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 11 }}>
                        {msg.reply_to.user_name}
                      </Text>
                      <Text numberOfLines={2} style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>
                        {msg.reply_to.message}
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
                        <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('600'), fontSize: 12 }}>
                          {a.file_name?.toLowerCase().endsWith('.pdf') ? 'PDF' : 'File'}
                        </Text>
                        <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                          {a.file_name}
                        </Text>
                        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('500'), fontSize: 11, marginTop: 6 }}>Tap to open</Text>
                      </View>
                    </Pressable>
                  ))}
                  {showText ? (
                    <LinkifiedText
                      style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 14, lineHeight: 22 }}
                      linkStyle={{ color: THEME_COLORS.gold }}
                    >
                      {displayMessage}
                    </LinkifiedText>
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
                            ...iosFontStyle('600'),
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
        {reactionEntries.length > 0 && !hasMessageBubble && (mediaAtts.length > 0 || !!previewUrl) && (
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
                        ...iosFontStyle('600'),
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
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 10, marginTop: 3, marginHorizontal: 6 }}>
            {msg.timestamp
              ? dayjs(
                  typeof msg.timestamp === 'number'
                    ? msg.timestamp
                    : (msg.timestamp as { toMillis?: () => number })?.toMillis?.() ?? Date.now()
                ).format('h:mm A')
              : ''}
          </Text>
        )}
      </View>
    </Swipeable>
    </View>
  );
}
