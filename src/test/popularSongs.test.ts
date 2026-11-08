import { describe, expect, test } from 'vitest';
import { popularCandidates, uniqueSongs } from '../lib/popularSongs';
import type { Track } from '../sources/types';

const dz = (title: string, artist = 'Kodak Black') => ({ id: Math.random(), title, artist: { name: artist } });
const track = (id: string, title: string, sourceId = 'nd'): Track => ({ id, sourceId, kind: 'track', title, artist: 'Kodak Black' });

describe('popular songs on an artist page', () => {
  test("Deezer's top tracks become one search per song, in Deezer's order", () => {
    const raw = [dz('Tunnel Vision'), dz('ZEZE (feat. Travis Scott & Offset)'), dz('Tunnel Vision'), dz('ZEZE'), { title: '' }, null, dz('Super Gremlin')];
    expect(popularCandidates(raw)).toEqual([
      { title: 'Tunnel Vision', artist: 'Kodak Black' },
      { title: 'ZEZE (feat. Travis Scott & Offset)', artist: 'Kodak Black' },
      { title: 'Super Gremlin', artist: 'Kodak Black' },
    ]);
  });

  test('a song found twice (two copies, or Explicit and Clean) shows once, and misses are skipped', () => {
    const found = [track('1', 'Tunnel Vision'), undefined, track('1', 'Tunnel Vision'), track('2', 'Tunnel Vision (Clean)', 'plex'), track('3', 'Super Gremlin')];
    expect(uniqueSongs(found).map((t) => t.id)).toEqual(['1', '3']);
  });

  test('at most the given number', () => {
    const found = Array.from({ length: 15 }, (_, i) => track(String(i), `Song ${i}`));
    expect(uniqueSongs(found, 10)).toHaveLength(10);
  });
});
