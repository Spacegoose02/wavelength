import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;

test('people pick covers for their own playlists, and only they see them', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'wl-pcover-'));
  const { app, tokens } = await seeded({}, { dataDir });
  const now = Date.now();
  await json(app, 'PUT', '/api/me/playlists', { token: tokens.member, body: { playlists: [{ id: 'mia-1', name: 'Gym', tracks: [], createdAt: now, updatedAt: now }] } });

  const set = await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key: 'wavelength:mia-1', image } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.match(set.body.cover.url, /^\/api\/art\/[0-9a-f]{32}\.jpg$/);
  const img = await app.inject({ method: 'GET', url: set.body.cover.url });
  assert.equal(img.statusCode, 200);

  // a playlist not synced yet is fine too; kids have playlists of their own
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.kid, body: { key: 'wavelength:kit-1', image } })).status, 200);

  const mine = await json(app, 'GET', '/api/playlist-covers', { token: tokens.member });
  assert.deepEqual(mine.body.covers.map((c: { key: string }) => c.key), ['wavelength:mia-1']);
  assert.equal((await json(app, 'GET', '/api/playlist-covers', { token: tokens.admin })).body.covers.length, 0, "someone else's playlists stay theirs");

  // nobody else can change or remove it
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.admin, body: { key: 'wavelength:mia-1', image } })).status, 403);
  assert.equal((await json(app, 'DELETE', '/api/playlist-covers/wavelength:mia-1', { token: tokens.admin })).status, 403);

  // replacing drops the old file; resetting drops the new one
  const again = await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key: 'wavelength:mia-1', image } });
  assert.ok(!existsSync(join(dataDir, 'artwork', set.body.cover.url.split('/').pop())));
  assert.equal((await json(app, 'DELETE', '/api/playlist-covers/wavelength:mia-1', { token: tokens.member })).status, 200);
  assert.ok(!existsSync(join(dataDir, 'artwork', again.body.cover.url.split('/').pop())));
  assert.equal(readdirSync(join(dataDir, 'artwork')).length, 1, "only the kid's is left");

  // bad input
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key: 'spotify:x', image } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key: 'wavelength:x' } })).status, 400);
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key: 'wavelength:x', image: Buffer.from('hi').toString('base64') } })).status, 415);
  assert.equal((await json(app, 'GET', '/api/playlist-covers')).status, 401);
});

test('server and household playlist covers are shared, with grown-up rules', async () => {
  const { app, tokens } = await seeded({}, { dataDir: mkdtempSync(join(tmpdir(), 'wl-pcover-')) });

  const nd = await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key: 'navidrome:abc123', image } });
  assert.equal(nd.status, 200, JSON.stringify(nd.body));
  assert.equal((await json(app, 'GET', '/api/playlist-covers', { token: tokens.admin })).body.covers[0].key, 'navidrome:abc123', 'everyone sees it');
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.kid, body: { key: 'plex:9', image } })).status, 403, 'not kids');
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.admin, body: { key: 'navidrome:abc123', image } })).status, 200, 'an admin may replace it');
  assert.equal((await json(app, 'DELETE', '/api/playlist-covers/navidrome:abc123', { token: tokens.member })).status, 403, "now it's the admin's");

  const hh = await json(app, 'POST', '/api/household/playlists', { token: tokens.admin, body: { name: 'Road trip' } });
  const key = `household:${hh.body.playlist.id}`;
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.member, body: { key, image } })).status, 403, 'only whoever made it');
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.admin, body: { key, image } })).status, 200);
  assert.equal((await json(app, 'PUT', '/api/playlist-covers', { token: tokens.admin, body: { key: 'household:999', image } })).status, 404);

  const log = JSON.stringify((await json(app, 'GET', '/api/admin/audit', { token: tokens.admin })).body);
  assert.ok(log.includes('playlistCover.set') && log.includes('navidrome:abc123'));
});
