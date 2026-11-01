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

const { artistVariants, cleanTitle, lyricsFor } = await import('../lib/lyrics');

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
