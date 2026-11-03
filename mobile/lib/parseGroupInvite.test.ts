import { parseGroupInviteInput, parseInviteUrl } from './parseGroupInvite';

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got !== want) {
    throw new Error(`${label}\nexpected ${want}\ngot      ${got}`);
  }
}

const groupId = '11111111-2222-4333-8444-555555555555';
const code = 'A1B2C3D4';
const inviteUrl = `https://divinebridge.io/join/${groupId}?code=${code}`;

assertEqual(
  parseGroupInviteInput(`  ${code.toLowerCase()}  `),
  { groupId: '', code },
  'short code',
);

assertEqual(
  parseGroupInviteInput('Code: a1b2c3d4'),
  { groupId: '', code },
  'labeled code',
);

assertEqual(
  parseGroupInviteInput('a1b2 c3d4'),
  { groupId: '', code },
  'spaced code',
);

assertEqual(
  parseGroupInviteInput(inviteUrl),
  { groupId, code },
  'invite url',
);

assertEqual(
  parseGroupInviteInput(
    `Join me in "Morning Seekers" on DivineBridge — a space for prayer and community.\n\n${inviteUrl}`,
  ),
  { groupId, code },
  'share message',
);

assertEqual(
  parseGroupInviteInput(`io.divinebridge.app://join/${groupId}?code=${code}`),
  { groupId, code },
  'custom scheme',
);

assertEqual(
  parseGroupInviteInput(
    `https://divinebridge.io/prayers?join_group=${groupId}&invite_code=${code.toLowerCase()}`,
  ),
  { groupId, code },
  'join_group query',
);

assertEqual(parseGroupInviteInput(''), null, 'empty');
assertEqual(parseGroupInviteInput('not a code'), null, 'garbage');
assertEqual(parseInviteUrl(inviteUrl), { groupId, code }, 'deep link url');
assertEqual(parseInviteUrl(code), null, 'deep link ignores bare code');

console.log('parseGroupInvite tests passed');
