'use strict';

/**
 * Redis-backed room registry for multi-instance SFU deployment.
 *
 * Each SFU instance registers the rooms it hosts in Redis with a TTL.
 * When a client asks to join a room, the signaling layer can look up which
 * SFU instance hosts that room and route accordingly.
 *
 * If Redis is not available, falls back to a no-op (single-instance mode).
 */

const REDIS_KEY_PREFIX = 'sfu:room:';
const INSTANCE_KEY_PREFIX = 'sfu:instance:';
const TTL_SECONDS = 120; // rooms expire if not refreshed

let redisClient = null;
let instanceId = null;

async function init() {
  const host = process.env.REDIS_HOST;
  if (!host) {
    console.log('[roomRegistry] No REDIS_HOST — running in single-instance mode');
    return;
  }

  try {
    const { createClient } = require('redis');
    redisClient = createClient({
      url: `redis://${host}:${process.env.REDIS_PORT || 6379}`,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    await redisClient.connect();

    instanceId =
      process.env.SFU_INSTANCE_ID ||
      `sfu-${process.env.HOSTNAME || require('os').hostname()}-${process.pid}`;

    console.log(`[roomRegistry] Connected to Redis as instance ${instanceId}`);
  } catch (err) {
    console.warn('[roomRegistry] Redis init failed, single-instance mode:', err.message);
    redisClient = null;
  }
}

async function registerRoom(roomId) {
  if (!redisClient) return;
  try {
    await redisClient.setEx(`${REDIS_KEY_PREFIX}${roomId}`, TTL_SECONDS, instanceId);
  } catch (err) {
    console.warn('[roomRegistry] registerRoom error:', err.message);
  }
}

async function refreshRoom(roomId) {
  return registerRoom(roomId); // same operation — reset TTL
}

async function unregisterRoom(roomId) {
  if (!redisClient) return;
  try {
    await redisClient.del(`${REDIS_KEY_PREFIX}${roomId}`);
  } catch (err) {
    console.warn('[roomRegistry] unregisterRoom error:', err.message);
  }
}

async function lookupRoom(roomId) {
  if (!redisClient) return null;
  try {
    return await redisClient.get(`${REDIS_KEY_PREFIX}${roomId}`);
  } catch {
    return null;
  }
}

async function heartbeat(peerCount) {
  if (!redisClient || !instanceId) return;
  try {
    await redisClient.setEx(
      `${INSTANCE_KEY_PREFIX}${instanceId}`,
      TTL_SECONDS,
      JSON.stringify({ peers: peerCount, ts: Date.now() }),
    );
  } catch {}
}

module.exports = {
  init,
  registerRoom,
  refreshRoom,
  unregisterRoom,
  lookupRoom,
  heartbeat,
};
