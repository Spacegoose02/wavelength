import type { AiArtist } from './api/aiArtists.ts';
import type { Db } from './db.ts';
import { tagKey } from './itemTags.ts';
import { getPrefs } from './prefs.ts';

/**
 * AI-generated artists (docs/HUB.md, "AI-generated artists"): artists an admin marked, kept by name so they cover
 * artists that are only on the charts as well as the library. The app shows a badge on them and lets each person
 * hide them from Discover; with `outOfPicks` in their prefs the Hub leaves them out of that person's mixes and DJ
 * mode the way Don't play does (dontPlay.ts).
 */

const MAX = 5000;

interface Row { name: string; set_by_name: string | null; set_at: number }
const SELECT = 'SELECT a.name, u.display_name AS set_by_name, a.set_at FROM ai_artists a LEFT JOIN users u ON u.id = a.set_by';
const toArtist = (r: Row): AiArtist => ({ name: r.name, setBy: r.set_by_name, setAt: r.set_at });

/** Every marked artist, A to Z. */
export function aiArtists(db: Db): AiArtist[] {
  return (db.prepare(SELECT).all() as unknown as Row[]).map(toArtist).sort((a, b) => a.name.localeCompare(b.name));
}

export function aiArtist(db: Db, name: string): AiArtist | null {
  const r = db.prepare(`${SELECT} WHERE a.key = ?`).get(tagKey(name)) as unknown as Row | undefined;
  return r ? toArtist(r) : null;
}

/** Mark or unmark one artist. Returns whether anything changed. */
export function setAiArtist(db: Db, name: string, ai: boolean, userId: number): boolean {
  const key = tagKey(name);
  if (!key) return false;
  if (!ai) return db.prepare('DELETE FROM ai_artists WHERE key = ?').run(key).changes > 0;
  const was = db.prepare('SELECT name FROM ai_artists WHERE key = ?').get(key) as { name: string } | undefined;
  if (was?.name === name) return false;
  if (!was && (db.prepare('SELECT COUNT(*) AS n FROM ai_artists').get() as { n: number }).n >= MAX) throw new Error(`At most ${MAX} artists can be marked`);
  db.prepare(`INSERT INTO ai_artists (key, name, set_by, set_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET name = excluded.name, set_by = excluded.set_by, set_at = excluded.set_at`).run(key, name, userId, Date.now());
  return true;
}

/** An artist was renamed (Edit artist): the mark follows. Returns whether there was one. */
export function renameAiArtist(db: Db, from: string, to: string): boolean {
  const k = tagKey(from);
  const r = db.prepare('SELECT set_by, set_at FROM ai_artists WHERE key = ?').get(k) as { set_by: number | null; set_at: number } | undefined;
  if (!r || !tagKey(to)) return false;
  db.prepare('DELETE FROM ai_artists WHERE key = ?').run(k);
  db.prepare(`INSERT INTO ai_artists (key, name, set_by, set_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET name = excluded.name`).run(tagKey(to), to, r.set_by, r.set_at);
  return true;
}

/** The marked artists' names when this person keeps AI artists out of their picks, else none. */
export function aiOutOfPicks(db: Db, userId: number): string[] {
  const v = getPrefs(db, userId)['settings.aiArtists']?.value as { outOfPicks?: unknown } | undefined;
  if (v?.outOfPicks !== true) return [];
  return (db.prepare('SELECT name FROM ai_artists').all() as { name: string }[]).map((r) => r.name);
}
