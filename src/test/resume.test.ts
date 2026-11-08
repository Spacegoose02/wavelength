import { describe, expect, test } from 'vitest';
import { storable, trimQueue, usable, type SavedQueue } from '../lib/resumeQueue';
import { withQuality } from '../lib/streamQuality';
import type { Track } from '../sources/types';

const track = (id: string, x: Partial<Track> = {}): Track => ({ id, sourceId: 'nd', kind: 'track', title: id, artist: '', streamUrl: `https://nd/rest/stream?id=${id}&t=secret`, ...x });

describe('pick up where you left off', () => {
  test('stream links the server makes per play, and listening sessions, are not saved', () => {
    expect(storable(track('a', { sessionId: 's' }), () => true)).toEqual({ id: 'a', sourceId: 'nd', kind: 'track', title: 'a', artist: '', streamUrl: undefined });
    expect(storable(track('r', { kind: 'radio', streamUrl: 'https://radio/live' }), () => false).streamUrl).toBe('https://radio/live');
  });

  test('a long queue keeps the songs around the one playing', () => {
    const q = Array.from({ length: 1000 }, (_, i) => i);
    const kept = trimQueue(q, 600, 300);
    expect(kept.queue.length).toBe(300);
    expect(kept.queue[kept.index]).toBe(600);
    expect(kept.index).toBe(50);
    expect(trimQueue(q, 990, 300).queue[299]).toBe(999);
    expect(trimQueue([1, 2], 1)).toEqual({ queue: [1, 2], index: 1 });
  });

  test('only your own, recent, sensible queue comes back', () => {
    const saved: SavedQueue = { v: 1, who: '7', queue: [track('a')], index: 0, at: 42, savedAt: 1000 };
    expect(usable(saved, '7', 2000)).toBe(saved);
    expect(usable(saved, '8', 2000)).toBeUndefined();
    expect(usable(saved, '7', 1000 + 31 * 86_400_000)).toBeUndefined();
    expect(usable({ ...saved, index: 3 }, '7', 2000)).toBeUndefined();
    expect(usable(null, '7')).toBeUndefined();
  });
});

describe('streaming quality', () => {
  const url = 'https://nd/rest/stream?id=1&u=me&t=x&s=y';
  test('original leaves the link alone', () => {
    expect(withQuality(url, 'original')).toBe(url);
  });
  test('smaller files ask Navidrome to convert: Opus, or MP3 on Apple', () => {
    expect(withQuality(url, 'normal', false)).toBe(`${url}&maxBitRate=160&format=opus`);
    expect(withQuality(url, 'low', true)).toBe(`${url}&maxBitRate=96&format=mp3`);
  });
  test('other servers, and links that already ask for a format, are left alone', () => {
    expect(withQuality('https://plex/library/parts/1/file.flac?X-Plex-Token=t', 'low')).toBe('https://plex/library/parts/1/file.flac?X-Plex-Token=t');
    expect(withQuality(`${url}&format=raw`, 'low')).toBe(`${url}&format=raw`);
  });
});
