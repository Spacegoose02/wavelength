import { describe, expect, test } from 'vitest';
import { DeemixWatch } from '../lib/deemixQueue';
import { deezerTrackId, LOST_MS, radioGetStatus } from '../lib/radioGet';
import { parseNowPlaying } from '../sources/radio';

const queue = (status: string, extra: Record<string, unknown> = {}) =>
  new DeemixWatch(() => 0).read({ queue: { track_42_3: { uuid: 'track_42_3', type: 'track', id: 42, title: 'I Know Somebody', status, size: 1, ...extra } } });

const sent = { via: 'deemix' as const, link: 'https://www.deezer.com/track/42', at: 0 };

describe('Get this song on the radio follows the download', () => {
  test('reads the track id from a Deezer link', () => {
    expect(deezerTrackId('https://www.deezer.com/track/42')).toBe('42');
    expect(deezerTrackId('https://www.deezer.com/en/track/42?utm=x')).toBe('42');
    expect(deezerTrackId('https://www.deezer.com/album/42')).toBeUndefined();
    expect(deezerTrackId(undefined)).toBeUndefined();
  });

  test('waiting, downloading, done', () => {
    expect(radioGetStatus(sent, queue('inQueue'), true, 1000)).toMatchObject({ label: 'Waiting', kind: 'busy' });
    expect(radioGetStatus(sent, queue('downloading', { progress: 40.4 }), true, 1000)).toMatchObject({ label: 'Downloading 40%', kind: 'busy' });
    expect(radioGetStatus(sent, queue('completed'), true, 1000)).toMatchObject({ label: 'Adding to library', kind: 'done' });
  });

  test('a failed download says why and can be tried again', () => {
    const s = radioGetStatus(sent, queue('failed', { errors: [{ errid: 'notLoggedIn' }] }), true, 1000);
    expect(s).toMatchObject({ label: 'Failed · try again', kind: 'error' });
    expect(s.detail).toMatch(/isn’t logged in/);
  });

  test('another song in the queue is not this one', () => {
    expect(radioGetStatus({ ...sent, link: 'https://www.deezer.com/track/7' }, queue('failed'), true, 1000)).toMatchObject({ label: 'Sent to deemix', kind: 'busy' });
  });

  test('gone from the queue after a while stops looking busy', () => {
    expect(radioGetStatus(sent, [], true, LOST_MS + 1)).toMatchObject({ kind: 'done' });
    expect(radioGetStatus(sent, [], false, LOST_MS + 1)).toMatchObject({ kind: 'busy' });
  });

  test('requests and yt-dlp', () => {
    expect(radioGetStatus({ via: 'request', at: 0 }, [], true)).toMatchObject({ label: 'Requested' });
    expect(radioGetStatus({ via: 'yt-dlp', at: 0 }, [], true)).toMatchObject({ label: 'Downloading' });
  });
});

describe('Icecast now-playing pages', () => {
  const two = { icestats: { source: [
    { listenurl: 'http://radio.example:8000/sister', title: 'LOCASH - I Know Somebody' },
    { listenurl: 'http://radio.example:8000/live', title: 'The Mamas & The Papas - California Dreamin\'' },
  ] } };

  test('uses the stream being played', () => {
    expect(parseNowPlaying(two, 'https://radio.example/live')).toBe('The Mamas & The Papas - California Dreamin\'');
  });

  test('never takes another stream’s title when none matches', () => {
    expect(parseNowPlaying(two, 'https://radio.example/other')).toBeUndefined();
  });

  test('a server with one stream is that stream', () => {
    expect(parseNowPlaying({ icestats: { source: { listenurl: 'http://x:8000/a', title: 'A - B' } } }, 'https://x/b')).toBe('A - B');
  });
});
