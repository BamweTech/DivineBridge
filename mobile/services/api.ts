import { auth } from '@/lib/firebase';
import { API_BASE_URL } from '@/lib/constants';

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) return { 'Content-Type': 'application/json' };
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error ?? json.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

// ─── Daily Content ─────────────────────────────────────────────────────────────

export const prayerApi = {
  getToday: (date: string) =>
    request<any>(`/api/prayer/prayer/${date}`),
  like: (date: string) =>
    request<any>(`/api/prayer/daily-prayer/${date}/like`, { method: 'POST' }),
  unlike: (date: string) =>
    request<any>(`/api/prayer/daily-prayer/${date}/like`, { method: 'DELETE' }),
  getInteractions: (date: string) =>
    request<any>(`/api/prayer/daily-prayer/${date}/interactions`),
  share: (date: string) =>
    request<any>(`/api/prayer/daily-prayer/${date}/share`, { method: 'POST' }),
};

export const verseApi = {
  getToday: (date: string) =>
    request<any>(`/api/today-verse?client_date=${encodeURIComponent(date)}`),
  like: (date: string) =>
    request<any>(`/api/today-verse/${date}/like`, { method: 'POST' }),
  unlike: (date: string) =>
    request<any>(`/api/today-verse/${date}/like`, { method: 'DELETE' }),
};

// ─── Prayer Rooms ─────────────────────────────────────────────────────────────

export const roomApi = {
  list: () => request<any>('/api/prayer-room/rooms'),
  create: (name: string, privacy: 'public' | 'private') =>
    request<any>('/api/prayer-room/create', {
      method: 'POST',
      body: JSON.stringify({ room_name: name, room_privacy: privacy }),
    }),
  join: (roomId: string, code?: string) =>
    request<any>(`/api/prayer-room/join/${roomId}`, {
      method: 'POST',
      body: JSON.stringify({ room_code: code }),
    }),
  get: (roomId: string) =>
    request<any>(`/api/prayer-room/room/${roomId}`),
  end: (roomId: string) =>
    request<any>(`/api/prayer-room/end/${roomId}`, { method: 'POST' }),
  leave: (roomId: string) =>
    request<any>(`/api/prayer-room/leave/${roomId}`, { method: 'POST' }),
  mute: (roomId: string, userId: string, muted: boolean) =>
    request<any>(`/api/prayer-room/${roomId}/mute`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, muted }),
    }),
  selfMute: (roomId: string, muted: boolean) =>
    request<any>(`/api/prayer-room/${roomId}/self-mute`, {
      method: 'POST',
      body: JSON.stringify({ muted }),
    }),
  iceConfig: () => request<any>('/api/prayer-room/ice-config'),
  sfuToken: (roomId: string) =>
    request<{ customToken: string; sfuUrl: string }>(`/api/prayer-room/sfu-token/${roomId}`, { method: 'POST' }),
  sendChat: (roomId: string, message: string) =>
    request<any>(`/api/prayer-room/${roomId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};

// ─── Scheduled Sessions ────────────────────────────────────────────────────────

export const scheduledApi = {
  list: (params?: { time?: string; sort?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return request<any>(`/api/prayer-room/public-scheduled-sessions${qs ? `?${qs}` : ''}`);
  },
  schedule: (data: any) =>
    request<any>('/api/prayer-room/schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  rsvp: (sessionId: string, status: string, prefs: any) =>
    request<any>(`/api/prayer-room/scheduled-session/${sessionId}/rsvp`, {
      method: 'POST',
      body: JSON.stringify({ rsvp_status: status, ...prefs }),
    }),
  removeRsvp: (sessionId: string) =>
    request<any>(`/api/prayer-room/scheduled-session/${sessionId}/rsvp`, {
      method: 'DELETE',
    }),
  myRooms: () => request<any>('/api/prayer-room/my-scheduled-rooms'),
};

// ─── Prayer Groups ─────────────────────────────────────────────────────────────

export const groupApi = {
  list: () => request<any>('/api/groups'),
  create: (data: any) =>
    request<any>('/api/groups', { method: 'POST', body: JSON.stringify(data) }),
  get: (groupId: string) => request<any>(`/api/groups/${groupId}`),
  join: (groupId: string, code?: string) =>
    request<any>(`/api/groups/${groupId}/join`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  leave: (groupId: string) =>
    request<any>(`/api/groups/${groupId}/leave`, { method: 'POST' }),
  myGroups: () => request<any>('/api/groups/my'),
  joinByCode: (code: string) =>
    request<any>('/api/groups/join-by-code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

// ─── Devotional Plans ─────────────────────────────────────────────────────────

export const devotionalApi = {
  generate: (theme: string, duration: number, tradition?: string) =>
    request<any>('/api/devotional/generate', {
      method: 'POST',
      body: JSON.stringify({ theme, duration, tradition }),
    }),
  checkIn: (planId: string, day: number) =>
    request<any>(`/api/devotional/${planId}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ day }),
    }),
};

// ─── Global Prayer Watch ─────────────────────────────────────────────────────

export const globalWatchApi = {
  /** Returns active disaster prayers from the Global Prayer Watch system. */
  list: () => request<any>('/api/prayer/global-watch'),
};

// ─── Prayer Requests ─────────────────────────────────────────────────────────

export const prayerRequestApi = {
  list: () => request<any>('/api/prayer/prayers'),
  // Backend validates `title` (min 5, max 200) and `content` (min 10, max 2000).
  // We auto-generate `title` from the first 60 chars of the prayer so the UX
  // stays single-field (like X / Threads).
  submit: (content: string, isAnonymous?: boolean) =>
    request<any>('/api/prayer/request', {
      method: 'POST',
      body: JSON.stringify({
        title: content.substring(0, 60).trim() || 'Prayer',
        content,
        is_anonymous: isAnonymous ?? false,
      }),
    }),
  pray: (requestId: string) =>
    request<any>(`/api/prayer/request/${requestId}/pray`, { method: 'POST' }),
};
