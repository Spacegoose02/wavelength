import type { Lyrics, LyricsHit } from './api/lyrics.ts';
import type { Db } from './db.ts';

/**
 * The house's shared lyrics (docs/HUB.md "Lyrics"). The apps still find lyrics themselves (src/lib/lyrics.ts knows
 * LRCLIB's quirks); this keeps what they found, so the next device, and the next person, gets them in one call and
 * LRCLIB is asked once per song for the whole house. Found lyrics are kept for 180 days, then looked up again.
 * The words are indexed (SQLite FTS5) for "search by lyrics".
 */

const KEEP_MS = 180 * 86_400_000;
const MAX_LINES = 400;
const MAX_TEXT = 500;

/** The app's Lyrics, checked: at most 400 lines of 500 characters, numbers for times. Null when it isn't one. */
export function checkLyrics(v: unknown): Lyrics | null {
  const o = v as Partial<Lyrics> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.lines) || o.lines.length > MAX_LINES || typeof o.source !== 'string') return null;
  const lines = [];
  for (const l of o.lines as unknown[]) {
    const x = l as { text?: unknown; time?: unknown } | null;
    if (!x || typeof x.text !== 'string') return null;
    const time = typeof x.time === 'number' && Number.isFinite(x.time) && x.time >= 0 ? x.time : undefined;
    lines.push({ text: x.text.slice(0, MAX_TEXT), ...(time !== undefined && { time }) });
  }
  if (!lines.length && !o.instrumental) return null;
  return { lines, synced: !!o.synced, ...(o.instrumental && { instrumental: true }), source: o.source.slice(0, 40) };
}

export class LyricsCache {
  private db: Db;
  private now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  get(key: string): Lyrics | null {
    const row = this.db.prepare('SELECT body, at FROM lyrics_cache WHERE key = ?').get(key) as { body: string; at: number } | undefined;
    if (!row || this.now() - row.at > KEEP_MS) return null;
    try {
      return JSON.parse(row.body) as Lyrics;
    } catch {
      return null;
    }
  }

  put(key: string, artist: string, title: string, lyrics: Lyrics) {
    const lines = lyrics.lines.map((l) => l.text).join('\n');
    const words = lines.replace(/['’`]/g, '');
    this.db.prepare('INSERT INTO lyrics_cache (key, artist, title, body, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET artist = excluded.artist, title = excluded.title, body = excluded.body, at = excluded.at')
      .run(key, artist.slice(0, 300), title.slice(0, 300), JSON.stringify(lyrics), this.now());
    this.db.prepare('DELETE FROM lyrics_fts WHERE key = ?').run(key);
    if (words) this.db.prepare('INSERT INTO lyrics_fts (key, artist, title, lines, words) VALUES (?, ?, ?, ?, ?)').run(key, artist, title, lines, words);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM lyrics_cache').get() as { n: number }).n;
  }

  /**
   * Songs whose words contain these words in this order ("search by lyrics"), each with the line that matched.
   * Only for 3 or more words: shorter queries match too many songs to be useful.
   */
  search(q: string, limit = 20): LyricsHit[] {
    const terms = q.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (terms.length < 3) return [];
    const phrase = `"${terms.join(' ')}"`;
    let rows: { artist: string; title: string; lines: string }[];
    try {
      rows = this.db.prepare('SELECT artist, title, lines FROM lyrics_fts WHERE lyrics_fts MATCH ? ORDER BY rank LIMIT ?').all(`words:${phrase}`, limit * 2) as typeof rows;
    } catch {
      return [];
    }
    const flat = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
    const want = terms.join(' ');
    const seen = new Set<string>();
    const out: LyricsHit[] = [];
    for (const r of rows) {
      const id = `${flat(r.artist)}|${flat(r.title)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const lines = r.lines.split('\n');
      const line = lines.find((l) => flat(l).includes(want)) ?? lines.find((l) => flat(l).includes(terms[0])) ?? '';
      out.push({ artist: r.artist, title: r.title, line: line.trim() });
      if (out.length >= limit) break;
    }
    return out;
  }
}
