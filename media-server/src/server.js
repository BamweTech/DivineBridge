'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const mediasoup = require('mediasoup');
const { verifyToken } = require('./auth');
const config = require('./config');
const { Room, Peer } = require('./Room');

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {import('mediasoup').types.Worker[]} */
const workers = [];
let nextWorkerIdx = 0;

/** @type {Map<string, Room>} roomId → Room */
const rooms = new Map();

// ─── Worker Pool ──────────────────────────────────────────────────────────────

async function createWorkers() {
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker(config.workerSettings);
    worker.on('died', () => {
      console.error(`mediasoup worker ${worker.pid} died — restarting in 2s`);
      setTimeout(createWorkers, 2000);
    });
    workers.push(worker);
    console.log(`[sfu] worker ${worker.pid} ready`);
  }
}

function getNextWorker() {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

// ─── Room Registry ────────────────────────────────────────────────────────────

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const room = await Room.create(getNextWorker(), roomId);
  rooms.set(roomId, room);
  console.log(`[sfu] room ${roomId} created`);
  return room;
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.isEmpty()) {
    room.close();
    rooms.delete(roomId);
    console.log(`[sfu] room ${roomId} closed (empty)`);
  }
}

// ─── WebSocket Signaling ──────────────────────────────────────────────────────

/**
 * Handle one WebSocket connection (= one participant).
 *
 * All messages are JSON: { action, requestId, data }
 * Responses:       { requestId, ok: true, data }
 * Errors:          { requestId, ok: false, error }
 * Push events:     { event, data }
 */
function handleConnection(ws) {
  /** @type {Peer | null} */
  let peer = null;
  /** @type {Room | null} */
  let room = null;

  ws.on('message', async (raw) => {
    let requestId, action, data;
    try {
      ({ requestId, action, data } = JSON.parse(raw));
    } catch {
      return;
    }

    const reply = (payload) =>
      ws.send(JSON.stringify({ requestId, ok: true, data: payload }));
    const error = (msg) =>
      ws.send(JSON.stringify({ requestId, ok: false, error: msg }));

    try {
      switch (action) {
        // ── 1. Join room ──────────────────────────────────────────────────────
        case 'join': {
          const { token, roomId } = data;
          let claims;
          try {
            claims = await verifyToken(token, roomId);
          } catch (e) {
            console.warn('[sfu] auth failed:', e.message);
            return error('Invalid or expired token');
          }

          const { userId, userName } = claims;
          peer = new Peer(userId, userName, ws);
          room = await getOrCreateRoom(roomId);
          room.addPeer(peer);

          // Notify existing peers
          room.broadcast(userId, {
            event: 'peerJoined',
            data: { userId, userName },
          });

          // Return router capabilities + current peer list
          const peerList = Array.from(room.peers.values())
            .filter((p) => p.userId !== userId)
            .map((p) => ({ userId: p.userId, userName: p.userName }));

          reply({
            routerRtpCapabilities: room.rtpCapabilities,
            peers: peerList,
            mode: room.getMode(),
          });
          console.log(`[sfu] ${userName} joined room ${roomId}`);
          break;
        }

        // ── 2. Store client RTP capabilities ─────────────────────────────────
        case 'setRtpCapabilities': {
          if (!peer) return error('Not joined');
          peer.rtpCapabilities = data.rtpCapabilities;
          reply({});
          break;
        }

        // ── 3. Create send or receive transport ───────────────────────────────
        case 'createTransport': {
          if (!peer || !room) return error('Not joined');
          const { direction } = data; // 'send' | 'receive'
          const transport = await room.createWebRtcTransport();

          if (direction === 'send') {
            peer.sendTransport = transport;
          } else {
            peer.receiveTransport = transport;
            // Now subscribe this peer to all existing producers
            await room.subscribeNewPeerToExistingProducers(peer);
          }

          reply({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
          break;
        }

        // ── 4. Complete DTLS handshake ────────────────────────────────────────
        case 'connectTransport': {
          if (!peer) return error('Not joined');
          const { transportId, dtlsParameters } = data;

          const transport =
            peer.sendTransport?.id === transportId
              ? peer.sendTransport
              : peer.receiveTransport;
          if (!transport) return error('Transport not found');

          await transport.connect({ dtlsParameters });
          reply({});
          break;
        }

        // ── 5. Produce (publish audio or video) ───────────────────────────────
        case 'produce': {
          if (!peer || !room) return error('Not joined');
          const { kind, rtpParameters, appData } = data;

          if (!peer.sendTransport) return error('Send transport not ready');

          const producer = await peer.sendTransport.produce({
            kind,
            rtpParameters,
            appData: appData ?? {},
          });
          peer.addProducer(producer);

          producer.on('transportclose', () => {
            peer.producers.delete(producer.id);
          });

          // Fan out to all other peers
          await room.onNewProducer(peer, producer);

          reply({ producerId: producer.id });
          break;
        }

        // ── 6. Resume consumer (client ACK after receiving newConsumer) ────────
        case 'resumeConsumer': {
          if (!peer) return error('Not joined');
          const { consumerId } = data;
          const consumer = peer.consumers.get(consumerId);
          if (!consumer) return error('Consumer not found');
          await consumer.resume();
          reply({});
          break;
        }

        // ── 7. Pause / resume own producer (mute/unmute) ──────────────────────
        case 'pauseProducer': {
          if (!peer) return error('Not joined');
          const producer = peer.producers.get(data.producerId);
          if (!producer) return error('Producer not found');
          await producer.pause();
          reply({});
          break;
        }

        case 'resumeProducer': {
          if (!peer) return error('Not joined');
          const producer = peer.producers.get(data.producerId);
          if (!producer) return error('Producer not found');
          await producer.resume();
          reply({});
          break;
        }

        // ── 8. Close a producer (stop video, screen share end, etc.) ──────────
        case 'closeProducer': {
          if (!peer) return error('Not joined');
          const producer = peer.producers.get(data.producerId);
          if (!producer) return error('Producer not found');
          producer.close();
          peer.producers.delete(data.producerId);
          reply({});
          break;
        }

        // ── 9. Get router stats (debug) ───────────────────────────────────────
        case 'getStats': {
          if (!room) return error('Not joined');
          reply({
            rooms: rooms.size,
            peers: room.peers.size,
            mode: room.getMode(),
          });
          break;
        }

        default:
          error(`Unknown action: ${action}`);
      }
    } catch (err) {
      console.error(`[sfu] error handling ${action}:`, err.message);
      error(err.message);
    }
  });

  ws.on('close', () => {
    if (!peer || !room) return;
    const roomId = room.roomId;
    console.log(`[sfu] ${peer.userName} left room ${roomId}`);
    room.removePeer(peer.userId);
    cleanupRoomIfEmpty(roomId);
    peer = null;
    room = null;
  });

  ws.on('error', (err) => {
    console.error('[sfu] ws error:', err.message);
  });
}

// ─── HTTP Server (health + token info) ───────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    workers: workers.length,
    rooms: rooms.size,
    peers: Array.from(rooms.values()).reduce((n, r) => n + r.peers.size, 0),
  });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  await createWorkers();

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', handleConnection);

  server.listen(config.port, () => {
    console.log(`[sfu] DivineBridge SFU running on port ${config.port}`);
    console.log(`[sfu] ${workers.length} mediasoup worker(s) ready`);
  });
}

main().catch((err) => {
  console.error('[sfu] fatal:', err);
  process.exit(1);
});
