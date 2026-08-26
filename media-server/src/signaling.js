'use strict';

const { verifyToken } = require('./auth');
const { Peer } = require('./Room');
const { getOrCreateRoom, cleanupRoomIfEmpty, getRooms } = require('./roomManager');
const { ACTIONS } = require('./protocol');

const ACTION_SET = new Set(ACTIONS);

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
  /** @type {import('./Room').Room | null} */
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

          room.broadcast(userId, {
            event: 'peerJoined',
            data: { userId, userName },
          });

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

        case 'setRtpCapabilities': {
          if (!peer) return error('Not joined');
          peer.rtpCapabilities = data.rtpCapabilities;
          reply({});
          break;
        }

        case 'createTransport': {
          if (!peer || !room) return error('Not joined');
          const { direction } = data; // 'send' | 'receive'
          const transport = await room.createWebRtcTransport();

          if (direction === 'send') {
            peer.sendTransport = transport;
          } else {
            peer.receiveTransport = transport;
          }

          reply({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
          break;
        }

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

          await room.onNewProducer(peer, producer);

          reply({ producerId: producer.id });
          break;
        }

        case 'readyToConsume': {
          if (!peer || !room) return error('Not joined');
          await room.subscribeNewPeerToExistingProducers(peer);
          reply({});
          break;
        }

        case 'resumeConsumer': {
          if (!peer) return error('Not joined');
          const { consumerId } = data;
          const consumer = peer.consumers.get(consumerId);
          if (!consumer) return error('Consumer not found');
          await consumer.resume();
          reply({});
          break;
        }

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

        case 'closeProducer': {
          if (!peer) return error('Not joined');
          const producer = peer.producers.get(data.producerId);
          if (!producer) return error('Producer not found');
          producer.close();
          peer.producers.delete(data.producerId);
          reply({});
          break;
        }

        case 'getStats': {
          if (!room) return error('Not joined');
          reply({
            rooms: getRooms().size,
            peers: room.peers.size,
            mode: room.getMode(),
          });
          break;
        }

        case 'ping': {
          reply({ ok: true });
          break;
        }

        default:
          if (!ACTION_SET.has(action)) {
            error(`Unknown action: ${action}`);
          } else {
            error(`Unhandled action: ${action}`);
          }
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

module.exports = { handleConnection };
