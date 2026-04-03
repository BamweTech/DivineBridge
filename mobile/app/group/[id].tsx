import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
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
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
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
import { GroupMembersSheet } from '@/components/group/GroupMembersSheet';
import { VoiceRecorder } from '@/components/group/VoiceRecorder';
import { ReplyComposerBanner } from '@/components/group/ReplyComposerBanner';
import { AttachmentTray } from '@/components/group/AttachmentTray';
import { DateDivider, UnreadDivider } from '@/components/group/ChatDividers';
import { GroupChatBubble } from '@/components/group/GroupChatBubble';
import { PendingUploadChatBubble } from '@/components/group/PendingUploadChatBubble';
import { MessageReactionPopover } from '@/components/group/MessageReactionPopover';
import { InviteSheet } from '@/components/group/InviteSheet';
import { JumpToLatestButton } from '@/components/group/JumpToLatestButton';
import {
  applyReactionMutation,
  buildReplyPreviewText,
  type ChatListItem,
  type ChatSurface,
  downloadAttachmentToCache,
  getMediaLibraryModule,
  normalizeReactions,
  type PendingUploadBubble,
  type ReactionPopoverState,
  sameSenderCluster,
  toReplyRef,
  type ViewerMedia,
} from '@/components/group/groupChatUtils';
import { PulsingDot } from '@/components/ui/PulsingDot';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { PrayerGroup, GroupChatMessage, GroupChatReplyRef } from '@/types';

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
  const scrollRef = useRef<FlatList<ChatListItem>>(null);
  const fsScrollRef = useRef<FlatList<ChatListItem>>(null);

  const { group } = useGroupDetails(id!);
  const { members, isLoading: isLoadingMembers } = useGroupMembers(id!);
  const groupLiveRoom = useGroupLiveRoom(id!);
  const { messages, isLoading: isLoadingChat, sendMessage, toggleReaction, deleteMessage } = useGroupChat(id!);
  const { markGroupChatRead, unreadCountByGroup } = useGroupUnread();
  const { reads, isReadsReady } = useGroupChatLastReads();
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
  const [voiceRecordingSurface, setVoiceRecordingSurface] = useState<'main' | 'fs' | null>(null);
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

  const currentMember = useMemo(
    () => (user?.uid ? members.find((m) => m.uid === user.uid) : undefined),
    [members, user?.uid],
  );
  const memberJoinedAt = currentMember?.joined_at ?? 0;
  const lastReadSeededRef = useRef(false);

  useEffect(() => {
    if (!id || !user?.uid || lastReadSeededRef.current) return;
    if (lastReadAt > 0) {
      lastReadSeededRef.current = true;
      return;
    }
    if (isLoadingMembers || memberJoinedAt === 0) return;
    lastReadSeededRef.current = true;
    void markGroupChatRead(id, memberJoinedAt);
  }, [id, user?.uid, lastReadAt, isLoadingMembers, memberJoinedAt, markGroupChatRead]);

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

  const displayedMessages = useMemo(() => {
    const isRecentJoiner = memberJoinedAt > 0 && (Date.now() - memberJoinedAt < 300_000);
    const effectiveJoinedAt =
      isReadsReady && lastReadAt === 0 && isRecentJoiner ? memberJoinedAt : 0;

    return messages
      .filter((msg) =>
        effectiveJoinedAt === 0 || firestoreTimestampMs(msg.timestamp) >= effectiveJoinedAt
      )
      .map((msg) => {
        const override = optimisticReactions[msg.message_id];
        return override ? { ...msg, reactions: override } : msg;
      });
  }, [messages, optimisticReactions, lastReadAt, memberJoinedAt, isReadsReady]);

  const firstUnreadIndex = useMemo(() => {
    if (!user?.uid) return -1;
    if (lastReadAt === 0) {
      return -1;
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

  const prevMessageIdsRef = useRef<Set<string>>(new Set());
  const prevGroupIdRef = useRef(id);

  useEffect(() => {
    if (prevGroupIdRef.current !== id) {
      prevGroupIdRef.current = id;
      prevMessageIdsRef.current = new Set();
      messageLayoutMapRef.current = {};
      fsMessageLayoutMapRef.current = {};
    }
  }, [id]);

  useEffect(() => {
    const currentIds = new Set(displayedMessages.map((m) => m.message_id));
    const prevIds = prevMessageIdsRef.current;

    if (currentIds.size === 0 && pendingCount === 0) {
      prevMessageIdsRef.current = currentIds;
      return;
    }

    const hasGenuinelyNewMessages =
      prevIds.size > 0 &&
      displayedMessages.some((m) => !prevIds.has(m.message_id));

    if (hasGenuinelyNewMessages && isNearBottom) {
      scrollRef.current?.scrollToOffset({ offset: 0, animated: false });
      fsScrollRef.current?.scrollToOffset({ offset: 0, animated: false });
    }

    prevMessageIdsRef.current = currentIds;
  }, [displayedMessages, pendingCount, id, isNearBottom]);

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timeout = setTimeout(() => setHighlightedMessageId(null), 2200);
    return () => clearTimeout(timeout);
  }, [highlightedMessageId]);

  function handleMainScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset } = event.nativeEvent;
    const nearBottom = contentOffset.y < 72;
    setIsNearBottom(nearBottom);

    if (nearBottom && id) {
      const last = displayedMessages[displayedMessages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      void markGroupChatRead(id, ts);
    }
  }

  function handleFsScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset } = event.nativeEvent;
    const nearBottom = contentOffset.y < 72;
    setIsNearBottom(nearBottom);

    if (nearBottom && id) {
      const last = displayedMessages[displayedMessages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      void markGroupChatRead(id, ts);
    }
  }

  function scrollToLatest() {
    scrollRef.current?.scrollToOffset({ offset: 0, animated: true });
    fsScrollRef.current?.scrollToOffset({ offset: 0, animated: true });
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
    if (surface === 'fs') fsScrollRef.current?.scrollToOffset({ offset: targetY, animated: true });
    else scrollRef.current?.scrollToOffset({ offset: targetY, animated: true });
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
      if (asset.width && asset.height) { att.width = asset.width; att.height = asset.height; }
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
      if (asset.width && asset.height) { att.width = asset.width; att.height = asset.height; }
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

  const handleVoiceSend = useCallback(async (uri: string, _durationMs: number) => {
    if (!id || !user) return;
    const tempId = `voice-${Date.now()}`;
    const name = `voice_${Date.now()}.m4a`;
    const mime = 'audio/mp4';
    try {
      addPendingUpload({
        temp_id: tempId,
        user_name: user.displayName ?? user.email ?? 'You',
        user_photo: undefined,
        message: '',
        local_uri: uri,
        file_name: name,
        content_type: mime,
        status: 'uploading',
      });
      const res = await fetch(uri);
      const blob = await res.blob();
      const att = await uploadGroupChatFile(id, blob, mime, name);
      await sendMessage('', 'text', {
        attachments: [att],
        replyTo: replyTarget ? toReplyRef(replyTarget) : null,
      });
      setReplyTarget(null);
      removePendingUpload(tempId);
    } catch (e) {
      updatePendingUpload(tempId, 'failed');
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again.');
    }
  }, [id, user, sendMessage, replyTarget]);

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

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = [];
    let lastDateKey = '';

    displayedMessages.forEach((msg, idx) => {
      const prev = displayedMessages[idx - 1];
      const next = displayedMessages[idx + 1];
      const showSender = !sameSenderCluster(msg, prev);
      const showTimestamp = !sameSenderCluster(msg, next);

      const msgMs = firestoreTimestampMs(msg.timestamp);
      const msgDate = new Date(msgMs);
      const dateKey = `${msgDate.getFullYear()}-${String(msgDate.getMonth() + 1).padStart(2, '0')}-${String(msgDate.getDate()).padStart(2, '0')}`;

      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        let label: string;
        if (dateKey === todayKey) label = 'Today';
        else if (dateKey === yesterdayKey) label = 'Yesterday';
        else label = msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: msgDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });

        items.push({ key: `date-${dateKey}`, kind: 'date', label });
      }

      if (idx === firstUnreadIndex) {
        items.push({
          key: 'unread-divider',
          kind: 'unread',
          count: unreadCount,
        });
      }

      items.push({
        key: msg.message_id,
        kind: 'message',
        msg,
        showSender,
        showTimestamp,
      });
    });

    pendingUploads.forEach((item) => {
      items.push({
        key: `pending-${item.temp_id}`,
        kind: 'pending',
        item,
      });
    });

    return items;
  }, [displayedMessages, firstUnreadIndex, unreadCount, pendingUploads]);

  const invertedChatItems = useMemo(() => [...chatItems].reverse(), [chatItems]);

  const didMarkReadOnMountRef = useRef(false);
  useEffect(() => {
    if (didMarkReadOnMountRef.current || !id || displayedMessages.length === 0) return;
    if (firstUnreadIndex < 0) {
      didMarkReadOnMountRef.current = true;
      const last = displayedMessages[displayedMessages.length - 1];
      const ts = last ? firestoreTimestampMs(last.timestamp) : undefined;
      if (ts) void markGroupChatRead(id, ts);
    }
  }, [id, displayedMessages, firstUnreadIndex, markGroupChatRead]);

  const chatEmptyComponent = useMemo(() => (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: THEME_COLORS.bg, transform: [{ scaleY: -1 }] }}>
      <Icon name="gathering" size={48} color={THEME_COLORS.text3} />
      <Text style={{
        color: THEME_COLORS.text2,
        fontFamily: 'Geist_500Medium',
        fontSize: 15,
        marginTop: 16,
        textAlign: 'center',
      }}>
        {memberJoinedAt > 0 && lastReadAt === 0
          ? 'You just joined! Start the conversation.'
          : 'No messages yet. Say something!'}
      </Text>
    </View>
  ), [memberJoinedAt, lastReadAt]);

  function renderChatItem(item: ChatListItem, surface: ChatSurface) {
    if (item.kind === 'date') {
      return <DateDivider label={item.label} />;
    }
    if (item.kind === 'unread') {
      return <UnreadDivider count={item.count} />;
    }
    if (item.kind === 'pending') {
      return <PendingUploadChatBubble item={item.item} userUid={user?.uid} />;
    }
    return (
      <GroupChatBubble
        msg={item.msg}
        surface={surface}
        userUid={user?.uid}
        showSender={item.showSender}
        showTimestamp={item.showTimestamp}
        highlighted={highlightedMessageId === item.msg.message_id}
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
              <Icon name="gathering" size={16} color={THEME_COLORS.sage} />
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
      <FlatList
        key={`main-${id}`}
        ref={scrollRef}
        data={invertedChatItems}
        inverted
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => renderChatItem(item, 'main')}
        style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
        contentContainerStyle={invertedChatItems.length === 0 ? { flexGrow: 1 } : { padding: 16, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        onScroll={handleMainScroll}
        scrollEventThrottle={16}
        ListEmptyComponent={chatEmptyComponent}
      />
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
                <FlatList
                  key={`fs-${id}-${fsChatOpen ? 'open' : 'closed'}`}
                  ref={fsScrollRef}
                  data={invertedChatItems}
                  inverted
                  keyExtractor={(item) => item.key}
                  renderItem={({ item }) => renderChatItem(item, 'fs')}
                  style={{ flex: 1 }}
                  contentContainerStyle={invertedChatItems.length === 0 ? { flexGrow: 1 } : { padding: 16, paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                  onScroll={handleFsScroll}
                  scrollEventThrottle={16}
                  ListEmptyComponent={chatEmptyComponent}
                />
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
                    {voiceRecordingSurface === 'fs' ? (
                      <VoiceRecorder onSend={handleVoiceSend} />
                    ) : (
                      <>
                        <Pressable
                          onPress={() => setShowAttachTray((current) => (current === 'fs' ? null : 'fs'))}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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
                        />
                        {fsChatText.trim() ? (
                          <Pressable
                            onPress={handleFsSend}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: THEME_COLORS.gold,
                            }}
                          >
                            <Icon name="send" size={14} color="#ffffff" />
                          </Pressable>
                        ) : (
                          <VoiceRecorder onSend={handleVoiceSend} />
                        )}
                      </>
                    )}
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
          {voiceRecordingSurface === 'main' ? (
            <VoiceRecorder onSend={handleVoiceSend} />
          ) : (
            <>
              <Pressable
                onPress={() => setShowAttachTray((current) => (current === 'main' ? null : 'main'))}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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
              />
              {text.trim() ? (
                <Pressable
                  onPress={handleSend}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={{
                    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: THEME_COLORS.gold,
                  }}
                >
                  <Icon name="send" size={14} color="#ffffff" />
                </Pressable>
              ) : (
                <VoiceRecorder onSend={handleVoiceSend} />
              )}
            </>
          )}
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
