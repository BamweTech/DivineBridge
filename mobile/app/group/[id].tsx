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
  Modal,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import dayjs from 'dayjs';
import { useGroupChat, useGroupDetails } from '@/hooks/useGroups';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS, MESSAGE_TYPES } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { MessageType, PrayerGroup } from '@/types';

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
};

const TYPE_BORDER_COLORS: Record<MessageType, string> = {
  text: 'transparent',
  prayer_request: 'rgba(112,64,184,0.18)',
  scripture: THEME_COLORS.goldBorder,
  praise: 'rgba(74,124,94,0.22)',
  announcement: 'rgba(59,130,246,0.2)',
};

const TYPE_LABEL_COLORS: Record<MessageType, string> = {
  text: THEME_COLORS.text3,
  prayer_request: THEME_COLORS.violet,
  scripture: THEME_COLORS.gold,
  praise: THEME_COLORS.sage,
  announcement: '#3b82f6',
};

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

  const { group } = useGroupDetails(id!);
  const { messages, isLoading, sendMessage } = useGroupChat(id!);
  const [text, setText] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  async function handleSend() {
    if (!text.trim()) return;
    await sendMessage(text.trim(), messageType);
    setText('');
    setMessageType('text');
    setShowTypePicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
            onPress={() => router.push('/(tabs)/rooms' as any)}
            style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: THEME_COLORS.sageDim, borderWidth: 1, borderColor: 'rgba(74,124,94,0.2)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="live" size={16} color={THEME_COLORS.sage} />
          </Pressable>
          <Pressable
            onPress={() => setShowInviteSheet(true)}
            style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="more" size={16} color={THEME_COLORS.text2} />
          </Pressable>
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg, i) => {
          const isMe = msg.user_id === user?.uid;
          const isSpecial = msg.message_type !== 'text';
          const bg = isSpecial ? TYPE_COLORS[msg.message_type] : isMe ? THEME_COLORS.goldDim : THEME_COLORS.bg2;
          const borderColor = isSpecial ? TYPE_BORDER_COLORS[msg.message_type] : isMe ? THEME_COLORS.goldBorder : THEME_COLORS.border;

          return (
            <Animated.View
              key={msg.message_id}
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
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22 }}>
                  {msg.message}
                </Text>
              </View>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10, marginTop: 3, marginHorizontal: 6 }}>
                {msg.timestamp
                  ? dayjs(
                      typeof msg.timestamp === 'number'
                        ? msg.timestamp
                        : (msg.timestamp as any)?.toMillis?.() ?? Date.now()
                    ).format('h:mm A')
                  : ''}
              </Text>
            </Animated.View>
          );
        })}
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

      {/* Input bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        padding: 12, paddingBottom: insets.bottom + 8, gap: 8,
        borderTopWidth: showTypePicker ? 0 : 1, borderTopColor: THEME_COLORS.border,
        backgroundColor: THEME_COLORS.bg,
      }}>
        {/* Pray / attach buttons */}
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
          disabled={!text.trim()}
          style={{
            width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            backgroundColor: text.trim() ? THEME_COLORS.gold : THEME_COLORS.bg3,
          }}
        >
          <Icon name="send" size={14} color={text.trim() ? '#ffffff' : THEME_COLORS.text3} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
