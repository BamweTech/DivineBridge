import { auth } from '@/lib/firebase';
import { API_BASE_URL } from '@/lib/constants';

function localClientDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getAuthHeaders(forceRefresh = false): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) return { 'Content-Type': 'application/json' };
  const token = await user.getIdToken(forceRefresh);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  async function doFetch(forceRefresh: boolean): Promise<Response> {
    const headers = await getAuthHeaders(forceRefresh);
    return fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers ?? {}) },
    });
  }

  let res = await doFetch(false);
  if (res.status === 401 && auth.currentUser) {
    res = await doFetch(true);
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    }
  }
  if (!res.ok) {
    let msg =
      (typeof json.error === 'string' && json.error) ||
      (typeof json.message === 'string' && json.message) ||
      `HTTP ${res.status}`;
    if (typeof json.reason === 'string' && json.reason.trim()) {
      msg = msg.includes(json.reason) ? msg : `${msg}\n${json.reason}`;
    }
    throw new Error(msg);
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
  getInteractions: (date: string) =>
    request<any>(`/api/today-verse/${date}/interactions`),
  share: (date: string) =>
    request<any>(`/api/today-verse/${date}/share`, {
      method: 'POST',
      body: JSON.stringify({ platform: 'mobile' }),
    }),
};

// ─── Prayer Rooms ─────────────────────────────────────────────────────────────

export const roomApi = {
  list: () => request<any>('/api/prayer-room/rooms'),
  create: (name: string, privacy: 'public' | 'private') =>
    request<any>('/api/prayer-room/create', {
      method: 'POST',
      body: JSON.stringify({ room_name: name, room_privacy: privacy }),
    }),
  /** Active or new private room bound to a prayer group (members join without a code). */
  ensureGroupSession: (groupId: string) =>
    request<{ success: boolean; room_id: string; room_name: string; room_code?: string | null; reused?: boolean }>(
      '/api/prayer-room/group-session',
      { method: 'POST', body: JSON.stringify({ group_id: groupId }) }
    ),
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
  syncMembers: (groupId: string) =>
    request<any>(`/api/groups/${groupId}/members/sync`, {
      method: 'POST',
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
  /** Authenticated: track "I prayed" on a Global Watch card (same metrics as Prayer Wall). */
  pray: (prayerId: string) =>
    request<{ message: string; reference: string }>('/api/prayer/global-watch/pray', {
      method: 'POST',
      body: JSON.stringify({ prayer_id: prayerId }),
    }),
};

// ─── Prayer Requests ─────────────────────────────────────────────────────────

export const prayerRequestApi = {
  /** Authenticated: Prayer Wall tap metrics for home (rolling 7 days + wall streak). */
  getHomePrayerMetrics: () =>
    request<{ wall_pray_last_7_days: number; wall_pray_streak_days: number }>(
      '/api/prayer/my/home-prayer-metrics'
    ),
  list: () =>
    request<any>(
      `/api/prayer/prayers?client_date=${encodeURIComponent(localClientDateYmd())}`
    ),
  /** Backend validates `content` (min 10, max 2000); title is derived server-side. */
  submit: (content: string, isAnonymous?: boolean) =>
    request<any>('/api/prayer/request', {
      method: 'POST',
      body: JSON.stringify({
        content,
        is_anonymous: isAnonymous ?? false,
      }),
    }),
  pray: (requestId: string) =>
    request<any>(`/api/prayer/request/${requestId}/pray`, { method: 'POST' }),
};

// ─── Profile (business card fields; same contract as web profile) ────────────

export const profileApi = {
  getBusinessCard: () =>
    request<{
      firstName: string;
      lastName: string;
      email: string;
      phoneNumber: string;
      linkedin: string;
      businessCardEnabled: boolean;
    }>('/api/auth/profile/business-card'),
  updateBusinessCard: (body: {
    phoneNumber?: string;
    linkedin?: string;
    businessCardEnabled?: boolean;
  }) =>
    request<{ message: string }>('/api/auth/profile/business-card', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ─── Email preferences ───────────────────────────────────────────────────────

export const emailPrefsApi = {
  subscriptionStatus: () =>
    request<{ subscribed: boolean }>('/api/email/subscription-status'),
  subscribeDaily: () =>
    request<{ subscribed: boolean }>('/api/email/subscribe-daily', {
      method: 'POST',
    }),
  unsubscribeDaily: () =>
    request<{ subscribed: boolean }>('/api/email/unsubscribe-daily', {
      method: 'POST',
    }),
};
