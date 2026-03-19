export const API_BASE_URL = 'https://divinebridge.io';
export const SFU_URL = 'wss://sfu.divinebridge.io/ws';

export const ROOM_MODES = {
  GROUP_CALL: 'group_call',   // ≤8 participants, full audio+video mesh
  PRAYER_ROOM: 'prayer_room', // >8 or public room, audio mesh + spotlight video
} as const;

export const GROUP_CALL_MAX_PARTICIPANTS = 8;
export const PRAYER_ROOM_MAX_SPEAKERS = 20;
export const ACTIVE_SPEAKER_MAX_CONNECTIONS = 5; // max peer connections per listener

export const COLLECTIONS = {
  USERS: 'users',
  PRAYER_ROOMS: 'prayer_rooms',
  SCHEDULED_ROOMS: 'scheduled_rooms',
  SCHEDULED_ROOM_RSVPS: 'scheduled_room_rsvps',
  CHAT_MESSAGES: 'chat_messages',
  PRAYER_REQUESTS: 'prayer_requests',
  TESTIMONIES: 'testimonies',
  PRAYER_GROUPS: 'prayer_groups',
  GROUP_MEMBERS: 'group_members',
  GROUP_CHAT_MESSAGES: 'group_chat_messages',
  DEVOTIONAL_PLANS: 'devotional_plans',
} as const;

export const MESSAGE_TYPES = {
  TEXT: 'text',
  PRAYER_REQUEST: 'prayer_request',
  SCRIPTURE: 'scripture',
  PRAISE: 'praise',
  ANNOUNCEMENT: 'announcement',
} as const;

export const DEVOTIONAL_DURATIONS = [7, 14, 30] as const;

export const THEME_COLORS = {
  // Warm cream backgrounds
  bg: '#faf6ef',
  bg2: '#ffffff',
  bg3: '#f0ebe2',
  surface: '#e8e2d8',

  // Gold accents
  gold: '#b07d20',
  gold2: '#c99230',
  goldDim: 'rgba(176,125,32,0.12)',
  goldDim2: 'rgba(176,125,32,0.06)',
  goldBorder: 'rgba(176,125,32,0.25)',

  // Semantic accents
  sage: '#4a7c5e',
  sageDim: 'rgba(74,124,94,0.12)',
  rose: '#b05a50',
  violet: '#7040b8',
  violetDim: 'rgba(112,64,184,0.1)',

  // Text
  text: '#2c2417',
  text2: '#6b5c48',
  text3: '#9e8e78',

  // Borders
  border: 'rgba(44,36,23,0.10)',
  border2: 'rgba(176,125,32,0.25)',

  // Backward-compatible aliases (mapped to warm equivalents)
  navy950: '#faf6ef',
  navy900: '#faf6ef',
  navy800: '#f0ebe2',
  navy700: '#e8e2d8',
  amber500: '#b07d20',
  amber300: '#c99230',
  textPrimary: '#2c2417',
  textSecondary: '#6b5c48',
  textMuted: '#9e8e78',
  online: '#4a7c5e',
  speaking: '#b07d20',
  error: '#b05a50',
} as const;
