import { useEffect, useRef, useState, useCallback } from 'react';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { ref, query as rtdbQuery, limitToLast, onChildAdded, off } from 'firebase/database';
import { db, auth, rtdb } from '@/lib/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { COLLECTIONS, ROOM_MODES } from '@/lib/constants';
import { SfuEngine } from '@/lib/sfu';
import type { PeerEntry } from '@/lib/sfu';
import { roomApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { PrayerRoom, ChatMessage, RoomMode, Participant } from '@/types';

// ── Dev override ──────────────────────────────────────────────────────────────
// When __DEV__ is true (all local/simulator builds), skip the Flask sfuToken
// call and connect directly to the SFU running on your Mac.
// The iOS simulator routes `localhost` to the Mac, so no tunnel needed.
// Set DEV_SFU_URL to undefined to fall through to the real Flask flow.
// In dev builds, override the SFU address returned by Flask so the simulator
// and a real device both hit the same production SFU.
// Auth always goes through Flask → Firebase regardless of this override.
// Set to undefined to use whatever Flask returns (production default).
const DEV_SFU_URL = __DEV__ ? 'ws://34.75.185.102:3000/ws' : undefined;

export function usePrayerRoom(roomId: string) {
  const { user, profile } = useAuthStore();
  const engineRef = useRef<SfuEngine | null>(null);

  const [room, setRoom] = useState<PrayerRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peers, setPeers] = useState<Map<string, PeerEntry>>(new Map());
  const [localStream, setLocalStream] = useState<any>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [roomMode, setRoomMode] = useState<RoomMode>(ROOM_MODES.GROUP_CALL);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [modeSwitchToast, setModeSwitchToast] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);

  // ── Watch room document ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, COLLECTIONS.PRAYER_ROOMS, roomId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Omit<PrayerRoom, 'room_id'>;
      const updatedRoom: PrayerRoom = { room_id: roomId, ...data };
      setRoom(updatedRoom);

      // Let the SFU engine know participant count changed (drives mode transitions)
      if (engineRef.current) {
        const count = updatedRoom.participants?.length ?? 0;
        engineRef.current.updateParticipantCount(count);
      }
    });
    return unsub;
  }, [roomId]);

  // ── Watch chat messages via RTDB (real-time delivery, low-latency) ──────────
  useEffect(() => {
    if (!roomId) return;
    setMessages([]);
    const chatRef = rtdbQuery(ref(rtdb, `/rooms/${roomId}/chat`), limitToLast(100));
    const handler = onChildAdded(chatRef, (snap) => {
      const val = snap.val();
      if (!val) return;
      const msg: ChatMessage = {
        message_id: val.message_id ?? snap.key ?? '',
        room_id: roomId,
        user_id: val.user_id,
        user_name: val.user_name,
        message: val.message,
        timestamp: val.timestamp,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.message_id === msg.message_id)) return prev;
        return [...prev, msg];
      });
    });
    return () => off(chatRef, 'child_added', handler);
  }, [roomId]);

  // ── Join room ────────────────────────────────────────────────────────────────
  const join = useCallback(async (code?: string) => {
    if (!user || !profile || !roomId) return;
    try {
      // 1. Join room on Flask backend (updates Firestore participants)
      const result = await roomApi.join(roomId, code);
      const isSpeaker =
        result.participants?.find((p: Participant) => p.user_id === user.uid)?.role === 'speaker';

      // 2. Get Firebase custom token from Flask, exchange for an ID token.
      //    In dev builds, override the SFU URL so simulator + real device
      //    both hit the same production SFU (auth is always real Firebase).
      const resp = await roomApi.sfuToken(roomId);
      const sfuUrl = DEV_SFU_URL ?? resp.sfuUrl;
      if (DEV_SFU_URL) {
        console.log('[room] DEV — overriding SFU URL to', sfuUrl);
      }
      await signInWithCustomToken(auth, resp.customToken);
      const token = await auth.currentUser!.getIdToken();

      // 3. Boot SFU engine
      const engine = new SfuEngine({
        roomId,
        userId: user.uid,
        userName: profile.displayName,
        isSpeaker,
        sfuUrl,
        token,
      });

      engine.onPeersChanged = (p) => setPeers(new Map(p));
      engine.onModeChanged = (mode) => {
        setRoomMode(mode);
        const toast =
          mode === ROOM_MODES.PRAYER_ROOM
            ? 'Switched to Prayer Room mode for better performance'
            : 'Switched to Group Call mode';
        setModeSwitchToast(toast);
        setTimeout(() => setModeSwitchToast(null), 3500);
      };
      engine.onActiveSpeakersChanged = setActiveSpeakers;

      await engine.start({ videoEnabled: false });

      engineRef.current = engine;
      setLocalStream(engine.getLocalStream());
      setRoomMode(engine.getCurrentMode());
      setIsJoined(true);
    } catch (err) {
      console.error('[room] Failed to join:', err);
      throw err;
    }
  }, [roomId, user, profile]);

  // ── Leave room ───────────────────────────────────────────────────────────────
  const leave = useCallback(async () => {
    engineRef.current?.destroy();
    engineRef.current = null;
    setIsJoined(false);
    await roomApi.leave(roomId).catch(() => null);
  }, [roomId]);

  // ── Mute / Video toggles ─────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    engineRef.current?.setAudioEnabled(isMuted);
    setIsMuted((v) => !v);
    roomApi.selfMute(roomId, !isMuted).catch(() => null);
  }, [isMuted, roomId]);

  const toggleVideo = useCallback(async () => {
    const next = !isVideoOn;
    await engineRef.current?.setVideoEnabled(next);
    setIsVideoOn(next);
  }, [isVideoOn]);

  // ── Chat ─────────────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    await roomApi.sendChat(roomId, text);
  }, [roomId]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => {
    return () => { engineRef.current?.destroy(); };
  }, []);

  return {
    room,
    messages,
    peers,
    localStream,
    isMuted,
    isVideoOn,
    roomMode,
    activeSpeakers,
    modeSwitchToast,
    isJoined,
    join,
    leave,
    toggleMute,
    toggleVideo,
    sendMessage,
  };
}
