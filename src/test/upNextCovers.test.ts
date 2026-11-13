import { beforeEach, describe, expect, it } from 'vitest';
import { trackArt } from '../lib/artwork';
import { fromHit } from '../lib/sonic';
import { NavidromeSource } from '../sources/navidrome';
import type { Album, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';

const hit = { id: 's42', title: 'I LIKE IT (feat. Loe Shimmy)', artist: 'BigXthaPlug;Loe Shimmy', album: 'I LIKE IT', duration: 180, bpm: 120, key: 'C', energy: 0.5, mood: 'happy' };

describe('sound-alike songs the name lookup missed', () => {
  const src = new NavidromeSource({ id: 'nd', kind: 'navidrome', name: 'Navidrome', enabled: true, url: 'http://nd', username: 'me', password: 'pw' } as never);

  it('get a cover, a stream and a tidied credit', () => {
    const t = fromHit(src, hit);
    expect(new URL(t.coverUrl!).searchParams.get('id')).toBe('s42');
    expect(t.streamUrl).toContain('stream');
    expect(t.artist).toBe('BigXthaPlug feat. Loe Shimmy');
    expect(t.sourceId).toBe('nd');
  });
});

describe('songs saved without a cover', () => {
  const album = (artist: string, title: string, coverUrl?: string) => ({ id: title, sourceId: 'nd', artist, title, coverUrl }) as Album;
  const song = (artist: string, albumTitle: string, coverUrl?: string) => ({ id: 'x', sourceId: 'nd', kind: 'track', title: 'Song', artist, album: albumTitle, coverUrl }) as Track;

  beforeEach(() => useCatalog.setState({ albums: [album('Kodak Black', 'Dying to Live', 'http://nd/cover/dtl'), album('Joyner Lucas', 'ADHD', 'http://nd/cover/adhd')] }));

  it("show the library album's cover", () => {
    expect(trackArt(song('Kodak Black', 'Dying to Live'))).toBe('http://nd/cover/dtl');
    expect(trackArt(song('Kodak Black feat. XXXTENTACION', 'Dying to Live'))).toBe('http://nd/cover/dtl');
    expect(trackArt(song('Someone else', 'ADHD'))).toBe('http://nd/cover/adhd');
  });

  it('keep their own cover when they have one', () => {
    expect(trackArt(song('Kodak Black', 'Dying to Live', 'http://own'))).toBe('http://own');
  });

  it('stay without one when the album is not in the library', () => {
    expect(trackArt(song('Nobody', 'Nothing'))).toBeUndefined();
  });
});
