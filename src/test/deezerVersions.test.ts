import { describe, expect, test } from 'vitest';
import { cleanOnly, ownVersion, withVersions } from '../lib/deezerVersions';
import type { DeezerResult } from '../sources/deemix';

const album = (id: number, title: string, explicit?: boolean, extra: Partial<DeezerResult> = {}): DeezerResult =>
  ({ type: 'album', id, title, artist: 'Lil Wayne', link: '', explicit, ...extra }) as DeezerResult;

describe('Deezer explicit and clean versions', () => {
  test('two releases with the same name: the one not marked explicit is the clean version', () => {
    const [e, c] = withVersions([album(1, 'I Am Not A Human Being II', true), album(2, 'I Am Not A Human Being II', false)]);
    expect(e.version).toBe('explicit');
    expect(c.version).toBe('clean');
  });

  test('"(Edited Version)" and edited lyrics make the clean version even alone', () => {
    expect(ownVersion(album(3, 'Tha Carter IV (Edited Version)'))).toBe('clean');
    expect(ownVersion(album(4, 'Rebirth', false, { explicitContent: 3 }))).toBe('clean');
    expect(ownVersion(album(5, 'Tha Carter IV (Explicit Version)'))).toBe('explicit');
  });

  test('a release that was never explicit isn’t called clean', () => {
    expect(withVersions([album(6, 'Free Weezy Album', false)])[0].version).toBeUndefined();
  });

  test('another artist’s explicit album with the same name doesn’t make this one clean', () => {
    const [, other] = withVersions([album(7, 'Loud', true), album(8, 'Loud', false, { artist: 'Someone Else' })]);
    expect(other.version).toBeUndefined();
  });

  test('Clean only keeps clean, unmarked, artists and playlists', () => {
    const list = withVersions([
      album(1, 'IANAHB', true),
      album(2, 'IANAHB', false),
      album(6, 'Free Weezy Album', false),
      { type: 'artist', id: 9, title: 'Lil Wayne', artist: 'Lil Wayne', link: '' },
    ]);
    expect(cleanOnly(list).map((r) => r.id)).toEqual([2, 6, 9]);
  });
});
