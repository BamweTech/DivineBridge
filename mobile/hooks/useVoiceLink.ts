import { useEffect, useRef, useState, useCallback } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { COLLECTIONS, SFU_URL } from '@/lib/constants';
import { SfuEngine } from '@/lib/sfu';
import type { PeerEntry } from '@/lib/sfu';
import { voiceLinkApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { getDisplayName } from '@/lib/userDisplayName';
import type { PrayerRoom, Participant } from '@/types';
import {
  setLiveRoomAudioRoute,
  resetLiveRoomAudio,
  type LiveRoomAudioRoute,
} from '@/lib/liveRoomAudio';
import { startCallKeepAlive, stopCallKeepAlive } from '@/lib/callKeepAlive';

export function useVoiceLink(roomId: string, roomCode?: string) {
  const { user, profile } = useAuthStore();
  const engineRef = useRef<SfuEngine | null>(null);
  const endHandledRef = useRef(false);

  const [room, setRoom] = useState<PrayerRoom | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerEntry>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [audioOutputRoute, setAudioOutputRouteState] = useState<LiveRoomAudioRoute>('speaker');
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const audioOutputRouteRef = useRef<LiveRoomAudioRoute>('speaker');

  useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, COLLECTIONS.PRAYER_ROOMS, roomId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Omit<PrayerRoom, 'room_id'>;
      setRoom({ room_id: roomId, ...data });
    });
    return unsub;
  }, [roomId]);

  const join = useCallback(async () => {
    if (!user || !roomId || !roomCode) {
      setJoinError('Missing call code.');
      return;
    }
    setJoinError(null);
    try {
      await voiceLinkApi.join(roomId, roomCode);
      const resp = await voiceLinkApi.sfuToken(roomId);
      const userCred = await signInWithCustomToken(auth, resp.customToken);
      const token = await userCred.user.getIdToken();

      const engine = new SfuEngine({
        roomId,
        userId: user.uid,
        userName: getDisplayName(profile, user),
        isSpeaker: true,
        sfuUrl: SFU_URL,
        token,
      });
      engine.onPeersChanged = (p) => setPeers(new Map(p));
      await engine.start({ videoEnabled: false });

      engineRef.current = engine;
      audioOutputRouteRef.current = 'speaker';
      setAudioOutputRouteState('speaker');
      await setLiveRoomAudioRoute('speaker');
      setIsJoined(true);
      void startCallKeepAlive('Voice call');
    } catch (err: any) {
      console.error('[voice-link] join failed:', err);
      setJoinError(err?.message || 'Could not join the call.');
      throw err;
    }
  }, [roomId, roomCode, user, profile]);

  const leave = useCallback(async () => {
    engineRef.current?.destroy();
    engineRef.current = null;
    setIsJoined(false);
    await stopCallKeepAlive();
    await resetLiveRoomAudio();
    await voiceLinkApi.leave(roomId).catch(() => null);
  }, [roomId]);

  const endCall = useCallback(async (reason: 'user' | 'timeout' = 'user') => {
    if (endHandledRef.current) return;
    endHandledRef.current = true;
    try {
      await voiceLinkApi.end(roomId, reason);
    } catch (e) {
      console.warn('[voice-link] end failed', e);
    }
    await leave();
  }, [roomId, leave]);

  const toggleMute = useCallback(() => {
    if (!roomId || !engineRef.current) return;
    engineRef.current.setAudioEnabled(isMuted);
    setIsMuted((v) => !v);
    voiceLinkApi.selfMute(roomId, !isMuted).catch(() => null);
  }, [isMuted, roomId]);

  const toggleAudioOutput = useCallback(async () => {
    const next = audioOutputRouteRef.current === 'speaker' ? 'earpiece' : 'speaker';
    audioOutputRouteRef.current = next;
    setAudioOutputRouteState(next);
    await setLiveRoomAudioRoute(next);
  }, []);

  const activePeerCount = room?.participants?.filter((p: Participant) => p.is_active !== false).length ?? 0;
  const isConnected = activePeerCount >= 2;

  useEffect(() => {
    if (!room?.expires_at) return;
    let expiresMs: number | null = null;
    const raw = room.expires_at as unknown;
    if (typeof raw === 'number') {
      expiresMs = raw;
    } else if (typeof raw === 'string') {
      expiresMs = Date.parse(raw);
    } else if (raw && typeof raw === 'object' && 'toMillis' in raw && typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
      expiresMs = (raw as { toMillis: () => number }).toMillis();
    }
    if (!expiresMs || !Number.isFinite(expiresMs)) return;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0 && isJoined) {
        void endCall('timeout');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [room?.expires_at, isJoined, endCall]);

  useEffect(() => {
    if (!room || !isJoined || room.is_active !== false || endHandledRef.current) return;
    endHandledRef.current = true;
    void (async () => {
      await leave();
    })();
  }, [room?.is_active, isJoined, leave]);

  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
      void stopCallKeepAlive();
      resetLiveRoomAudio().catch(() => null);
    };
  }, []);

  return {
    room,
    peers,
    isMuted,
    isJoined,
    joinError,
    audioOutputRoute,
    secondsRemaining,
    activePeerCount,
    isConnected,
    join,
    leave,
    endCall,
    toggleMute,
    toggleAudioOutput,
  };
}
