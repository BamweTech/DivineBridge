/**
 * DivineBridge SFU Web Client
 *
 * Uses mediasoup-client (exposed as window.mediasoupClient by sfu-bundle.js)
 * with the auto-detected browser handler (Chrome74 / Firefox120 / Safari12).
 *
 * This mirrors mobile/lib/sfu.ts exactly — same protocol, same SFU server,
 * same mediasoup-client Device abstraction — so web and mobile behave identically.
 *
 * Requires sfu-bundle.js to be loaded before this file.
 *
 * Usage (wired automatically by the prayer room template):
 *   const client = await createSfuClient({
 *     roomId, userId, userName, isSpeaker, videoEnabled, firebaseAuth
 *   });
 *   client.onPeersChanged    = (peers) => { ... };   // Map<userId, PeerEntry>
 *   client.onActiveSpeakers  = (ids)   => { ... };   // string[]
 *   client.onModeChanged     = (mode)  => { ... };   // 'group_call' | 'prayer_room'
 *   await client.setAudioEnabled(false);             // mute
 *   await client.destroy();
 */

'use strict';

/** Public SFU — must match mobile `lib/constants.ts` SFU_URL */
const DEFAULT_PRODUCTION_SFU_URL = 'wss://sfu.divinebridge.io/ws';

/**
 * Flask may return ws://localhost when SFU_URL is missing on the server.
 * Browsers on https://divinebridge.io cannot use that; fall back to production WSS.
 * Local dev (page on localhost): keep server-provided URL so local SFU still works.
 */
function resolveSfuUrl(sfuUrlFromServer) {
  try {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocalPage = host === 'localhost' || host === '127.0.0.1';
    const raw = (sfuUrlFromServer || '').trim();
    if (isLocalPage) {
      return raw || 'ws://127.0.0.1:3000/ws';
    }
    if (!raw || /localhost|127\.0\.0\.1/i.test(raw)) {
      console.warn('[sfu] Replacing unusable SFU URL with production:', DEFAULT_PRODUCTION_SFU_URL);
      return DEFAULT_PRODUCTION_SFU_URL;
    }
    return raw;
  } catch (_) {
    return DEFAULT_PRODUCTION_SFU_URL;
  }
}

// ─── SFU Client ────────────────────────────────────────────────────────────────

class SfuClient {
  /**
   * @param {{
   *   sfuUrl: string,
   *   token: string,
   *   roomId: string,
   *   userId: string,
   *   userName: string,
   *   isSpeaker: boolean,
   * }} opts
   */
  constructor({ sfuUrl, token, roomId, userId, userName, isSpeaker }) {
    this.sfuUrl   = sfuUrl;
    this.token    = token;
    this.roomId   = roomId;
    this.userId   = userId;
    this.userName = userName;
    this.isSpeaker = isSpeaker;

    /** @type {WebSocket | null} */
    this._ws = null;
    /** @type {Map<string, {resolve: Function, reject: Function}>} */
    this._pending = new Map();
    this._reqCounter = 0;

    /** mediasoup-client objects */
    this._device        = null;
    this._sendTransport = null;
    this._recvTransport = null;
    this._audioProducer = null;
    this._videoProducer = null;

    /** consumerId → mediasoup-client Consumer */
    this._consumers = new Map();
    /** consumerId → { userId, kind } */
    this._consumerMeta = new Map();

    /** newConsumer events that arrived before recvTransport was ready */
    this._pendingConsumers = [];

    /** @type {MediaStream | null} */
    this.localStream = null;

    /** @type {Map<string, {userId, userName, stream, audioLevel, isVideoEnabled, isMuted}>} */
    this.peers = new Map();

    // ── Public callbacks ──────────────────────────────────────────────────────
    /** @type {((peers: Map) => void) | null} */
    this.onPeersChanged   = null;
    /** @type {((ids: string[]) => void) | null} */
    this.onActiveSpeakers = null;
    /** @type {((mode: string) => void) | null} */
    this.onModeChanged    = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Connect to the SFU, load the mediasoup Device, set up transports, and
   * optionally start producing local audio/video.
   * @param {{ videoEnabled?: boolean }} opts
   */
  async start({ videoEnabled = false } = {}) {
    await this._connectWs();

    // 1. Join room → routerRtpCapabilities + current peer list + mode
    const joinResult = await this._request('join', {
      token:  this.token,
      roomId: this.roomId,
    });

    // 2. Load the mediasoup-client Device.
    //    window.mediasoupClient is exposed by sfu-bundle.js.
    //    Device auto-selects Chrome74/Firefox120/Safari12 handler.
    this._device = new window.mediasoupClient.Device();
    await this._device.load({
      routerRtpCapabilities: joinResult.routerRtpCapabilities,
    });

    // 3. Tell the server our RTP capabilities so it can create consumers for us
    await this._request('setRtpCapabilities', {
      rtpCapabilities: this._device.rtpCapabilities,
    });

    // 4. Populate initial peer map
    for (const p of (joinResult.peers ?? [])) {
      this.peers.set(p.userId, {
        userId: p.userId, userName: p.userName,
        stream: null, audioLevel: 0,
        isVideoEnabled: false, isMuted: false,
      });
    }
    this._emitPeers();
    if (joinResult.mode) this.onModeChanged?.(joinResult.mode);

    // 5. Create receive transport first (server subscribes existing producers)
    await this._setupRecvTransport();

    // 6. Acquire mic/cam and publish (speakers only)
    if (this.isSpeaker) {
      await this._acquireLocalMedia({ audio: true, video: videoEnabled });
      await this._setupSendTransport();
    }
  }

  /** Enable or disable the local microphone. */
  async setAudioEnabled(enabled) {
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    if (this._audioProducer) {
      await this._request(enabled ? 'resumeProducer' : 'pauseProducer', {
        producerId: this._audioProducer.id,
      });
    }
  }

  /** Enable or disable the local camera. */
  async setVideoEnabled(enabled) {
    if (!this.isSpeaker || !this._sendTransport) return;

    if (enabled && !this._videoProducer) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      const track = stream.getVideoTracks()[0];
      this.localStream?.addTrack(track);
      this._videoProducer = await this._sendTransport.produce({ track });
    } else if (this._videoProducer) {
      await this._request(enabled ? 'resumeProducer' : 'pauseProducer', {
        producerId: this._videoProducer.id,
      });
      this.localStream?.getVideoTracks().forEach((t) => { t.enabled = enabled; });
    }
  }

  /** Tear down all transports, consumers, and the WebSocket connection. */
  async destroy() {
    this._audioProducer?.close();
    this._videoProducer?.close();
    for (const c of this._consumers.values()) c.close();
    this._consumers.clear();
    this._sendTransport?.close();
    this._recvTransport?.close();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this._ws?.close();
    this._pending.clear();
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────────

  _connectWs() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.sfuUrl);
      this._ws = ws;
      ws.onopen  = () => resolve();
      ws.onerror = () => reject(new Error('SFU WebSocket connection failed'));
      ws.onclose = () => {
        for (const { reject: rej } of this._pending.values()) rej(new Error('WebSocket closed'));
        this._pending.clear();
      };
      ws.onmessage = (e) => this._onMessage(e.data);
    });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.requestId != null) {
      const cb = this._pending.get(String(msg.requestId));
      if (cb) {
        this._pending.delete(String(msg.requestId));
        msg.ok ? cb.resolve(msg.data) : cb.reject(new Error(msg.error ?? 'SFU error'));
      }
      return;
    }

    if (msg.event) this._handleEvent(msg.event, msg.data).catch(console.error);
  }

  _request(action, data = {}) {
    return new Promise((resolve, reject) => {
      const requestId = String(++this._reqCounter);
      this._pending.set(requestId, { resolve, reject });
      this._ws.send(JSON.stringify({ action, requestId, data }));
      setTimeout(() => {
        if (this._pending.has(requestId)) {
          this._pending.delete(requestId);
          reject(new Error(`SFU timeout: ${action}`));
        }
      }, 15_000);
    });
  }

  // ─── Push Events ──────────────────────────────────────────────────────────────

  async _handleEvent(event, data) {
    switch (event) {
      case 'peerJoined':
        if (!this.peers.has(data.userId)) {
          this.peers.set(data.userId, {
            userId: data.userId, userName: data.userName,
            stream: null, audioLevel: 0, isVideoEnabled: false, isMuted: false,
          });
          this._emitPeers();
        }
        break;

      case 'peerLeft':
        this.peers.delete(data.userId);
        this._emitPeers();
        break;

      case 'newProducer':
        if (!this.peers.has(data.userId)) {
          this.peers.set(data.userId, {
            userId: data.userId, userName: data.userName,
            stream: null, audioLevel: 0, isVideoEnabled: false, isMuted: false,
          });
        }
        if (data.kind === 'video') {
          const p = this.peers.get(data.userId);
          if (p) p.isVideoEnabled = true;
        }
        this._emitPeers();
        break;

      case 'newConsumer':
        if (!this._recvTransport) {
          this._pendingConsumers.push(data);
        } else {
          await this._consumeTrack(data);
        }
        break;

      case 'consumerClosed': {
        const meta = this._consumerMeta.get(data.consumerId);
        if (meta?.kind === 'video') {
          const p = this.peers.get(meta.userId);
          if (p) { p.isVideoEnabled = false; this._emitPeers(); }
        }
        this._consumers.get(data.consumerId)?.close();
        this._consumers.delete(data.consumerId);
        this._consumerMeta.delete(data.consumerId);
        break;
      }

      case 'consumerPaused':
      case 'consumerResumed': {
        const meta = this._consumerMeta.get(data.consumerId);
        if (meta?.kind === 'audio') {
          const p = this.peers.get(meta.userId);
          if (p) { p.isMuted = event === 'consumerPaused'; this._emitPeers(); }
        }
        break;
      }

      case 'activeSpeakers':
        this.onActiveSpeakers?.(data.speakers ?? []);
        break;

      case 'modeChanged':
        this.onModeChanged?.(data.mode);
        break;
    }
  }

  // ─── Local Media ──────────────────────────────────────────────────────────────

  async _acquireLocalMedia({ audio, video }) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: audio ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate:       48000,
        channelCount:     2,
      } : false,
      video: video
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        : false,
    });
    return this.localStream;
  }

  // ─── Send Transport ───────────────────────────────────────────────────────────

  async _setupSendTransport() {
    const params = await this._request('createTransport', { direction: 'send' });

    // mediasoup-client Device.createSendTransport handles ICE/DTLS/SDP internally
    this._sendTransport = this._device.createSendTransport(params);

    // 'connect' fires once when the first produce() triggers the DTLS handshake
    this._sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this._request('connectTransport', {
        transportId:     this._sendTransport.id,
        dtlsParameters,
      }).then(callback).catch(errback);
    });

    // 'produce' fires for each track we publish
    this._sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      this._request('produce', { kind, rtpParameters, appData })
        .then(({ producerId }) => callback({ id: producerId }))
        .catch(errback);
    });

    for (const track of (this.localStream?.getTracks() ?? [])) {
      try {
        if (track.kind === 'audio') {
          this._audioProducer = await this._sendTransport.produce({ track });
        } else if (track.kind === 'video') {
          this._videoProducer = await this._sendTransport.produce({ track });
        }
      } catch (err) {
        console.warn(`[sfu] failed to produce ${track.kind} track:`, err?.message ?? err);
      }
    }
  }

  // ─── Receive Transport ────────────────────────────────────────────────────────

  async _setupRecvTransport() {
    const params = await this._request('createTransport', { direction: 'receive' });

    this._recvTransport = this._device.createRecvTransport(params);

    this._recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this._request('connectTransport', {
        transportId:     this._recvTransport.id,
        dtlsParameters,
      }).then(callback).catch(errback);
    });

    // Signal server that recv transport is ready so it fans out existing producers.
    // Mirrors the mobile sfu.ts readyToConsume handshake.
    await this._request('readyToConsume', {});

    // Drain any newConsumer events that arrived before the transport was ready
    for (const pending of this._pendingConsumers) {
      await this._consumeTrack(pending).catch(console.error);
    }
    this._pendingConsumers = [];
  }

  async _consumeTrack({ consumerId, producerId, kind, rtpParameters, producerUserId, appData }) {
    if (!this._recvTransport) return;

    this._consumerMeta.set(consumerId, { userId: producerUserId, kind });

    // mediasoup-client handles ICE/DTLS + SSRC-to-transceiver binding internally
    const consumer = await this._recvTransport.consume({
      id: consumerId,
      producerId,
      kind,
      rtpParameters,
    });
    this._consumers.set(consumerId, consumer);

    // Ensure peer entry exists
    if (!this.peers.has(producerUserId)) {
      this.peers.set(producerUserId, {
        userId: producerUserId,
        userName: appData?.userName ?? 'Unknown',
        stream: null, audioLevel: 0, isVideoEnabled: false, isMuted: false,
      });
    }

    // Attach the track to a MediaStream and give it to the peer entry
    const peer = this.peers.get(producerUserId);
    if (!peer.stream) {
      peer.stream = new MediaStream([consumer.track]);
    } else {
      peer.stream.addTrack(consumer.track);
    }
    if (kind === 'video') peer.isVideoEnabled = true;
    this._emitPeers();

    // ACK → server resumes the consumer so RTP starts flowing
    await this._request('resumeConsumer', { consumerId });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────

  _emitPeers() {
    this.onPeersChanged?.(new Map(this.peers));
  }
}

// ─── Integration Helper ───────────────────────────────────────────────────────
//
// Called by the prayer room template after the user has joined via Flask.
// Flow:
//   1. Fetch Firebase custom token from Flask (has roomId claim)
//   2. Exchange for a Firebase ID token via signInWithCustomToken
//   3. Connect to SFU with the ID token

/**
 * @param {{
 *   roomId: string,
 *   userId: string,
 *   userName: string,
 *   isSpeaker: boolean,
 *   videoEnabled?: boolean,
 *   firebaseAuth: import('firebase/auth').Auth
 * }} opts
 * @returns {Promise<SfuClient>}
 */
async function createSfuClient({ roomId, userId, userName, isSpeaker, videoEnabled = false, firebaseAuth }) {
  // 1. Get a Firebase Custom Token (with roomId claim) from Flask
  const resp = await fetch(`/api/prayer-room/sfu-token/${roomId}`, { method: 'POST' });
  if (!resp.ok) throw new Error(`Failed to get SFU token: ${resp.status}`);
  const { customToken, sfuUrl: sfuUrlRaw } = await resp.json();
  const sfuUrl = resolveSfuUrl(sfuUrlRaw);

  // 2. Exchange custom token → Firebase ID token.
  //    Supports both Firebase compat SDK (auth.signInWithCustomToken)
  //    and the modular SDK (signInWithCustomToken(auth, token)).
  let idToken;
  if (typeof firebaseAuth?.signInWithCustomToken === 'function') {
    // Compat SDK (firebase.auth())
    const userCred = await firebaseAuth.signInWithCustomToken(customToken);
    idToken = await userCred.user.getIdToken();
  } else {
    // Modular SDK
    const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js');
    const userCred = await signInWithCustomToken(firebaseAuth, customToken);
    idToken = await userCred.user.getIdToken();
  }

  // 3. Connect to SFU
  const client = new SfuClient({ sfuUrl, token: idToken, roomId, userId, userName, isSpeaker });
  await client.start({ videoEnabled });
  return client;
}

// Make available globally for the template and for module consumers
if (typeof window !== 'undefined') {
  window.SfuClient       = SfuClient;
  window.createSfuClient = createSfuClient;
}

if (typeof module !== 'undefined') {
  module.exports = { SfuClient, createSfuClient };
}
