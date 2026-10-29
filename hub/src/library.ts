import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.ts';
import { seal, unseal } from './crypto.ts';
import { HttpError } from './http.ts';
import { hubDeemix } from './routes/proxy.ts';
import { serviceForHub, serviceIdOfKind } from './services.ts';
import type { YtdlpRunner, YtJob } from './ytdlp.ts';

/**
 * From download to library (docs/USERS-AND-ADMIN.md Phase 3): follows approved requests until their
 * download finishes, asks Navidrome to rescan after any download (requests and direct ones), and marks the
 * requests ready once the scan is done, which tells the requester "your song is ready".
 *
 * Navidrome scans need an admin login, kept on the Hub (sealed) and never handed to a device.
 */

const SETTINGS_KEY = 'navidrome.scan';
const AAD = 'hub-setting:navidrome.scan';
const TICK_MS = 30_000;
/** Wait for more downloads to finish before scanning, so an album is one scan, not twelve. */
const SCAN_DELAY_MS = 45_000;
const SCAN_TIMEOUT_MS = 30 * 60_000;
/** Stop following a request whose download never reports back. */
const FOLLOW_MS = 2 * 24 * 3600_000;
/** Keep looking at the deemix queue this long after the last download someone started. */
const ACTIVE_MS = 6 * 3600_000;

export interface ScanSettings {
  url: string;
  username: string;
  password: string;
}

export interface LibraryStatus {
  navidrome: { url: string; username: string } | null;
  scanning: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  scanQueued: boolean;
}

/** The scan login saved under Library updates, else the admin login of the Navidrome server kept on the Hub. */
export function getScanSettings(db: Db, key: Buffer): ScanSettings | null {
  const row = db.prepare('SELECT value FROM hub_settings WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) {
    const id = serviceIdOfKind(db, 'navidrome');
    const s = id === undefined ? undefined : serviceForHub(db, key, id);
    return s?.secrets.adminUsername && s.secrets.adminPassword ? { url: s.url, username: s.secrets.adminUsername, password: s.secrets.adminPassword } : null;
  }
  try {
    const v = JSON.parse(row.value) as { url: string; username: string; password: string };
    return { url: v.url, username: v.username, password: unseal(key, v.password, AAD) };
  } catch {
    return null;
  }
}

export function saveScanSettings(db: Db, key: Buffer, s: ScanSettings | null) {
  if (!s) return void db.prepare('DELETE FROM hub_settings WHERE key = ?').run(SETTINGS_KEY);
  const value = JSON.stringify({ url: s.url, username: s.username, password: seal(key, s.password, AAD) });
  db.prepare('INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(SETTINGS_KEY, value);
}

/** One Subsonic call to Navidrome with the scan login. */
export async function navidrome(s: ScanSettings, method: string, params: Record<string, string> = {}): Promise<any> {
  const salt = randomBytes(6).toString('hex');
  const q = new URLSearchParams({ ...params, u: s.username, t: createHash('md5').update(s.password + salt).digest('hex'), s: salt, v: '1.16.1', c: 'wavelength-hub', f: 'json' });
  let res: Response;
  try {
    res = await fetch(`${s.url.replace(/\/+$/, '')}/rest/${method}?${q}`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new HttpError(502, `Couldn't reach Navidrome at ${s.url}`);
  }
  const body = (await res.json().catch(() => null)) as any;
  const r = body?.['subsonic-response'];
  if (!res.ok || r?.status !== 'ok') throw new HttpError(502, `Navidrome: ${r?.error?.message ?? `answered ${res.status}`}`);
  return r;
}

/** deemix queue ids look like `album_302127_9` (type, Deezer id, bitrate). */
export function deemixPrefix(link: string): string | null {
  const m = /deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist|artist)\/(\d+)/i.exec(link);
  return m ? `${m[1].toLowerCase()}_${m[2]}_` : null;
}

/** Ids deemix gave back for an addToQueue call (shapes differ between versions). */
export function deemixJobIds(answer: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || !v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'uuid' && typeof x === 'string') out.add(x.slice(0, 100));
      else walk(x, depth + 1);
    }
  };
  walk(answer, 0);
  return [...out].slice(0, 50);
}

interface Watched { id: number; via: string | null; job: string | null; link: string; decided_at: number | null }

export class Library {
  private db: Db;
  private key: Buffer;
  private timer?: ReturnType<typeof setInterval>;
  private scanTimer?: ReturnType<typeof setTimeout>;
  private scanning = false;
  private lastScanAt: number | null = null;
  private lastError: string | null = null;
  private lastActivity = 0;
  /** Shorter in tests. */
  scanDelayMs = SCAN_DELAY_MS;
  pollMs = 3000;
  private lastAttempt = 0;
  /** deemix queue items already seen finished; undefined until the first look (so old ones don't count). */
  private deemixDone?: Set<string>;

  constructor(db: Db, key: Buffer, ytdlp: YtdlpRunner) {
    this.db = db;
    this.key = key;
    ytdlp.onFinished = (job) => this.ytdlpFinished(job);
  }

  start() {
    this.timer ??= setInterval(() => void this.tick().catch(() => undefined), TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.scanTimer);
    this.timer = undefined;
  }

  status(): LibraryStatus {
    const s = getScanSettings(this.db, this.key);
    return { navidrome: s && { url: s.url, username: s.username }, scanning: this.scanning, lastScanAt: this.lastScanAt, lastError: this.lastError, scanQueued: !!this.scanTimer };
  }

  /** Someone started a download (keeps the deemix queue watched for a while). */
  activity() {
    this.lastActivity = Date.now();
  }

  /** A download finished: scan soon, or mark requests ready straight away without a Navidrome login. */
  downloaded() {
    if (!getScanSettings(this.db, this.key)) return this.markReady();
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      void this.scan().catch(() => undefined);
    }, this.scanDelayMs);
    this.scanTimer.unref?.();
  }

  /** Ask Navidrome to scan, wait for it, then mark finished downloads ready. */
  async scan(): Promise<void> {
    const s = getScanSettings(this.db, this.key);
    if (!s) throw new HttpError(409, 'Add a Navidrome admin login under Settings → Server first');
    if (this.scanning) return;
    this.scanning = true;
    const startedAt = Date.now();
    this.lastAttempt = startedAt;
    try {
      await navidrome(s, 'startScan');
      // Navidrome scans in the background; poll until it says it's done
      while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, this.pollMs));
        const st = await navidrome(s, 'getScanStatus');
        if (!st.scanStatus?.scanning) break;
      }
      this.lastScanAt = Date.now();
      this.lastError = null;
      this.markReady(startedAt);
    } catch (e) {
      this.lastError = (e as Error).message;
      throw e;
    } finally {
      this.scanning = false;
    }
  }

  /** Requests whose download finished (before `before`) are now in the library. */
  private markReady(before = Date.now()) {
    this.db
      .prepare("UPDATE requests SET ready_at = ?, seen = 0 WHERE status = 'approved' AND downloaded_at IS NOT NULL AND downloaded_at <= ? AND ready_at IS NULL")
      .run(Date.now(), before);
  }

  private ytdlpFinished(job: YtJob) {
    const r = this.db.prepare("SELECT id FROM requests WHERE job = ? AND status = 'approved'").get(`yt:${job.jobId}`) as { id: number } | undefined;
    if (r) this.finish(r.id, job.status === 'done', job.message);
    if (job.status === 'done') this.downloaded();
  }

  private finish(id: number, ok: boolean, why?: string) {
    if (ok) this.db.prepare('UPDATE requests SET downloaded_at = ? WHERE id = ? AND downloaded_at IS NULL').run(Date.now(), id);
    else this.db.prepare("UPDATE requests SET status = 'failed', reason = ?, seen = 0 WHERE id = ?").run(`The download failed${why ? `: ${why}` : ''}`.slice(0, 300), id);
  }

  /** Look at the deemix queue: finished request downloads, and any new finished download (for a scan). */
  async tick() {
    const watched = this.db
      .prepare("SELECT id, via, job, link, decided_at FROM requests WHERE status = 'approved' AND via = 'deemix' AND downloaded_at IS NULL AND decided_at > ?")
      .all(Date.now() - FOLLOW_MS) as unknown as Watched[];
    if (!watched.length && Date.now() - this.lastActivity > ACTIVE_MS) return;
    let queue: { queue?: Record<string, { uuid?: string; status?: string }> };
    try {
      queue = await hubDeemix(this.db, this.key).client.getQueue();
    } catch {
      return; // deemix not set up or not reachable: try again next time
    }
    const items = Object.values(queue?.queue ?? {}).filter((i) => typeof i?.uuid === 'string');
    const done = (st?: string) => st === 'completed' || st === 'withErrors';

    for (const r of watched) {
      let ids: string[] = [];
      try {
        ids = r.job ? (JSON.parse(r.job) as string[]) : [];
      } catch {
        /* not JSON */
      }
      const prefix = deemixPrefix(r.link);
      const mine = items.filter((i) => ids.includes(i.uuid!) || (prefix && i.uuid!.startsWith(prefix)));
      if (!mine.length) continue;
      if (mine.every((i) => done(i.status))) this.finish(r.id, true);
      else if (mine.every((i) => done(i.status) || i.status === 'failed') && mine.some((i) => i.status === 'failed')) this.finish(r.id, false, 'deemix couldn’t get it');
    }

    const finished = new Set(items.filter((i) => done(i.status)).map((i) => i.uuid!));
    const isNew = this.deemixDone ? [...finished].some((u) => !this.deemixDone!.has(u)) : false;
    this.deemixDone = finished;
    // a new finished download, or requests still waiting for a scan (retried every 10 minutes if it failed)
    const waiting = !!this.db.prepare("SELECT 1 FROM requests WHERE status = 'approved' AND downloaded_at IS NOT NULL AND ready_at IS NULL").get();
    if ((isNew || (waiting && Date.now() - this.lastAttempt > 10 * 60_000)) && !this.scanTimer && !this.scanning) this.downloaded();
  }
}
