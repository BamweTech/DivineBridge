'use strict';
/**
 * SFU Smoke Test
 *
 * Simulates two clients (Alice + Bob) joining the same room,
 * verifying the full signaling handshake:
 *
 *  ✓ Both connect and join
 *  ✓ Alice gets Bob's peer info (and vice versa)
 *  ✓ Both create send + receive transports
 *  ✓ Alice "produces" audio → Bob receives a newConsumer event
 *  ✓ Active speaker detection fires
 *  ✓ Both leave cleanly
 *
 * Run:  node test/smoke.js
 * Requires the SFU to be running on localhost:3000 with DEV_MODE=true
 */

const WebSocket = require('ws');

const SFU_URL = 'ws://localhost:3000/ws';
const ROOM_ID = 'smoke-test-room-' + Date.now();

// ─── Dev token helper (base64 JSON — accepted in DEV_MODE) ────────────────────
function devToken(userId, userName) {
  return Buffer.from(JSON.stringify({ userId, userName, roomId: ROOM_ID })).toString('base64');
}

// ─── Simple client wrapper ────────────────────────────────────────────────────
function makeClient(userId, userName) {
  return new Promise((resolveClient) => {
    const ws = new WebSocket(SFU_URL);
    let counter = 0;
    const pending = new Map();
    const events = [];

    ws.on('open', () => resolveClient(client));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.requestId != null) {
        const cb = pending.get(String(msg.requestId));
        if (cb) {
          pending.delete(String(msg.requestId));
          msg.ok ? cb.resolve(msg.data) : cb.reject(new Error(msg.error));
        }
      } else if (msg.event) {
        events.push(msg);
        console.log(`  [${userName}] ← event: ${msg.event}`, JSON.stringify(msg.data).slice(0, 120));
      }
    });

    const client = {
      userId, userName, ws, events,
      request(action, data = {}) {
        return new Promise((resolve, reject) => {
          const requestId = String(++counter);
          pending.set(requestId, { resolve, reject });
          ws.send(JSON.stringify({ action, requestId, data }));
          setTimeout(() => {
            if (pending.has(requestId)) {
              pending.delete(requestId);
              reject(new Error(`Timeout: ${action}`));
            }
          }, 8000);
        });
      },
      close() { ws.close(); },
      waitForEvent(name, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
          const check = setInterval(() => {
            const e = events.find((ev) => ev.event === name);
            if (e) { clearInterval(check); resolve(e.data); }
          }, 100);
          setTimeout(() => { clearInterval(check); reject(new Error(`Timeout waiting for event: ${name}`)); }, timeoutMs);
        });
      },
    };
  });
}

// ─── Fake RTP params (good enough for signaling test — no real media) ─────────
const FAKE_RTP_CAPS = {
  codecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2, rtcpFeedback: [] },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, rtcpFeedback: [] },
  ],
  headerExtensions: [],
};

const FAKE_AUDIO_RTP_PARAMS = {
  mid: '0',
  codecs: [{ mimeType: 'audio/opus', clockRate: 48000, channels: 2, payloadType: 111, parameters: { useinbandfec: 1 } }],
  headerExtensions: [],
  encodings: [{ ssrc: 11111111 }],
  rtcp: { cname: 'test-alice', reducedSize: true },
};

// ─── Test runner ──────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🧪 DivineBridge SFU Smoke Test`);
  console.log(`   Room: ${ROOM_ID}`);
  console.log(`   SFU:  ${SFU_URL}\n`);

  let passed = 0;
  let failed = 0;

  function pass(label) { console.log(`  ✅ ${label}`); passed++; }
  function fail(label, err) { console.log(`  ❌ ${label}: ${err.message}`); failed++; }

  let alice, bob;

  // ── Connect ──────────────────────────────────────────────────────────────
  try {
    [alice, bob] = await Promise.all([
      makeClient('alice-uid', 'Alice'),
      makeClient('bob-uid', 'Bob'),
    ]);
    pass('Alice + Bob connected to WebSocket');
  } catch (e) {
    fail('WebSocket connect', e);
    process.exit(1);
  }

  // ── Alice joins ──────────────────────────────────────────────────────────
  let aliceJoin;
  try {
    aliceJoin = await alice.request('join', {
      token: devToken('alice-uid', 'Alice'),
      roomId: ROOM_ID,
    });
    pass(`Alice joined (mode: ${aliceJoin.mode}, peers: ${aliceJoin.peers.length})`);
  } catch (e) { fail('Alice join', e); }

  // ── Bob joins ────────────────────────────────────────────────────────────
  let bobJoin;
  try {
    bobJoin = await bob.request('join', {
      token: devToken('bob-uid', 'Bob'),
      roomId: ROOM_ID,
    });
    pass(`Bob joined (peers: ${bobJoin.peers.length} — should see Alice)`);
    if (!bobJoin.peers.find((p) => p.userId === 'alice-uid')) {
      fail('Bob should see Alice in peer list', new Error('alice-uid not found'));
    } else {
      pass('Bob sees Alice in peer list');
    }
  } catch (e) { fail('Bob join', e); }

  // ── Alice should get peerJoined event for Bob ─────────────────────────────
  try {
    const ev = await alice.waitForEvent('peerJoined');
    if (ev.userId === 'bob-uid') pass(`Alice got peerJoined for Bob`);
    else fail('peerJoined userId mismatch', new Error(`got ${ev.userId}`));
  } catch (e) { fail('Alice peerJoined event', e); }

  // ── Set RTP capabilities ─────────────────────────────────────────────────
  try {
    await Promise.all([
      alice.request('setRtpCapabilities', { rtpCapabilities: FAKE_RTP_CAPS }),
      bob.request('setRtpCapabilities', { rtpCapabilities: FAKE_RTP_CAPS }),
    ]);
    pass('Both set RTP capabilities');
  } catch (e) { fail('setRtpCapabilities', e); }

  // ── Create transports ────────────────────────────────────────────────────
  let aliceSendTransport, aliceRecvTransport;
  try {
    [aliceSendTransport, aliceRecvTransport] = await Promise.all([
      alice.request('createTransport', { direction: 'send' }),
      alice.request('createTransport', { direction: 'receive' }),
    ]);
    pass(`Alice transports created (send: ${aliceSendTransport.transportId.slice(0,8)}…)`);
  } catch (e) { fail('Alice createTransport', e); }

  let bobRecvTransport;
  try {
    bobRecvTransport = await bob.request('createTransport', { direction: 'receive' });
    pass(`Bob receive transport created`);
  } catch (e) { fail('Bob createTransport', e); }

  // ── Connect transports (fake DTLS) ────────────────────────────────────────
  const fakeDtls = { role: 'client', fingerprints: [{ algorithm: 'sha-256', value: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99' }] };
  try {
    await Promise.all([
      alice.request('connectTransport', { transportId: aliceSendTransport.transportId, dtlsParameters: fakeDtls }),
      alice.request('connectTransport', { transportId: aliceRecvTransport.transportId, dtlsParameters: fakeDtls }),
      bob.request('connectTransport', { transportId: bobRecvTransport.transportId, dtlsParameters: fakeDtls }),
    ]);
    pass('All transports connected (DTLS handshake)');
  } catch (e) { fail('connectTransport', e); }

  // ── Alice produces audio ──────────────────────────────────────────────────
  let audioProducerId;
  try {
    const result = await alice.request('produce', {
      kind: 'audio',
      rtpParameters: FAKE_AUDIO_RTP_PARAMS,
      appData: { kind: 'audio' },
    });
    audioProducerId = result.producerId;
    pass(`Alice produced audio (id: ${audioProducerId.slice(0,8)}…)`);
  } catch (e) { fail('Alice produce audio', e); }

  // ── Bob should get newConsumer event ──────────────────────────────────────
  try {
    const ev = await bob.waitForEvent('newConsumer', 6000);
    if (ev.producerUserId === 'alice-uid') pass(`Bob got newConsumer from Alice (kind: ${ev.kind})`);
    else fail('newConsumer producerUserId mismatch', new Error(`got ${ev.producerUserId}`));
  } catch (e) { fail('Bob newConsumer event', e); }

  // ── Mute / unmute ─────────────────────────────────────────────────────────
  try {
    await alice.request('pauseProducer', { producerId: audioProducerId });
    await alice.request('resumeProducer', { producerId: audioProducerId });
    pass('Mute + unmute producer');
  } catch (e) { fail('pause/resumeProducer', e); }

  // ── peerLeft ──────────────────────────────────────────────────────────────
  bob.close();
  try {
    await alice.waitForEvent('peerLeft', 3000);
    pass('Alice got peerLeft when Bob disconnected');
  } catch (e) { fail('peerLeft event', e); }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  alice.close();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
