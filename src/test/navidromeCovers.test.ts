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

describe('cover addresses', () => {
  const src = new NavidromeSource({ id: 'nd', kind: 'navidrome', name: 'Navidrome', enabled: true, url: 'http://nas:4533', username: 'me', password: 'pw' } as never);

  it('stay the same every time, so the webview can keep the picture between visits and launches', () => {
    const a = src.trackFromId('s1', { albumId: 'a9' }).coverUrl;
    const b = new NavidromeSource({ ...src.config }).trackFromId('s2', { albumId: 'a9' }).coverUrl;
    expect(a).toBe(b);
    const u = new URL(a!);
    expect(u.searchParams.get('s')).toBeTruthy();
    // the salt isn't made from the password
    expect(u.searchParams.get('s')).toBe(new URL(new NavidromeSource({ ...src.config, password: 'other' } as never).trackFromId('s1', { albumId: 'a9' }).coverUrl!).searchParams.get('s'));
  });

  it('still sign in with a fresh salt for everything else', () => {
    const a = new URL(src.trackFromId('s1').streamUrl!).searchParams.get('s');
    const b = new URL(src.trackFromId('s1').streamUrl!).searchParams.get('s');
    expect(a).not.toBe(b);
  });
});
