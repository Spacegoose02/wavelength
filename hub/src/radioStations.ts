import { randomUUID } from 'node:crypto';
import { navidromeOff } from './services.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { getScanSettings, navidrome } from './library.ts';

/**
 * Internet radio stations kept by the Hub (phase 5 of the Hub's own music server, docs/HUB.md "Radio stations").
 * Navidrome used to keep them. The Hub copies Navidrome's list once, keeping its ids so each device's station order
 * and hidden stations still match, and from then on the app (src/sources/navidrome.ts, for the Hub's own Navidrome)
 * and devices going through the relay (`getInternetRadioStations` …) read and change the Hub's list.
 */

export interface RadioStation {
  id: string;
  name: string;
  streamUrl: string;
  homePageUrl: string;
  /** a picture for the station's card ('' for none) */
  logoUrl: string;
}

const IMPORTED_KEY = 'radio.imported';

/** When the Hub copied Navidrome's stations, or null while it hasn't (the app keeps asking Navidrome until then). */
export function radioImportedAt(db: Db): number | null {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(IMPORTED_KEY) as { value: string } | undefined;
  return row ? Number(JSON.parse(row.value).at) || null : null;
}

export function listStations(db: Db): RadioStation[] {
  return (db.prepare('SELECT id, name, stream_url, homepage_url, logo_url FROM radio_stations ORDER BY name COLLATE NOCASE, id').all() as { id: string; name: string; stream_url: string; homepage_url: string; logo_url: string }[])
    .map((r) => ({ id: r.id, name: r.name, streamUrl: r.stream_url, homePageUrl: r.homepage_url, logoUrl: r.logo_url }));
}

/** A station's fields checked: a name, and http(s) links. */
export function readStation(b: Record<string, unknown> | null | undefined, partial = false): Partial<Omit<RadioStation, 'id'>> {
  const str = (k: string) => (typeof b?.[k] === 'string' ? (b[k] as string).trim() : undefined);
  const name = str('name'), streamUrl = str('streamUrl'), homePageUrl = str('homePageUrl'), logoUrl = str('logoUrl');
  const link = (v: string | undefined, what: string) => {
    if (v && (!/^https?:\/\/[^\s]+$/i.test(v) || v.length > 2000)) throw new HttpError(400, `${what} must be an http(s) link`);
  };
  if (!partial && !name) throw new HttpError(400, 'A station needs a name');
  if (!partial && !streamUrl) throw new HttpError(400, 'A station needs a stream link');
  if (name !== undefined && (!name || name.length > 200)) throw new HttpError(400, 'A station name is 1 to 200 characters');
  link(streamUrl, 'The stream');
  link(homePageUrl, 'The home page');
  link(logoUrl, 'The logo');
  return {
    ...(name !== undefined && { name }),
    ...(streamUrl !== undefined && { streamUrl }),
    ...(homePageUrl !== undefined && { homePageUrl }),
    ...(logoUrl !== undefined && { logoUrl }),
  };
}

export function addStation(db: Db, s: { name: string; streamUrl: string; homePageUrl?: string; logoUrl?: string }, id: string = randomUUID()): RadioStation {
  const now = Date.now();
  db.prepare('INSERT INTO radio_stations (id, name, stream_url, homepage_url, logo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, s.name, s.streamUrl, s.homePageUrl ?? '', s.logoUrl ?? '', now, now);
  return { id, name: s.name, streamUrl: s.streamUrl, homePageUrl: s.homePageUrl ?? '', logoUrl: s.logoUrl ?? '' };
}

export function updateStation(db: Db, id: string, s: Partial<Omit<RadioStation, 'id'>>): RadioStation {
  const cur = listStations(db).find((x) => x.id === id);
  if (!cur) throw new HttpError(404, 'No such station');
  const next = { ...cur, ...s };
  db.prepare('UPDATE radio_stations SET name = ?, stream_url = ?, homepage_url = ?, logo_url = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.streamUrl, next.homePageUrl, next.logoUrl, Date.now(), id);
  return next;
}

export function deleteStation(db: Db, id: string) {
  if (!db.prepare('DELETE FROM radio_stations WHERE id = ?').run(id).changes) throw new HttpError(404, 'No such station');
}

/**
 * Copy Navidrome's stations (with the admin login under Library updates), keeping their ids. Stations the Hub has
 * already (same id or same stream link) are left as they are. Marks the copy done, so it runs once by itself;
 * an admin can run it again. null without the Navidrome admin login.
 */
export async function importFromNavidrome(db: Db, key: Buffer): Promise<{ added: number; total: number } | null> {
  const s = getScanSettings(db, key);
  if (!s || navidromeOff(db)) return null;
  const r = await navidrome(s, 'getInternetRadioStations');
  const list = (r?.internetRadioStations?.internetRadioStation ?? []) as { id?: unknown; name?: unknown; streamUrl?: unknown; homePageUrl?: unknown }[];
  const have = listStations(db);
  const ids = new Set(have.map((x) => x.id));
  const urls = new Set(have.map((x) => x.streamUrl.toLowerCase()));
  let added = 0;
  for (const x of list) {
    const id = String(x.id ?? ''), name = String(x.name ?? '').trim(), streamUrl = String(x.streamUrl ?? '').trim();
    if (!id || !name || !streamUrl || ids.has(id) || urls.has(streamUrl.toLowerCase())) continue;
    addStation(db, { name: name.slice(0, 200), streamUrl, homePageUrl: String(x.homePageUrl ?? '').trim() }, id);
    ids.add(id);
    urls.add(streamUrl.toLowerCase());
    added++;
  }
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(IMPORTED_KEY, JSON.stringify({ at: Date.now(), added, navidrome: list.length }));
  return { added, total: listStations(db).length };
}

/** In Subsonic's shape, for the relay. */
export const subsonicStations = (db: Db) => listStations(db).map((s) => ({ id: s.id, name: s.name, streamUrl: s.streamUrl, ...(s.homePageUrl && { homePageUrl: s.homePageUrl }) }));
