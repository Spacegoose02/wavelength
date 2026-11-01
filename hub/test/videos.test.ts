import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickVideo } from '../src/videos.ts';
import { json, seeded } from './helpers.ts';

const r = (id: string, title: string, channel: string, duration = 240) => ({ id, title, channel, url: '', duration });

test('music videos: picks the official video, not lyrics, live or covers', () => {
  const results = [
    r('lyr', 'Adele - Hello (Lyrics)', 'Lyric Hub'),
    r('live', 'Adele - Hello (Live at the BBC)', 'BBC Music'),
    r('cov', 'Hello - Adele (cover by Someone)', 'Someone'),
    r('off', 'Adele - Hello (Official Music Video)', 'AdeleVEVO', 366),
  ];
  assert.equal(pickVideo(results, 'Adele', 'Hello', 295)?.id, 'off');
  assert.equal(pickVideo(results.slice(0, 3), 'Adele', 'Hello', 295), null, 'nothing good enough');
  // a song with "Live" in its own title is fine
  assert.equal(pickVideo([r('lf', 'Oasis - Live Forever (Official Video)', 'Oasis')], 'Oasis', 'Live Forever')?.id, 'lf');
  assert.equal(pickVideo([r('x', 'Something Else (Official Video)', 'Adele')], 'Adele', 'Hello'), null, 'title must match');
});

test('music videos: route is behind the switch and cached', async () => {
  let calls = 0;
  const videoSearch = async (q: string, n: number) => {
    calls++;
    assert.equal(n, 8);
    assert.match(q, /Adele Hello official video/);
    return [r('off', 'Adele - Hello (Official Music Video)', 'AdeleVEVO')];
  };
  const { app, tokens } = await seeded({}, {}, { videoSearch });
  assert.equal((await json(app, 'GET', '/api/videos?artist=Adele&title=Hello', { token: tokens.member })).body.video.id, 'off');
  await json(app, 'GET', '/api/videos?artist=adele&title=hello', { token: tokens.member });
  assert.equal(calls, 1);
  assert.equal((await json(app, 'GET', '/api/videos?artist=Adele&title=Hello', { token: tokens.kid })).status, 403, 'kids off by default');
  assert.equal((await json(app, 'GET', '/api/videos?artist=Adele', { token: tokens.member })).status, 400);
});
