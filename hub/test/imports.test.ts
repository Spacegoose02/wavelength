import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { json, seeded } from './helpers.ts';

test('YouTube Music playlists are read with the Hub’s yt-dlp, as titles and artists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-import-'));
  const bin = join(dir, 'yt-dlp');
  writeFileSync(bin, `#!/bin/sh
echo '{"entries":[{"id":"a","title":"Midnight City","channel":"M83 - Topic","duration":243},{"id":"b","title":"Daft Punk - One More Time (Official Video)","channel":"Daft Punk"}]}'
`);
  chmodSync(bin, 0o755);
  const { app, tokens } = await seeded({}, { ytdlpBin: bin });
  const r = await json(app, 'POST', '/api/import/youtube', { token: tokens.kid, body: { url: 'https://music.youtube.com/playlist?list=PL123' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tracks, [
    { title: 'Midnight City', artist: 'M83', duration: 243 },
    { title: 'One More Time', artist: 'Daft Punk' },
  ]);
  assert.equal((await json(app, 'POST', '/api/import/youtube', { token: tokens.kid, body: { url: 'https://evil.example/playlist' } })).status, 400);
  assert.equal((await json(app, 'POST', '/api/import/youtube', { body: { url: 'https://music.youtube.com/playlist?list=PL123' } })).status, 401);
});
