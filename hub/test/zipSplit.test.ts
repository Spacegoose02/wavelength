import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pack, readZip, writeZip } from '../src/zipSplit.ts';
import { makeZip, unzip } from './zipHelpers.ts';

test('a zip splits into smaller zips that hold the same members, untouched', () => {
  const files = { 'manifest.json': '{"format":"subwave-backup"}', 'jingles/a.mp3': 'a'.repeat(5000), 'voices/b.wav': 'b'.repeat(7000), 'settings.json': '{"station":"Main"}' };
  const zip = makeZip(files);
  const members = readZip(zip);
  assert.deepEqual(members.map((m) => m.name), Object.keys(files));

  const again = writeZip(members);
  assert.deepEqual(unzip(again), files, 'rewriting keeps every member');

  const part = writeZip([members[0], members[2]]);
  assert.deepEqual(unzip(part), { 'manifest.json': files['manifest.json'], 'voices/b.wav': files['voices/b.wav'] });
  assert.equal(readZip(part)[1].central.readUInt32LE(42), members[0].local.length, 'offsets point at the new places');
});

test('members are packed into groups under a budget, a big one on its own', () => {
  const m = (name: string, n: number) => ({ name, local: Buffer.alloc(n), central: Buffer.alloc(46) });
  const groups = pack([m('a', 40), m('b', 40), m('c', 200), m('d', 10)], 100);
  assert.deepEqual(groups.map((g) => g.map((x) => x.name)), [['a', 'b'], ['c'], ['d']]);
});
