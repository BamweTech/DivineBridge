'use strict';

require('dotenv').config();
const os = require('os');
const http = require('http');

// ─── Public IP Detection ──────────────────────────────────────────────────────
// On GCE, fetch the external IP from the metadata server so ICE candidates
// advertise the correct address.  Falls back to ANNOUNCED_IP env var, then
// 127.0.0.1 for local development.

function fetchGcePublicIp() {
  return new Promise((resolve) => {
    const req = http.get(
      'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip',
      { headers: { 'Metadata-Flavor': 'Google' }, timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body.trim() || null));
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Resolve the public IP to announce in ICE candidates.
 * Priority: explicit ANNOUNCED_IP env var (if not 127.0.0.1) → GCE metadata → 127.0.0.1
 */
async function resolveAnnouncedIp() {
  const envIp = process.env.ANNOUNCED_IP;

  if (envIp && envIp !== '127.0.0.1') {
    return envIp;
  }

  const gceIp = await fetchGcePublicIp();
  if (gceIp) {
    console.log(`[config] Auto-detected GCE public IP: ${gceIp}`);
    return gceIp;
  }

  return '127.0.0.1';
}

// ─── Config (announced IP patched at startup by server.js) ────────────────────

const config = {
  // ─── HTTP / WebSocket ────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT ?? '3000', 10),

  // ─── Auth ────────────────────────────────────────────────────────────────────
  jwtSecret: process.env.SFU_JWT_SECRET ?? 'dev_secret_change_in_prod',

  // ─── mediasoup ───────────────────────────────────────────────────────────────
  numWorkers: parseInt(process.env.NUM_WORKERS ?? String(os.cpus().length), 10),

  workerSettings: {
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: parseInt(process.env.RTC_MIN_PORT ?? '10000', 10),
    rtcMaxPort: parseInt(process.env.RTC_MAX_PORT ?? '10999', 10),
  },

  // Codecs offered to clients — both audio and video
  routerMediaCodecs: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
      parameters: {
        'sprop-stereo': 1,
        useinbandfec: 1,     // Forward Error Correction
        usedtx: 1,           // Discontinuous Transmission (silence suppression)
      },
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: { 'x-google-start-bitrate': 1000 },
    },
    {
      kind: 'video',
      mimeType: 'video/VP9',
      clockRate: 90000,
      parameters: {
        'profile-id': 2,
        'x-google-start-bitrate': 1000,
      },
    },
    {
      kind: 'video',
      mimeType: 'video/h264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '4d0032',
        'level-asymmetry-allowed': 1,
        'x-google-start-bitrate': 1000,
      },
    },
  ],

  // ICE / DTLS transport settings — announcedAddress is patched by resolveAnnouncedIp()
  webRtcTransportOptions: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: '127.0.0.1', // placeholder, resolved at startup
      },
      {
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress: '127.0.0.1', // placeholder, resolved at startup
      },
    ],
    initialAvailableOutgoingBitrate: 1_000_000,
    minimumAvailableOutgoingBitrate: 600_000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1_500_000,
  },

  resolveAnnouncedIp,
};

module.exports = config;
