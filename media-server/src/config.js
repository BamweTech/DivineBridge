'use strict';

require('dotenv').config();
const os = require('os');

module.exports = {
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

  // ICE / DTLS transport settings
  webRtcTransportOptions: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: process.env.ANNOUNCED_IP ?? '127.0.0.1',
      },
      {
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress: process.env.ANNOUNCED_IP ?? '127.0.0.1',
      },
    ],
    initialAvailableOutgoingBitrate: 1_000_000,
    minimumAvailableOutgoingBitrate: 600_000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1_500_000,
  },
};
