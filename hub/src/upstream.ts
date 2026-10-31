import { HttpError } from './http.ts';

/**
 * The Hub's own calls to SUB/WAVE and deemix, made with logins that never leave the Hub
 * (routes/proxy.ts). Errors become HttpError 502 with a message the app can show as is.
 */

const TIMEOUT_MS = 20_000;

async function call(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
  } catch {
    throw new HttpError(502, `The Hub can't reach ${what}. Check its address in Settings → Sources / Downloads`);
  }
}

async function body(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

// ---- SUB/WAVE admin ----

export interface SubwaveTarget {
  url: string;
  apiUrl?: string;
  username: string;
  password: string;
  token?: string;
}

/** The API base for a SUB/WAVE server (its own /api unless the admin set an API URL). */
export const subwaveApi = (t: { url: string; apiUrl?: string }) => (t.apiUrl || `${t.url}/api`).replace(/\/+$/, '');

/**
 * Forward one admin call to SUB/WAVE with the Basic login kept on the Hub. `path` is relative to the
 * API base and may not climb out of it.
 */
export async function subwaveAdmin(t: SubwaveTarget, method: string, path: string, search: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const base = subwaveApi(t);
  const target = new URL(`${base}/${path.replace(/^\/+/, '')}${search}`);
  if (!`${target.origin}${target.pathname}`.startsWith(`${base}/`) || path.split('/').includes('..')) throw new HttpError(400, 'Bad SUB/WAVE path');
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Basic ${Buffer.from(`${t.username}:${t.password}`).toString('base64')}`,
  };
  if (t.token) headers['x-station-auth'] = t.token;
  const send = payload !== undefined && method !== 'GET' && method !== 'DELETE';
  if (send) headers['content-type'] = 'application/json';
  const res = await call(target.href, { method, headers, body: send ? JSON.stringify(payload) : undefined }, 'SUB/WAVE');
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'SUB/WAVE rejected the admin login saved on the Hub');
  return { status: res.status, body: await body(res) };
}

// ---- deemix ----

/**
 * A deemix web server (deemix-gui / deemix-docker). deemix keeps the Deezer login in a cookie session,
 * so one client (with its cookie) is kept per server and login: see deemixFor.
 */
export class DeemixClient {
  readonly url: string;
  readonly arl: string;
  private cookie = '';
  constructor(url: string, arl: string) {
    this.url = url.replace(/\/+$/, '');
    this.arl = arl;
  }

  private async req(method: string, path: string, payload?: unknown): Promise<any> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    const res = await call(`${this.url}${path}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) }, 'deemix');
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const json = (await body(res)) as any;
    if (!res.ok) throw new HttpError(502, `deemix: ${json?.errid ?? json?.error ?? res.status}`);
    return json;
  }

  async login() {
    if (!this.arl) throw new HttpError(502, "deemix isn't logged in and the Hub has no ARL for it. Add one in Settings → Downloads");
    const r = await this.req('POST', '/api/loginArl', { arl: this.arl, force: true, child: 0 });
    if (r?.status === 0 || r?.status === false) throw new HttpError(502, 'deemix rejected the ARL saved on the Hub');
  }

  /** bitrate: 9 = FLAC, 3 = MP3 320, 1 = MP3 128 */
  async addToQueue(link: string, bitrate?: number) {
    const send = async () => {
      const r = await this.req('POST', '/api/addToQueue', { url: link, bitrate: bitrate ?? null });
      // deemix answers 200 with { result: false, errid } on failure
      if (r?.result === false) throw new HttpError(502, `deemix: ${r?.errid ?? r?.data?.error ?? 'refused the download'}`);
      return r;
    };
    try {
      return await send();
    } catch (e) {
      const msg = String((e as Error).message);
      if (/AlreadyInQueue/i.test(msg)) return this.requeue(link, send, e);
      if (!/NotLoggedIn|login/i.test(msg)) throw e;
      await this.login();
      return send();
    }
  }

  /**
   * deemix refuses a link it still has on its list, even a failed or finished one, so Retry would never work.
   * Take the old finished one off and queue it again; one still waiting or downloading is left as it is.
   */
  private async requeue(link: string, send: () => Promise<any>, refused: unknown) {
    const m = /deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist)\/(\d+)/i.exec(link);
    const prefix = m ? `${m[1].toLowerCase()}_${m[2]}_` : null;
    const items = Object.values<{ uuid?: string; status?: string }>((await this.getQueue())?.queue ?? {});
    const mine = prefix ? items.filter((i) => typeof i.uuid === 'string' && i.uuid.startsWith(prefix)) : [];
    if (!mine.length) throw refused;
    if (mine.some((i) => i.status === 'inQueue' || i.status === 'downloading')) return { result: true, alreadyQueued: true, uuid: mine[0].uuid };
    for (const i of mine) await this.removeFromQueue(i.uuid!);
    return send();
  }

  getQueue() {
    return this.req('GET', '/api/getQueue');
  }

  /**
   * Cancel one download (or take a finished one off the list). deemix-gui reads the id from the query string in
   * some versions and the body in others, so it gets both.
   */
  removeFromQueue(uuid: string) {
    return this.req('POST', `/api/removeFromQueue?uuid=${encodeURIComponent(uuid)}`, { uuid });
  }

  /** Clear finished and failed downloads off deemix's list. */
  removeFinished() {
    return this.req('POST', '/api/removeFinishedDownloads', {});
  }

  /** deemix's settings, and its Spotify ones (saving has to send those back too). */
  getSettings(): Promise<{ settings: Record<string, unknown>; spotifySettings?: unknown }> {
    return this.req('GET', '/api/getSettings');
  }

  /**
   * Save deemix's settings. deemix's own page saves them over its websocket (its HTTP route reads them from
   * the query string, which turns every value into text), so the Hub does the same, then reads them back to
   * be sure they took.
   */
  async saveSettings(settings: Record<string, unknown>, spotifySettings: unknown, check: (s: Record<string, unknown>) => boolean) {
    const ws = new WebSocket(this.url.replace(/^http/i, 'ws'));
    try {
      await new Promise<void>((ok, fail) => {
        const t = setTimeout(() => fail(new Error('timeout')), 10_000);
        ws.onopen = () => (clearTimeout(t), ok());
        ws.onerror = () => (clearTimeout(t), fail(new Error('refused')));
      });
      ws.send(JSON.stringify({ key: 'saveSettings', data: { settings, spotifySettings, spotifyUser: false } }));
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (check((await this.getSettings()).settings ?? {})) return;
      }
      throw new HttpError(502, "deemix didn't take the new settings");
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `The Hub couldn't change deemix's settings (${(e as Error).message})`);
    } finally {
      ws.close();
    }
  }

  /** Who deemix is logged in as, logging in with the Hub's ARL if needed. */
  async status(): Promise<{ user: string | null }> {
    let r = await this.req('GET', '/api/connect');
    if (!r?.currentUser?.name && this.arl) {
      await this.login();
      r = await this.req('GET', '/api/connect').catch(() => null);
    }
    return { user: r?.currentUser?.name ?? null };
  }
}

const deemixClients = new Map<number, DeemixClient>();

/** The client for this deemix server, made again when its address or ARL changes. */
export function deemixFor(id: number, url: string, arl: string): DeemixClient {
  const c = deemixClients.get(id);
  if (c && c.url === url.replace(/\/+$/, '') && c.arl === arl) return c;
  const fresh = new DeemixClient(url, arl);
  deemixClients.set(id, fresh);
  return fresh;
}
