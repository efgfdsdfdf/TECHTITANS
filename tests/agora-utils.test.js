const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');

const context = {
  TextEncoder,
  crypto: webcrypto,
  window: {},
};

vm.createContext(context);
vm.runInContext(readFileSync('agora-utils.js', 'utf8'), context);

async function run() {
  const { compactChannelName, isValidChannelName } = context.window.TechTitansAgora;
  const userA = '00000000-0000-4000-8000-000000000001';
  const userB = '00000000-0000-4000-8000-000000000002';
  const userC = '00000000-0000-4000-8000-000000000003';

  const dmOne = await compactChannelName('dm', [userA, userB].sort().join('_'));
  const dmOneReversed = await compactChannelName('dm', [userB, userA].sort().join('_'));
  const dmTwo = await compactChannelName('dm', [userA, userC].sort().join('_'));
  const groupOne = await compactChannelName('group', 'Engineering');
  const groupOneAgain = await compactChannelName('group', 'Engineering');
  const longGroup = await compactChannelName('group', 'A'.repeat(500));

  assert.equal(dmOne, dmOneReversed, 'same DM users should produce the same channel');
  assert.notEqual(dmOne, dmTwo, 'different DM users should produce different channels');
  assert.equal(groupOne, groupOneAgain, 'same group should produce the same channel');
  assert.ok(isValidChannelName(dmOne), 'DM channel should be valid');
  assert.ok(isValidChannelName(groupOne), 'group channel should be valid');
  assert.ok(new TextEncoder().encode(longGroup).length < 64, 'long identifiers should hash under 64 bytes');
}

run()
  .then(() => console.log('Agora channel tests passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
