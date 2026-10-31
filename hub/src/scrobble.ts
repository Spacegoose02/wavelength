import { createHash } from 'node:crypto';
import type { Config } from './config.ts';
import { seal, unseal } from './crypto.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';

/**
 * Scrobbling: each person can connect ListenBrainz (a user token from listenbrainz.org/settings) and, when the
 * Hub has a Last.fm API account (WAVELENGTH_LASTFM_KEY / _SECRET), Last.fm. Every music play the Hub records
 * for Rewind (rewind.ts) is queued here and sent in batches once a minute, so a play made offline or while
 * a service is down still arrives. Tokens and session keys are sealed like the other server logins.
 */

export type Service = 'listenbrainz' | 'lastfm';
export const SERVICES: Service[] = ['listenbrainz', 'lastfm'];

const LB = 'https://api.listenbrainz.org/1';
const LASTFM = 'https://ws.audioscrobbler.com/2.0/';
const TICK_MS = 60_000;
const BATCH = 50;
/** A play that keeps failing (service down) is dropped after this many tries, about a day. */
const MAX_TRIES = 1440;
/** Last.fm refuses scrobbles older than two weeks. */
const LASTFM_MAX_AGE_MS = 14 * 86_400_000;

export interface Account { service: Service; username: string; connectedAt: number; error: string | null }

interface Queued { id: number; played_at: number; artist: string; title: string; album: string; seconds: number; tries: number }

const aad = (userId: number, service: Service) => `scrobble:${userId}:${service}`;

export class Scrobbler {
  private db: Db;
  private config: Pick<Config, 'secretKey' | 'lastfmKey' | 'lastfmSecret'>;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(db: Db, config: Pick<Config, 'secretKey' | 'lastfmKey' | 'lastfmSecret'>) {
    this.db = db;
    this.config = config;
  }

  start() {
    this.timer ??= setInterval(() => void this.flush().catch(() => undefined), TICK_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  get lastfmAvailable() {
    return !!(this.config.lastfmKey && this.config.lastfmSecret);
  }

  accounts(userId: number): Account[] {
    const rows = this.db.prepare('SELECT service, username, created_at, error FROM scrobble_accounts WHERE user_id = ? ORDER BY service').all(userId) as
      { service: Service; username: string; created_at: number; error: string | null }[];
    return rows.map((r) => ({ service: r.service, username: r.username, connectedAt: r.created_at, error: r.error }));
  }

  private save(userId: number, service: Service, username: string, secret: string) {
    this.db.prepare(`INSERT INTO scrobble_accounts (user_id, service, username, secret, created_at, error) VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT (user_id, service) DO UPDATE SET username = excluded.username, secret = excluded.secret, created_at = excluded.created_at, error = NULL`)
      .run(userId, service, username, seal(this.config.secretKey, secret, aad(userId, service)), Date.now());
  }

  /** Check a ListenBrainz user token and keep it. */
  async connectListenBrainz(userId: number, token: string): Promise<Account> {
    const res = await fetch(`${LB}/validate-token`, { headers: { authorization: `Token ${token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => {
      throw new HttpError(502, 'Couldn’t reach ListenBrainz');
    });
    const body = (await res.json().catch(() => ({}))) as { valid?: boolean; user_name?: string };
    if (!res.ok || !body.valid || !body.user_name) throw new HttpError(400, 'ListenBrainz says that token isn’t valid');
    this.save(userId, 'listenbrainz', body.user_name, token);
    return this.accounts(userId).find((a) => a.service === 'listenbrainz')!;
  }

  /** Log in to Last.fm once (auth.getMobileSession) and keep only the session key, never the password. */
  async connectLastfm(userId: number, username: string, password: string): Promise<Account> {
    if (!this.lastfmAvailable) throw new HttpError(400, 'Last.fm isn’t set up on this Hub (WAVELENGTH_LASTFM_KEY)');
    const body = await this.lastfm({ method: 'auth.getMobileSession', username, password }).catch((e) => {
      throw new HttpError(400, `Last.fm: ${(e as Error).message}`);
    });
    const session = body?.session as { key?: string; name?: string } | undefined;
    if (!session?.key) throw new HttpError(400, 'Last.fm didn’t accept that login');
    this.save(userId, 'lastfm', session.name ?? username, session.key);
    return this.accounts(userId).find((a) => a.service === 'lastfm')!;
  }

  disconnect(userId: number, service: Service): boolean {
    this.db.prepare('DELETE FROM scrobble_queue WHERE user_id = ? AND service = ?').run(userId, service);
    return this.db.prepare('DELETE FROM scrobble_accounts WHERE user_id = ? AND service = ?').run(userId, service).changes > 0;
  }

  /** A music play to send to each service this person connected (called next to rewind.ts recordPlay). */
  enqueue(userId: number, at: number, p: { artist: string; title: string; album: string; seconds: number }) {
    if (!p.title || !p.artist) return;
    const add = this.db.prepare('INSERT INTO scrobble_queue (user_id, service, played_at, artist, title, album, seconds) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const { service } of this.db.prepare('SELECT service FROM scrobble_accounts WHERE user_id = ? AND error IS NULL').all(userId) as { service: Service }[]) {
      add.run(userId, service, at, p.artist, p.title, p.album, p.seconds);
    }
  }

  /** Send what's queued, per person and service. */
  async flush() {
    if (this.running) return;
    this.running = true;
    try {
      const accounts = this.db.prepare(`SELECT DISTINCT a.user_id, a.service, a.secret FROM scrobble_accounts a
        JOIN scrobble_queue q ON q.user_id = a.user_id AND q.service = a.service WHERE a.error IS NULL`).all() as { user_id: number; service: Service; secret: string }[];
      for (const a of accounts) {
        const plays = this.db.prepare('SELECT id, played_at, artist, title, album, seconds, tries FROM scrobble_queue WHERE user_id = ? AND service = ? ORDER BY id LIMIT ?')
          .all(a.user_id, a.service, BATCH) as unknown as Queued[];
        let secret: string;
        try {
          secret = unseal(this.config.secretKey, a.secret, aad(a.user_id, a.service));
        } catch {
          this.fail(a.user_id, a.service, 'Connect again: the Hub’s key changed');
          continue;
        }
        const ids = plays.map((p) => p.id);
        try {
          if (a.service === 'listenbrainz') await this.sendListenBrainz(secret, plays);
          else await this.sendLastfm(secret, plays);
          this.db.prepare(`DELETE FROM scrobble_queue WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        } catch (e) {
          const err = e as Error & { fatal?: boolean };
          if (err.fatal) this.fail(a.user_id, a.service, err.message);
          else {
            this.db.prepare(`UPDATE scrobble_queue SET tries = tries + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
            this.db.prepare('DELETE FROM scrobble_queue WHERE tries >= ?').run(MAX_TRIES);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** A bad token or session: stop sending and tell the person in Settings. */
  private fail(userId: number, service: Service, error: string) {
    this.db.prepare('UPDATE scrobble_accounts SET error = ? WHERE user_id = ? AND service = ?').run(error.slice(0, 200), userId, service);
    this.db.prepare('DELETE FROM scrobble_queue WHERE user_id = ? AND service = ?').run(userId, service);
  }

  private async sendListenBrainz(token: string, plays: Queued[]) {
    const payload = plays.map((p) => ({
      listened_at: Math.floor(p.played_at / 1000),
      track_metadata: {
        artist_name: p.artist, track_name: p.title, ...(p.album ? { release_name: p.album } : {}),
        additional_info: { submission_client: 'Wavelength', ...(p.seconds ? { duration: p.seconds } : {}) },
      },
    }));
    const res = await fetch(`${LB}/submit-listens`, {
      method: 'POST',
      headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ listen_type: plays.length === 1 ? 'single' : 'import', payload }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) throw Object.assign(new Error('ListenBrainz no longer accepts the token: connect again'), { fatal: true });
    if (!res.ok) throw new Error(`ListenBrainz answered ${res.status}`);
  }

  private async sendLastfm(sk: string, plays: Queued[]) {
    const fresh = plays.filter((p) => Date.now() - p.played_at < LASTFM_MAX_AGE_MS);
    if (!fresh.length) return;
    const params: Record<string, string> = { method: 'track.scrobble', sk };
    fresh.forEach((p, i) => {
      params[`artist[${i}]`] = p.artist;
      params[`track[${i}]`] = p.title;
      params[`timestamp[${i}]`] = String(Math.floor(p.played_at / 1000));
      if (p.album) params[`album[${i}]`] = p.album;
      if (p.seconds) params[`duration[${i}]`] = String(p.seconds);
    });
    await this.lastfm(params);
  }

  /** A signed Last.fm call (POST, JSON). Errors 9 (bad session) and 4/14 (auth) are fatal. */
  private async lastfm(params: Record<string, string>): Promise<any> {
    const all: Record<string, string> = { ...params, api_key: this.config.lastfmKey };
    all.api_sig = lastfmSignature(all, this.config.lastfmSecret);
    all.format = 'json';
    const res = await fetch(LASTFM, { method: 'POST', body: new URLSearchParams(all), signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as { error?: number; message?: string };
    if (body.error) throw Object.assign(new Error(body.message ?? `error ${body.error}`), { fatal: [4, 9, 10, 14, 26].includes(body.error) });
    if (!res.ok) throw new Error(`Last.fm answered ${res.status}`);
    return body;
  }
}

/** Last.fm's api_sig: md5 of every parameter name and value sorted by name (not `format`), then the secret. */
export function lastfmSignature(params: Record<string, string>, secret: string): string {
  const s = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort().map((k) => k + params[k]).join('') + secret;
  return createHash('md5').update(s, 'utf8').digest('hex');
}
