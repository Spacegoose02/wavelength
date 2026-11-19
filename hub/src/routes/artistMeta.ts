import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import type { Db } from '../db.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';

/**
 * Artist details that have nowhere to live in the music files (docs/HUB.md, "Edit artist"): a biography an admin
 * wrote, shown on the artist page instead of Wikipedia's, how that artist's albums are ordered there, and a group's
 * members (Hot Boy$: Lil Wayne, Turk, Juvenile, B.G.), which each member's page reads back as "Member of". Also
 * the artist's match (Edit artist → Match): which MusicBrainz and Deezer artist they are when looking them up by
 * name finds nobody or the wrong one, or that they're on neither, and facts filled in by hand (type, where from,
 * years, links). Everyone signed in reads them; admins with `library.edit` set them from the app's Edit artist dialog.
 */

export const ALBUM_SORTS = ['', 'newest', 'oldest', 'title'] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];
export const MAX_MEMBERS = 60;

export const MAX_LINKS = 20;
/** Don't look the artist up on that site at all. */
export const NO_MATCH = 'none';
export const ARTIST_TYPES = ['', 'Person', 'Group', 'Orchestra', 'Choir', 'Character', 'Other'] as const;

/** Facts filled in by hand for an artist, shown over MusicBrainz's. Dates are YYYY, YYYY-MM or YYYY-MM-DD. */
export interface ArtistFacts {
  type: (typeof ARTIST_TYPES)[number];
  area: string;
  began: string;
  ended: string;
  links: { label: string; url: string }[];
}

interface Row { name: string; bio: string; album_sort: AlbumSort; members: string | null; mb_match: string | null; deezer_match: string | null; facts: string | null; updated_at: number }
type Fields = Omit<Row, 'name' | 'updated_at'>;

/** Names compared loosely: case, accents and punctuation don't count, and "$" reads as "s" (Hot Boy$ = Hot Boys). */
export const memberKey = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\$/g, 's').replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const parseMembers = (raw: string | null): string[] | null => {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
};

const parseFacts = (raw: string | null): ArtistFacts | null => {
  if (raw == null) return null;
  try {
    return cleanFacts(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
};

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** A MusicBrainz match from a request: an artist id (lower case), 'none', or null (look them up by name). undefined when it's neither. */
export function cleanMbMatch(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const id = v.trim().toLowerCase();
  return id === NO_MATCH || MBID.test(id) ? id : undefined;
}

/** A Deezer match from a request: an artist id (a whole number, as text), 'none', or null. undefined when it's neither. */
export function cleanDeezerMatch(v: unknown): string | null | undefined {
  if (v === null) return null;
  const id = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim().toLowerCase() : '';
  return id === NO_MATCH || /^[1-9]\d{0,15}$/.test(id) ? id : undefined;
}

/**
 * Clean facts from a request: trimmed, dates checked, links kept to http(s) ones with a label (the site's name when
 * none is given). null when nothing is filled in; undefined when it isn't facts at all.
 */
export function cleanFacts(v: unknown): ArtistFacts | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const text = (k: string, max: number) => (typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, max) : o[k] == null ? '' : undefined);
  const type = text('type', 20);
  const area = text('area', 200);
  const began = text('began', 10);
  const ended = text('ended', 10);
  if (type === undefined || area === undefined || began === undefined || ended === undefined) return undefined;
  if (!(ARTIST_TYPES as readonly string[]).includes(type)) return undefined;
  if ((began && !DATE.test(began)) || (ended && !DATE.test(ended))) return undefined;
  if (o.links != null && !Array.isArray(o.links)) return undefined;
  const links: ArtistFacts['links'] = [];
  for (const l of (o.links as unknown[] | undefined) ?? []) {
    if (!l || typeof l !== 'object') return undefined;
    const url = typeof (l as any).url === 'string' ? (l as any).url.trim().slice(0, 500) : '';
    let host: string;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
      host = u.hostname.replace(/^www\./, '');
    } catch {
      if (!url) continue;
      return undefined;
    }
    const label = (typeof (l as any).label === 'string' ? (l as any).label.trim().slice(0, 60) : '') || host;
    if (!links.some((x) => x.url === url)) links.push({ label, url });
  }
  const facts = { type: type as ArtistFacts['type'], area, began, ended, links: links.slice(0, MAX_LINKS) };
  return facts.type || facts.area || facts.began || facts.ended || facts.links.length ? facts : null;
}

/** Clean a members list from a request: trimmed, without blanks, repeats or the group itself. null when it isn't a list of names. */
export function cleanMembers(v: unknown, group: string): string[] | null {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return null;
  const seen = new Set([memberKey(group)]);
  const out: string[] = [];
  for (const x of v as string[]) {
    const name = x.trim().slice(0, 200);
    const k = memberKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out.slice(0, MAX_MEMBERS);
}

/** The groups that list this artist as a member, A to Z. */
export function groupsOf(db: Db, name: string): string[] {
  const k = memberKey(name);
  if (!k) return [];
  const rows = db.prepare('SELECT name, members FROM artist_meta WHERE members IS NOT NULL').all() as { name: string; members: string }[];
  return rows.filter((r) => parseMembers(r.members)?.some((m) => memberKey(m) === k)).map((r) => r.name).sort((a, b) => a.localeCompare(b));
}

/** A row's match: ids as the app uses them (Deezer's a number), 'none', or null (looked up by name). */
function matchOf(r?: Pick<Row, 'mb_match' | 'deezer_match'>) {
  const dz = r?.deezer_match ?? null;
  return { musicbrainz: r?.mb_match ?? null, deezer: dz === null || dz === NO_MATCH ? dz : Number(dz) };
}

export function artistMetaRoutes(app: FastifyInstance, { db }: Ctx) {
  const get = (name: string) => db.prepare('SELECT name, bio, album_sort, members, mb_match, deezer_match, facts, updated_at FROM artist_meta WHERE name = ?').get(name) as Row | undefined;
  const out = (name: string, r?: Row) => ({
    name: r?.name ?? name,
    bio: r?.bio ?? '',
    albumSort: r?.album_sort ?? '',
    members: parseMembers(r?.members ?? null),
    memberOf: groupsOf(db, name),
    match: matchOf(r),
    facts: parseFacts(r?.facts ?? null),
    updatedAt: r?.updated_at ?? null,
  });
  const write = (name: string, f: Fields, by: number) => {
    if (!f.bio && !f.album_sort && f.members === null && f.mb_match === null && f.deezer_match === null && f.facts === null) db.prepare('DELETE FROM artist_meta WHERE name = ?').run(name);
    else {
      db.prepare(`INSERT INTO artist_meta (name, bio, album_sort, members, mb_match, deezer_match, facts, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (name) DO UPDATE SET bio = excluded.bio, album_sort = excluded.album_sort, members = excluded.members, mb_match = excluded.mb_match,
          deezer_match = excluded.deezer_match, facts = excluded.facts, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(name, f.bio, f.album_sort, f.members, f.mb_match, f.deezer_match, f.facts, by, Date.now());
    }
  };

  app.get<{ Querystring: { name?: string } }>('/api/artist-meta', async (req) => {
    signedIn(req);
    const name = (req.query.name ?? '').trim().slice(0, 200);
    if (!name) throw new HttpError(400, 'name is needed');
    return out(name, get(name));
  });

  /** Every artist matched by hand, so the app can use the match wherever it looks artists up (Release Radar too). */
  app.get('/api/artist-matches', async (req) => {
    signedIn(req);
    const rows = db.prepare('SELECT name, mb_match, deezer_match FROM artist_meta WHERE mb_match IS NOT NULL OR deezer_match IS NOT NULL ORDER BY name').all() as Pick<Row, 'name' | 'mb_match' | 'deezer_match'>[];
    return { matches: rows.map((r) => ({ name: r.name, ...matchOf(r) })) };
  });

  /**
   * `{ name, bio?, albumSort?, members?, musicbrainz?, deezer?, facts? }`: only what's sent changes. `members` is a list
   * of artist names (`[]` = none, which hides MusicBrainz's) or null (not set: the app shows MusicBrainz's).
   * `musicbrainz` is a MusicBrainz artist id and `deezer` a Deezer artist id, either one 'none' (not on that site) or
   * null (look them up by name). `facts` is `{ type, area, began, ended, links: [{ label, url }] }` or null. An artist
   * with nothing left set is forgotten.
   */
  app.put('/api/admin/artist-meta', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const name = str(body, 'name', 200);
    if (!name) throw new HttpError(400, 'name is needed');
    const was = get(name);
    const bio = body?.bio === undefined ? (was?.bio ?? '') : typeof body.bio === 'string' ? body.bio.trim().slice(0, 20_000) : null;
    if (bio === null) throw new HttpError(400, 'bio must be text');
    const sort = body?.albumSort === undefined ? (was?.album_sort ?? '') : body.albumSort;
    if (!(ALBUM_SORTS as readonly unknown[]).includes(sort)) throw new HttpError(400, `albumSort must be one of: ${ALBUM_SORTS.filter(Boolean).join(', ')}, or empty`);
    let members = parseMembers(was?.members ?? null);
    if (body?.members !== undefined) {
      members = body.members === null ? null : cleanMembers(body.members, name);
      if (body.members !== null && members === null) throw new HttpError(400, 'members must be a list of artist names');
    }
    const mb = body?.musicbrainz === undefined ? (was?.mb_match ?? null) : cleanMbMatch(body.musicbrainz);
    if (mb === undefined) throw new HttpError(400, `musicbrainz must be a MusicBrainz artist id, "${NO_MATCH}" or null`);
    const dz = body?.deezer === undefined ? (was?.deezer_match ?? null) : cleanDeezerMatch(body.deezer);
    if (dz === undefined) throw new HttpError(400, `deezer must be a Deezer artist id, "${NO_MATCH}" or null`);
    const facts = body?.facts === undefined ? parseFacts(was?.facts ?? null) : cleanFacts(body.facts);
    if (facts === undefined) throw new HttpError(400, 'facts must be { type, area, began, ended, links } with dates as YYYY, YYYY-MM or YYYY-MM-DD and http(s) links');
    write(name, { bio, album_sort: sort as AlbumSort, members: members === null ? null : JSON.stringify(members), mb_match: mb, deezer_match: dz, facts: facts && JSON.stringify(facts) }, user.id);
    audit(db, { actorId: user.id, action: 'artist.edited', target: name, detail: { bio: !!bio, albumSort: sort, members: members?.length ?? null, musicbrainz: mb, deezer: dz, facts: !!facts }, ip: clientIp(req) });
    return out(name, get(name));
  });

  /**
   * `{ from, to }`: an artist was renamed (Edit artist), so every group listing them as a member lists the new name.
   * Returns the groups changed.
   */
  app.put('/api/admin/artist-meta/member-rename', async (req) => {
    const { user } = need(req, 'library.edit');
    const body = req.body as Record<string, unknown> | null;
    const from = str(body, 'from', 200);
    const to = str(body, 'to', 200);
    if (!from || !to) throw new HttpError(400, 'from and to are needed');
    const k = memberKey(from);
    const changed: string[] = [];
    for (const group of groupsOf(db, from)) {
      const r = get(group)!;
      const list = parseMembers(r.members) ?? [];
      const next = cleanMembers(list.map((m) => (memberKey(m) === k ? to : m)), group) ?? list;
      write(r.name, { ...r, members: JSON.stringify(next) }, user.id);
      changed.push(r.name);
    }
    if (changed.length) audit(db, { actorId: user.id, action: 'artist.memberRenamed', target: to, detail: { from, groups: changed }, ip: clientIp(req) });
    return { groups: changed };
  });
}
