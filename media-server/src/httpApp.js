'use strict';

const express = require('express');
const cors = require('cors');
const config = require('./config');
const roomRegistry = require('./roomRegistry');
const { getRooms, totalPeers } = require('./roomManager');
const { workerCount } = require('./workers');

function createHttpApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const peers = totalPeers();
    roomRegistry.heartbeat(peers);
    res.json({
      ok: true,
      workers: workerCount(),
      rooms: getRooms().size,
      peers,
      announcedIp: config.webRtcTransportOptions.listenInfos[0]?.announcedAddress,
    });
  });

  app.get('/room-lookup/:roomId', async (req, res) => {
    const instance = await roomRegistry.lookupRoom(req.params.roomId);
    res.json({ roomId: req.params.roomId, instance: instance || null });
  });

  return app;
}

module.exports = { createHttpApp };
