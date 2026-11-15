import { randomBytes } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { keyFor } from './families.ts';
import { HttpError } from './http.ts';

/**
 * Move from Spotify by signing in (docs/USER-GUIDE.md "Move from Spotify"). Spotify only lets an app that
 * isn't a big business sign in 5 people it was told about, so each household brings its own: whoever has
 * Spotify Premium (on a Family plan, the plan's manager) makes an app on developer.spotify.com, adds the
 * family's Spotify emails to it, and pastes its Client ID and secret into Shared keys (spotifyClientId /
 * spotifyClientSecret, per family or for the whole Hub).
 *
 * A person presses Connect Spotify in the app; the Hub sends their browser to Spotify, Spotify comes back to
 * `<public URL>/auth/spotify/callback`, and the Hub reads their own playlists, liked songs and followed artists
 * once, then forgets the sign-in. The app picks the result up from `GET /api/spotify/import` and matches it to
 * the library like the export file (src/lib/spotifyExport.ts). Nothing is written to Spotify.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SpotifySong {
  title: string;
  artist: string;
  album?: string;
}

export interface SpotifyBundle {
  /** The Spotify account it came from. */
  account?: string;
  playlists: { name: string; songs: SpotifySong[] }[];
  liked: SpotifySong[];
  /** Followed artists, by name. */
  artists: string[];
  /** Playlists Spotify wouldn't hand over (ones you follow but someone else made), with their link. */
  skipped: { name: string; url?: string }[];
}

export type SpotifyJob =
  | { state: 'working'; at: number; read?: number }
  | { state: 'ready'; at: number; data: SpotifyBundle }
  | { state: 'error'; at: number; error: string };

export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read user-follow-read';
const API = 'https://api.spotify.com/v1';
const STATE_TTL = 15 * 60_000;
const JOB_TTL = 60 * 60_000;
/** Enough for anyone's library, and a stop if paging ever loops. */
const MAX_PAGES = 400;

const song = (t: any): SpotifySong | undefined => {
  if (!t || (t.type && t.type !== 'track') || !t.name) return undefined;
  const artist = t.artists?.[0]?.name;
  return artist ? { title: String(t.name), artist: String(artist), album: t.album?.name ? String(t.album.name) : undefined } : undefined;
};

export class SpotifyConnect {
  private pending = new Map<string, { userId: number; at: number }>();
  private jobs = new Map<number, SpotifyJob>();

  private db: Db;
  private config: Pick<Config, 'secretKey' | 'publicUrl'>;
  private fetch: Fetch;

  constructor(db: Db, config: Pick<Config, 'secretKey' | 'publicUrl'>, fetch: Fetch = (url, init) => globalThis.fetch(url, init)) {
    this.db = db;
    this.config = config;
    this.fetch = fetch;
  }

  /** This person's family's Spotify app, else the whole Hub's. */
  app(userId: number): { id: string; secret: string } | null {
    const id = keyFor(this.db, this.config.secretKey, userId, 'spotifyClientId');
    const secret = keyFor(this.db, this.config.secretKey, userId, 'spotifyClientSecret');
    return id && secret ? { id, secret } : null;
  }

  get redirectUri() {
    return `${this.config.publicUrl}/auth/spotify/callback`;
  }

  /** Spotify only sends people back to https addresses, or to this computer itself (127.0.0.1). */
  get redirectOk() {
    return /^https:\/\//i.test(this.config.publicUrl) || /^http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(this.config.publicUrl);
  }

  /** Where to send this person's browser to sign in to Spotify. */
  start(userId: number): string {
    const app = this.app(userId);
    if (!app) throw new HttpError(400, 'Spotify sign-in isn’t set up on this Hub yet');
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > STATE_TTL) this.pending.delete(k);
    const state = randomBytes(24).toString('base64url');
    this.pending.set(state, { userId, at: now });
    const q = new URLSearchParams({
      client_id: app.id,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: SPOTIFY_SCOPES,
      state,
      // a shared phone or computer may still be signed in to someone else's Spotify
      show_dialog: 'true',
    });
    return `https://accounts.spotify.com/authorize?${q}`;
  }

  /** Spotify came back: swap the code for a token and read everything in the background. Returns who it was for. */
  async finish(state: string, code: string | undefined, error: string | undefined): Promise<number> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || Date.now() - p.at > STATE_TTL) throw new HttpError(400, 'That sign-in link has expired. Press Connect Spotify in Wavelength again');
    if (error || !code) {
      this.jobs.set(p.userId, { state: 'error', at: Date.now(), error: error === 'access_denied' ? 'You said no on Spotify’s page, so nothing was read' : `Spotify said: ${error ?? 'no code'}` });
      return p.userId;
    }
    const app = this.app(p.userId);
    if (!app) throw new HttpError(400, 'Spotify sign-in isn’t set up on this Hub any more');
    const res = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri }).toString(),
    });
    const tok = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
    if (!res.ok || !tok.access_token) {
      const why = tok.error_description ?? tok.error ?? `status ${res.status}`;
      throw new HttpError(502, /invalid_client/i.test(why) ? 'Spotify didn’t accept the Hub’s Client ID or secret. Check them under Shared keys' : `Spotify didn’t sign you in (${why})`);
    }
    const job: SpotifyJob = { state: 'working', at: Date.now(), read: 0 };
    this.jobs.set(p.userId, job);
    void this.read(tok.access_token, job).then(
      (data) => this.jobs.get(p.userId) === job && this.jobs.set(p.userId, { state: 'ready', at: Date.now(), data }),
      (e) => this.jobs.get(p.userId) === job && this.jobs.set(p.userId, { state: 'error', at: Date.now(), error: (e as Error).message }),
    );
    return p.userId;
  }

  job(userId: number): SpotifyJob | null {
    const j = this.jobs.get(userId);
    if (j && j.state !== 'working' && Date.now() - j.at > JOB_TTL) {
      this.jobs.delete(userId);
      return null;
    }
    return j ?? null;
  }

  clear(userId: number) {
    this.jobs.delete(userId);
  }

  /** One GET, waiting out Spotify's "slow down" answers. */
  private async get(token: string, url: string): Promise<any> {
    for (let tries = 0; ; tries++) {
      const res = await this.fetch(url.startsWith('http') ? url : API + url, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 429 && tries < 5) {
        const wait = Math.min(30, Number(res.headers.get('retry-after')) || 2);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (res.ok) return res.json();
      if (res.status === 403)
        throw new Error('Spotify won’t let this account in yet. Whoever set up Spotify for your family adds your Spotify email under Users Management on developer.spotify.com (5 people at most)');
      const err = new Error(`Spotify answered ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
  }

  /** Every page of a Spotify list (`next` links). */
  private async all(token: string, first: string, items: (page: any) => { list: any[]; next?: string | null }, job: SpotifyJob): Promise<any[]> {
    const out: any[] = [];
    let url: string | null | undefined = first;
    for (let n = 0; url && n < MAX_PAGES; n++) {
      const { list, next } = items(await this.get(token, url));
      out.push(...list);
      if (job.state === 'working') job.read = (job.read ?? 0) + list.length;
      url = next;
    }
    return out;
  }

  async read(token: string, job: SpotifyJob = { state: 'working', at: Date.now() }): Promise<SpotifyBundle> {
    const me = await this.get(token, '/me');
    const page = (p: any) => ({ list: p?.items ?? [], next: p?.next });
    const lists = await this.all(token, '/me/playlists?limit=50', page, job);
    const playlists: SpotifyBundle['playlists'] = [];
    const skipped: SpotifyBundle['skipped'] = [];
    for (const pl of lists) {
      if (!pl?.id) continue;
      const name = String(pl.name ?? 'Spotify playlist');
      const url = pl.external_urls?.spotify;
      // Spotify only hands over the songs of playlists you made or collaborate on
      const mine = pl.owner?.id === me.id || pl.collaborative;
      if (!mine) {
        skipped.push({ name, url });
        continue;
      }
      let entries: any[];
      try {
        entries = await this.all(token, `/playlists/${pl.id}/items?limit=50`, page, job);
      } catch (e) {
        // older apps still have the /tracks spelling
        if ((e as { status?: number }).status !== 404) throw e;
        entries = await this.all(token, `/playlists/${pl.id}/tracks?limit=50`, page, job);
      }
      playlists.push({ name, songs: entries.map((x) => song(x?.item ?? x?.track)).filter((s): s is SpotifySong => !!s) });
    }
    const liked = (await this.all(token, '/me/tracks?limit=50', page, job)).map((x) => song(x?.track ?? x?.item)).filter((s): s is SpotifySong => !!s);
    const followed = await this.all(token, '/me/following?type=artist&limit=50', (p) => ({ list: p?.artists?.items ?? [], next: p?.artists?.next }), job);
    return {
      account: me.display_name ?? me.id,
      playlists,
      liked,
      artists: followed.map((a) => String(a?.name ?? '')).filter(Boolean),
      skipped,
    };
  }
}
