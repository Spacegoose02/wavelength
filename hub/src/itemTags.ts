import type { Db } from './db.ts';
import { tx } from './db.ts';

/**
 * Styles, moods and collections of albums and artists, and an artist's own genres (docs/HUB.md, "Styles, moods and
 * collections"): Plex-style metadata kept on the Hub, because the music files have no tag for most of it (no style
 * tag at all, and an .m4a can't hold a mood) and an artist has no file of their own. An album's genres stay in its
 * files, where the genre rules and the tag editor already look after them.
 *
 * - **Styles** are the narrow kinds of music within a genre ("Southern Rap", "Christmas Pop").
 * - **Moods** describe how it feels ("Laid-Back/Mellow", "Energetic").
 * - **Collections** are groups an admin makes ("Christmas", "Turning Red"), for browsing and smart playlists.
 * - **Artist genres** are what the artist plays as a whole, so an album can be Christmas while the artist stays Pop.
 *
 * Albums are keyed by album artist and title, artists by name, compared without case, accents or punctuation, so a
 * row survives a rescan and doesn't depend on Navidrome's ids. A rename moves the rows (`renameItem`). Each row says
 * who set it: an admin (`edit`) or an import (`plex`); an import never changes what an admin set.
 */

export const KINDS = ['artist', 'album'] as const;
export type ItemKind = (typeof KINDS)[number];
export const FACETS = ['genre', 'style', 'mood', 'collection'] as const;
export type Facet = (typeof FACETS)[number];
/** Albums keep their genres in their files; everything else is on the Hub. */
export const FACETS_OF: Record<ItemKind, readonly Facet[]> = { artist: FACETS, album: ['style', 'mood', 'collection'] };
export type Source = 'edit' | 'plex';

export const isKind = (v: unknown): v is ItemKind => (KINDS as readonly unknown[]).includes(v);

/** A name compared without case, accents, punctuation or "&" vs "and" ("Beyoncé" = "beyonce", "AC/DC" = "ac dc"). */
export function tagKey(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The key of an artist (by name) or an album (by album artist and title). */
export const itemKey = (kind: ItemKind, artist: string, title = '') => (kind === 'artist' ? tagKey(artist) : `${tagKey(artist)}\u001f${tagKey(title)}`);

/** Names tidied: trimmed, at most 100 letters, no repeats (in any case), at most 60. */
export function cleanValues(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return null;
    const name = x.replace(/\s+/g, ' ').trim().slice(0, 100);
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out.slice(0, 60);
}

interface Row { kind: ItemKind; item: string; facet: Facet; artist: string; title: string; vals: string; source: Source; updated_at: number }

export type Facets = Partial<Record<Facet, string[]>>;
export interface ItemTags { kind: ItemKind; artist: string; title: string; facets: Facets; sources: Partial<Record<Facet, Source>>; updatedAt: number | null }

const parse = (vals: string): string[] => {
  try {
    const v = JSON.parse(vals);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** One album's or artist's tags (empty when nothing is set). */
export function readItem(db: Db, kind: ItemKind, artist: string, title = ''): ItemTags {
  const rows = db.prepare('SELECT * FROM item_tags WHERE kind = ? AND item = ?').all(kind, itemKey(kind, artist, title)) as unknown as Row[];
  const out: ItemTags = { kind, artist: rows[0]?.artist ?? artist, title: kind === 'album' ? (rows[0]?.title ?? title) : '', facets: {}, sources: {}, updatedAt: null };
  for (const r of rows) {
    out.facets[r.facet] = parse(r.vals);
    out.sources[r.facet] = r.source;
    out.updatedAt = Math.max(out.updatedAt ?? 0, r.updated_at);
  }
  return out;
}

/** Every album and artist with tags, for browsing and filters. */
export function readAll(db: Db): { artists: ItemTags[]; albums: ItemTags[] } {
  const rows = db.prepare('SELECT * FROM item_tags ORDER BY kind, item').all() as unknown as Row[];
  const by = new Map<string, ItemTags>();
  for (const r of rows) {
    const k = `${r.kind}\u0000${r.item}`;
    let t = by.get(k);
    if (!t) by.set(k, (t = { kind: r.kind, artist: r.artist, title: r.title, facets: {}, sources: {}, updatedAt: null }));
    t.facets[r.facet] = parse(r.vals);
    t.sources[r.facet] = r.source;
    t.updatedAt = Math.max(t.updatedAt ?? 0, r.updated_at);
  }
  const all = [...by.values()];
  return { artists: all.filter((t) => t.kind === 'artist'), albums: all.filter((t) => t.kind === 'album') };
}

/**
 * Set some of an item's tags: each facet given replaces what it had, an empty list clears it. An import
 * (`source` other than 'edit') leaves facets an admin set alone, and says which it changed.
 */
export function setItem(db: Db, o: { kind: ItemKind; artist: string; title?: string; facets: Facets; source?: Source; userId?: number | null; now?: number }): Facet[] {
  const source = o.source ?? 'edit';
  const item = itemKey(o.kind, o.artist, o.title);
  const now = o.now ?? Date.now();
  const changed: Facet[] = [];
  tx(db, () => {
    for (const facet of FACETS_OF[o.kind]) {
      const vals = o.facets[facet];
      if (!vals) continue;
      const was = db.prepare('SELECT vals, source FROM item_tags WHERE kind = ? AND item = ? AND facet = ?').get(o.kind, item, facet) as { vals: string; source: Source } | undefined;
      if (was && was.source === 'edit' && source !== 'edit') continue;
      if (!vals.length) {
        if (was) {
          db.prepare('DELETE FROM item_tags WHERE kind = ? AND item = ? AND facet = ?').run(o.kind, item, facet);
          changed.push(facet);
        }
        continue;
      }
      const json = JSON.stringify(vals);
      if (was && was.vals === json && was.source === source) continue;
      db.prepare(`INSERT INTO item_tags (kind, item, facet, artist, title, vals, source, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (kind, item, facet) DO UPDATE SET artist = excluded.artist, title = excluded.title, vals = excluded.vals,
          source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(o.kind, item, facet, o.artist, o.kind === 'album' ? (o.title ?? '') : '', json, source, o.userId ?? null, now);
      changed.push(facet);
    }
  });
  return changed;
}

/**
 * Follow a rename: an album's tags move to its new artist and title; an artist's move to their new name, and so do
 * their albums' (the album artist changed in every one). When the new name already has tags (a merge), the names
 * are put together. Returns how many rows moved.
 */
export function renameItem(db: Db, o: { kind: ItemKind; from: { artist: string; title?: string }; to: { artist: string; title?: string }; userId?: number | null; now?: number }): number {
  const now = o.now ?? Date.now();
  const fromKey = itemKey(o.kind, o.from.artist, o.from.title);
  const toKey = itemKey(o.kind, o.to.artist, o.to.title);
  const move = (kind: ItemKind, from: string, to: string, artist: string, title: string) => {
    if (from === to) {
      // only the spelling changed: keep the rows, show the new spelling
      return Number(db.prepare('UPDATE item_tags SET artist = ?, title = ? WHERE kind = ? AND item = ?').run(artist, title, kind, from).changes);
    }
    const rows = db.prepare('SELECT * FROM item_tags WHERE kind = ? AND item = ?').all(kind, from) as unknown as Row[];
    for (const r of rows) {
      const there = db.prepare('SELECT vals, source FROM item_tags WHERE kind = ? AND item = ? AND facet = ?').get(kind, to, r.facet) as { vals: string; source: Source } | undefined;
      const vals = cleanValues([...(there ? parse(there.vals) : []), ...parse(r.vals)]) ?? [];
      const source: Source = r.source === 'edit' || there?.source === 'edit' ? 'edit' : r.source;
      db.prepare(`INSERT INTO item_tags (kind, item, facet, artist, title, vals, source, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (kind, item, facet) DO UPDATE SET artist = excluded.artist, title = excluded.title, vals = excluded.vals,
          source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(kind, to, r.facet, artist, title, JSON.stringify(vals), source, o.userId ?? null, now);
    }
    db.prepare('DELETE FROM item_tags WHERE kind = ? AND item = ?').run(kind, from);
    return rows.length;
  };
  return tx(db, () => {
    if (o.kind === 'album') return move('album', fromKey, toKey, o.to.artist, o.to.title ?? '');
    let n = move('artist', fromKey, toKey, o.to.artist, '');
    const albums = db.prepare("SELECT DISTINCT item, title FROM item_tags WHERE kind = 'album' AND item LIKE ? ESCAPE '\\'")
      .all(`${fromKey.replace(/[\\%_]/g, (c) => `\\${c}`)}\u001f%`) as { item: string; title: string }[];
    for (const a of albums) n += move('album', a.item, itemKey('album', o.to.artist, a.title), o.to.artist, a.title);
    return n;
  });
}

/** Every name in use for each kind of tag, most used first, for the editors' suggestions and Browse. */
export function tagValues(db: Db): Record<Facet, { name: string; albums: number; artists: number }[]> {
  const out = Object.fromEntries(FACETS.map((f) => [f, new Map<string, { name: string; albums: number; artists: number }>()])) as Record<Facet, Map<string, { name: string; albums: number; artists: number }>>;
  for (const r of db.prepare('SELECT kind, facet, vals FROM item_tags').all() as unknown as Row[]) {
    for (const name of parse(r.vals)) {
      const k = name.toLowerCase();
      const e = out[r.facet].get(k) ?? { name, albums: 0, artists: 0 };
      if (r.kind === 'album') e.albums++;
      else e.artists++;
      out[r.facet].set(k, e);
    }
  }
  return Object.fromEntries(FACETS.map((f) => [f, [...out[f].values()].sort((a, b) => b.albums + b.artists - (a.albums + a.artists) || a.name.localeCompare(b.name))])) as Record<Facet, { name: string; albums: number; artists: number }[]>;
}
