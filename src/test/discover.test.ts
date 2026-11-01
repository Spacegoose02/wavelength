import { beforeEach, describe, expect, test, vi } from 'vitest';

// a localStorage for the device's own chart history (tests run in node)
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

vi.mock('../lib/getSong', () => {
  class NotOnDeezer extends Error {}
  return {
    NotOnDeezer,
    getSong: vi.fn(async (e: { title: string }) => {
      if (e.title === 'Missing') throw new NotOnDeezer('Not on Deezer');
      return 'deemix';
    }),
    viaYtdlp: vi.fn(async () => 'yt-dlp'),
  };
});

const { computeMoves, localMoves, moveLabel } = await import('../lib/chartMoves');
const { sameNavidrome } = await import('../lib/discoverMatch');
const { chartKey, songKey, sourcesFor, chartsFor, GENRES } = await import('../sources/charts');
const { getAll, getOne, useChartGets } = await import('../lib/chartGets');

describe('chart movement', () => {
  beforeEach(() => store.clear());

  test('compares with the snapshot from about a week ago, else the oldest one', () => {
    expect(computeMoves('2026-11-02', ['x'], [])).toEqual({ since: null, moves: [{ prev: null, weeks: 1 }] });
    const earlier = [
      { day: '2026-10-20', keys: ['x', 'z'] },
      { day: '2026-10-26', keys: ['z', 'x'] },
      { day: '2026-11-01', keys: ['y'] },
    ];
    const m = computeMoves('2026-11-03', ['x', 'y', 'z'], earlier);
    expect(m.since).toBe('2026-10-26');
    expect(m.moves.map((x) => x.prev)).toEqual([2, null, 1]);
    expect(m.moves.map((x) => x.weeks)).toEqual([3, 2, 3]);
  });

  test('this device keeps its own history without a Hub', () => {
    const day = Date.parse('2026-10-26T12:00:00Z');
    const a = { title: 'A', artist: 'Band' };
    const b = { title: 'B (feat. Guest)', artist: 'Band Featuring Guest' };
    expect(localMoves('billboard:all', [a, b], day).since).toBeNull();
    const later = localMoves('billboard:all', [{ title: 'B', artist: 'Band' }, a, { title: 'C', artist: 'Band' }], day + 7 * 86_400_000);
    expect(later.since).toBe('2026-10-26');
    expect(later.moves).toEqual([{ prev: 2, weeks: 2 }, { prev: 1, weeks: 2 }, { prev: null, weeks: 1 }]);
    // and forgets snapshots after 120 days
    localMoves('billboard:all', [a], day + 200 * 86_400_000);
    expect(JSON.parse(store.get('tonearm.chartHistory')!)['billboard:all']).toHaveLength(1);
  });

  test('labels', () => {
    expect(moveLabel(3, { prev: 6, weeks: 2 }, '2026-10-26')).toEqual({ text: '▲3', kind: 'up' });
    expect(moveLabel(6, { prev: 3, weeks: 2 }, '2026-10-26')).toEqual({ text: '▼3', kind: 'down' });
    expect(moveLabel(1, { prev: null, weeks: 1 }, '2026-10-26')).toEqual({ text: 'NEW', kind: 'new' });
    expect(moveLabel(1, { prev: 1, weeks: 5 }, '2026-10-26')?.kind).toBe('same');
    expect(moveLabel(1, { prev: null, weeks: 1 }, null)).toBeNull();
  });
});

describe('charts', () => {
  test('chart keys: genre only matters for Billboard and Apple, and a Mix is named by its charts', () => {
    expect(chartKey('billboard', 'country')).toBe('billboard:country');
    expect(chartKey('ihHitsNow', 'pop')).toBe('ihHitsNow');
    expect(chartKey('mix', 'pop', ['rwPop', 'billboard'])).toBe(chartKey('mix', 'pop', ['billboard', 'rwPop']));
    expect(songKey({ title: 'Song (feat. X)', artist: 'Band Featuring X' })).toBe(songKey({ title: 'Song', artist: 'Band' }));
  });

  test('Alternative has charts that serve it', () => {
    expect(GENRES.some((x) => x.id === 'alt')).toBe(true);
    expect(sourcesFor('alt')).toEqual(['rwAltRock', 'apple']);
    expect(sourcesFor('alt').every((s) => chartsFor('alt').includes(s))).toBe(true);
    // Billboard's alternative page isn't known to be live, so it isn't offered
    expect(chartsFor('alt')).not.toContain('billboard');
  });
});

describe('library matching', () => {
  const nd = (id: string, url: string, hubId?: number) => ({ id, kind: 'navidrome' as const, name: id, url, enabled: true, ...(hubId !== undefined && { hubId }) });
  test('uses the device’s login for the Hub’s Navidrome', () => {
    expect(sameNavidrome('https://music.home/', [nd('a', 'https://other'), nd('b', 'https://MUSIC.home')])?.id).toBe('b');
    // a different URL is fine when it's the only Navidrome and the Hub handed it out
    expect(sameNavidrome('http://navidrome:4533', [nd('a', 'https://music.home', 3)])?.id).toBe('a');
    expect(sameNavidrome('http://navidrome:4533', [nd('a', 'https://music.home')])).toBeUndefined();
  });
});

describe('getting chart songs', () => {
  test('one at a time in the background, remembered by song', async () => {
    const songs = [{ title: 'One', artist: 'A' }, { title: 'Missing', artist: 'B' }, { title: 'Two', artist: 'C' }];
    expect(getAll(songs, 'Mix · Pop')).toBe(true);
    expect(getAll(songs, 'again')).toBe(false);
    await vi.waitFor(() => expect(useChartGets.getState().job?.running).toBe(false));
    const job = useChartGets.getState().job!;
    expect([job.total, job.done, job.failed]).toEqual([3, 3, 1]);
    const s = useChartGets.getState().songs;
    expect(s[songKey(songs[0])]).toEqual({ state: 'queued', via: 'deemix' });
    expect(s[songKey(songs[1])]).toMatchObject({ state: 'error', notOnDeezer: true });
    // a retry with yt-dlp
    await getOne(songs[1], 'ytdlp');
    expect(useChartGets.getState().songs[songKey(songs[1])]).toEqual({ state: 'queued', via: 'yt-dlp' });
    // nothing left to get
    expect(getAll(songs, 'Mix · Pop')).toBe(false);
  });
});
