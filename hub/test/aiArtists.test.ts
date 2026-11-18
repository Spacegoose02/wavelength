import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MixLookups } from '../src/mixes.ts';
import { json, seeded } from './helpers.ts';

const DAY = 86_400_000;
const RELATED: Record<string, string[]> = { 'velvet sundown': ['Future', 'Adele'], future: ['Velvet Sundown', 'Young Thug'], adele: ['Sam Smith', 'Velvet Sundown'] };
const look: MixLookups = { related: async (a) => RELATED[a.toLowerCase()] ?? [], top: async (a) => [{ title: `${a} hit`, artist: a }] };

test('admins mark artists as AI-generated, everyone reads the list, and a rename keeps the mark', async () => {
  const { app, tokens } = await seeded();
  const list = async () => (await json(app, 'GET', '/api/ai-artists', { token: tokens.member })).body.artists as { name: string; setBy: string | null }[];
  const put = (body: unknown, token = tokens.admin) => json(app, 'PUT', '/api/admin/ai-artists', { token, body });
  assert.equal((await json(app, 'GET', '/api/ai-artists')).status, 401);
  assert.deepEqual(await list(), []);
  assert.equal((await put({ name: 'Velvet Sundown', ai: true }, tokens.member)).status, 403);
  assert.equal((await put({ name: 'Velvet Sundown' })).status, 400);
  assert.equal((await put({ ai: true })).status, 400);

  const set = await put({ name: 'Velvet Sundown', ai: true });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.artist.name, 'Velvet Sundown');
  assert.equal(set.body.artist.setBy, 'boss');
  await put({ name: 'Aria Neon', ai: true });
  assert.deepEqual((await list()).map((a) => a.name), ['Aria Neon', 'Velvet Sundown']);
  // names match loosely: marking again in another case just renames the mark
  await put({ name: 'velvet sundown', ai: true });
  assert.deepEqual((await list()).map((a) => a.name), ['Aria Neon', 'velvet sundown']);

  const moved = await json(app, 'POST', '/api/admin/ai-artists/rename', { token: tokens.admin, body: { from: 'Aria Neon', to: 'Aria' } });
  assert.equal(moved.body.moved, true);
  assert.ok((await list()).some((a) => a.name === 'Aria' && a.setBy === 'boss'));
  assert.equal((await json(app, 'POST', '/api/admin/ai-artists/rename', { token: tokens.admin, body: { from: 'Nobody', to: 'X' } })).body.moved, false);

  const off = await put({ name: 'aria', ai: false });
  assert.equal(off.body.artist, null);
  assert.ok(!(await list()).some((a) => a.name === 'Aria'));
});

test('keeping AI artists out of your picks leaves them out of your mixes, for you only', async () => {
  const { app, db, tokens, ids } = await seeded({}, {}, { mixLookups: look });
  const play = (userId: number, at: number, title: string, artist: string) =>
    db.prepare('INSERT OR IGNORE INTO plays (user_id, played_at, title, artist, album, seconds, track) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, at, title, artist, 'Album', 200, JSON.stringify({ kind: 'track', id: title, sourceId: 'nd', title, artist, coverUrl: 'https://x/c.jpg' }));
  let at = Date.now() - 5 * DAY;
  for (const who of [ids.member, ids.admin]) {
    for (let i = 0; i < 4; i++) for (const [t, a] of [['One', 'Velvet Sundown'], ['Two', 'Velvet Sundown feat. Aria'], ['Three', 'Future'], ['Four', 'Adele'], ['Five', 'Adele'], ['Six', 'Future']]) play(who, (at += 60_000), t, a);
  }
  const songs = async (token: string) => ((await json(app, 'GET', '/api/mixes', { token })).body.mixes as { songs: { artist: string }[] }[]).flatMap((m) => m.songs);
  await json(app, 'PUT', '/api/admin/ai-artists', { token: tokens.admin, body: { name: 'Velvet Sundown', ai: true } });
  // marking alone changes nothing: each person chooses
  assert.ok((await songs(tokens.member)).some((s) => s.artist.startsWith('Velvet Sundown')));
  const prefs = (value: unknown) => json(app, 'PUT', '/api/me/prefs', { token: tokens.member, body: { changes: { 'settings.aiArtists': { value, updatedAt: Date.now() } } } });
  assert.equal((await prefs({ hideInDiscover: true, outOfPicks: false })).status, 200);
  assert.ok((await songs(tokens.member)).some((s) => s.artist.startsWith('Velvet Sundown')));
  await prefs({ hideInDiscover: false, outOfPicks: true });
  const mine = await songs(tokens.member);
  assert.ok(!mine.some((s) => s.artist.startsWith('Velvet Sundown')), 'featured credits count too, like Don\'t play');
  assert.ok(mine.some((s) => s.artist === 'Future'));
  assert.ok((await songs(tokens.admin)).some((s) => s.artist.startsWith('Velvet Sundown')), 'someone else still gets them');
});
