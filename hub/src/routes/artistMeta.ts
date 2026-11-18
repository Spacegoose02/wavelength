import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import type { Db } from '../db.ts';
import { clientIp, HttpError, need, signedIn, str } from '../http.ts';

/**
 * Artist details that have nowhere to live in the music files (docs/HUB.md, "Edit artist"): a biography an admin
 * wrote, shown on the artist page instead of Wikipedia's, how that artist's albums are ordered there, and a group's
 * members (Hot Boy$: Lil Wayne, Turk, Juvenile, B.G.), which each member's page reads back as "Member of". Everyone
 * signed in reads them; admins with `library.edit` set them from the app's Edit artist dialog.
 */

export const ALBUM_SORTS = ['', 'newest', 'oldest', 'title'] as const;
export type AlbumSort = (typeof ALBUM_SORTS)[number];
export const MAX_MEMBERS = 60;

interface Row { name: string; bio: string; album_sort: AlbumSort; members: string | null; updated_at: number }

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

export function artistMetaRoutes(app: FastifyInstance, { db }: Ctx) {
  const get = (name: string) => db.prepare('SELECT name, bio, album_sort, members, updated_at FROM artist_meta WHERE name = ?').get(name) as Row | undefined;
  const out = (name: string, r?: Row) => ({
    name: r?.name ?? name,
    bio: r?.bio ?? '',
    albumSort: r?.album_sort ?? '',
    members: parseMembers(r?.members ?? null),
    memberOf: groupsOf(db, name),
    updatedAt: r?.updated_at ?? null,
  });
  const write = (name: string, bio: string, sort: string, members: string[] | null, by: number) => {
    if (!bio && !sort && members === null) db.prepare('DELETE FROM artist_meta WHERE name = ?').run(name);
    else {
      db.prepare(`INSERT INTO artist_meta (name, bio, album_sort, members, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (name) DO UPDATE SET bio = excluded.bio, album_sort = excluded.album_sort, members = excluded.members, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(name, bio, sort, members === null ? null : JSON.stringify(members), by, Date.now());
    }
  };

  app.get<{ Querystring: { name?: string } }>('/api/artist-meta', async (req) => {
    signedIn(req);
    const name = (req.query.name ?? '').trim().slice(0, 200);
    if (!name) throw new HttpError(400, 'name is needed');
    return out(name, get(name));
  });

  /**
   * `{ name, bio?, albumSort?, members? }`: only what's sent changes. `members` is a list of artist names (`[]` = none,
   * which hides MusicBrainz's) or null (not set: the app shows MusicBrainz's). An artist with nothing left set is forgotten.
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
    write(name, bio, sort as string, members, user.id);
    audit(db, { actorId: user.id, action: 'artist.edited', target: name, detail: { bio: !!bio, albumSort: sort, members: members?.length ?? null }, ip: clientIp(req) });
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
      write(r.name, r.bio, r.album_sort, next, user.id);
      changed.push(r.name);
    }
    if (changed.length) audit(db, { actorId: user.id, action: 'artist.memberRenamed', target: to, detail: { from, groups: changed }, ip: clientIp(req) });
    return { groups: changed };
  });
}
