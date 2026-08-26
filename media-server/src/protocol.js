'use strict';

/**
 * SFU WebSocket protocol contract.
 * Keep in sync with:
 *   - contracts/sfu-protocol.json
 *   - mobile/lib/constants.ts (ROOM_MODES / caps)
 *   - web/static/js/sfu-client.js
 *   - mobile/lib/sfu.ts
 */

/** Client → server request actions (`{ action, requestId, data }`). */
const ACTIONS = Object.freeze([
  'join',
  'setRtpCapabilities',
  'createTransport',
  'connectTransport',
  'produce',
  'readyToConsume',
  'resumeConsumer',
  'pauseProducer',
  'resumeProducer',
  'closeProducer',
  'getStats',
  'ping',
]);

/** Server → client push events (`{ event, data }`). */
const EVENTS = Object.freeze([
  'peerJoined',
  'peerLeft',
  'newProducer',
  'newConsumer',
  'consumerClosed',
  'consumerPaused',
  'consumerResumed',
  'activeSpeakers',
  'modeChanged',
]);

const ROOM_MODES = Object.freeze({
  GROUP_CALL: 'group_call',
  PRAYER_ROOM: 'prayer_room',
});

/** Max peers before automatic transition to prayer_room mode. */
const GROUP_CALL_MAX_PARTICIPANTS = 8;

module.exports = {
  ACTIONS,
  EVENTS,
  ROOM_MODES,
  GROUP_CALL_MAX_PARTICIPANTS,
};
