/**
 * SfuEngine — DivineBridge SFU client for React Native
 *
 * Uses mediasoup-client (pure-JS, no native rebuild required) with the
 * ReactNative106 handler which delegates WebRTC to react-native-webrtc.
 *
 * Why mediasoup-client instead of raw RTCPeerConnection:
 *   The mediasoup wire protocol requires generating SDP from the server's
 *   ICE/DTLS parameters, proper SSRC-to-transceiver binding, and coordinated
 *   renegotiation for each new consumer.  mediasoup-client handles all of this
 *   internally — without it, no audio ever flows even if signaling succeeds.
 *
 * Architecture:
 *   • One WebSocket for signaling
 *   • mediasoup-client Device (loaded with routerRtpCapabilities)
 *   • One SendTransport  → produces local audio/video tracks
 *   • One RecvTransport  → consumes all remote tracks
 */

import type React from 'react';
import Constants from 'expo-constants';
import type { RoomMode } from '@/types';
import { ROOM_MODES, GROUP_CALL_MAX_PARTICIPANTS } from '@/lib/constants';

// ─── Expo Go guard ─────────────────────────────────────────────────────────────
// Runtime may report legacy 'expo'; current typings only list storeClient | bare | standalone.
const _execEnv = Constants.executionEnvironment as string;
const _isExpoGo =
  Constants.executionEnvironment === 'storeClient' || _execEnv === 'expo';

let _mediaDevices: any = null;
let _RTCView: any = null;
let _nativeModuleAvailable = false;

if (!_isExpoGo) {
  try {
    const webrtc = require('react-native-webrtc');
    // registerGlobals() injects RTCPeerConnection, MediaStream, etc. into the
    // global scope — mediasoup-client's ReactNative106 handler requires these.
    webrtc.registerGlobals();
    _mediaDevices = webrtc.mediaDevices;
    _RTCView = webrtc.RTCView;
    _nativeModuleAvailable = true;
  } catch {
    // Native module absent — fail gracefully
  }
}

function _RTCViewStub(_props: Record<string, unknown>) {
  return null;
}

export const RTCView: React.ComponentType<any> = _RTCView ?? _RTCViewStub;
export const isWebRTCAvailable = _nativeModuleAvailable;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PeerEntry {
  userId: string;
  userName: string;
  stream: any | null;
  audioLevel: number;
  isVideoEnabled: boolean;
  isMuted: boolean;
  /** Bumped whenever the stream's tracks change so UI can force a remount. */
  revision: number;
}

export type OnPeersChanged = (peers: Map<string, PeerEntry>) => void;
export type OnModeChanged = (mode: RoomMode) => void;
export type OnActiveSpeakersChanged = (speakerIds: string[]) => void;

// ─── SFU Engine ────────────────────────────────────────────────────────────────

export class SfuEngine {
  private roomId: string;
  private userId: string;
  private userName: string;
  private isSpeaker: boolean;
  private sfuUrl: string;
  private token: string;

  private ws: WebSocket | null = null;
  private localStream: any | null = null;
  private currentMode: RoomMode = ROOM_MODES.GROUP_CALL;

  /** newConsumer events that arrived before recvTransport was ready */
  private pendingConsumers: any[] = [];

  /** Serializes async event handling to prevent concurrent peer mutations */
  private _eventQueue: Promise<void> = Promise.resolve();

  private peers = new Map<string, PeerEntry>();
  private activeSpeakers: string[] = [];

  // mediasoup-client objects
  private device: any | null = null;
  private sendTransport: any | null = null;
  private recvTransport: any | null = null;
  private audioProducer: any | null = null;
  private videoProducer: any | null = null;

  /** consumerId → Consumer (mediasoup-client Consumer) */
  private consumers = new Map<string, any>();
  /** consumerId → { userId, kind } */
  private consumerMeta = new Map<string, { userId: string; kind: 'audio' | 'video' }>();

  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private reqCounter = 0;

  onPeersChanged?: OnPeersChanged;
  onModeChanged?: OnModeChanged;
  onActiveSpeakersChanged?: OnActiveSpeakersChanged;

  constructor(options: {
    roomId: string;
    userId: string;
    userName: string;
    isSpeaker: boolean;
    sfuUrl: string;
    token: string;
  }) {
    this.roomId = options.roomId;
    this.userId = options.userId;
    this.userName = options.userName;
    this.isSpeaker = options.isSpeaker;
    this.sfuUrl = options.sfuUrl;
    this.token = options.token;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async start(options: { videoEnabled?: boolean }) {
    if (_isExpoGo || !_nativeModuleAvailable) {
      console.warn('[sfu] WebRTC not available in Expo Go');
      return;
    }

    await this._connectWs();

    // 1. Join room → get routerRtpCapabilities + current peers
    const joinResult = await this._request('join', {
      token: this.token,
      roomId: this.roomId,
    });

    // 2. Load mediasoup-client Device with the router's RTP capabilities.
    //    ReactNative106 uses react-native-webrtc globals (already patched).
    const { Device } = require('mediasoup-client');
    const { ReactNative106 } = require('mediasoup-client/lib/handlers/ReactNative106');

    this.device = new Device({
      handlerFactory: ReactNative106.createFactory(),
    });

    await this.device.load({
      routerRtpCapabilities: joinResult.routerRtpCapabilities,
    });
    console.log('[sfu] device loaded, rtpCapabilities keys:', Object.keys(this.device.rtpCapabilities ?? {}));

    // 3. Tell the server our RTP capabilities so it can create consumers for us
    await this._request('setRtpCapabilities', {
      rtpCapabilities: this.device.rtpCapabilities,
    });

    // 4. Populate initial peer list
    for (const p of joinResult.peers ?? []) {
      this.peers.set(p.userId, {
        userId: p.userId,
        userName: p.userName,
        stream: null,
        audioLevel: 0,
        isVideoEnabled: false,
        isMuted: false,
        revision: 0,
      });
    }
    this._notifyPeers();

    this._applyMode(joinResult.mode ?? ROOM_MODES.GROUP_CALL);

    // 5. Create receive transport first (server subscribes existing producers)
    await this._setupRecvTransport();

    // 6. Acquire mic and publish (speakers only)
    if (this.isSpeaker) {
      const stream = await this._acquireLocalMedia({ audio: true, video: options.videoEnabled ?? false });
      const tracks = stream?.getTracks?.() ?? [];
      console.log(`[sfu] local tracks: ${tracks.map((t: any) => `${t.kind}(${t.readyState})`).join(', ') || 'none'}`);
      await this._setupSendTransport();
      if (!this.audioProducer) {
        console.warn('[sfu] audio producer was not created — mic may not work (simulator limitation)');
      }
    }
  }

  /** Promoted to speaker mid-session — acquire mic and create send transport + producers */
  async startPublishing(options: { videoEnabled?: boolean } = {}) {
    if (_isExpoGo || !_nativeModuleAvailable) return;
    if (!this.device || !this.recvTransport) {
      console.warn('[sfu] startPublishing: client not fully started');
      return;
    }
    if (this.audioProducer) {
      return;
    }
    this.isSpeaker = true;
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }
    const videoEnabled = options.videoEnabled ?? false;
    await this._acquireLocalMedia({ audio: true, video: videoEnabled });
    await this._setupSendTransport();
  }

  /** Demoted to listener — tear down local producers and send transport */
  async stopPublishing() {
    this.isSpeaker = false;
    this.audioProducer?.close();
    this.audioProducer = null;
    this.videoProducer?.close();
    this.videoProducer = null;
    this.sendTransport?.close();
    this.sendTransport = null;
    this.localStream?.getTracks?.().forEach((t: any) => t.stop());
    this.localStream = null;
  }

  getLocalStream() {
    return this.localStream;
  }

  setAudioEnabled(enabled: boolean) {
    this.localStream?.getAudioTracks?.().forEach((t: any) => { t.enabled = enabled; });
    if (this.audioProducer) {
      const action = enabled ? 'resumeProducer' : 'pauseProducer';
      this._request(action, { producerId: this.audioProducer.id }).catch(() => null);
    }
  }

  async setVideoEnabled(enabled: boolean) {
    if (!this.isSpeaker || !this.sendTransport) return;

    if (enabled && !this.videoProducer) {
      const videoStream = await _mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      const track = videoStream.getVideoTracks()[0];
      this.localStream?.addTrack?.(track);
      this.videoProducer = await this.sendTransport.produce({ track });
    } else if (this.videoProducer) {
      if (enabled) {
        await this.videoProducer.resume();
        await this._request('resumeProducer', { producerId: this.videoProducer.id });
      } else {
        await this.videoProducer.pause();
        await this._request('pauseProducer', { producerId: this.videoProducer.id });
      }
      this.localStream?.getVideoTracks?.().forEach((t: any) => { t.enabled = enabled; });
    }
  }

  updateParticipantCount(count: number) {
    const expected = count > GROUP_CALL_MAX_PARTICIPANTS
      ? ROOM_MODES.PRAYER_ROOM
      : ROOM_MODES.GROUP_CALL;
    if (expected !== this.currentMode) this._applyMode(expected);
  }

  destroy() {
    this.audioProducer?.close();
    this.videoProducer?.close();
    for (const c of this.consumers.values()) c.close();
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.localStream?.getTracks?.().forEach((t: any) => t.stop());
    this.localStream = null;
    this.ws?.close();
    this.ws = null;
  }

  getPeers() {
    return new Map(this.peers);
  }

  getCurrentMode() {
    return this.currentMode;
  }

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  private _connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.sfuUrl);
      this.ws = ws;

      ws.onopen = () => resolve();
      ws.onerror = (e: any) => reject(new Error(`WS error: ${e.message ?? 'connection failed'}`));
      ws.onclose = () => {
        this.pending.forEach(({ reject: rej }) => rej(new Error('WebSocket closed')));
        this.pending.clear();
      };
      ws.onmessage = (e: MessageEvent) => this._onWsMessage(e.data);
    });
  }

  private _onWsMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.requestId != null) {
      const cb = this.pending.get(String(msg.requestId));
      if (cb) {
        this.pending.delete(String(msg.requestId));
        if (msg.ok) cb.resolve(msg.data);
        else cb.reject(new Error(msg.error ?? 'SFU error'));
      }
      return;
    }

    if (msg.event) {
      this._eventQueue = this._eventQueue
        .then(() => this._handleEvent(msg.event, msg.data))
        .catch((err) => console.warn('[sfu] event handler error:', err));
    }
  }

  private _request(action: string, data: Record<string, any> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = String(++this.reqCounter);
      this.pending.set(requestId, { resolve, reject });
      this.ws?.send(JSON.stringify({ action, requestId, data }));
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`Timeout waiting for ${action}`));
        }
      }, 15_000);
    });
  }

  // ─── Server Push Events ────────────────────────────────────────────────────

  private async _handleEvent(event: string, data: any) {
    switch (event) {
      case 'peerJoined':
        if (!this.peers.has(data.userId)) {
          this.peers.set(data.userId, {
            userId: data.userId,
            userName: data.userName,
            stream: null,
            audioLevel: 0,
            isVideoEnabled: false,
            isMuted: false,
            revision: 0,
          });
          this._notifyPeers();
        }
        break;

      case 'peerLeft':
        this.peers.delete(data.userId);
        this._notifyPeers();
        break;

      case 'newProducer':
        if (!this.peers.has(data.userId)) {
          this.peers.set(data.userId, {
            userId: data.userId,
            userName: data.userName,
            stream: null,
            audioLevel: 0,
            isVideoEnabled: false,
            isMuted: false,
            revision: 0,
          });
        }
        if (data.kind === 'video') {
          const p = this.peers.get(data.userId);
          if (p) { p.isVideoEnabled = true; this.peers.set(data.userId, p); }
        }
        this._notifyPeers();
        break;

      case 'newConsumer':
        if (!this.recvTransport) {
          // recvTransport not ready yet — buffer and process after setup
          this.pendingConsumers.push(data);
        } else {
          await this._consumeTrack(data);
        }
        break;

      case 'consumerClosed': {
        const meta = this.consumerMeta.get(data.consumerId);
        const consumer = this.consumers.get(data.consumerId);
        if (meta && consumer?.track) {
          const p = this.peers.get(meta.userId);
          if (p?.stream) {
            const { MediaStream: MS } = require('react-native-webrtc');
            const remaining = p.stream.getTracks().filter((t: any) => t !== consumer.track);
            p.stream = remaining.length > 0 ? new MS(remaining) : null;
            p.revision = (p.revision ?? 0) + 1;
            this.peers.set(meta.userId, p);
          }
          if (meta.kind === 'video' && p) {
            p.isVideoEnabled = false;
            this.peers.set(meta.userId, p);
          }
          this._notifyPeers();
        } else if (meta?.kind === 'video') {
          const p = this.peers.get(meta.userId);
          if (p) {
            p.isVideoEnabled = false;
            p.revision = (p.revision ?? 0) + 1;
            this.peers.set(meta.userId, p);
            this._notifyPeers();
          }
        }
        this.consumers.get(data.consumerId)?.close();
        this.consumers.delete(data.consumerId);
        this.consumerMeta.delete(data.consumerId);
        break;
      }

      case 'consumerPaused':
      case 'consumerResumed': {
        const meta = this.consumerMeta.get(data.consumerId);
        if (meta?.kind === 'audio') {
          const p = this.peers.get(meta.userId);
          if (p) {
            p.isMuted = event === 'consumerPaused';
            this.peers.set(meta.userId, p);
            this._notifyPeers();
          }
        }
        break;
      }

      case 'activeSpeakers':
        this.activeSpeakers = data.speakers ?? [];
        this.onActiveSpeakersChanged?.(this.activeSpeakers);
        break;
    }
  }

  // ─── Local Media ───────────────────────────────────────────────────────────

  private async _acquireLocalMedia(constraints: { audio: boolean; video: boolean }) {
    if (this.localStream) {
      this.localStream.getTracks?.().forEach((t: any) => t.stop());
    }
    this.localStream = await _mediaDevices.getUserMedia({
      audio: constraints.audio
        ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : false,
      video: constraints.video
        ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        : false,
    });
    return this.localStream;
  }

  // ─── Send Transport ─────────────────────────────────────────────────────────

  private async _setupSendTransport() {
    const params = await this._request('createTransport', { direction: 'send' });

    // device.createSendTransport wires up all ICE/DTLS via mediasoup-client internals
    this.sendTransport = this.device.createSendTransport(params);

    // 'connect' fires once when the first produce() triggers ICE/DTLS
    this.sendTransport.on(
      'connect',
      ({ dtlsParameters }: any, callback: () => void, errback: (e: Error) => void) => {
        this._request('connectTransport', {
          transportId: this.sendTransport.id,
          dtlsParameters,
        })
          .then(callback)
          .catch(errback);
      }
    );

    // 'produce' fires when transport.produce() is called
    this.sendTransport.on(
      'produce',
      (
        { kind, rtpParameters, appData }: any,
        callback: (p: { id: string }) => void,
        errback: (e: Error) => void
      ) => {
        this._request('produce', { kind, rtpParameters, appData })
          .then(({ producerId }: { producerId: string }) => callback({ id: producerId }))
          .catch(errback);
      }
    );

    // Produce each local track — catch per-track errors so a codec failure
    // (common on the iOS Simulator) doesn't take down the entire session.
    for (const track of (this.localStream?.getTracks?.() ?? [])) {
      try {
        if (track.kind === 'audio') {
          this.audioProducer = await this.sendTransport.produce({ track });
          console.log('[sfu] audio producer created');
        } else if (track.kind === 'video') {
          this.videoProducer = await this.sendTransport.produce({ track });
          console.log('[sfu] video producer created');
        }
      } catch (err: any) {
        console.warn(`[sfu] failed to produce ${track.kind} track:`, err?.message ?? err);
      }
    }
  }

  // ─── Receive Transport ──────────────────────────────────────────────────────

  private async _setupRecvTransport() {
    const params = await this._request('createTransport', { direction: 'receive' });

    console.log('[sfu] recvTransport params keys:', Object.keys(params ?? {}));
    this.recvTransport = this.device.createRecvTransport(params);

    this.recvTransport.on(
      'connect',
      ({ dtlsParameters }: any, callback: () => void, errback: (e: Error) => void) => {
        this._request('connectTransport', {
          transportId: this.recvTransport.id,
          dtlsParameters,
        })
          .then(callback)
          .catch(errback);
      }
    );

    // Signal server that recv transport is ready — it will now fan out existing producers.
    // Also drain any newConsumer events that arrived before this point.
    await this._request('readyToConsume', {});
    for (const pending of this.pendingConsumers) {
      await this._consumeTrack(pending).catch((e) =>
        console.warn('[sfu] pending consumer error:', e)
      );
    }
    this.pendingConsumers = [];
  }

  private async _consumeTrack(data: {
    consumerId: string;
    producerId: string;
    kind: 'audio' | 'video';
    rtpParameters: any;
    producerUserId: string;
    appData: any;
  }) {
    if (!this.recvTransport) return;

    this.consumerMeta.set(data.consumerId, {
      userId: data.producerUserId,
      kind: data.kind,
    });

    // mediasoup-client handles ICE/DTLS + SSRC-to-transceiver binding internally
    const consumer = await this.recvTransport.consume({
      id: data.consumerId,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });

    this.consumers.set(data.consumerId, consumer);

    // Ensure peer entry exists
    if (!this.peers.has(data.producerUserId)) {
      this.peers.set(data.producerUserId, {
        userId: data.producerUserId,
        userName: data.appData?.userName ?? 'Unknown',
        stream: null,
        audioLevel: 0,
        isVideoEnabled: false,
        isMuted: false,
        revision: 0,
      });
    }

    // Build a NEW MediaStream so RTCView picks up the changed toURL()
    const { MediaStream } = require('react-native-webrtc');
    const peer = this.peers.get(data.producerUserId)!;
    const existingTracks = peer.stream ? peer.stream.getTracks() : [];
    peer.stream = new MediaStream([...existingTracks, consumer.track]);
    if (data.kind === 'video') peer.isVideoEnabled = true;
    peer.revision = (peer.revision ?? 0) + 1;
    this.peers.set(data.producerUserId, peer);
    this._notifyPeers();

    // ACK → server resumes the consumer
    await this._request('resumeConsumer', { consumerId: data.consumerId });
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  private _applyMode(mode: RoomMode) {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.onModeChanged?.(mode);
  }

  private _notifyPeers() {
    this.onPeersChanged?.(new Map(this.peers));
  }
}
