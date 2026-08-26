'use strict';

/**
 * Cross-runtime SFU protocol contract check (media-server side).
 * Compares media-server/src/protocol.js against contracts/sfu-protocol.json.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'contracts/sfu-protocol.json'), 'utf8'),
);
const protocol = require('../src/protocol');

assert.deepStrictEqual([...protocol.ACTIONS].sort(), [...fixture.actions].sort());
assert.deepStrictEqual([...protocol.EVENTS].sort(), [...fixture.events].sort());
assert.strictEqual(protocol.ROOM_MODES.GROUP_CALL, fixture.roomModes.GROUP_CALL);
assert.strictEqual(protocol.ROOM_MODES.PRAYER_ROOM, fixture.roomModes.PRAYER_ROOM);
assert.strictEqual(
  protocol.GROUP_CALL_MAX_PARTICIPANTS,
  fixture.thresholds.groupCallMaxParticipants,
);

console.log('media-server protocol contract OK');
