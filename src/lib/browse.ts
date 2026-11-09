import { norm } from '../sources/registry';
import type { Album, Artist } from '../sources/types';
import { genreKey, splitGenres } from './genreNames';
import { albumFacets, artistFacets } from './itemTags';

export { genreKey, splitGenres };

/**
 * Browsing the library by genre, decade and year (views/Browse.tsx, and the filters on Albums and Artists).
 * Everything comes from the albums already loaded: Navidrome and Plex send each album's genres and year with
 * the album list, so no extra calls are needed. An artist's genres and decades are those of their albums.
 * Styles, moods and collections come from the Hub (lib/itemTags.ts): an album's own, else its artist's
 * (`albumTags`).
 */

export type AlbumSort = 'name' | 'artist' | 'newest' | 'oldest' | 'added';
export type ArtistSort = 'name' | 'albums';

export interface BrowseQuery {
  /** A genre as `albumGenres` gives it; matched without caring about case or punctuation. */
  genre?: string;
  /** The first year of a decade: 1990 for the 90s. */
  decade?: number;
  from?: number;
  to?: number;
  /** Styles, moods and collections kept on the Hub, matched without caring about case or punctuation. */
  style?: string;
  mood?: string;
  collection?: string;
}

export const TAG_FACETS = ['style', 'mood', 'collection'] as const;
export type TagFacet = (typeof TAG_FACETS)[number];

export const ALBUM_SORTS: { id: AlbumSort; label: string }[] = [
  { id: 'name', label: 'A to Z' },
  { id: 'artist', label: 'Artist' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'added', label: 'Recently added' },
];

/** The album's genres, from every server that has it. */
export function albumGenres(a: Album): string[] {
  return splitGenres((a.refs ?? [a]).flatMap((r) => r.genres ?? []).concat(a.genres ?? []));
}

/** 1994 → 1990. Nothing for a missing or silly year. */
export const decadeOf = (year?: number) => (year && year >= 1000 && year < 3000 ? Math.floor(year / 10) * 10 : undefined);

/** 1990 → "90s", 2010 → "2010s". */
export const decadeLabel = (decade: number) => (decade >= 1900 && decade < 2000 ? `${String(decade).slice(2)}s` : `${decade}s`);

/** The library's genres with how many albums each has, most first. The name shown is the one most albums use. */
export function genreCounts(albums: Album[]): { name: string; albums: number }[] {
  const by = new Map<string, { names: Map<string, number>; albums: number }>();
  for (const a of albums) {
    for (const g of albumGenres(a)) {
      const k = genreKey(g);
      const e = by.get(k) ?? { names: new Map(), albums: 0 };
      e.albums += 1;
      e.names.set(g, (e.names.get(g) ?? 0) + 1);
      by.set(k, e);
    }
  }
  return [...by.values()]
    .map((e) => ({ name: [...e.names].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0], albums: e.albums }))
    .sort((x, y) => y.albums - x.albums || x.name.localeCompare(y.name));
}

/** The decades the library has albums from, oldest first. */
export function decadeCounts(albums: Album[]): { decade: number; albums: number }[] {
  const by = new Map<number, number>();
  for (const a of albums) {
    const d = decadeOf(a.year);
    if (d !== undefined) by.set(d, (by.get(d) ?? 0) + 1);
  }
  return [...by].map(([decade, n]) => ({ decade, albums: n })).sort((x, y) => x.decade - y.decade);
}

/** The oldest and newest years in the library. */
export function yearRange(albums: Album[]): { min: number; max: number } | undefined {
  const years = albums.map((a) => a.year).filter((y): y is number => decadeOf(y) !== undefined);
  return years.length ? { min: Math.min(...years), max: Math.max(...years) } : undefined;
}

export const isFiltered = (q: BrowseQuery) => !!(q.genre || q.decade !== undefined || q.from || q.to || q.style || q.mood || q.collection);

/**
 * An album's styles, moods or collections from the Hub. Collections add the artist's (an artist in Christmas puts
 * their albums there); an album with no styles or moods of its own takes its artist's.
 */
export function albumTags(a: Album, f: TagFacet): string[] {
  const own = albumFacets(a.artist, a.title)[f] ?? [];
  const theirs = artistFacets(a.artist)[f] ?? [];
  if (f === 'collection') return theirs.length ? splitGenres([...own, ...theirs]) : own;
  return own.length ? own : theirs;
}

const hasTag = (names: string[], want: string) => names.some((n) => genreKey(n) === genreKey(want));

export function matchesAlbum(a: Album, q: BrowseQuery): boolean {
  for (const f of TAG_FACETS) if (q[f] && !hasTag(albumTags(a, f), q[f]!)) return false;
  if (q.genre) {
    const k = genreKey(q.genre);
    if (!albumGenres(a).some((g) => genreKey(g) === k)) return false;
  }
  if (q.decade !== undefined && decadeOf(a.year) !== q.decade) return false;
  if (q.from || q.to) {
    if (decadeOf(a.year) === undefined) return false;
    if (q.from && a.year! < q.from) return false;
    if (q.to && a.year! > q.to) return false;
  }
  return true;
}

export function sortAlbums(albums: Album[], sort: AlbumSort): Album[] {
  const byName = (x: Album, y: Album) => x.title.localeCompare(y.title, undefined, { sensitivity: 'base' });
  const cmp: Record<AlbumSort, (x: Album, y: Album) => number> = {
    name: byName,
    artist: (x, y) => x.artist.localeCompare(y.artist, undefined, { sensitivity: 'base' }) || (x.year ?? 0) - (y.year ?? 0) || byName(x, y),
    newest: (x, y) => (y.year ?? 0) - (x.year ?? 0) || byName(x, y),
    // albums without a year go last, not first
    oldest: (x, y) => (x.year ?? 9999) - (y.year ?? 9999) || byName(x, y),
    added: (x, y) => (y.addedAt ?? 0) - (x.addedAt ?? 0) || byName(x, y),
  };
  return [...albums].sort(cmp[sort]);
}

export const queryAlbums = (albums: Album[], q: BrowseQuery, sort: AlbumSort = 'name') =>
  sortAlbums(isFiltered(q) ? albums.filter((a) => matchesAlbum(a, q)) : albums, sort);

/** An album's artist, by name: an artist and their albums can come from different servers. */
const artistKeyOf = (name: string) => norm(name);

/** Artists whose albums match, sorted. `albums` is the whole library; the artist list says who to show. */
export function queryArtists(artists: Artist[], albums: Album[], q: BrowseQuery, sort: ArtistSort = 'name'): Artist[] {
  let shown = artists;
  const counts = new Map<string, number>();
  if (isFiltered(q) || sort === 'albums') {
    for (const a of albums) if (!isFiltered(q) || matchesAlbum(a, q)) counts.set(artistKeyOf(a.artist), (counts.get(artistKeyOf(a.artist)) ?? 0) + 1);
    // without a year, an artist's own genres, styles, moods and collections on the Hub count too
    const own = (a: Artist) => q.decade === undefined && !q.from && !q.to && matchesArtistTags(a.name, q);
    if (isFiltered(q)) shown = artists.filter((a) => counts.has(artistKeyOf(a.name)) || own(a));
  }
  const byName = (x: Artist, y: Artist) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' });
  return sort === 'albums'
    ? [...shown].sort((x, y) => (counts.get(artistKeyOf(y.name)) ?? y.albumCount ?? 0) - (counts.get(artistKeyOf(x.name)) ?? x.albumCount ?? 0) || byName(x, y))
    : [...shown].sort(byName);
}

/** Whether an artist's own tags on the Hub (genres, styles, moods, collections) match every one asked. */
export function matchesArtistTags(name: string, q: BrowseQuery): boolean {
  const t = artistFacets(name);
  const asked = [['genre', q.genre], ['style', q.style], ['mood', q.mood], ['collection', q.collection]] as const;
  return asked.some(([, v]) => v) && asked.every(([f, v]) => !v || hasTag(t[f] ?? [], v));
}

/** The styles, moods or collections of these albums, with how many albums have each, most first. */
export function tagCounts(albums: Album[], f: TagFacet): { name: string; albums: number }[] {
  const by = new Map<string, { name: string; albums: number }>();
  for (const a of albums) {
    for (const n of albumTags(a, f)) {
      const k = genreKey(n);
      const e = by.get(k) ?? { name: n, albums: 0 };
      e.albums++;
      by.set(k, e);
    }
  }
  return [...by.values()].sort((x, y) => y.albums - x.albums || x.name.localeCompare(y.name));
}

/** The genres an artist plays, from their albums, most albums first. */
export function artistGenres(artist: Artist, albums: Album[]): string[] {
  const k = artistKeyOf(artist.name);
  return genreCounts(albums.filter((a) => artistKeyOf(a.artist) === k)).map((g) => g.name);
}

/** A random handful, for "Shuffle this genre". */
export function sample<T>(items: T[], n: number, rand = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export interface GenreNode {
  /** What to show: "Rap / Hip-Hop" when two genres always go together. */
  label: string;
  /** What to filter on (BrowseQuery.genre). */
  genre: string;
  albums: number;
  subs: GenreNode[];
}

/**
 * The library's genres as genres and sub-genres, worked out from the tags: the Hub writes a sub-genre next to
 * its genre ("Electronic; Deep House"), so a genre whose albums all also have a bigger genre is a sub-genre of
 * it. Genres that are always together ("Rap" and "Hip-Hop", from "Rap; Hip-Hop") are one. Most albums first.
 */
export function genreTree(albums: Album[]): GenreNode[] {
  const sets = new Map<string, { names: Map<string, number>; ids: Set<number> }>();
  albums.forEach((a, i) => {
    for (const g of albumGenres(a)) {
      const k = genreKey(g);
      const e = sets.get(k) ?? { names: new Map(), ids: new Set() };
      e.ids.add(i);
      e.names.set(g, (e.names.get(g) ?? 0) + 1);
      sets.set(k, e);
    }
  });
  const nameOf = (names: Map<string, number>) => [...names].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  const sameSet = (x: Set<number>, y: Set<number>) => x.size === y.size && [...x].every((i) => y.has(i));
  // genres always together become one
  const groups: { names: string[]; ids: Set<number> }[] = [];
  // …unless one name is in the other: "Metal" and "Thrash Metal" with the same albums is a genre and a sub-genre
  const inName = (sub: string, of: string) => sub !== of && genreKey(sub).includes(genreKey(of));
  for (const e of sets.values()) {
    const name = nameOf(e.names);
    const same = groups.find((g) => sameSet(g.ids, e.ids) && !g.names.some((n) => inName(n, name) || inName(name, n)));
    if (same) same.names.push(name);
    else groups.push({ names: [name], ids: e.ids });
  }
  // a sub-genre's albums are all in a bigger genre: it goes under the biggest one
  const parentOf = groups.map((g) => {
    let best: number | undefined;
    groups.forEach((p, j) => {
      const bigger = p.ids.size > g.ids.size || (p.ids.size === g.ids.size && p !== g && g.names.some((n) => p.names.some((m) => inName(n, m))));
      if (!bigger || (best !== undefined && groups[best].ids.size >= p.ids.size)) return;
      if ([...g.ids].every((i) => p.ids.has(i))) best = j;
    });
    return best;
  });
  const node = (i: number): GenreNode => ({
    label: groups[i].names.join(' / '),
    genre: groups[i].names[0],
    albums: groups[i].ids.size,
    subs: groups.map((_, j) => j).filter((j) => parentOf[j] === i).map(node).sort(byAlbums),
  });
  const byAlbums = (x: GenreNode, y: GenreNode) => y.albums - x.albums || x.label.localeCompare(y.label);
  // nesting stops at two levels: a sub-genre of a sub-genre is listed under the top genre
  const top = groups.map((_, i) => i).filter((i) => parentOf[i] === undefined).map(node);
  for (const t of top) t.subs = t.subs.flatMap((s) => [{ ...s, subs: [] }, ...flatten(s.subs)]).sort(byAlbums);
  return top.sort(byAlbums);
}

const flatten = (nodes: GenreNode[]): GenreNode[] => nodes.flatMap((n) => [{ ...n, subs: [] }, ...flatten(n.subs)]);

/** The genre (top level) a genre is in, and the node itself, by name. */
export function findGenre(tree: GenreNode[], genre: string): { parent?: GenreNode; node: GenreNode } | undefined {
  const k = genreKey(genre);
  for (const t of tree) {
    if (genreKey(t.genre) === k) return { node: t };
    const s = t.subs.find((x) => genreKey(x.genre) === k);
    if (s) return { parent: t, node: s };
  }
  return undefined;
}
