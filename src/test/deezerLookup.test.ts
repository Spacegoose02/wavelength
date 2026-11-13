import { beforeEach, describe, expect, test, vi } from 'vitest';

/** Answers handed out in order, one per Deezer search. */
const answers: unknown[] = [];
const asked: string[] = [];
vi.mock('../lib/http', () => ({
  qs: (p: Record<string, string>) => new URLSearchParams(p).toString(),
  chartFetch: vi.fn(),
  setHubFetch: vi.fn(),
  hubEndpoint: vi.fn(),
  http: vi.fn(),
  trimSlash: (s: string) => s,
  isTauri: false,
  getJson: vi.fn(async (url: string) => {
    asked.push(decodeURIComponent(url));
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return a ?? { data: [] };
  }),
}));

const { deezerLookup, previewExpired } = await import('../sources/charts');

const hit = (title: string, artist: string, preview = '') => ({ title, artist: { name: artist }, link: `https://www.deezer.com/track/${title}`, preview, explicit_lyrics: false });
const quota = { error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } };

beforeEach(() => {
  answers.length = 0;
  asked.length = 0;
  vi.useFakeTimers();
});

/** Runs the pacing and retry timers out; a rejection is handed back as the error it threw. */
const run = async <T>(p: Promise<T>): Promise<T> => {
  const settled = p.then((v) => ({ v }), (e) => ({ e }));
  await vi.runAllTimersAsync();
  const r = (await settled) as { v?: T; e?: unknown };
  if ('e' in r) throw r.e;
  return r.v as T;
};

describe('previewExpired', () => {
  const now = Date.UTC(2026, 10, 6, 12);
  const at = (ms: number) => `https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/abc.mp3?hdnea=exp=${Math.floor(ms / 1000)}~acl=/api/1/1/a/b/c/0/abc.mp3*~data=user_id=0,application_id=42~hmac=f00`;
  test('a signed link past its time has run out', () => expect(previewExpired(at(now - 60_000), now)).toBe(true));
  test('one about to run out counts as run out', () => expect(previewExpired(at(now + 30_000), now)).toBe(true));
  test('a fresh one is good', () => expect(previewExpired(at(now + 15 * 60_000), now)).toBe(false));
  test('a link with no expiry is good', () => expect(previewExpired('https://cdns-preview-1.dzcdn.net/stream/c-1.mp3', now)).toBe(false));
});

describe('deezerLookup', () => {
  test('waits out the rate limit instead of reading it as no preview', async () => {
    answers.push(quota, { data: [hit('Espresso', 'Sabrina Carpenter', 'https://clip/1.mp3')] });
    const r = await run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }));
    expect(r.preview).toBe('https://clip/1.mp3');
    expect(asked).toHaveLength(2);
  });

  test('throws when Deezer keeps refusing, so the button can try again', async () => {
    answers.push(quota, quota, quota, quota);
    await expect(run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).rejects.toThrow(/busy/);
  });

  test('throws when Deezer cannot be reached', async () => {
    answers.push(new Error('offline'));
    await expect(run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).rejects.toThrow('offline');
  });

  test('the same song with a clip wins over a first hit without one', async () => {
    answers.push({ data: [hit('Espresso', 'Sabrina Carpenter'), hit('Espresso', 'Sabrina Carpenter', 'https://clip/2.mp3')] });
    expect((await run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).preview).toBe('https://clip/2.mp3');
  });

  test('the same title wins over another song by the artist', async () => {
    answers.push({ data: [hit('Please Please Please', 'Sabrina Carpenter', 'https://clip/other.mp3'), hit('Espresso', 'Sabrina Carpenter', 'https://clip/3.mp3')] });
    expect((await run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).preview).toBe('https://clip/3.mp3');
    expect(asked).toHaveLength(1);
  });

  test('asks with a plain "Artist Title" search, not the strict artist:/track: one', async () => {
    answers.push({ data: [hit('Espresso', 'Sabrina Carpenter', 'https://clip/1.mp3')] });
    await run(deezerLookup({ title: 'Espresso (Remix)', artist: 'Sabrina Carpenter feat. Someone' }));
    expect(asked[0]).toContain('q=Sabrina+Carpenter+Espresso&');
  });

  test('a new song search does not know yet is found on the artist\'s newest release', async () => {
    answers.push(
      { data: [hit('Lose My Mind', 'Don Toliver', 'https://clip/other.mp3')] },
      { data: [{ id: 9, name: 'Don Toliver', nb_fan: 10 }, { id: 1, name: 'Don Toliver', nb_fan: 5_000_000 }] },
      { data: [{ id: 50, title: 'Hardstone Psycho', release_date: '2024-06-14' }, { id: 51, title: 'Party With The Boys', release_date: '2026-11-07' }] },
      { data: [{ id: 4411282281, title: 'Party With The Boys', link: 'https://www.deezer.com/track/4411282281', preview: 'https://clip/new.mp3', explicit_lyrics: true }] },
    );
    const r = await run(deezerLookup({ title: 'Party With The Boys', artist: 'Don Toliver' }));
    expect(r).toEqual({ link: 'https://www.deezer.com/track/4411282281', preview: 'https://clip/new.mp3', explicit: true });
    // the artist with the most fans, and the release named like the song first
    expect(asked[2]).toContain('artist/1/albums');
    expect(asked[3]).toContain('album/51/tracks');
  });

  test('another song by the artist is not this one (deemix would get the wrong song)', async () => {
    answers.push({ data: [hit('Please Please Please', 'Sabrina Carpenter', 'https://clip/other.mp3')] }, { data: [] });
    expect(await run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).toEqual({});
  });

  test('the same song without a clip still gives deemix its link when the catalog has nothing better', async () => {
    answers.push({ data: [hit('Espresso', 'Sabrina Carpenter')] }, { data: [] });
    expect(await run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).toEqual({ link: 'https://www.deezer.com/track/Espresso', preview: undefined, explicit: false });
  });

  test('nothing by the artist is not found, not an error', async () => {
    answers.push({ data: [hit('Espresso', 'Someone Else', 'x')] }, { data: [] });
    expect(await run(deezerLookup({ title: 'Espresso', artist: 'Sabrina Carpenter' }))).toEqual({});
  });
});
