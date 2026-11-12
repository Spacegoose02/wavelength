import { describe, expect, it } from 'vitest';
import { NavidromeSource } from '../sources/navidrome';

describe('songs rebuilt from an id (a playlist synced through the Hub)', () => {
  const src = new NavidromeSource({ id: 'nd', kind: 'navidrome', name: 'Navidrome', enabled: true, url: 'http://hub:7780/nd/1', username: 'me~1', password: 'pw' } as never);

  it('show their album’s cover, one picture for every song of the album', () => {
    const a = new URL(src.trackFromId('s1', { albumId: 'a9' }).coverUrl!);
    const b = new URL(src.trackFromId('s2', { albumId: 'a9' }).coverUrl!);
    expect(a.searchParams.get('id')).toBe('al-a9');
    expect(b.searchParams.get('id')).toBe('al-a9');
  });

  it('fall back to the song’s own picture without an album', () => {
    expect(new URL(src.trackFromId('s1').coverUrl!).searchParams.get('id')).toBe('s1');
  });
});
