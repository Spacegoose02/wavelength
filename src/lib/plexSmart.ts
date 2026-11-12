import type { SmartPlaylist } from './smartPlaylists';
import { type FieldId, newRule, type Op, type Rule, type RuleGroup, type SortId } from './smartRules';

/**
 * Plex smart playlists as Wavelength smart playlists: Plex keeps a smart playlist's rules as a library link in the
 * playlist's `content` ("…/library/sections/5/all?type=10&push=1&artist.genre=123&or=1&artist.title=Lil&pop=1
 * &track.userRating>>=6&sort=viewCount:desc&limit=50"). This reads that link into advanced rules (lib/smartRules.ts)
 * so the playlist stays smart in Wavelength instead of being frozen as the songs it had on the day it was copied.
 *
 * The link's grammar (the same one Plex Web's filter builder writes):
 * - `push=1` opens a group and `pop=1` closes it; `or=1` between two rows makes their group "match any".
 * - A row is `<kind>.<field><operator><value>`. Text: `=` contains, `!=` does not contain, `==` is, `!==` is not,
 *   `<=` begins with, `>=` ends with. Numbers and ratings: `=` is, `!=` is not, `>>=` greater than, `<<=` less than.
 *   Dates: `>>=-30d` in the last 30 days, `<<=-30d` not in the last (units m, h, d, w, mon, y), or a fixed date.
 * - Tags (genre, style, mood, collection) are Plex tag ids (`album.genre=1234`, `1234,5678` = either); the caller
 *   turns them into names with `resolve` (PlexSource asks the library section for each tag list).
 * - Ratings are 0–10 in Plex (half stars), stars 0–5 in Wavelength.
 *
 * Rows Wavelength has no field for (Plex's country, skips, source…) are left out and listed in `dropped`, so the
 * person can see what changed.
 */

type Kind = 'artist' | 'album' | 'track';
type Tag = 'genre' | 'style' | 'mood' | 'collection';

/** Plex `<kind>.<field>` → the Wavelength field, and what sort of value it takes. */
const FIELD_MAP: Record<string, { field: FieldId; type: 'text' | 'tag' | 'number' | 'decade' | 'rating' | 'date' }> = {
  'artist.title': { field: 'artist', type: 'text' },
  'artist.genre': { field: 'artistGenre', type: 'tag' },
  'artist.style': { field: 'artistStyle', type: 'tag' },
  'artist.mood': { field: 'artistMood', type: 'tag' },
  'artist.collection': { field: 'artistCollection', type: 'tag' },
  'album.title': { field: 'album', type: 'text' },
  'album.year': { field: 'year', type: 'number' },
  'album.decade': { field: 'decade', type: 'decade' },
  'album.genre': { field: 'genre', type: 'tag' },
  'album.style': { field: 'style', type: 'tag' },
  'album.mood': { field: 'mood', type: 'tag' },
  'album.collection': { field: 'collection', type: 'tag' },
  'album.studio': { field: 'label', type: 'text' },
  'album.userRating': { field: 'albumRating', type: 'rating' },
  'album.viewCount': { field: 'albumPlays', type: 'number' },
  'album.lastViewedAt': { field: 'albumPlayed', type: 'date' },
  'album.addedAt': { field: 'albumAdded', type: 'date' },
  'track.title': { field: 'title', type: 'text' },
  'track.genre': { field: 'trackGenre', type: 'tag' },
  'track.mood': { field: 'trackMood', type: 'tag' },
  'track.style': { field: 'trackStyle', type: 'tag' },
  'track.userRating': { field: 'rating', type: 'rating' },
  'track.viewCount': { field: 'plays', type: 'number' },
  'track.lastViewedAt': { field: 'played', type: 'date' },
  'track.addedAt': { field: 'added', type: 'date' },
};

/** A Plex tag the rules point at by id, for `resolve`. */
export interface PlexTagRef { kind: Kind; tag: Tag; id: string }

export interface PlexSmartParse {
  /** The library section the rules are about (`/library/sections/<id>/all`), for looking up tag names. */
  section?: string;
  rules: RuleGroup;
  sort?: SortId;
  limit?: number;
  /** Plex rows Wavelength can't express, in words ("artist.country is 12"). */
  dropped: string[];
}

const KIND_OF_TYPE: Record<string, Kind> = { '8': 'artist', '9': 'album', '10': 'track' };
const ROW = /^([A-Za-z]+(?:\.[A-Za-z]+)?)(!==|==|!=|>>=|<<=|<=|>=|=)(.*)$/s;
const DAY = 86_400_000;

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

/** The query part of a smart playlist's `content`: "library://…/directory/%2Flibrary%2F…%3Ftype%3D10…" → "type=10&…". */
export function plexQuery(content: string): { path: string; query: string } {
  let s = content.trim();
  // library://<uuid>/directory/<encoded path> (newer) or server://…/com.plexapp.plugins.library/library/… (older)
  const dir = s.match(/\/directory\/(.+)$/);
  if (dir) s = decode(dir[1]);
  else s = s.replace(/^[a-z]+:\/\/[^/]+(?:\/com\.plexapp\.plugins\.library)?/i, '');
  // a link encoded twice has its "?" still as %3F
  if (!s.includes('?') && /%3F/i.test(s)) s = decode(s);
  const q = s.indexOf('?');
  return q < 0 ? { path: s, query: '' } : { path: s.slice(0, q), query: s.slice(q + 1) };
}

/** "-30d" / "30d" → 30 days; a fixed date ("2024-01-31" or seconds) → the days since then. */
export function plexDays(v: string, now = Date.now()): number | undefined {
  const rel = v.trim().match(/^-?(\d+)\s*(mon|[mhdwy])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const per: Record<string, number> = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7, mon: 30, y: 365 };
    return Math.max(1, Math.ceil(n * per[rel[2].toLowerCase()]));
  }
  const t = /^\d{9,}$/.test(v) ? Number(v) * 1000 : Date.parse(v);
  if (Number.isNaN(t)) return undefined;
  return Math.max(1, Math.ceil((now - t) / DAY));
}

/** Plex's sort ("viewCount:desc", "track.lastViewedAt:desc", "random") → which songs the limit keeps. */
export function plexSort(v: string | undefined): SortId | undefined {
  if (!v) return undefined;
  const [key, dir] = v.split(',')[0].split(':');
  const field = key.replace(/^(artist|album|track)\./, '');
  const desc = dir === 'desc';
  switch (field) {
    case 'random': return 'random';
    case 'viewCount': return desc ? 'plays' : 'leastPlays';
    case 'lastViewedAt': return desc ? 'played' : undefined;
    case 'addedAt': return desc ? 'added' : undefined;
    case 'userRating': return desc ? 'rating' : undefined;
    case 'year':
    case 'originallyAvailableAt': return desc ? 'newest' : 'oldest';
    default: return undefined;
  }
}

/** Half stars (0–10) as whole stars for an operator, so "rated above 3½" keeps 4 and 5. */
function stars(op: Op, v: number): string {
  const s = v / 2;
  if (op === 'gt') return String(Math.floor(s));
  if (op === 'lt') return String(Math.ceil(s));
  return String(Math.round(s));
}

const TEXT_OPS: Record<string, Op> = { '=': 'contains', '!=': 'notContains', '==': 'is', '!==': 'isNot', '<=': 'beginsWith', '>=': 'endsWith' };
const NUM_OPS: Record<string, Op> = { '=': 'is', '==': 'is', '!=': 'isNot', '!==': 'isNot', '>>=': 'gt', '<<=': 'lt' };

/**
 * One Plex row → a Wavelength row (or an "any" group for a tag row with several ids), or why it can't be.
 * Tag values stay as `plex-tag:<kind>.<tag>:<id>` until `resolvePlexTags` names them.
 */
function row(key: string, op: string, value: string, kind: Kind, now: number): Rule | RuleGroup | string {
  const full = key.includes('.') ? key : `${kind}.${key}`;
  const map = FIELD_MAP[full];
  const words = `${full} ${op} ${value}`;
  if (!map) return words;
  const { field, type } = map;
  switch (type) {
    case 'text': {
      const o = TEXT_OPS[op];
      return o ? { field, op: o, value } : words;
    }
    case 'tag': {
      // tags: "is" / "is not", one id or several (any of them)
      const neg = op === '!=' || op === '!==';
      if (!neg && op !== '=' && op !== '==') return words;
      const [k, tag] = full.split('.') as [Kind, Tag];
      const values = value.split(',').map((v) => v.trim()).filter(Boolean)
        .map((v) => (/^\d+$/.test(v) ? `plex-tag:${k}.${tag}:${v}` : v));
      const rules: Rule[] = values.map((v) => ({ field, op: neg ? 'isNot' : 'is', value: v }));
      if (rules.length === 1) return rules[0];
      return { match: neg ? 'all' : 'any', rules };
    }
    case 'number':
    case 'decade': {
      const o = NUM_OPS[op];
      if (!o || Number.isNaN(Number(value))) return words;
      if (type === 'decade' && o !== 'is' && o !== 'isNot') {
        // "decade after 1980" is "year after 1989"; "before 1980" is "year before 1980"
        return { field: 'year', op: o, value: o === 'gt' ? String(Number(value) + 9) : value };
      }
      return { field, op: o, value };
    }
    case 'rating': {
      const o = NUM_OPS[op];
      const n = Number(value);
      if (!o || Number.isNaN(n)) return words;
      return { field, op: o, value: stars(o, n) };
    }
    case 'date': {
      const days = plexDays(value, now);
      if (days === undefined) return words;
      if (op === '>>=') return { field, op: 'inLast', value: String(days) };
      if (op === '<<=') return { field, op: 'notInLast', value: String(days) };
      return words;
    }
  }
}

/** A group with nothing left in it is dropped; one with a single row is just that row. */
function tidy(g: RuleGroup): RuleGroup | Rule | undefined {
  const rules = g.rules.map((r) => ('match' in r ? tidy(r) : r)).filter((r): r is Rule | RuleGroup => !!r);
  if (!rules.length) return undefined;
  return { ...g, rules };
}

/** Reads a Plex smart playlist's `content` into Wavelength rules, a sort and a limit. */
export function parsePlexSmart(content: string, now = Date.now()): PlexSmartParse {
  const { path, query } = plexQuery(content);
  const section = path.match(/\/library\/sections\/(\d+)/)?.[1];
  const tokens = query.split('&').filter(Boolean);
  let kind: Kind = 'track';
  for (const t of tokens) {
    const [k, v] = decode(t).split('=');
    if (k === 'type' && KIND_OF_TYPE[v]) kind = KIND_OF_TYPE[v];
  }
  const dropped: string[] = [];
  let sort: SortId | undefined;
  let limit: number | undefined;
  const root: RuleGroup = { match: 'all', rules: [] };
  const stack: RuleGroup[] = [root];
  for (const raw of tokens) {
    const tok = decode(raw);
    const top = stack[stack.length - 1];
    if (tok === 'push=1') {
      const g: RuleGroup = { match: 'all', rules: [] };
      top.rules.push(g);
      stack.push(g);
      continue;
    }
    if (tok === 'pop=1') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tok === 'or=1') {
      top.match = 'any';
      continue;
    }
    const m = tok.match(ROW);
    if (!m) continue;
    const [, key, op, value] = m;
    if (key === 'type' || key === 'push' || key === 'pop' || key === 'includeGuids' || key.startsWith('X-Plex')) continue;
    if (key === 'sort') {
      sort = plexSort(value);
      if (!sort) dropped.push(`sort by ${value}`);
      continue;
    }
    if (key === 'limit') {
      const n = Number(value);
      if (n > 0) limit = n;
      continue;
    }
    const r = row(key, op, value, kind, now);
    if (typeof r === 'string') dropped.push(r);
    else top.rules.push(r);
  }
  const tidied = tidy(root);
  const rules: RuleGroup = !tidied ? { match: 'all', rules: [] } : 'match' in tidied ? tidied : { match: 'all', rules: [tidied] };
  return { section, rules, sort, limit, dropped };
}

/** Every Plex tag id the rules point at, for looking up their names. */
export function plexTagRefs(g: RuleGroup): PlexTagRef[] {
  const out: PlexTagRef[] = [];
  const walk = (x: RuleGroup) => {
    for (const r of x.rules) {
      if ('match' in r) walk(r);
      else {
        const m = r.value.match(/^plex-tag:(artist|album|track)\.(genre|style|mood|collection):(\d+)$/);
        if (m) out.push({ kind: m[1] as Kind, tag: m[2] as Tag, id: m[3] });
      }
    }
  };
  walk(g);
  return out;
}

/** Swaps tag ids for their names (`names` keyed "album.genre:1234"); an id Plex didn't name is left out and reported. */
export function resolvePlexTags(g: RuleGroup, names: Record<string, string>, dropped: string[]): RuleGroup {
  const walk = (x: RuleGroup): RuleGroup => ({
    ...x,
    rules: x.rules.flatMap((r): (Rule | RuleGroup)[] => {
      if ('match' in r) {
        const w = walk(r);
        return w.rules.length ? [w] : [];
      }
      const m = r.value.match(/^plex-tag:([a-z]+\.[a-z]+):(\d+)$/);
      if (!m) return [r];
      const name = names[`${m[1]}:${m[2]}`];
      if (!name) {
        dropped.push(`${m[1]} ${r.op === 'isNot' ? 'is not' : 'is'} tag #${m[2]} (no longer in Plex)`);
        return [];
      }
      return [{ ...r, value: name }];
    }),
  });
  return walk(g);
}

/** The Wavelength smart playlist for a Plex one. No limit in Plex means "every song": 500 here. */
export function smartFromPlex(name: string, parsed: Pick<PlexSmartParse, 'rules' | 'sort' | 'limit'>, base: SmartPlaylist): SmartPlaylist {
  const rules: RuleGroup = parsed.rules.rules.length ? parsed.rules : { match: 'all', rules: [newRule()] };
  return { ...base, name, rules, sort: parsed.sort ?? 'random', limit: parsed.limit ?? 500 };
}
