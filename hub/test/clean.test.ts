import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readTags } from '../src/tags.ts';
import { json, seeded } from './helpers.ts';

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

/** Unmask one websocket text frame from the client (enough for a small JSON message). */
function frame(buf: Buffer): string {
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) (len = buf.readUInt16BE(2)), (off = 4);
  const mask = buf.subarray(off, off + 4);
  const data = buf.subarray(off + 4, off + 4 + len);
  return Buffer.from(data.map((b, i) => b ^ mask[i % 4])).toString();
}

/**
 * A stand-in deemix: settings over the websocket like deemix-gui, a queue that "starts" an album the next time
 * it's looked at, and a note of the folder name in force when each album started.
 */
async function fakeDeemix() {
  const st = {
    settings: { albumNameTemplate: '%artist% - %album%', createAlbumFolder: false, maxBitrate: 3 } as Record<string, unknown>,
    queue: {} as Record<string, { uuid: string; status: string }>,
    startedWith: {} as Record<string, unknown>,
    spotify: { clientId: 'keep-me' },
  };
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      let out: unknown = {};
      if (req.url === '/api/getSettings') out = { settings: st.settings, spotifySettings: st.spotify };
      else if (req.url === '/api/addToQueue') {
        const id = /album\/(\d+)/.exec(JSON.parse(body).url)![1];
        st.queue[`album_${id}_3`] = { uuid: `album_${id}_3`, status: 'inQueue' };
        out = { result: true };
      } else if (req.url === '/api/getQueue') {
        out = { queue: structuredClone(st.queue) };
        for (const i of Object.values(st.queue)) {
          if (i.status === 'inQueue') (i.status = 'downloading'), (st.startedWith[i.uuid] = st.settings.albumNameTemplate);
          else if (i.status === 'downloading') i.status = 'completed';
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  srv.on('upgrade', (req, socket: Socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', (buf: Buffer) => {
      if ((buf[0] & 0x0f) !== 1) return socket.end();
      const msg = JSON.parse(frame(buf));
      if (msg.key === 'saveSettings') {
        st.settings = msg.data.settings;
        assert.deepEqual(msg.data.spotifySettings, { clientId: 'keep-me' }, 'Spotify settings sent back as they were');
      }
    });
    socket.on('error', () => undefined);
  });
  servers.push(srv);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, st };
}

test('a clean version downloads into its own "(Clean)" folder, and deemix gets its folder name back', async () => {
  const dz = await fakeDeemix();
  const { app, tokens } = await seeded();
  app.hubClean.pollMs = 10;
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' }, config: { bitrate: 3 } } });

  assert.equal((await json(app, 'POST', '/api/downloads/deemix/clean', { token: tokens.kid, body: { link: 'https://www.deezer.com/album/11' } })).status, 403);
  assert.equal((await json(app, 'POST', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/track/11' } })).status, 400, 'albums only');

  for (const id of [11, 12]) {
    const r = await json(app, 'POST', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: `https://www.deezer.com/album/${id}` } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.job.state, 'waiting');
  }
  await app.hubClean.idle();

  assert.deepEqual(dz.st.startedWith, { album_11_3: '%artist% - %album% (Clean)', album_12_3: '%artist% - %album% (Clean)' });
  assert.deepEqual(dz.st.settings, { albumNameTemplate: '%artist% - %album%', createAlbumFolder: false, maxBitrate: 3 }, 'put back as it was');
  const jobs = (await json(app, 'GET', '/api/downloads/deemix/clean', { token: tokens.admin })).body.jobs;
  assert.deepEqual(jobs.map((j: { state: string }) => j.state), ['queued', 'queued']);
});

test('approving "Request clean version" uses the clean folder too', async () => {
  const dz = await fakeDeemix();
  const { app, tokens } = await seeded();
  app.hubClean.pollMs = 10;
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' }, config: { bitrate: 3 } } });
  const r = await json(app, 'POST', '/api/requests', { token: tokens.member, body: { link: 'https://www.deezer.com/album/21', kind: 'album', title: 'Loud (clean)', artist: 'Rihanna' } });
  const a = await json(app, 'POST', `/api/admin/requests/${r.body.request.id}/approve`, { token: tokens.admin, body: {} });
  assert.equal(a.body.request.status, 'approved', JSON.stringify(a.body));
  await app.hubClean.idle();
  assert.equal(dz.st.startedWith.album_21_3, '%artist% - %album% (Clean)');
});

test('songs downloaded into a "(Clean)" folder get "(Clean)" on their album tag', async () => {
  const dz = await fakeDeemix();
  const music = mkdtempSync(join(tmpdir(), 'wl-clean-'));
  const { app, tokens } = await seeded({}, { musicDir: music });
  app.hubClean.pollMs = 10;
  await json(app, 'POST', '/api/admin/services', { token: tokens.admin, body: { kind: 'deemix', url: dz.url, secrets: { arl: 'x' }, config: { bitrate: 3 } } });
  await json(app, 'POST', '/api/downloads/deemix/clean', { token: tokens.admin, body: { link: 'https://www.deezer.com/album/31' } });
  await app.hubClean.idle();

  const mp3 = (dir: string, album: string) => {
    mkdirSync(join(music, dir), { recursive: true });
    const file = join(music, dir, '01 - Song.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-metadata', `album=${album}`, '-y', file]);
    return file;
  };
  const cleanFile = mp3('Rihanna - Loud (Clean)', 'Loud');
  const multi = mp3('Rihanna - Talk (Clean)/CD 1', 'Talk');
  const explicit = mp3('Rihanna - Loud', 'Loud');
  const already = mp3('Other - Edited (Clean)', 'Edited (Clean)');

  app.hubLibrary.downloaded();
  await app.hubLibrary.tidy();
  assert.equal((await readTags(cleanFile)).album, 'Loud (Clean)');
  assert.equal((await readTags(multi)).album, 'Talk (Clean)');
  assert.equal((await readTags(explicit)).album, 'Loud', 'the explicit copy is left alone');
  assert.equal((await readTags(already)).album, 'Edited (Clean)', 'not marked twice');
});
