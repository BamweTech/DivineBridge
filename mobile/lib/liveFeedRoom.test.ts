import { isLiveFeedRoom } from './liveFeedRoom';

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got !== want) {
    throw new Error(`${label}\nexpected ${want}\ngot      ${got}`);
  }
}

// Standard prayer / group live rooms (with or without an explicit type) belong
// in the shared feed. Only private 1:1 call types are excluded client-side.
assertEqual(isLiveFeedRoom({ room_type: 'prayer' }), true, 'prayer rooms are live-feed visible');
assertEqual(isLiveFeedRoom({}), true, 'rooms without room_type stay visible client-side');
assertEqual(isLiveFeedRoom({ room_type: 'voice_link' }), false, 'voice link hidden');
assertEqual(
  isLiveFeedRoom({ room_type: 'matched_prayer_call' }),
  false,
  'matched private prayer call hidden',
);

console.log('liveFeedRoom.test.ts: ok');
