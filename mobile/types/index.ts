import { ROOM_MODES, MESSAGE_TYPES } from '@/lib/constants';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  /** @deprecated Prefer firstName + lastName from server profile; kept for legacy mobile docs */
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  photoURL?: string;
  bio?: string;
  phone?: string;
  linkedIn?: string;
  /** Mirrors Firestore `email_subscribed` (daily email). */
  emailSubscribed?: boolean;
  /** Local daily reminder (Firestore + scheduled local notification). */
  notifyDailyVerse?: boolean;
  /** Preference for future session reminder push/in-app (Firestore). */
  sessionRemindersEnabled?: boolean;
  /** Devotional daily reminder (Firestore + scheduled local notification). */
  notifyDevotional?: boolean;
  createdAt?: number;
  groups?: string[];
}

// ─── Prayer Rooms ─────────────────────────────────────────────────────────────

export type RoomMode = typeof ROOM_MODES[keyof typeof ROOM_MODES];
export type ParticipantRole = 'speaker' | 'listener';

export interface Participant {
  user_id: string;
  user_name: string;
  joined_at: number;
  is_muted: boolean;
  is_host: boolean;
  role: ParticipantRole;
  requested_role: ParticipantRole | null;
}

export interface PrayerRoom {
  room_id: string;
  room_name: string;
  room_privacy: 'public' | 'private';
  /** When set, only members of this prayer group can join without a room code. */
  group_id?: string;
  room_code?: string;
  host_id: string;
  host_name: string;
  created_at: number;
  participants: Participant[];
  is_active: boolean;
  is_locked: boolean;
  max_speakers: number;
  settings: {
    allow_anonymous: boolean;
    max_participants: number;
    auto_mute_new_participants: boolean;
  };
  // derived client-side
  mode?: RoomMode;
}

// ─── Scheduled Sessions ────────────────────────────────────────────────────────

export type RsvpStatus = 'going' | 'maybe' | 'interested';
export type RecurrencePattern = 'weekly' | 'biweekly' | 'monthly';

export interface ScheduledSession {
  scheduled_room_id: string;
  room_name: string;
  room_description?: string;
  host_name: string;
  host_id: string;
  room_privacy: 'public' | 'private';
  scheduled_time: number;
  is_recurring: boolean;
  recurrence_pattern?: RecurrencePattern;
  status: 'scheduled' | 'active' | 'ended';
  active_room_id?: string;
  rsvp_count: { going: number; maybe: number; interested: number };
  total_rsvps: number;
  user_rsvp_status: RsvpStatus | null;
}

// ─── Chat Messages ─────────────────────────────────────────────────────────────

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

export interface ChatMessage {
  message_id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  message: string;
  message_type: MessageType;
  timestamp: number;
  reactions?: Record<string, string[]>; // emoji → [uid, ...]
  is_prayer_request?: boolean;
}

// ─── Prayer Groups ─────────────────────────────────────────────────────────────

export type GroupRole = 'admin' | 'member';
export type GroupPrivacy = 'public' | 'private' | 'invite_only';

export interface PrayerGroup {
  group_id: string;
  name: string;
  description?: string;
  cover_image?: string;
  privacy: GroupPrivacy;
  member_count: number;
  created_by: string;
  created_at: number;
  member_ids?: string[];
  invite_code?: string;
}

export interface GroupMember {
  uid: string;
  display_name: string;
  photo_url?: string;
  role: GroupRole;
  joined_at: number;
}

export interface GroupChatAttachment {
  url: string;
  content_type: string;
  file_name: string;
  size_bytes?: number;
  /** Pixel dimensions captured at upload time for instant layout. */
  width?: number;
  height?: number;
}

export interface GroupChatReplyRef {
  message_id: string;
  user_id: string;
  user_name: string;
  message: string;
}

export interface GroupChatMessage {
  message_id: string;
  group_id: string;
  user_id: string;
  user_name: string;
  user_photo?: string;
  message: string;
  message_type: MessageType;
  /** Optional https URL shared with the message */
  link_url?: string;
  /** Files uploaded to Firebase Storage (see storage.rules) */
  attachments?: GroupChatAttachment[];
  /** Lightweight quoted reference used to render reply previews without refetching. */
  reply_to?: GroupChatReplyRef | null;
  timestamp: number;
  reactions?: Record<string, string[]>;
  read_by?: string[];
}

// ─── Daily Content ─────────────────────────────────────────────────────────────

export interface DailyPrayer {
  content: string;
  date: string;
  created_at: string;
  metadata?: {
    disasters?: string[];
    topics?: string[];
    affected_regions?: string[];
  };
  likes_count?: number;
  user_liked?: boolean;
}

export interface DailyVerse {
  verse: string;
  reference: string;
  date: string;
  likes_count?: number;
  user_liked?: boolean;
}

// ─── Devotional Plans ─────────────────────────────────────────────────────────

export interface DevotionalDay {
  day: number;
  title: string;
  scripture: string;
  scripture_reference: string;
  reflection: string;
  prayer: string;
  completed: boolean;
  completed_at?: number;
  journal?: string;
}

export interface DevotionalPlan {
  plan_id: string;
  uid: string;
  title: string;
  theme: string;
  duration: 7 | 14 | 30;
  created_at: number;
  days: DevotionalDay[];
  current_day: number;
  streak: number;
  last_completed_at?: number;
  completed_at?: number;
}

// ─── WebRTC Signaling ─────────────────────────────────────────────────────────

export interface SignalingOffer {
  from_user: string;
  to_user: string;
  offer: RTCSessionDescriptionInit;
  timestamp: number;
}

export interface SignalingAnswer {
  from_user: string;
  to_user: string;
  answer: RTCSessionDescriptionInit;
  timestamp: number;
}

export interface SignalingCandidate {
  from_user: string;
  to_user: string;
  candidate: RTCIceCandidateInit;
  timestamp: number;
}
