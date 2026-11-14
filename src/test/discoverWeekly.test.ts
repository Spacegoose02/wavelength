import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => p }));
// the library has only "In Library"
vi.mock('../lib/match', () => ({
  findInLibrary: () => async (q: { title: string }) => (q.title === 'In Library' ? { id: 'lib1', sourceId: 'nd', kind: 'track', title: 'In Library', artist: 'A' } : undefined),
  pool: async <T, R>(items: T[], _n: number, fn: (x: T, i: number) => Promise<R>) => Promise.all(items.map(fn)),
}));
const lookup = vi.fn(async (s: { title: string }) => (s.title === 'Old Mix Song' ? { link: 'https://www.deezer.com/track/9', preview: 'https://cdn/old.mp3', explicit: false } : {}));
vi.mock('../sources/charts', () => ({ deezerLookup: (s: { title: string }) => lookup(s) }));

const { mixRows } = await import('../lib/mixes');

const dz = (n: number) => ({ link: `https://www.deezer.com/track/${n}`, preview: `https://cdn/${n}.mp3`, explicit: false });

describe('Discover Weekly', () => {
  it('keeps the songs the library has and fills the rest with Deezer clips, instead of showing only one song', async () => {
    const mix = {
      id: 'discover-weekly', name: 'Discover Weekly', description: '', kind: 'discover' as const,
      songs: [
        { title: 'New 1', artist: 'B', deezer: dz(1) },
        { title: 'In Library', artist: 'A', deezer: dz(2) },
        { title: 'New 3', artist: 'C', deezer: dz(3) },
        { title: 'No clip', artist: 'D', deezer: { link: 'https://www.deezer.com/track/4' } },
        { title: 'Old Mix Song', artist: 'E' },
      ],
    };
    const rows = await mixRows(mix, 50);
    expect(rows.map((r) => [r.song.title, r.owned])).toEqual([['New 1', false], ['In Library', true], ['New 3', false], ['Old Mix Song', false]]);
    expect(rows[0].track).toMatchObject({ sourceId: 'preview', streamUrl: 'https://cdn/1.mp3', duration: 30 });
    expect(rows[0].link).toBe('https://www.deezer.com/track/1');
    expect(rows[1].track.id).toBe('lib1');
    // a mix made before the Hub sent Deezer links: looked up on Deezer
    expect(rows[3].link).toBe('https://www.deezer.com/track/9');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
