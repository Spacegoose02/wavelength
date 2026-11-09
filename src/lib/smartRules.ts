import type { Album, Track } from '../sources/types';
import { albumGenres, albumTags, decadeOf, genreKey, splitGenres } from './browse';
import { artistFacets } from './itemTags';
import type { SongFacts } from './smartPlaylists';

/**
 * Advanced rules for smart playlists, like Plex's filter builder: groups that match all or any of their rows (and of
 * the groups inside them), each row a field, an operator and a value. "Album genre is Country and (artist contains
 * Lil or artist contains Young)". The fields come in Plex's three kinds:
 *
 * - Artist: the album artist, and the artist's own genres, styles, moods and collections on the Hub.
 * - Album: from the library's album list (title, year, genres, plays, rating, ♥, record label, type, added) and
 *   the album's styles, moods and collections on the Hub.
 * - Track: only known once the album's songs are read (title, artist, genre, plays, rating, ♥, format, folder…).
 *
 * So a playlist first keeps the albums that could match (`evalGroup` with no song gives "maybe" for track fields),
 * then reads their songs and checks each one (lib/smartPlaylists.ts).
 */

export type FieldType = 'text' | 'tags' | 'number' | 'decade' | 'rating' | 'days' | 'bool';
export type FieldKind = 'Artist' | 'Album' | 'Track';
export type Op = 'is' | 'isNot' | 'contains' | 'notContains' | 'beginsWith' | 'endsWith' | 'gt' | 'lt' | 'inLast' | 'notInLast';

export interface Rule { field: FieldId; op: Op; value: string }
export interface RuleGroup { match: 'all' | 'any'; rules: (Rule | RuleGroup)[] }

export interface RuleCtx { album: Album; track?: Track; facts?: SongFacts; now?: number }
type Value = string | string[] | number | boolean | undefined;

const own = (a: Album, f: 'genre' | 'style' | 'mood' | 'collection') => artistFacets(a.artist)[f] ?? [];
const t = (c: RuleCtx) => c.track!;

/** Each field: its kind, its type, and how to read it (track fields only get a context with a song). */
export const FIELDS = [
  { id: 'artist', kind: 'Artist', label: 'Artist', type: 'text', get: (c: RuleCtx): Value => c.album.artist },
  // the artist's genres on the Hub, or the genres of their albums when the Hub has none
  { id: 'artistGenre', kind: 'Artist', label: 'Artist genre', type: 'tags', get: (c: RuleCtx): Value => (own(c.album, 'genre').length ? own(c.album, 'genre') : albumGenres(c.album)) },
  { id: 'artistStyle', kind: 'Artist', label: 'Artist style', type: 'tags', get: (c: RuleCtx): Value => own(c.album, 'style') },
  { id: 'artistMood', kind: 'Artist', label: 'Artist mood', type: 'tags', get: (c: RuleCtx): Value => own(c.album, 'mood') },
  { id: 'artistCollection', kind: 'Artist', label: 'Artist collection', type: 'tags', get: (c: RuleCtx): Value => own(c.album, 'collection') },
  { id: 'album', kind: 'Album', label: 'Album title', type: 'text', get: (c: RuleCtx): Value => c.album.title },
  { id: 'year', kind: 'Album', label: 'Year', type: 'number', get: (c: RuleCtx): Value => c.album.year },
  { id: 'decade', kind: 'Album', label: 'Album decade', type: 'decade', get: (c: RuleCtx): Value => decadeOf(c.album.year) },
  { id: 'genre', kind: 'Album', label: 'Album genre', type: 'tags', get: (c: RuleCtx): Value => albumGenres(c.album) },
  { id: 'albumPlays', kind: 'Album', label: 'Album plays', type: 'number', get: (c: RuleCtx): Value => c.album.plays ?? 0 },
  { id: 'albumPlayed', kind: 'Album', label: 'Album last played', type: 'days', get: (c: RuleCtx): Value => c.album.playedAt },
  { id: 'albumRating', kind: 'Album', label: 'Album rating', type: 'rating', get: (c: RuleCtx): Value => c.album.rating ?? 0 },
  { id: 'albumStarred', kind: 'Album', label: 'Album ♥', type: 'bool', get: (c: RuleCtx): Value => !!c.album.starred },
  // the label is in the album list on newer Navidromes; otherwise it's known once the album is read
  { id: 'label', kind: 'Album', label: 'Record label', type: 'tags', get: (c: RuleCtx): Value => c.album.labels ?? (c.facts ? splitGenres(c.facts.label ?? '') : undefined) },
  { id: 'style', kind: 'Album', label: 'Album style', type: 'tags', get: (c: RuleCtx): Value => albumTags(c.album, 'style') },
  { id: 'mood', kind: 'Album', label: 'Album mood', type: 'tags', get: (c: RuleCtx): Value => albumTags(c.album, 'mood') },
  { id: 'collection', kind: 'Album', label: 'Album collection', type: 'tags', get: (c: RuleCtx): Value => albumTags(c.album, 'collection') },
  { id: 'albumType', kind: 'Album', label: 'Album type', type: 'tags', get: (c: RuleCtx): Value => [...(c.album.releaseTypes ?? ['album']), ...(c.album.compilation ? ['compilation'] : [])] },
  { id: 'albumAdded', kind: 'Album', label: 'Date album added', type: 'days', get: (c: RuleCtx): Value => c.album.addedAt },
  { id: 'title', kind: 'Track', label: 'Track title', type: 'text', get: (c: RuleCtx): Value => t(c).title },
  { id: 'trackArtist', kind: 'Track', label: 'Track artist', type: 'text', get: (c: RuleCtx): Value => t(c).artist },
  { id: 'trackGenre', kind: 'Track', label: 'Track genre', type: 'tags', get: (c: RuleCtx): Value => splitGenres(c.facts?.genre ?? '') },
  { id: 'plays', kind: 'Track', label: 'Track plays', type: 'number', get: (c: RuleCtx): Value => c.facts?.plays ?? 0 },
  { id: 'played', kind: 'Track', label: 'Track last played', type: 'days', get: (c: RuleCtx): Value => c.facts?.playedAt },
  { id: 'rating', kind: 'Track', label: 'Track rating', type: 'rating', get: (c: RuleCtx): Value => c.facts?.rating ?? 0 },
  { id: 'starred', kind: 'Track', label: 'Track ♥', type: 'bool', get: (c: RuleCtx): Value => !!c.facts?.starred },
  { id: 'added', kind: 'Track', label: 'Track added', type: 'days', get: (c: RuleCtx): Value => c.facts?.addedAt },
  { id: 'format', kind: 'Track', label: 'Audio format', type: 'text', get: (c: RuleCtx): Value => c.facts?.format ?? '' },
  { id: 'bitRate', kind: 'Track', label: 'Bit rate (kbps)', type: 'number', get: (c: RuleCtx): Value => c.facts?.bitRate },
  { id: 'folder', kind: 'Track', label: 'Folder location', type: 'text', get: (c: RuleCtx): Value => c.facts?.path ?? '' },
] as const satisfies readonly { id: string; kind: FieldKind; label: string; type: FieldType; get: (c: RuleCtx) => Value }[];
export type FieldId = (typeof FIELDS)[number]['id'];
type Field = (typeof FIELDS)[number];
export const fieldOf = (id: FieldId): Field => FIELDS.find((f) => f.id === id) ?? FIELDS[0];

export const OPS: Record<FieldType, { op: Op; label: string }[]> = {
  text: [{ op: 'contains', label: 'contains' }, { op: 'notContains', label: 'does not contain' }, { op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }, { op: 'beginsWith', label: 'begins with' }, { op: 'endsWith', label: 'ends with' }],
  tags: [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }, { op: 'contains', label: 'contains' }, { op: 'notContains', label: 'does not contain' }],
  number: [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }, { op: 'gt', label: 'is greater than' }, { op: 'lt', label: 'is less than' }],
  decade: [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }],
  rating: [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }, { op: 'gt', label: 'is greater than' }, { op: 'lt', label: 'is less than' }],
  days: [{ op: 'inLast', label: 'is in the last' }, { op: 'notInLast', label: 'is not in the last' }],
  bool: [{ op: 'is', label: 'is' }],
};

export const isGroup = (r: Rule | RuleGroup): r is RuleGroup => 'match' in r;
export function newRule(field: FieldId = 'genre'): Rule {
  const f = fieldOf(field);
  return { field, op: OPS[f.type][0].op, value: f.type === 'bool' ? 'true' : '' };
}
export const newGroup = (match: 'all' | 'any' = 'all'): RuleGroup => ({ match, rules: [newRule()] });

/** A row that says something (an empty value is left out, like Plex). */
const filled = (r: Rule) => fieldOf(r.field).type === 'bool' || !!r.value.trim();

const DAY = 86_400_000;

/** One row: true, false, or undefined when it's about the song and there's no song yet. */
export function evalRule(r: Rule, c: RuleCtx): boolean | undefined {
  if (!filled(r)) return true;
  const f = fieldOf(r.field);
  if (f.kind === 'Track' && !c.track) return undefined;
  const have = f.get(c);
  if (have === undefined && f.type === 'tags') return undefined; // the label before the album is read
  const v = r.value.trim();
  switch (f.type) {
    case 'text': {
      const h = genreKey(String(have ?? ''));
      const w = genreKey(v);
      switch (r.op) {
        case 'is': return h === w;
        case 'isNot': return h !== w;
        case 'notContains': return !h.includes(w);
        case 'beginsWith': return h.startsWith(w);
        case 'endsWith': return h.endsWith(w);
        default: return h.includes(w);
      }
    }
    case 'tags': {
      const names = (have as string[]).map(genreKey);
      const w = genreKey(v);
      switch (r.op) {
        case 'isNot': return !names.includes(w);
        case 'contains': return names.some((n) => n.includes(w));
        case 'notContains': return !names.some((n) => n.includes(w));
        default: return names.includes(w);
      }
    }
    case 'number':
    case 'rating':
    case 'decade': {
      const w = Number(v);
      if (Number.isNaN(w)) return true;
      if (typeof have !== 'number') return r.op === 'isNot';
      switch (r.op) {
        case 'isNot': return have !== w;
        case 'gt': return have > w;
        case 'lt': return have < w;
        default: return have === w;
      }
    }
    case 'days': {
      const days = Number(v);
      if (Number.isNaN(days)) return true;
      const recent = typeof have === 'number' && (c.now ?? Date.now()) - have <= days * DAY;
      // never played counts as "not played in the last N days"
      return r.op === 'notInLast' ? !recent : recent;
    }
    case 'bool':
      return !!have === (v !== 'false');
  }
}

/** A group: all or any of its rows and groups. "Maybe" (undefined) stays maybe unless the rest decides. */
export function evalGroup(g: RuleGroup, c: RuleCtx): boolean | undefined {
  let maybe = false;
  for (const r of g.rules) {
    const x = isGroup(r) ? evalGroup(r, c) : evalRule(r, c);
    if (x === undefined) maybe = true;
    else if (g.match === 'all' && !x) return false;
    else if (g.match === 'any' && x) return true;
  }
  if (maybe) return undefined;
  // "any" of nothing (every row empty) is no rule at all
  return g.match === 'all' || !g.rules.some((r) => isGroup(r) || filled(r));
}

/** Whether any row is about the songs (so every candidate album has to be read to know). */
export const needsSongs = (g: RuleGroup): boolean => g.rules.some((r) => (isGroup(r) ? needsSongs(r) : filled(r) && fieldOf(r.field).kind === 'Track'));

/** Rules that don't say anything. */
export const isEmpty = (g: RuleGroup): boolean => !g.rules.some((r) => (isGroup(r) ? !isEmpty(r) : filled(r)));

/** In words, for the playlist card: "Album genre is Country and any of (Artist contains Lil, Artist contains Young)". */
export function describeRules(g: RuleGroup): string {
  const one = (r: Rule | RuleGroup): string => {
    if (isGroup(r)) return `${r.match} of (${r.rules.filter((x) => isGroup(x) || filled(x)).map(one).join(', ')})`;
    const f = fieldOf(r.field);
    const op = OPS[f.type].find((o) => o.op === r.op)?.label ?? r.op;
    const val = f.type === 'decade' ? `${r.value}s` : f.type === 'days' ? `${r.value} days` : f.type === 'bool' ? (r.value === 'false' ? 'off' : 'on') : f.type === 'rating' ? `${r.value}★` : r.value;
    return `${f.label} ${op} ${val}`;
  };
  const parts = g.rules.filter((r) => (isGroup(r) ? !isEmpty(r) : filled(r))).map(one);
  return parts.length ? parts.join(g.match === 'all' ? ' and ' : ' or ') : 'Any song';
}

/** What the limit keeps when more songs match: random, or the top by one of these. */
export const SORTS = [
  { id: 'random', label: 'at random' },
  { id: 'plays', label: 'most played' },
  { id: 'leastPlays', label: 'least played' },
  { id: 'played', label: 'last played' },
  { id: 'added', label: 'recently added' },
  { id: 'rating', label: 'highest rated' },
  { id: 'newest', label: 'newest' },
  { id: 'oldest', label: 'oldest' },
] as const;
export type SortId = (typeof SORTS)[number]['id'];

/** Sorts matched songs for the limit (random is left to the caller's shuffle). */
export function sortKey(s: SortId, x: { album: Album; facts: SongFacts }): number {
  switch (s) {
    case 'plays': return -(x.facts.plays ?? 0);
    case 'leastPlays': return x.facts.plays ?? 0;
    case 'played': return -(x.facts.playedAt ?? 0);
    case 'added': return -(x.facts.addedAt ?? x.album.addedAt ?? 0);
    case 'rating': return -(x.facts.rating ?? 0);
    case 'newest': return -(x.facts.year ?? x.album.year ?? 0);
    case 'oldest': return x.facts.year ?? x.album.year ?? 9999;
    default: return 0;
  }
}
