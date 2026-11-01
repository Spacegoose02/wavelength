import { seal, unseal } from './crypto.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';

/**
 * Tour dates (the tourDates feature): upcoming concerts for an artist from Ticketmaster's Discovery API or
 * Bandsintown, with a key an admin saves under Settings → Features. The key stays on the Hub (sealed like the AI
 * DJ's); listeners only ever see the dates. Answers are kept for six hours per artist.
 */

const KEY = 'tours';
export const TOUR_PROVIDERS = ['ticketmaster', 'bandsintown'] as const;
export type TourProvider = (typeof TOUR_PROVIDERS)[number];

export interface TourEvent {
  date: string; // YYYY-MM-DD
  time?: string;
  venue: string;
  city: string;
  country?: string;
  url?: string;
}

interface Stored {
  provider: TourProvider;
  key?: string; // sealed
}

function read(db: Db): Stored {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  try {
    return { provider: 'ticketmaster', ...(row ? (JSON.parse(row.value) as Partial<Stored>) : {}) };
  } catch {
    return { provider: 'ticketmaster' };
  }
}

export function tourSettings(db: Db, secretKey: Buffer) {
  const s = read(db);
  const key = tourKey(db, secretKey);
  return { provider: s.provider, keySet: !!key, hint: key ? `…${key.slice(-4)}` : null };
}

export function tourKey(db: Db, secretKey: Buffer): string | null {
  const s = read(db);
  if (!s.key) return null;
  try {
    return unseal(secretKey, s.key, KEY);
  } catch {
    return null;
  }
}

/** `{ provider?, key? }`: key '' removes it. */
export function saveTourSettings(db: Db, secretKey: Buffer, body: unknown) {
  const b = (body ?? {}) as { provider?: unknown; key?: unknown };
  const cur = read(db);
  if (b.provider !== undefined) {
    if (!TOUR_PROVIDERS.includes(b.provider as TourProvider)) throw new HttpError(400, 'Pick Ticketmaster or Bandsintown');
    cur.provider = b.provider as TourProvider;
  }
  if (typeof b.key === 'string') {
    const k = b.key.trim();
    if (k.length > 200) throw new HttpError(400, 'That key is too long');
    if (k) cur.key = seal(secretKey, k, KEY);
    else delete cur.key;
  }
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(cur));
  return tourSettings(db, secretKey);
}

type Fetcher = (url: string) => Promise<unknown>;
const getJson: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'The tour dates service refused the Hub’s key');
  if (res.status === 404) return [];
  if (!res.ok) throw new HttpError(502, `The tour dates service had a problem (${res.status})`);
  return res.json();
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Pure: Ticketmaster's answer → events by this artist (it matches loosely on keyword). */
export function fromTicketmaster(artist: string, j: unknown): TourEvent[] {
  const events = ((j as { _embedded?: { events?: unknown[] } })?._embedded?.events ?? []) as {
    url?: string;
    dates?: { start?: { localDate?: string; localTime?: string } };
    _embedded?: { venues?: { name?: string; city?: { name?: string }; country?: { countryCode?: string } }[]; attractions?: { name?: string }[] };
  }[];
  return events
    .filter((e) => (e._embedded?.attractions ?? []).some((a) => norm(a.name ?? '') === norm(artist)))
    .flatMap((e) => {
      const v = e._embedded?.venues?.[0];
      const date = e.dates?.start?.localDate;
      return date && v ? [{ date, time: e.dates?.start?.localTime?.slice(0, 5), venue: v.name ?? '', city: v.city?.name ?? '', country: v.country?.countryCode, url: e.url }] : [];
    });
}

/** Pure: Bandsintown's answer → events. */
export function fromBandsintown(j: unknown): TourEvent[] {
  if (!Array.isArray(j)) return [];
  return (j as { datetime?: string; url?: string; venue?: { name?: string; city?: string; country?: string } }[]).flatMap((e) =>
    e.datetime && e.venue ? [{ date: e.datetime.slice(0, 10), time: e.datetime.slice(11, 16) || undefined, venue: e.venue.name ?? '', city: e.venue.city ?? '', country: e.venue.country, url: e.url }] : [],
  );
}

export class Tours {
  private db: Db;
  private secretKey: Buffer;
  private fetch: Fetcher;
  private cache = new Map<string, { at: number; events: TourEvent[] }>();

  constructor(db: Db, secretKey: Buffer, fetcher: Fetcher = getJson) {
    this.db = db;
    this.secretKey = secretKey;
    this.fetch = fetcher;
  }

  async upcoming(artist: string): Promise<TourEvent[]> {
    const name = artist.trim().slice(0, 200);
    if (!name) throw new HttpError(400, 'Which artist?');
    const key = tourKey(this.db, this.secretKey);
    if (!key) throw new HttpError(409, 'Tour dates aren’t set up yet: an admin needs to add a key in Settings → Features');
    const { provider } = read(this.db);
    const ck = `${provider}:${norm(name)}`;
    const hit = this.cache.get(ck);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.events;
    const today = new Date().toISOString().slice(0, 10);
    let events: TourEvent[];
    if (provider === 'bandsintown') {
      events = fromBandsintown(await this.fetch(`https://rest.bandsintown.com/artists/${encodeURIComponent(name.replace(/\//g, '%252F'))}/events?app_id=${encodeURIComponent(key)}&date=upcoming`));
    } else {
      events = fromTicketmaster(name, await this.fetch(`https://app.ticketmaster.com/discovery/v2/events.json?classificationName=music&size=50&sort=date,asc&keyword=${encodeURIComponent(name)}&apikey=${encodeURIComponent(key)}`));
    }
    events = events.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
    this.cache.set(ck, { at: Date.now(), events });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return events;
  }
}
