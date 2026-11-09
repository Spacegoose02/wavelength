import type { Db } from './db.ts';
import { tx } from './db.ts';
import { cleanValues, type Source, tagKey } from './itemTags.ts';

/**
 * Styles and moods of single songs (docs/HUB.md, "Styles, moods and collections"), like Plex's track moods: an album
 * can be "Energetic" while one song on it is "Melancholy". Kept like the album and artist tags (itemTags.ts): on the
 * Hub, keyed by album artist, album and title without case, accents or punctuation, set by an admin (`edit`) or an
 * import (`plex`), and an import never changes what an admin set.
 */

export const TRACK_FACETS = ['style', 'mood'] as const;
export type TrackFacet = (typeof TRACK_FACETS)[number];
export type TrackFacets = Partial<Record<TrackFacet, string[]>>;

export interface TrackTags { artist: string; album: string; title: string; facets: TrackFacets; sources: Partial<Record<TrackFacet, Source>> }

export const trackKey = (artist: string, album: string, title: string) => `${tagKey(artist)}\u001f${tagKey(album)}\u001f${tagKey(title)}`;

interface Row { item: string; facet: TrackFacet; artist: string; album: string; title: string; vals: string; source: Source }

const parse = (vals: string): string[] => {
  try {
    const v = JSON.parse(vals);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

function group(rows: Row[]): TrackTags[] {
  const by = new Map<string, TrackTags>();
  for (const r of rows) {
    let t = by.get(r.item);
    if (!t) by.set(r.item, (t = { artist: r.artist, album: r.album, title: r.title, facets: {}, sources: {} }));
    t.facets[r.facet] = parse(r.vals);
    t.sources[r.facet] = r.source;
  }
  return [...by.values()];
}

export function readTrack(db: Db, artist: string, album: string, title: string): TrackTags {
  const rows = db.prepare('SELECT * FROM track_tags WHERE item = ?').all(trackKey(artist, album, title)) as unknown as Row[];
  return group(rows)[0] ?? { artist, album, title, facets: {}, sources: {} };
}

/** Every song with a style or mood. */
export const readAllTracks = (db: Db): TrackTags[] => group(db.prepare('SELECT * FROM track_tags ORDER BY item').all() as unknown as Row[]);

/** Set a song's styles or moods (each given replaces what it had; empty clears). Returns what changed. */
export function setTrack(db: Db, o: { artist: string; album: string; title: string; facets: TrackFacets; source?: Source; userId?: number | null; now?: number }): TrackFacet[] {
  const source = o.source ?? 'edit';
  const item = trackKey(o.artist, o.album, o.title);
  const now = o.now ?? Date.now();
  const changed: TrackFacet[] = [];
  tx(db, () => {
    for (const facet of TRACK_FACETS) {
      const vals = o.facets[facet];
      if (!vals) continue;
      const was = db.prepare('SELECT vals, source FROM track_tags WHERE item = ? AND facet = ?').get(item, facet) as { vals: string; source: Source } | undefined;
      if (was && was.source === 'edit' && source !== 'edit') continue;
      if (!vals.length) {
        if (was) {
          db.prepare('DELETE FROM track_tags WHERE item = ? AND facet = ?').run(item, facet);
          changed.push(facet);
        }
        continue;
      }
      const json = JSON.stringify(vals);
      if (was && was.vals === json && was.source === source) continue;
      db.prepare(`INSERT INTO track_tags (item, facet, artist, album, title, vals, source, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (item, facet) DO UPDATE SET artist = excluded.artist, album = excluded.album, title = excluded.title, vals = excluded.vals,
          source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(item, facet, o.artist, o.album, o.title, json, source, o.userId ?? null, now);
      changed.push(facet);
    }
  });
  return changed;
}

/**
 * Follow a rename of an artist (every song of theirs), an album (its songs) or a song. Rows that land on a song that
 * already has some are put together. Returns how many rows moved.
 */
export function renameTracks(db: Db, o: { kind: 'artist' | 'album' | 'track'; from: { artist: string; album?: string; title?: string }; to: { artist: string; album?: string; title?: string }; now?: number }): number {
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const prefix = o.kind === 'artist' ? `${tagKey(o.from.artist)}\u001f` : o.kind === 'album' ? `${tagKey(o.from.artist)}\u001f${tagKey(o.from.album ?? '')}\u001f` : null;
  const rows = (prefix === null
    ? db.prepare('SELECT * FROM track_tags WHERE item = ?').all(trackKey(o.from.artist, o.from.album ?? '', o.from.title ?? ''))
    : db.prepare("SELECT * FROM track_tags WHERE item LIKE ? ESCAPE '\\'").all(`${esc(prefix)}%`)) as unknown as Row[];
  const now = o.now ?? Date.now();
  return tx(db, () => {
    for (const r of rows) {
      const artist = o.to.artist;
      const album = o.kind === 'artist' ? r.album : (o.to.album ?? r.album);
      const title = o.kind === 'track' ? (o.to.title ?? r.title) : r.title;
      const to = trackKey(artist, album, title);
      if (to === r.item) {
        db.prepare('UPDATE track_tags SET artist = ?, album = ?, title = ? WHERE item = ? AND facet = ?').run(artist, album, title, r.item, r.facet);
        continue;
      }
      const there = db.prepare('SELECT vals, source FROM track_tags WHERE item = ? AND facet = ?').get(to, r.facet) as { vals: string; source: Source } | undefined;
      const vals = cleanValues([...(there ? parse(there.vals) : []), ...parse(r.vals)]) ?? [];
      const source: Source = r.source === 'edit' || there?.source === 'edit' ? 'edit' : r.source;
      db.prepare(`INSERT INTO track_tags (item, facet, artist, album, title, vals, source, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT (item, facet) DO UPDATE SET artist = excluded.artist, album = excluded.album, title = excluded.title, vals = excluded.vals,
          source = excluded.source, updated_at = excluded.updated_at`)
        .run(to, r.facet, artist, album, title, JSON.stringify(vals), source, now);
      db.prepare('DELETE FROM track_tags WHERE item = ? AND facet = ?').run(r.item, r.facet);
    }
    return rows.length;
  });
}

/** How many songs have each style and mood, for the suggestions and Browse. */
export function trackTagCounts(db: Db): Record<TrackFacet, Map<string, { name: string; tracks: number }>> {
  const out = { style: new Map(), mood: new Map() } as Record<TrackFacet, Map<string, { name: string; tracks: number }>>;
  for (const r of db.prepare('SELECT facet, vals FROM track_tags').all() as { facet: TrackFacet; vals: string }[]) {
    for (const name of parse(r.vals)) {
      const k = name.toLowerCase();
      const e = out[r.facet].get(k) ?? { name, tracks: 0 };
      e.tracks++;
      out[r.facet].set(k, e);
    }
  }
  return out;
}

/** The album and artist counts (itemTags.ts `tagValues`) with each name's song count added, and names only songs have. */
export function withTrackCounts<V extends { name: string; albums: number; artists: number }>(values: Record<string, V[]>, db: Db): Record<string, (V & { tracks: number })[]> {
  const counts = trackTagCounts(db);
  const out: Record<string, (V & { tracks: number })[]> = {};
  for (const [facet, list] of Object.entries(values)) {
    const songs = (counts as Record<string, Map<string, { name: string; tracks: number }>>)[facet];
    const rows = list.map((v) => ({ ...v, tracks: songs?.get(v.name.toLowerCase())?.tracks ?? 0 }));
    for (const [k, e] of songs ?? []) if (!list.some((v) => v.name.toLowerCase() === k)) rows.push({ name: e.name, albums: 0, artists: 0, tracks: e.tracks } as V & { tracks: number });
    out[facet] = rows;
  }
  return out;
}
