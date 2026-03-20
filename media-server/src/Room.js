'use strict';

const { v4: uuidv4 } = require('uuid');
const config = require('./config');

/**
 * Room — one mediasoup Router + all peers inside a prayer room.
 *
 * Lifecycle:
 *   Room.create(worker) → room.addPeer() → peer.addProducer() →
 *   room.broadcastNewProducer() → peer.addConsumer() → ...
 *   → peer.close() → room.close() (when empty)
 */
class Room {
  /**
   * @param {string} roomId
   * @param {import('mediasoup').types.Router} router
   */
  constructor(roomId, router) {
    this.roomId = roomId;
    this.router = router;
    /** @type {Map<string, Peer>} userId → Peer */
    this.peers = new Map();
    this._activeSpeakerInterval = null;
    this._startActiveSpeakerDetection();
  }

  static async create(worker, roomId) {
    const router = await worker.createRouter({
      mediaCodecs: config.routerMediaCodecs,
    });
    return new Room(roomId, router);
  }

  get rtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  // ─── Peer Management ─────────────────────────────────────────────────────────

  addPeer(peer) {
    const prevMode = this.getMode();
    this.peers.set(peer.userId, peer);
    this._checkModeTransition(prevMode);
  }

  getPeer(userId) {
    return this.peers.get(userId);
  }

  removePeer(userId) {
    const prevMode = this.getMode();
    const peer = this.peers.get(userId);
    if (peer) {
      peer.close();
      this.peers.delete(userId);
    }
    // Notify remaining peers
    this.broadcast(userId, { event: 'peerLeft', data: { userId } });
    this._checkModeTransition(prevMode);
  }

  isEmpty() {
    return this.peers.size === 0;
  }

  // ─── Transport Factory ────────────────────────────────────────────────────────

  async createWebRtcTransport() {
    const transport = await this.router.createWebRtcTransport(
      config.webRtcTransportOptions,
    );
    transport.on('dtlsstatechange', (state) => {
      if (state === 'failed' || state === 'closed') transport.close();
    });
    return transport;
  }

  // ─── Consumer Factory ─────────────────────────────────────────────────────────

  /**
   * Create a Consumer on `consumerPeer` that receives from `producer`.
   * Returns null if the peer's device cannot consume the producer's codec.
   */
  async createConsumer(consumerPeer, producer) {
    if (
      !consumerPeer.rtpCapabilities ||
      !this.router.canConsume({
        producerId: producer.id,
        rtpCapabilities: consumerPeer.rtpCapabilities,
      })
    ) {
      return null;
    }

    const transport = consumerPeer.receiveTransport;
    if (!transport) return null;

    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities: consumerPeer.rtpCapabilities,
      paused: true, // start paused; client resumes after ACK
    });

    consumerPeer.addConsumer(consumer);

    consumer.on('transportclose', () => consumer.close());
    consumer.on('producerclose', () => {
      consumerPeer.removeConsumer(consumer.id);
      consumerPeer.notify({
        event: 'consumerClosed',
        data: { consumerId: consumer.id },
      });
    });
    consumer.on('producerpause', () => {
      consumerPeer.notify({
        event: 'consumerPaused',
        data: { consumerId: consumer.id },
      });
    });
    consumer.on('producerresume', () => {
      consumerPeer.notify({
        event: 'consumerResumed',
        data: { consumerId: consumer.id },
      });
    });

    return {
      consumer,
      params: {
        consumerId: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        producerUserId: producer._peerId,
        appData: producer.appData,
      },
    };
  }

  // ─── Broadcast ────────────────────────────────────────────────────────────────

  /**
   * Send an event to all peers EXCEPT the one with `excludeUserId`.
   */
  broadcast(excludeUserId, message) {
    for (const [uid, peer] of this.peers) {
      if (uid !== excludeUserId) peer.notify(message);
    }
  }

  /**
   * When a peer starts a new producer, subscribe all other peers to it
   * and notify the new producer's peer about existing producers.
   */
  async onNewProducer(producerPeer, producer) {
    // Tag producer with its owner
    producer._peerId = producerPeer.userId;

    // Subscribe all existing peers to this new producer
    for (const [uid, peer] of this.peers) {
      if (uid === producerPeer.userId) continue;
      const result = await this.createConsumer(peer, producer);
      if (!result) continue;
      peer.notify({
        event: 'newConsumer',
        data: result.params,
      });
    }

    // Let the room know about the new producer (for UI)
    this.broadcast(producerPeer.userId, {
      event: 'newProducer',
      data: {
        userId: producerPeer.userId,
        userName: producerPeer.userName,
        producerId: producer.id,
        kind: producer.kind,
        appData: producer.appData,
      },
    });
  }

  /**
   * When a new peer joins, subscribe it to all existing producers.
   */
  async subscribeNewPeerToExistingProducers(newPeer) {
    for (const [uid, existingPeer] of this.peers) {
      if (uid === newPeer.userId) continue;
      for (const producer of existingPeer.producers.values()) {
        const result = await this.createConsumer(newPeer, producer);
        if (!result) continue;
        newPeer.notify({
          event: 'newConsumer',
          data: result.params,
        });
      }
    }
  }

  // ─── Active Speaker Detection ─────────────────────────────────────────────────

  _startActiveSpeakerDetection() {
    // Poll audio levels every second
    this._activeSpeakerInterval = setInterval(async () => {
      try {
        await this._evaluateActiveSpeakers();
      } catch { /* ignore */ }
    }, 1000);
  }

  async _evaluateActiveSpeakers() {
    const levels = [];
    for (const [userId, peer] of this.peers) {
      for (const producer of peer.producers.values()) {
        if (producer.kind !== 'audio') continue;
        const stats = await producer.getStats();
        // Find audioLevel in stats (RTCStatsReport)
        for (const report of stats.values()) {
          if (report.audioLevel !== undefined) {
            levels.push({ userId, level: report.audioLevel });
          }
        }
      }
    }

    levels.sort((a, b) => b.level - a.level);
    const speakers = levels
      .filter((l) => l.level > 0.05)
      .slice(0, 5)
      .map((l) => l.userId);

    if (speakers.length > 0) {
      this.broadcast(null, {
        event: 'activeSpeakers',
        data: { speakers },
      });
    }
  }

  // ─── Room Mode ────────────────────────────────────────────────────────────────

  getMode() {
    return this.peers.size > 8 ? 'prayer_room' : 'group_call';
  }

  _checkModeTransition(prevMode) {
    const newMode = this.getMode();
    if (newMode !== prevMode) {
      this.broadcast(null, {
        event: 'modeChanged',
        data: { mode: newMode },
      });
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────

  close() {
    clearInterval(this._activeSpeakerInterval);
    this.router.close();
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
  }
}

// ─── Peer ─────────────────────────────────────────────────────────────────────

class Peer {
  /**
   * @param {string} userId
   * @param {string} userName
   * @param {WebSocket} ws
   */
  constructor(userId, userName, ws) {
    this.userId = userId;
    this.userName = userName;
    this.ws = ws;
    this.isSpeaker = false;

    /** RTP capabilities reported by the client device */
    this.rtpCapabilities = null;

    /** @type {import('mediasoup').types.WebRtcTransport | null} */
    this.sendTransport = null;
    /** @type {import('mediasoup').types.WebRtcTransport | null} */
    this.receiveTransport = null;

    /** @type {Map<string, import('mediasoup').types.Producer>} */
    this.producers = new Map();
    /** @type {Map<string, import('mediasoup').types.Consumer>} */
    this.consumers = new Map();
  }

  addProducer(producer) { this.producers.set(producer.id, producer); }
  addConsumer(consumer) { this.consumers.set(consumer.id, consumer); }
  removeConsumer(consumerId) { this.consumers.delete(consumerId); }

  notify(message) {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close() {
    for (const p of this.producers.values()) p.close();
    for (const c of this.consumers.values()) c.close();
    this.sendTransport?.close();
    this.receiveTransport?.close();
  }
}

module.exports = { Room, Peer };
