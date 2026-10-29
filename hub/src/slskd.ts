import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { serviceForHub, serviceIdOfKind } from './services.ts';

/**
 * slskd (Soulseek) as a download source (docs/USERS-AND-ADMIN.md §6.3): search the network, pick a
 * folder from someone who shares it, and have slskd download it. slskd saves into its downloads folder,
 * which should be inside the music library (docs/HUB.md "Soulseek"), so Navidrome picks the files up on
 * the next scan. The API key stays on the Hub.
 */

export interface SlskdFile { filename: string; size: number; bitRate?: number; bitDepth?: number; sampleRate?: number; length?: number; extension?: string; isLocked?: boolean }
interface SlskdResponse { username: string; files?: SlskdFile[]; hasFreeUploadSlot?: boolean; uploadSpeed?: number; queueLength?: number }
export interface SlskdTransfer { id: string; username: string; filename: string; size: number; state: string; percentComplete?: number }

/** A folder someone shares: usually one album. */
export interface SlskdFolder {
  username: string;
  folder: string;
  /** The folder's own name, e.g. "Daft Punk - Discovery (2001) [FLAC]". */
  name: string;
  files: { filename: string; name: string; size: number; bitRate?: number; length?: number }[];
  size: number;
  format: string;
  lossless: boolean;
  bitRate: number | null;
  freeSlot: boolean;
  speed: number;
  queue: number;
}

const AUDIO = /\.(flac|mp3|m4a|aac|ogg|opus|wav|aiff?|alac|ape|wv)$/i;
const LOSSLESS = /\.(flac|wav|aiff?|alac|ape|wv)$/i;

/** Soulseek paths use backslashes. */
const split = (filename: string) => {
  const i = Math.max(filename.lastIndexOf('\\'), filename.lastIndexOf('/'));
  return { dir: i >= 0 ? filename.slice(0, i) : '', name: filename.slice(i + 1) };
};

/** A shared folder's name to show: "Artist / Album", or just the album folder when it names the artist. */
export function folderName(dir: string): string {
  const segs = dir.split(/[\\/]/).filter((x) => x && !x.startsWith('@@'));
  const [parent, last] = [segs.at(-2), segs.at(-1) ?? dir];
  const generic = /^(music|musik|musique|mp3s?|flac|audio|media|albums?|downloads?|complete|shared?|soulseek|slsk)$/i;
  return parent && !generic.test(parent) && !last.toLowerCase().includes(parent.toLowerCase()) ? `${parent} / ${last}` : last;
}

/** Words of the search found in a folder's path and file names, for ranking. */
const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Responses grouped into folders of music, best first: folders whose path has the words searched for,
 * from someone with a free slot, fast, lossless, more songs.
 */
export function rankFolders(responses: SlskdResponse[], query: string, max = 60): SlskdFolder[] {
  const want = words(query);
  const out: (SlskdFolder & { score: number })[] = [];
  for (const r of responses) {
    const byDir = new Map<string, SlskdFile[]>();
    for (const f of r.files ?? []) {
      if (f.isLocked || !AUDIO.test(f.filename)) continue;
      const { dir } = split(f.filename);
      byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
    }
    for (const [dir, files] of byDir) {
      files.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
      const exts = new Set(files.map((f) => (f.filename.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase()));
      const rates = files.map((f) => f.bitRate ?? 0).filter(Boolean);
      const lossless = files.every((f) => LOSSLESS.test(f.filename));
      const have = new Set(words(dir + ' ' + files.map((f) => split(f.filename).name).join(' ')));
      const found = want.filter((w) => have.has(w)).length / Math.max(1, want.length);
      const score = found * 100 + (r.hasFreeUploadSlot ? 20 : 0) + Math.min(10, (r.uploadSpeed ?? 0) / 500_000) + (lossless ? 8 : 0) + Math.min(5, files.length / 3) - Math.min(10, (r.queueLength ?? 0) / 5);
      out.push({
        username: r.username,
        folder: dir,
        name: folderName(dir),
        files: files.map((f) => ({ filename: f.filename, name: split(f.filename).name, size: f.size, bitRate: f.bitRate, length: f.length })),
        size: files.reduce((n, f) => n + (f.size || 0), 0),
        format: [...exts].join('/').toUpperCase(),
        lossless,
        bitRate: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null,
        freeSlot: !!r.hasFreeUploadSlot,
        speed: r.uploadSpeed ?? 0,
        queue: r.queueLength ?? 0,
        score,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(({ score: _s, ...f }) => f);
}

/** Finished, and how. slskd states look like "Completed, Succeeded" or "Queued, Remotely". */
export const transferDone = (state: string) => state.startsWith('Completed');
export const transferOk = (state: string) => state === 'Completed, Succeeded';

export function slskdClient(url: string, apiKey: string) {
  const base = url.replace(/\/+$/, '');
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}/api/v0${path}`, {
        method,
        headers: { 'x-api-key': apiKey, ...(body !== undefined && { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HttpError(502, `Couldn't reach slskd at ${url}`);
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'slskd refused the API key kept on the Hub');
    if (!res.ok) throw new HttpError(502, `slskd answered ${res.status}${await res.text().then((t) => (t ? `: ${t.slice(0, 200)}` : ''), () => '')}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  return {
    /** Checks the URL and key. */
    async test(): Promise<string> {
      const s = await call<{ server?: { isConnected?: boolean; isLoggedIn?: boolean; username?: string }; version?: { current?: string } }>('GET', '/application');
      const conn = s?.server;
      return conn?.isLoggedIn ? `Connected to Soulseek as ${conn.username ?? '?'}` : 'slskd answers, but isn’t signed in to Soulseek';
    },
    search: (text: string) => call<{ id: string }>('POST', '/searches', { searchText: text }),
    searchState: (id: string) => call<{ id: string; state: string; isComplete?: boolean; responseCount?: number; fileCount?: number }>('GET', `/searches/${encodeURIComponent(id)}`),
    responses: (id: string) => call<SlskdResponse[]>('GET', `/searches/${encodeURIComponent(id)}/responses`),
    deleteSearch: (id: string) => call('DELETE', `/searches/${encodeURIComponent(id)}`).catch(() => undefined),
    download: (username: string, files: { filename: string; size: number }[]) => call('POST', `/transfers/downloads/${encodeURIComponent(username)}`, files),
    /** Every download slskd knows about, flattened. */
    async transfers(): Promise<SlskdTransfer[]> {
      const users = await call<{ username: string; directories?: { files?: SlskdTransfer[] }[] }[]>('GET', '/transfers/downloads');
      return (users ?? []).flatMap((u) => (u.directories ?? []).flatMap((d) => (d.files ?? []).map((f) => ({ ...f, username: f.username ?? u.username }))));
    },
  };
}
export type SlskdClient = ReturnType<typeof slskdClient>;

/** The slskd kept on the Hub, or a 404 saying how to add one. */
export function hubSlskd(db: Db, key: Buffer) {
  const id = serviceIdOfKind(db, 'slskd');
  const s = id === undefined ? undefined : serviceForHub(db, key, id);
  if (!s) throw new HttpError(404, 'The Hub has no slskd set up. An admin adds it in Settings → Downloads');
  return { s, client: slskdClient(s.url, s.secrets.apiKey ?? '') };
}
