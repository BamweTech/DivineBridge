'use strict';

require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const config = require('./config');
const roomRegistry = require('./roomRegistry');
const { createWorkers, workerCount } = require('./workers');
const { createHttpApp } = require('./httpApp');
const { handleConnection } = require('./signaling');

async function main() {
  await roomRegistry.init();

  const announcedIp = await config.resolveAnnouncedIp();
  for (const info of config.webRtcTransportOptions.listenInfos) {
    info.announcedAddress = announcedIp;
  }
  console.log(`[sfu] Announced IP: ${announcedIp}`);

  await createWorkers();

  const app = createHttpApp();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', handleConnection);

  server.listen(config.port, () => {
    console.log(`[sfu] DivineBridge SFU running on port ${config.port}`);
    console.log(`[sfu] ${workerCount()} mediasoup worker(s) ready`);
  });
}

main().catch((err) => {
  console.error('[sfu] fatal:', err);
  process.exit(1);
});
