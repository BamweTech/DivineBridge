/**
 * WebRTC Engine — fully owned audio/video layer
 *
 * Architecture:
 * - Signaling: Firestore real-time listeners (prayer_rooms/{rid}/signaling/)
 * - Speakers: full mesh (audio + video in group_call mode, audio-only in prayer_room mode)
 * - Listeners: active-speaker optimization — max ACTIVE_SPEAKER_MAX_CONNECTIONS peer connections
 * - Mode switch: automatic at GROUP_CALL_MAX_PARTICIPANTS threshold, smooth transition
 */

/**
 * react-native-webrtc uses requireNativeComponent() at module load time,
 * which throws a non-catchable JSI exception in Expo Go (killing the VM).
 * We guard the require() behind an Expo Go environment check so the module
 * is never evaluated in Expo Go — only in EAS dev/production builds.
 */
import type React from 'react';
import Constants from 'expo-constants';

// 'storeClient' = Expo Go  |  'standalone' / 'bare' = real build
const _isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  Constants.executionEnvironment === 'expo';

let _RTCPeerConnection: any = null;
let _RTCIceCandidate: any = null;
let _RTCSessionDescription: any = null;
let _mediaDevices: any = null;
let _RTCView: any = null;
let _nativeModuleAvailable = false;

if (!_isExpoGo) {
  try {
    const webrtc = require('react-native-webrtc');
    _RTCPeerConnection = webrtc.RTCPeerConnection;
    _RTCIceCandidate = webrtc.RTCIceCandidate;
    _RTCSessionDescription = webrtc.RTCSessionDescription;
    _mediaDevices = webrtc.mediaDevices;
    _RTCView = webrtc.RTCView;
    _nativeModuleAvailable = true;
  } catch {
    // Native module absent even in a real build — fail gracefully
  }
}

const RTCPeerConnection = _RTCPeerConnection;
const RTCIceCandidate = _RTCIceCandidate;
const RTCSessionDescription = _RTCSessionDescription;
const mediaDevices = _mediaDevices;

// Real RTCView in production builds; null-rendering stub in Expo Go
function _RTCViewStub(_props: Record<string, unknown>) { return null; }
export const RTCView: React.ComponentType<any> = _RTCView ?? _RTCViewStub;
export const isWebRTCAvailable = _nativeModuleAvailable;
import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  ACTIVE_SPEAKER_MAX_CONNECTIONS,
  GROUP_CALL_MAX_PARTICIPANTS,
  ROOM_MODES,
} from '@/lib/constants';
import type { RoomMode } from '@/types';

// RTCView is exported at the top of this file via the try/catch guard

// ICE servers — STUN (public) + TURN (fetched from backend on session start)
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface PeerEntry {
  userId: string;
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  audioLevel: number;
  isVideoEnabled: boolean;
}

export type OnPeersChanged = (peers: Map<string, PeerEntry>) => void;
export type OnModeChanged = (mode: RoomMode) => void;
export type OnActiveSpeakersChanged = (speakerIds: string[]) => void;

export class WebRTCEngine {
  private roomId: string;
  private localUserId: string;
  private localUserName: string;
  private isSpeaker: boolean;

  private localStream: MediaStream | null = null;
  private peers = new Map<string, PeerEntry>();
  private iceServers = DEFAULT_ICE_SERVERS;
  private currentMode: RoomMode = ROOM_MODES.GROUP_CALL;
  private activeSpeakers: string[] = [];
  private audioLevelInterval: ReturnType<typeof setInterval> | null = null;
  private signalingUnsubs: Unsubscribe[] = [];

  onPeersChanged?: OnPeersChanged;
  onModeChanged?: OnModeChanged;
  onActiveSpeakersChanged?: OnActiveSpeakersChanged;

  constructor(
    roomId: string,
    localUserId: string,
    localUserName: string,
    isSpeaker: boolean,
    iceServers?: typeof DEFAULT_ICE_SERVERS
  ) {
    this.roomId = roomId;
    this.localUserId = localUserId;
    this.localUserName = localUserName;
    this.isSpeaker = isSpeaker;
    if (iceServers) this.iceServers = iceServers;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  async start(options: {
    mode: RoomMode;
    videoEnabled?: boolean;
    speakerIds: string[];
  }) {
    this.currentMode = options.mode;

    if (this.isSpeaker) {
      await this.acquireLocalMedia({
        audio: true,
        video: (options.videoEnabled ?? false) && options.mode === ROOM_MODES.GROUP_CALL,
      });
    }

    this.listenForIncomingSignals();
    await this.connectToSpeakers(options.speakerIds);
  }

  // ─── Local Media ────────────────────────────────────────────────────────────

  async acquireLocalMedia(constraints: { audio: boolean; video: boolean }) {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
    }
    this.localStream = await mediaDevices.getUserMedia({
      audio: true,
      video: constraints.video
        ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        : false,
    }) as unknown as MediaStream;
    this.startAudioLevelDetection();
    return this.localStream;
  }

  getLocalStream() {
    return this.localStream;
  }

  async setVideoEnabled(enabled: boolean) {
    if (!this.localStream) return;
    const videoTracks = this.localStream.getVideoTracks();
    if (enabled && videoTracks.length === 0) {
      // Add video track to existing stream
      const videoStream = await mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      const track = videoStream.getVideoTracks()[0];
      this.localStream.addTrack(track);
      // Renegotiate with all peers
      this.peers.forEach((_, peerId) => this.renegotiate(peerId));
    } else {
      videoTracks.forEach((t) => { t.enabled = enabled; });
    }
  }

  setAudioEnabled(enabled: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = enabled; });
  }

  // ─── Mode Transition ────────────────────────────────────────────────────────

  async transitionToMode(newMode: RoomMode) {
    if (newMode === this.currentMode) return;
    this.currentMode = newMode;

    if (newMode === ROOM_MODES.PRAYER_ROOM && this.isSpeaker) {
      // Drop video tracks for all non-spotlight speakers (keep audio)
      const videoTracks = this.localStream?.getVideoTracks() ?? [];
      videoTracks.forEach((t) => { t.enabled = false; });

      this.peers.forEach((peer, peerId) => {
        peer.isVideoEnabled = false;
        this.renegotiate(peerId);
      });
    }

    this.onModeChanged?.(newMode);
  }

  updateParticipantCount(count: number) {
    const expectedMode =
      count > GROUP_CALL_MAX_PARTICIPANTS
        ? ROOM_MODES.PRAYER_ROOM
        : ROOM_MODES.GROUP_CALL;
    if (expectedMode !== this.currentMode) {
      this.transitionToMode(expectedMode);
    }
  }

  // ─── Peer Management ────────────────────────────────────────────────────────

  private async connectToSpeakers(speakerIds: string[]) {
    const targets = this.isSpeaker
      ? speakerIds.filter((id) => id !== this.localUserId)
      : this.getListenerTargets(speakerIds);

    for (const speakerId of targets) {
      await this.createOffer(speakerId);
    }
  }

  private getListenerTargets(speakerIds: string[]): string[] {
    // Listeners connect only to the current active speakers (max ACTIVE_SPEAKER_MAX_CONNECTIONS)
    const active = this.activeSpeakers.length > 0 ? this.activeSpeakers : speakerIds;
    return active.slice(0, ACTIVE_SPEAKER_MAX_CONNECTIONS);
  }

  async onNewSpeakerJoined(speakerId: string) {
    if (speakerId === this.localUserId) return;
    if (this.peers.has(speakerId)) return;

    if (this.isSpeaker) {
      await this.createOffer(speakerId);
    } else {
      // Listener: re-evaluate active speaker list
      this.updateListenerConnections();
    }
  }

  async onSpeakerLeft(speakerId: string) {
    this.closePeer(speakerId);
    if (!this.isSpeaker) {
      this.updateListenerConnections();
    }
    this.notifyPeersChanged();
  }

  private async updateListenerConnections() {
    const desired = this.activeSpeakers.slice(0, ACTIVE_SPEAKER_MAX_CONNECTIONS);
    // Close connections to speakers no longer in active list
    this.peers.forEach((_, id) => {
      if (!desired.includes(id)) this.closePeer(id);
    });
    // Open connections to new active speakers
    for (const id of desired) {
      if (!this.peers.has(id)) await this.createOffer(id);
    }
  }

  // ─── RTCPeerConnection Factory ───────────────────────────────────────────────

  private createPeerConnection(remoteUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers }) as any;

    if (this.localStream) {
      (this.localStream as any).getTracks().forEach((track: any) => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.ontrack = (event: any) => {
      const stream = event.streams[0];
      const peer = this.peers.get(remoteUserId);
      if (peer) {
        peer.stream = stream;
        this.notifyPeersChanged();
      }
    };

    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        this.sendCandidate(remoteUserId, event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        this.closePeer(remoteUserId);
        this.notifyPeersChanged();
      }
    };

    const entry: PeerEntry = {
      userId: remoteUserId,
      pc,
      stream: null,
      audioLevel: 0,
      isVideoEnabled: this.currentMode === ROOM_MODES.GROUP_CALL,
    };
    this.peers.set(remoteUserId, entry);
    return pc;
  }

  private closePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.close();
    peer.stream?.getTracks().forEach((t) => t.stop());
    this.peers.delete(userId);
  }

  // ─── Offer / Answer ──────────────────────────────────────────────────────────

  async createOffer(remoteUserId: string) {
    const pc = this.createPeerConnection(remoteUserId) as any;
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    await this.sendSignal('offer', remoteUserId, { offer: { type: offer.type, sdp: offer.sdp } });
  }

  private async handleOffer(fromUserId: string, offer: RTCSessionDescriptionInit) {
    if (this.peers.has(fromUserId)) this.closePeer(fromUserId);
    const pc = this.createPeerConnection(fromUserId) as any;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: offer.type!, sdp: offer.sdp! }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.sendSignal('answer', fromUserId, { answer: { type: answer.type, sdp: answer.sdp } });
  }

  private async handleAnswer(fromUserId: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(fromUserId);
    if (!peer) return;
    const pc = peer.pc as any;
    if (pc.signalingState === 'stable') return;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: answer.type!, sdp: answer.sdp! }));
  }

  private async handleCandidate(fromUserId: string, candidateInit: RTCIceCandidateInit) {
    const peer = this.peers.get(fromUserId);
    if (!peer) return;
    try {
      await (peer.pc as any).addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch {
      // Ignore stale candidates
    }
  }

  // ─── Renegotiation ──────────────────────────────────────────────────────────

  private async renegotiate(remoteUserId: string) {
    const peer = this.peers.get(remoteUserId);
    if (!peer) return;
    const pc = peer.pc as any;
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    await this.sendSignal('offer', remoteUserId, { offer: { type: offer.type, sdp: offer.sdp } });
  }

  // ─── Firestore Signaling ─────────────────────────────────────────────────────

  private signalingCol() {
    return collection(db, 'prayer_rooms', this.roomId, 'signaling');
  }

  private async sendSignal(
    type: 'offer' | 'answer' | 'candidate',
    toUserId: string,
    payload: Record<string, any>
  ) {
    await addDoc(this.signalingCol(), {
      type,
      from_user: this.localUserId,
      from_name: this.localUserName,
      to_user: toUserId,
      ...payload,
      timestamp: serverTimestamp(),
    });
  }

  private async sendCandidate(toUserId: string, candidate: RTCIceCandidateInit) {
    await this.sendSignal('candidate', toUserId, { candidate });
  }

  private listenForIncomingSignals() {
    const q = query(
      this.signalingCol(),
      where('to_user', '==', this.localUserId),
      orderBy('timestamp', 'asc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;
        const data = change.doc.data();
        switch (data.type) {
          case 'offer':
            await this.handleOffer(data.from_user, data.offer);
            break;
          case 'answer':
            await this.handleAnswer(data.from_user, data.answer);
            break;
          case 'candidate':
            await this.handleCandidate(data.from_user, data.candidate);
            break;
        }
      });
    });

    this.signalingUnsubs.push(unsub);
  }

  // ─── Active Speaker Detection ────────────────────────────────────────────────

  private startAudioLevelDetection() {
    if (this.audioLevelInterval) clearInterval(this.audioLevelInterval);
    this.audioLevelInterval = setInterval(() => {
      this.evaluateActiveSpeakers();
    }, 1000);
  }

  private evaluateActiveSpeakers() {
    // Build sorted list of peers by audio level (descending)
    const levels: { userId: string; level: number }[] = [];
    this.peers.forEach((peer, userId) => {
      levels.push({ userId, level: peer.audioLevel });
    });
    levels.sort((a, b) => b.level - a.level);

    const newActiveSpeakers = levels
      .filter((l) => l.level > 0.02)
      .slice(0, ACTIVE_SPEAKER_MAX_CONNECTIONS)
      .map((l) => l.userId);

    const changed =
      newActiveSpeakers.length !== this.activeSpeakers.length ||
      newActiveSpeakers.some((id, i) => id !== this.activeSpeakers[i]);

    if (changed) {
      this.activeSpeakers = newActiveSpeakers;
      this.onActiveSpeakersChanged?.(newActiveSpeakers);
      if (!this.isSpeaker) {
        this.updateListenerConnections();
      }
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  destroy() {
    if (this.audioLevelInterval) clearInterval(this.audioLevelInterval);
    this.signalingUnsubs.forEach((unsub) => unsub());
    this.peers.forEach((_, id) => this.closePeer(id));
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private notifyPeersChanged() {
    this.onPeersChanged?.(new Map(this.peers));
  }

  getPeers() {
    return new Map(this.peers);
  }

  getCurrentMode() {
    return this.currentMode;
  }
}
