import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';
import { tx } from './db.ts';
import type { NavidromeLogin } from './userData.ts';

/**
 * Each person's playlists kept by the Hub (phase 5 of the Hub's own music server, docs/HUB.md "Playlists"), with the
 * hearts and plays switch (userData.ts). The first time someone uses the relay after it is on, the Hub copies the
 * playlists they own from Navidrome, keeping Navidrome's ids. Smart playlists stay on Navidrome, which fills them.
 * Every change is made on Navidrome too (routes/relay.ts), first, so a new playlist gets the same id in both.
 */

export interface HubPlaylist {
  id: string;
  ownerId: number;
  name: string;
  comment: string;
  public: boolean;
  created: number;
  changed: number;
  songs: string[];
}

const importedKey = (userId: number) => `playlists.imported.${userId}`;

export function playlistsImported(db: Db, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM hub_settings WHERE key = ?').get(importedKey(userId));
}

export function getPlaylist(db: Db, id: string): HubPlaylist | null {
  const r = db.prepare('SELECT id, owner_id, name, comment, public, created_at, updated_at FROM server_playlists WHERE id = ?').get(id) as
    { id: string; owner_id: number; name: string; comment: string; public: number; created_at: number; updated_at: number } | undefined;
  if (!r) return null;
  const songs = (db.prepare('SELECT song_id FROM server_playlist_songs WHERE playlist_id = ? ORDER BY pos').all(id) as { song_id: string }[]).map((x) => x.song_id);
  return { id: r.id, ownerId: r.owner_id, name: r.name, comment: r.comment, public: !!r.public, created: r.created_at, changed: r.updated_at, songs };
}

/** The playlists a person sees: their own, and other people's public ones. */
export function visiblePlaylists(db: Db, userId: number): HubPlaylist[] {
  const ids = db.prepare('SELECT id FROM server_playlists WHERE owner_id = ? OR public = 1 ORDER BY name COLLATE NOCASE').all(userId) as { id: string }[];
  return ids.map((r) => getPlaylist(db, r.id)!).filter(Boolean);
}

function setSongs(db: Db, id: string, songs: string[]) {
  db.prepare('DELETE FROM server_playlist_songs WHERE playlist_id = ?').run(id);
  const add = db.prepare('INSERT INTO server_playlist_songs (playlist_id, pos, song_id) VALUES (?, ?, ?)');
  songs.forEach((s, i) => add.run(id, i, s));
}

function insert(db: Db, ownerId: number, name: string, songs: string[], id: string, at: number, extra: { comment?: string; public?: boolean }) {
  db.prepare('INSERT INTO server_playlists (id, owner_id, name, comment, public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, name.slice(0, 300), (extra.comment ?? '').slice(0, 2000), extra.public ? 1 : 0, at, at);
  setSongs(db, id, songs);
}

export function createPlaylist(db: Db, ownerId: number, name: string, songs: string[], id: string = randomUUID(), at = Date.now(), extra: { comment?: string; public?: boolean } = {}): HubPlaylist {
  tx(db, () => insert(db, ownerId, name, songs, id, at, extra));
  return getPlaylist(db, id)!;
}

/** Subsonic's createPlaylist with a playlistId: its songs become these. */
export function replaceSongs(db: Db, id: string, songs: string[]) {
  tx(db, () => {
    setSongs(db, id, songs);
    db.prepare('UPDATE server_playlists SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  });
}

/** Subsonic's updatePlaylist: rename, comment, public, songs added at the end, songs removed by position. */
export function updatePlaylist(db: Db, id: string, u: { name?: string; comment?: string; public?: boolean; add?: string[]; removeAt?: number[] }) {
  const p = getPlaylist(db, id);
  if (!p) return;
  const drop = new Set(u.removeAt ?? []);
  const songs = [...p.songs.filter((_, i) => !drop.has(i)), ...(u.add ?? [])];
  tx(db, () => {
    db.prepare('UPDATE server_playlists SET name = ?, comment = ?, public = ?, updated_at = ? WHERE id = ?')
      .run((u.name ?? p.name).slice(0, 300), (u.comment ?? p.comment).slice(0, 2000), (u.public ?? p.public) ? 1 : 0, Date.now(), id);
    setSongs(db, id, songs);
  });
}

export function deletePlaylist(db: Db, id: string) {
  db.prepare('DELETE FROM server_playlists WHERE id = ?').run(id);
}

/**
 * Copy the playlists this person owns from Navidrome (their own login), except smart ones, once. Throws when
 * Navidrome can't be asked; nothing is marked copied then.
 */
export async function importPlaylists(db: Db, userId: number, nd: NavidromeLogin): Promise<{ playlists: number; smart: number }> {
  const base = nd.url.replace(/\/+$/, '');
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: nd.username, password: nd.password }), signal: AbortSignal.timeout(30_000) });
  const token = ((await login.json().catch(() => null)) as { token?: string } | null)?.token;
  if (!login.ok || !token) throw new Error('Navidrome refused this person’s login');
  const headers = { 'x-nd-authorization': `Bearer ${token}` };
  const r = await fetch(`${base}/api/playlist?_start=0&_end=5000&_sort=name&_order=ASC`, { headers, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Navidrome couldn't list the playlists (${r.status})`);
  const list = (await r.json().catch(() => null)) as { id?: string; name?: string; comment?: string; ownerName?: string; public?: boolean; rules?: unknown; createdAt?: string; updatedAt?: string }[];
  if (!Array.isArray(list)) throw new Error('Navidrome sent something other than a list of playlists');
  const mine = list.filter((p) => p?.id && p.ownerName === nd.username);
  const plain = mine.filter((p) => !p.rules);
  const copies: { p: (typeof plain)[number]; songs: string[] }[] = [];
  for (const p of plain) {
    const t = await fetch(`${base}/api/playlist/${encodeURIComponent(p.id!)}/tracks?_start=0&_end=100000&_sort=id&_order=ASC`, { headers, signal: AbortSignal.timeout(60_000) });
    if (!t.ok) throw new Error(`Navidrome couldn't list the songs of ${p.name} (${t.status})`);
    const tracks = (await t.json().catch(() => [])) as { mediaFileId?: string; id?: string }[];
    copies.push({ p, songs: tracks.map((x) => String(x.mediaFileId ?? x.id ?? '')).filter(Boolean) });
  }
  tx(db, () => {
    for (const { p, songs } of copies) {
      if (getPlaylist(db, p.id!)) continue;
      insert(db, userId, String(p.name ?? 'Playlist'), songs, p.id!, Date.parse(p.createdAt ?? '') || Date.now(), { comment: p.comment ?? '', public: !!p.public });
    }
    db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(importedKey(userId), JSON.stringify({ at: Date.now(), playlists: copies.length, smart: mine.length - plain.length }));
  });
  return { playlists: copies.length, smart: mine.length - plain.length };
}
