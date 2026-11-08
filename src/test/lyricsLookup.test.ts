import { beforeEach, describe, expect, test, vi } from 'vitest';

const replies = new Map<string, unknown>();
const asked: string[] = [];
vi.mock('../lib/http', () => ({
  qs: (p: Record<string, string>) => new URLSearchParams(p).toString(),
  getJson: vi.fn(async (url: string) => {
    asked.push(url);
    for (const [k, v] of replies) if (url.includes(k)) {
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error('404 Not Found — x');
  }),
}));

const { artistVariants, cleanArtist, cleanTitle, clearLyricsPick, lyricQueries, lyricsCandidates, lyricsFor, lyricsPickFor, onLyricsPicked, pastedLyrics, setLyricsPick, setSharedLyrics, sharedKey } =
  await import('../lib/lyrics');

let n = 0;
const track = (title: string, artist: string, duration = 200, album = 'Album') =>
  ({ id: `t${++n}`, sourceId: 'deezer', kind: 'track', title, artist, album, duration }) as any;
const synced = '[00:10.00]Hello\n[00:15.00]World';

beforeEach(() => {
  replies.clear();
  asked.length = 0;
});

describe('LRCLIB names', () => {
  test('version notes come off titles', () => {
    expect(cleanTitle('Song (feat. X) - 2011 Remaster')).toBe('Song');
    expect(cleanTitle('Song - Radio Edit')).toBe('Song');
    expect(cleanTitle('Let It Go - From "Frozen"')).toBe('Let It Go');
    expect(cleanTitle("Love Story (Taylor's Version)")).toBe('Love Story');
    expect(cleanTitle('Song (Live at Wembley)')).toBe('Song');
    expect(cleanTitle('Part 1 - The Beginning')).toBe('Part 1 - The Beginning');
    expect(cleanTitle('(Sittin\' On) The Dock of the Bay')).toBe("(Sittin' On) The Dock of the Bay");
  });

  test('YouTube upload notes come off too', () => {
    expect(cleanTitle('Hello (Official Music Video)')).toBe('Hello');
    expect(cleanTitle('Hello [Lyrics] (HD)')).toBe('Hello');
    expect(cleanTitle('Hello ft. Someone')).toBe('Hello');
    expect(cleanArtist('Adele - Topic')).toBe('Adele');
    expect(cleanArtist('AdeleVEVO')).toBe('Adele');
  });

  test('"Artist - Title" titles are read both ways', () => {
    expect(lyricQueries({ title: 'Adele - Hello (Official Video)', artist: 'AdeleVEVO' })[0]).toEqual({ artist: 'Adele', title: 'Hello' });
    expect(lyricQueries({ title: 'Adele - Hello', artist: 'Unknown Artist' })).toEqual([{ artist: 'Adele', title: 'Hello' }]);
    // a real title with a dash stays first when the artist is someone else
    expect(lyricQueries({ title: 'Part 1 - The Beginning', artist: 'Band' })[0]).toEqual({ artist: 'Band', title: 'Part 1 - The Beginning' });
  });

  test('bands with & in the name are asked for whole first', () => {
    expect(artistVariants('Simon & Garfunkel')).toEqual(['Simon & Garfunkel', 'Simon']);
    expect(artistVariants('Drake, Future')).toEqual(['Drake, Future', 'Drake']);
    expect(artistVariants('Adele')).toEqual(['Adele']);
  });
});

describe('LRCLIB lookup', () => {
  test('an instrumental exact match loses to an entry with words', async () => {
    replies.set('/get?', { trackName: 'Song', duration: 200, instrumental: true });
    replies.set('/search?', [
      { trackName: 'Song (Instrumental)', duration: 200, instrumental: true },
      { trackName: 'Song', duration: 201, syncedLyrics: synced },
    ]);
    const ly = await lyricsFor(track('Song', 'Band'));
    expect(ly?.instrumental).toBeFalsy();
    expect(ly?.synced).toBe(true);
    expect(ly?.lines.map((l) => l.text)).toEqual(['Hello', 'World']);
  });

  test('karaoke uploads with words are skipped', async () => {
    replies.set('/search?', [
      { trackName: 'Song', albumName: 'Karaoke Hits Vol. 3', duration: 200, syncedLyrics: '[00:01.00]Wrong' },
      { trackName: 'Song', duration: 205, plainLyrics: 'Right' },
    ]);
    const ly = await lyricsFor(track('Song', 'Band'));
    expect(ly?.lines.map((l) => l.text)).toEqual(['Right']);
  });

  test('instrumental only when nothing matching has words', async () => {
    replies.set('/get?', { trackName: 'Interlude', duration: 200, instrumental: true });
    replies.set('/search?', []);
    expect((await lyricsFor(track('Interlude', 'Band')))?.instrumental).toBe(true);
  });

  test('a song named as an instrumental needs no lookup', async () => {
    expect((await lyricsFor(track('Song (Instrumental Version)', 'Band')))?.instrumental).toBe(true);
    expect(asked).toEqual([]);
  });

  test('falls back to the first artist, then a free-text search', async () => {
    replies.set('q=', [{ trackName: 'The Boxer', duration: 300, syncedLyrics: synced }]);
    const ly = await lyricsFor(track('The Boxer - Remastered 2001', 'Simon & Garfunkel', 300));
    expect(ly?.synced).toBe(true);
    expect(asked.some((u) => u.includes('artist_name=Simon+%26+Garfunkel'))).toBe(true);
    expect(asked.some((u) => u.endsWith('track_name=The+Boxer&artist_name=Simon'))).toBe(true);
    expect(asked[asked.length - 1]).toContain('q=Simon+%26+Garfunkel+The+Boxer');
  });

  test('stops once a matching synced entry is found', async () => {
    replies.set('/search?', [{ trackName: 'Song', duration: 200, syncedLyrics: synced }]);
    await lyricsFor(track('Song', 'A & B'));
    expect(asked.filter((u) => u.includes('/search?'))).toHaveLength(1);
  });

  test('a different length keeps the words but drops the times', async () => {
    replies.set('/search?', [{ trackName: 'Song', duration: 260, syncedLyrics: synced }]);
    const ly = await lyricsFor(track('Song (Live)', 'Band', 200));
    expect(ly?.synced).toBe(false);
    expect(ly?.lines).toEqual([{ text: 'Hello' }, { text: 'World' }]);
  });

  test('other songs from a free-text search are ignored', async () => {
    replies.set('q=', [{ trackName: 'Something Else', duration: 200, syncedLyrics: synced }]);
    expect(await lyricsFor(track('Song', 'Band'))).toBeUndefined();
  });

  test('a YouTube-style title finds the song', async () => {
    replies.set('artist_name=Adele', [{ trackName: 'Hello', duration: 200, syncedLyrics: synced }]);
    replies.set('/search?', []);
    const ly = await lyricsFor(track('Adele - Hello (Official Music Video)', 'AdeleVEVO'));
    expect(ly?.synced).toBe(true);
  });

  test('lyrics.ovh fills in plain lyrics when LRCLIB has none', async () => {
    replies.set('/search?', []);
    replies.set('lyrics.ovh/v1/Band/Song', { lyrics: 'Paroles de la chanson Song par Band\r\n[Verse 1]\nFirst line\nSecond line' });
    const ly = await lyricsFor(track('Song', 'Band'));
    expect(ly).toEqual({ synced: false, source: 'lyrics.ovh', lines: [{ text: 'First line' }, { text: 'Second line' }] });
  });

  test('lyrics.ovh is only asked when LRCLIB has nothing', async () => {
    replies.set('/search?', [{ trackName: 'Song', duration: 200, plainLyrics: 'From LRCLIB' }]);
    replies.set('lyrics.ovh', { lyrics: 'nope' });
    expect((await lyricsFor(track('Song', 'Band')))?.source).toBe('LRCLIB');
    expect(asked.some((u) => u.includes('lyrics.ovh'))).toBe(false);
  });

  test("the server's own lyrics win, but empty ones don't count", async () => {
    replies.set('/search?', [{ trackName: 'Song', duration: 200, plainLyrics: 'From LRCLIB' }]);
    const own = { lines: [{ text: 'Mine' }], synced: false, source: 'Navidrome' };
    expect((await lyricsFor(track('Song', 'Band'), { getLyrics: async () => own }))?.source).toBe('Navidrome');
    const empty = { lines: [], synced: false, source: 'Navidrome' };
    expect((await lyricsFor(track('Song', 'Band'), { getLyrics: async () => empty }))?.source).toBe('LRCLIB');
  });

  test("LRCLIB being down isn't remembered as no lyrics", async () => {
    replies.set('lrclib', new Error('Failed to fetch'));
    const t = track('Song', 'Band');
    await expect(lyricsFor(t)).rejects.toThrow('Failed to fetch');
    replies.clear();
    replies.set('/search?', [{ trackName: 'Song', duration: 200, plainLyrics: 'Back' }]);
    await new Promise((r) => setTimeout(r));
    expect((await lyricsFor(t))?.lines[0].text).toBe('Back');
  });
});

describe('shared lyrics on the Hub', () => {
  test('the key ignores version notes and keeps the length to 10 s', () => {
    expect(sharedKey({ title: "God's Plan (Explicit)", artist: 'Drake', duration: 199 })).toBe('drake|godsplan|20');
    expect(sharedKey({ title: 'Song', artist: 'Band' })).toBe('band|song|');
  });

  test('lyrics another device found come from the Hub, without asking LRCLIB', async () => {
    const hub = { lines: [{ time: 1, text: 'From the Hub' }], synced: true, source: 'LRCLIB' };
    const put = vi.fn();
    setSharedLyrics({ get: async () => hub, put });
    try {
      expect(await lyricsFor(track('Song', 'Band'))).toEqual(hub);
      expect(asked).toEqual([]);
      expect(put).not.toHaveBeenCalled();
    } finally {
      setSharedLyrics(undefined);
    }
  });

  test('what this device finds goes to the Hub', async () => {
    replies.set('/search?', [{ trackName: 'Song', duration: 200, syncedLyrics: synced }]);
    const put = vi.fn();
    setSharedLyrics({ get: async () => null, put });
    try {
      const ly = await lyricsFor(track('Song', 'Band'));
      expect(put).toHaveBeenCalledWith('band|song|20', 'Band', 'Song', ly);
    } finally {
      setSharedLyrics(undefined);
    }
  });
});

describe('stricter matching', () => {
  test('another artist with the same song name is ignored', async () => {
    replies.set('/search?', [{ trackName: 'Zoo', artistName: 'Someone Else', duration: 200, syncedLyrics: synced }]);
    expect(await lyricsFor(track('Zoo', 'Lil Wayne'))).toBeUndefined();
  });

  test('a name that only contains the title is ignored', async () => {
    replies.set('/search?', [{ trackName: 'Zoo York', artistName: 'Lil Wayne', duration: 200, syncedLyrics: synced }]);
    expect(await lyricsFor(track('Zoo', 'Lil Wayne'))).toBeUndefined();
  });

  test('the same name at a very different length is another song', async () => {
    replies.set('/search?', [{ trackName: 'Zoo', artistName: 'Lil Wayne', duration: 95, syncedLyrics: synced }]);
    expect(await lyricsFor(track('Zoo', 'Lil Wayne', 228))).toBeUndefined();
  });

  test('a featured artist listed first by LRCLIB still matches', async () => {
    replies.set('/search?', [{ trackName: 'Song', artistName: 'Band, Guest', duration: 200, syncedLyrics: synced }]);
    expect((await lyricsFor(track('Song', 'Band')))?.synced).toBe(true);
  });
});

describe('Wrong lyrics?', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });

  test('a pick replaces the found lyrics, is shared with the Hub, and can be forgotten', async () => {
    replies.set('/search?', [{ trackName: 'Song', duration: 200, syncedLyrics: '[00:01.00]Wrong' }]);
    const t = track('Song', 'Band');
    expect((await lyricsFor(t))?.lines[0].text).toBe('Wrong');
    const put = vi.fn();
    const seen: string[] = [];
    const off = onLyricsPicked((k) => seen.push(k));
    setSharedLyrics({ get: async () => null, put });
    try {
      const right = { lines: [{ time: 1, text: 'Right' }], synced: true, source: 'LRCLIB' };
      setLyricsPick(t, right);
      expect(await lyricsFor(t)).toEqual(right);
      expect(put).toHaveBeenCalledWith('band|song|20', 'Band', 'Song', right);
      expect(seen).toEqual([`${t.sourceId}:${t.id}`]);
      // the same song from another source gets the pick too
      expect((await lyricsFor(track('Song', 'Band')))?.lines[0].text).toBe('Right');
      clearLyricsPick(t);
      expect(lyricsPickFor(t)).toBeUndefined();
      expect((await lyricsFor(t))?.lines[0].text).toBe('Wrong');
    } finally {
      off();
      setSharedLyrics(undefined);
    }
  });

  test('"no lyrics" hides them', async () => {
    replies.set('/search?', [{ trackName: 'Hum', duration: 200, plainLyrics: 'Wrong' }]);
    const t = track('Hum', 'Band');
    setLyricsPick(t, null);
    expect(await lyricsFor(t)).toBeUndefined();
    clearLyricsPick(t);
  });

  test('pasted lyrics: LRC is synced, anything else plain', () => {
    expect(pastedLyrics('[00:01.50]One\n[00:03.00]Two')).toEqual({ synced: true, source: 'pasted in', lines: [{ time: 1.5, text: 'One' }, { time: 3, text: 'Two' }] });
    expect(pastedLyrics('  One\nTwo  ')?.lines).toEqual([{ text: 'One' }, { text: 'Two' }]);
    expect(pastedLyrics('   ')).toBeUndefined();
  });

  test('candidates: the likely ones first, every entry with words listed', async () => {
    replies.set('/search?', [
      { id: 1, trackName: 'Zoo York', artistName: 'Lil Wayne', duration: 228, syncedLyrics: '[00:01.00]Other song' },
      { id: 2, trackName: 'Zoo', artistName: 'Lil Wayne', duration: 229, syncedLyrics: '[00:01.00]This one' },
      { id: 3, trackName: 'Zoo', artistName: 'Lil Wayne', duration: 229, instrumental: true },
      { id: 2, trackName: 'Zoo', artistName: 'Lil Wayne', duration: 229, syncedLyrics: '[00:01.00]This one' },
    ]);
    const list = await lyricsCandidates(track('Zoo', 'Lil Wayne', 228));
    expect(list.map((c) => [c.id, c.likely, c.lyrics.synced])).toEqual([
      ['2', true, true],
      ['1', false, true],
    ]);
  });

  test('candidates for words of your own', async () => {
    replies.set('/search?', []);
    await lyricsCandidates(track('Zoo', 'Lil Wayne'), 'wayne zoo c3');
    expect(asked.filter((u) => u.includes('/search?'))).toEqual(['https://lrclib.net/api/search?q=wayne+zoo+c3']);
  });
});
