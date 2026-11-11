import { HttpError } from './http.ts';
import { pack, readZip, writeZip, type ZipMember } from './zipSplit.ts';

/**
 * The Hub's own calls to SUB/WAVE and deemix, made with logins that never leave the Hub
 * (routes/proxy.ts). Errors become HttpError 502 with a message the app can show as is.
 */

const TIMEOUT_MS = 20_000;

async function call(url: string, init: RequestInit, what: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
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
/**
 * How long one SUB/WAVE admin call may take. Most answer at once; a full health check (`doctor`) runs every check
 * in turn, and an archive hour is a big MP3, so those get longer.
 */
export function subwaveTimeout(path: string): number {
  const p = path.replace(/^\/+/, '');
  if (p.startsWith('archives/file/')) return 10 * 60_000;
  if (p === 'doctor' || p.startsWith('doctor/review') || p.startsWith('settings/llm/models')) return 120_000;
  return TIMEOUT_MS;
}

/** An answer that isn't JSON or text (an archive hour's MP3): passed on as bytes, with its type and file name. */
export interface SubwaveFile {
  status: number;
  file: Response;
  type: string;
  disposition?: string;
  length?: string;
}

export async function subwaveAdmin(t: SubwaveTarget, method: string, path: string, search: string, payload: unknown): Promise<{ status: number; body: unknown } | SubwaveFile> {
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
  const res = await call(target.href, { method, headers, body: send ? JSON.stringify(payload) : undefined }, 'SUB/WAVE', subwaveTimeout(path));
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'SUB/WAVE rejected the admin login saved on the Hub');
  const type = res.headers.get('content-type') ?? '';
  if (res.ok && res.body && /^(audio|application\/(zip|octet-stream))\b/i.test(type)) {
    return { status: res.status, file: res, type, disposition: res.headers.get('content-disposition') ?? undefined, length: res.headers.get('content-length') ?? undefined };
  }
  return { status: res.status, body: await body(res) };
}

/**
 * SUB/WAVE (or a proxy in front of it) refused the backup as too large: send it again as several smaller backups.
 * A restore only writes what its zip holds, so pieces add up to the whole. Media goes first, settings after it
 * (they can name themes and voices from the media), the library analysis last and on its own. A piece that's still
 * too big is halved; one file too big on its own is left out and named in `skipped`.
 */
async function restoreInParts(
  zip: Buffer,
  restore: (part: Buffer) => Promise<{ restored?: string[]; skipped?: string[]; requiresRestart?: boolean } | 'too-big'>,
): Promise<{ restored: string[]; skipped: string[]; requiresRestart: boolean }> {
  const all = readZip(zip);
  const manifest = all.find((m) => m.name === 'manifest.json');
  if (!manifest) throw new HttpError(502, 'Restoring into the station: the backup has no manifest');
  const media = all.filter((m) => !['manifest.json', 'settings.json', 'library.db'].includes(m.name));
  const later = ['settings.json', 'library.db'].map((n) => all.find((m) => m.name === n)).filter((m): m is ZipMember => !!m);
  const queue: ZipMember[][] = [...pack(media, Math.max(1 << 20, Math.floor(zip.length / 4))), ...later.map((m) => [m])];
  const out = { restored: new Set<string>(), skipped: [] as string[], requiresRestart: false };
  while (queue.length) {
    const group = queue.shift()!;
    const r = await restore(writeZip([manifest, ...group]));
    if (r === 'too-big') {
      if (group.length > 1) {
        const half = Math.ceil(group.length / 2);
        queue.unshift(group.slice(0, half), group.slice(half));
      } else {
        out.skipped.push(`${group[0].name}: too big for this SUB/WAVE to take in one upload (${Math.round(group[0].local.length / 1e6)} MB)`);
      }
      continue;
    }
    for (const x of r.restored ?? []) out.restored.add(x);
    out.skipped.push(...(r.skipped ?? []));
    out.requiresRestart ||= !!r.requiresRestart;
  }
  return { ...out, restored: [...out.restored] };
}

/** The parts of a station a copy keeps from the station being copied over: its own name and blurb. */
const KEEP_ON_COPY = ['station', 'stationDescription'] as const;

/**
 * Copy one SUB/WAVE station into another: the first one's backup (settings, DJs and their pictures, shows,
 * schedule, jingles, sound effects, voices, skills and library analysis) restored into the second, which then gets
 * its own name back. API keys and the music server login aren't in a backup, so the second keeps its own.
 */
export async function subwaveCopyStation(from: SubwaveTarget, to: SubwaveTarget): Promise<{ restored: string[]; skipped: string[]; requiresRestart: boolean; kept: Record<string, unknown>; bytes: number }> {
  const auth = (t: SubwaveTarget) => {
    const h: Record<string, string> = { authorization: `Basic ${Buffer.from(`${t.username}:${t.password}`).toString('base64')}` };
    if (t.token) h['x-station-auth'] = t.token;
    return h;
  };
  const fail = async (res: Response, what: string) => {
    if (res.status === 401 || res.status === 403) throw new HttpError(502, `SUB/WAVE rejected the admin login saved on the Hub (${what})`);
    const b = (await body(res)) as { error?: string } | undefined;
    throw new HttpError(502, `${what}: ${b?.error ?? `SUB/WAVE answered ${res.status}`}`);
  };
  const SLOW = 10 * 60_000;

  const exp = await call(`${subwaveApi(from)}/backup/export`, { headers: { ...auth(from), accept: 'application/zip' } }, 'the SUB/WAVE being copied', SLOW);
  if (!exp.ok) await fail(exp, 'Exporting the station');
  const zip = Buffer.from(await exp.arrayBuffer());

  const cur = await call(`${subwaveApi(to)}/settings`, { headers: { ...auth(to), accept: 'application/json' } }, 'the SUB/WAVE being copied into');
  if (!cur.ok) await fail(cur, 'Reading the station being copied into');
  const values = (((await body(cur)) as { values?: Record<string, unknown> } | undefined)?.values ?? {}) as Record<string, unknown>;
  const kept = Object.fromEntries(KEEP_ON_COPY.filter((k) => values[k] !== undefined).map((k) => [k, values[k]]));

  type Restore = { restored?: string[]; skipped?: string[]; requiresRestart?: boolean };
  const restore = async (part: Buffer): Promise<Restore | 'too-big'> => {
    const imp = await call(`${subwaveApi(to)}/backup/import`, { method: 'POST', headers: { ...auth(to), 'content-type': 'application/zip', accept: 'application/json' }, body: part }, 'the SUB/WAVE being copied into', SLOW);
    if (imp.status === 413) return 'too-big';
    if (!imp.ok) await fail(imp, 'Restoring into the station');
    return ((await body(imp)) ?? {}) as Restore;
  };
  let result = await restore(zip);
  if (result === 'too-big') result = await restoreInParts(zip, restore);

  if (Object.keys(kept).length) {
    const back = await call(`${subwaveApi(to)}/settings`, { method: 'POST', headers: { ...auth(to), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(kept) }, 'the SUB/WAVE being copied into');
    if (!back.ok) await fail(back, 'Copied, but putting the station name back');
  }
  return { restored: result.restored ?? [], skipped: result.skipped ?? [], requiresRestart: !!result.requiresRestart, kept, bytes: zip.length };
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
