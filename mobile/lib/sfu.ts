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
const _isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  Constants.executionEnvironment === 'expo';

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
      });
    }
    this._notifyPeers();

    this._applyMode(joinResult.mode ?? ROOM_MODES.GROUP_CALL);

    // 5. Create receive transport first (server subscribes existing producers)
    await this._setupRecvTransport();

    // 6. Acquire mic and publish (speakers only)
    if (this.isSpeaker) {
      await this._acquireLocalMedia({ audio: true, video: options.videoEnabled ?? false });
      await this._setupSendTransport();
    }
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
      this._handleEvent(msg.event, msg.data).catch((err) =>
        console.warn('[sfu] event handler error:', err)
      );
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
          });
        }
        if (data.kind === 'video') {
          const p = this.peers.get(data.userId);
          if (p) { p.isVideoEnabled = true; this.peers.set(data.userId, p); }
        }
        this._notifyPeers();
        break;

      case 'newConsumer':
        await this._consumeTrack(data);
        break;

      case 'consumerClosed': {
        const meta = this.consumerMeta.get(data.consumerId);
        if (meta?.kind === 'video') {
          const p = this.peers.get(meta.userId);
          if (p) { p.isVideoEnabled = false; this.peers.set(meta.userId, p); }
          this._notifyPeers();
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

    // Produce each local track
    for (const track of (this.localStream?.getTracks?.() ?? [])) {
      if (track.kind === 'audio') {
        this.audioProducer = await this.sendTransport.produce({ track });
      } else if (track.kind === 'video') {
        this.videoProducer = await this.sendTransport.produce({ track });
      }
    }
  }

  // ─── Receive Transport ──────────────────────────────────────────────────────

  private async _setupRecvTransport() {
    const params = await this._request('createTransport', { direction: 'receive' });

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
      });
    }

    // Attach track to a MediaStream and give it to the peer entry
    const { MediaStream } = require('react-native-webrtc');
    const peer = this.peers.get(data.producerUserId)!;
    if (!peer.stream) {
      peer.stream = new MediaStream([consumer.track]);
    } else {
      peer.stream.addTrack(consumer.track);
    }
    if (data.kind === 'video') peer.isVideoEnabled = true;
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
