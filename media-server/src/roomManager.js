'use strict';

const { Room } = require('./Room');
const roomRegistry = require('./roomRegistry');
const { getNextWorker } = require('./workers');

/** @type {Map<string, import('./Room').Room>} roomId → Room */
const rooms = new Map();

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const room = await Room.create(getNextWorker(), roomId);
  rooms.set(roomId, room);
  roomRegistry.registerRoom(roomId);
  console.log(`[sfu] room ${roomId} created`);
  return room;
}

function cleanupRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.isEmpty()) {
    room.close();
    rooms.delete(roomId);
    roomRegistry.unregisterRoom(roomId);
    console.log(`[sfu] room ${roomId} closed (empty)`);
  }
}

function getRooms() {
  return rooms;
}

function totalPeers() {
  return Array.from(rooms.values()).reduce((n, r) => n + r.peers.size, 0);
}

module.exports = {
  getOrCreateRoom,
  cleanupRoomIfEmpty,
  getRooms,
  totalPeers,
};
