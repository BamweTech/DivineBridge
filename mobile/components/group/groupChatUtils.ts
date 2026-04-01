import { THEME_COLORS } from '@/lib/constants';
import { firestoreTimestampMs } from '@/hooks/useGroups';
import type {
  MessageType,
  GroupChatMessage,
  GroupChatAttachment,
  GroupChatReplyRef,
} from '@/types';
import * as FileSystem from 'expo-file-system/legacy';

export type PendingUploadBubble = {
  temp_id: string;
  user_name: string;
  user_photo?: string | null;
  message: string;
  local_uri?: string;
  file_name: string;
  content_type: string;
  status: 'uploading' | 'failed';
};

export type ViewerMedia = {
  url: string;
  contentType: string;
  fileName: string;
};

export type ReactionPopoverState = {
  message: GroupChatMessage;
  anchorX: number;
  anchorY: number;
  align: 'left' | 'right';
};

export type ChatListItem =
  | { key: string; kind: 'unread'; count: number }
  | { key: string; kind: 'date'; label: string }
  | {
      key: string;
      kind: 'message';
      msg: GroupChatMessage;
      showSender: boolean;
      showTimestamp: boolean;
    }
  | { key: string; kind: 'pending'; item: PendingUploadBubble };

export const TYPE_COLORS: Record<MessageType, string> = {
  text: 'transparent',
  prayer_request: THEME_COLORS.violetDim,
  scripture: THEME_COLORS.goldDim2,
  praise: THEME_COLORS.sageDim,
  announcement: 'rgba(59,130,246,0.08)',
  system_notification: 'rgba(176,90,80,0.08)',
};

export const TYPE_BORDER_COLORS: Record<MessageType, string> = {
  text: 'transparent',
  prayer_request: 'rgba(112,64,184,0.18)',
  scripture: THEME_COLORS.goldBorder,
  praise: 'rgba(74,124,94,0.22)',
  announcement: 'rgba(59,130,246,0.2)',
  system_notification: 'rgba(176,90,80,0.2)',
};

export const TYPE_LABEL_COLORS: Record<MessageType, string> = {
  text: THEME_COLORS.text3,
  prayer_request: THEME_COLORS.violet,
  scripture: THEME_COLORS.gold,
  praise: THEME_COLORS.sage,
  announcement: '#3b82f6',
  system_notification: THEME_COLORS.rose,
};

export const REACTION_OPTIONS = ['🙏', '❤️', '🙌', '🔥', '😢', '✨'] as const;

export type ChatSurface = 'main' | 'fs';

export const BUBBLE_W = 264;

export function buildReplyPreviewText(msg: Pick<GroupChatMessage, 'message' | 'link_url' | 'attachments' | 'message_type'>) {
  const body = (msg.message ?? '').trim().replace(/\s+/g, ' ');
  if (body) return body;

  if (msg.link_url?.trim()) return msg.link_url.trim();

  const attachments = msg.attachments ?? [];
  if (attachments.length > 0) {
    const imageCount = attachments.filter((a) => a.content_type.startsWith('image/')).length;
    const videoCount = attachments.filter((a) => a.content_type.startsWith('video/')).length;
    const audioCount = attachments.filter((a) => a.content_type.startsWith('audio/')).length;
    if (imageCount === attachments.length) return imageCount === 1 ? 'Photo' : `${imageCount} photos`;
    if (videoCount === attachments.length) return videoCount === 1 ? 'Video' : `${videoCount} videos`;
    if (audioCount === attachments.length) return audioCount === 1 ? 'Voice message' : `${audioCount} voice messages`;
    return attachments.length === 1 ? `File: ${attachments[0].file_name}` : `${attachments.length} attachments`;
  }

  if (msg.message_type === 'prayer_request') return 'Prayer request';
  if (msg.message_type === 'scripture') return 'Scripture';
  if (msg.message_type === 'praise') return 'Praise report';
  return 'Message';
}

export function normalizeReactions(reactions?: Record<string, string[]>) {
  const next: Record<string, string[]> = {};
  for (const [emoji, users] of Object.entries(reactions ?? {})) {
    if (!emoji || !Array.isArray(users)) continue;
    const filtered = users.filter((uid): uid is string => typeof uid === 'string');
    if (filtered.length > 0) next[emoji] = filtered;
  }
  return next;
}

export function applyReactionMutation(
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

export function sameSenderCluster(
  current: GroupChatMessage,
  adjacent?: GroupChatMessage,
) {
  if (!adjacent) return false;
  if (current.user_id !== adjacent.user_id) return false;
  const currentTs = firestoreTimestampMs(current.timestamp);
  const adjacentTs = firestoreTimestampMs(adjacent.timestamp);
  return Math.abs(currentTs - adjacentTs) < 5 * 60 * 1000;
}

export function isVisualAttachment(att: GroupChatAttachment) {
  return att.content_type.startsWith('image/') || att.content_type.startsWith('video/');
}

export function fileExtensionFromAttachment(att: Pick<GroupChatAttachment, 'file_name' | 'content_type'>) {
  const fromName = (att.file_name.split('.').pop() || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (fromName) return fromName;
  if (att.content_type.startsWith('image/')) return att.content_type.split('/')[1] || 'jpg';
  if (att.content_type.startsWith('video/')) return att.content_type.split('/')[1] || 'mp4';
  return 'bin';
}

export async function downloadAttachmentToCache(att: Pick<GroupChatAttachment, 'url' | 'file_name' | 'content_type'>) {
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

export async function getMediaLibraryModule() {
  try {
    return await import('expo-media-library');
  } catch {
    throw new Error('Media saving needs the latest app build. Please update the app and try again.');
  }
}

export function toReplyRef(msg: GroupChatMessage): GroupChatReplyRef {
  return {
    message_id: msg.message_id,
    user_id: msg.user_id,
    user_name: msg.user_name,
    message: buildReplyPreviewText(msg),
  };
}
