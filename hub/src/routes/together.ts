import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, RateLimiter, signedIn, str } from '../http.ts';
import { jamPage } from '../jamPage.ts';
import { songNotForKids } from '../kidSafe.ts';

/**
 * Listen together (docs/USERS-AND-ADMIN.md §7.2): someone starts a party on their device, which becomes the
 * host and keeps the music's clock. Anyone signed in to the Hub can join; their devices play the host's
 * queue at the same spot. Guests can add songs (unless the host turns that off) and, if the host allows it,
 * skip and pause. Their requests go to the host's device, which applies them and reports the new state.
 * Devices long-poll for changes. Kept in memory only.
 *
 * Guest Jam (docs/USER-GUIDE.md "Guest Jam"): the host can make a guest link. Anyone with it, no account needed,
 * opens a page in their phone's browser that shows what's playing and lets them search the Hub's copy of the
 * library and add songs. Their picks reach the host like a guest's "+ Queue". Guests never get a stream, a file
 * or a login: only song names, and the host's device plays. Turning the link off (or ending the party) ends it.
 */

const MAX_WAIT_MS = 25_000;
const GONE_MS = 60_000; // a member who hasn't waited for this long has left
const MAX_QUEUE = 500;
const REQUESTS = ['add', 'playNext', 'next', 'prev', 'toggle', 'seek', 'jump'] as const;
type RequestAction = (typeof REQUESTS)[number];
const CONTROL: RequestAction[] = ['next', 'prev', 'toggle', 'seek', 'jump'];

interface Member { userId: number; deviceId: number; name: string; device: string; seen: number; wake?: () => void; waiting: boolean }
interface PartyRequest { id: number; action: RequestAction; tracks?: unknown[]; value?: number; index?: number; from: string; at: number }
interface Party {
  id: string;
  name: string;
  hostUserId: number;
  hostDeviceId: number;
  hostName: string;
  guestsAdd: boolean;
  guestsControl: boolean;
  createdAt: number;
  version: number;
  state: { queue: unknown[]; index: number; position: number; duration: number; playing: boolean; at: number };
  members: Map<number, Member>; // by device, host included
  requests: PartyRequest[];
  /** the guest link's code, while it's on */
  jam?: string;
}

const num = (v: unknown, min: number, max: number, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const tracksOf = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : []).filter((t) => t && typeof t === 'object' && JSON.stringify(t).length <= 16 * 1024).slice(0, max);

/** What a Jam guest may see of a song: its name, never a link. */
const songName = (t: unknown) => {
  const x = (t ?? {}) as Record<string, unknown>;
  return { title: String(x.title ?? '').slice(0, 200), artist: String(x.artist ?? '').slice(0, 200) };
};

export function togetherRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, config } = ctx;
  const parties = new Map<string, Party>();
  let nextId = 1;
  // Jam guests: looking is cheap, adding is limited per address
  const jamLook = new RateLimiter(240, 60_000);
  const jamAdd = new RateLimiter(12, 10 * 60_000);

  app.addHook('preClose', async () => {
    for (const p of parties.values()) for (const m of p.members.values()) m.wake?.();
  });

  const view = (p: Party, deviceId: number) => ({
    id: p.id,
    name: p.name,
    host: p.hostName,
    isHost: p.hostDeviceId === deviceId,
    guestsAdd: p.guestsAdd,
    guestsControl: p.guestsControl,
    version: p.version,
    now: Date.now(),
    state: p.state,
    members: [...p.members.values()].map((m) => ({ name: m.name, device: m.device, host: m.deviceId === p.hostDeviceId })),
    ...(p.hostDeviceId === deviceId && { jam: p.jam ? jamUrl(p.jam) : null }),
  });
  const jamUrl = (code: string) => `${config.publicUrl}/jam/${code}`;

  const changed = (p: Party) => {
    p.version++;
    for (const m of p.members.values()) m.wake?.();
  };
  const sweep = () => {
    const now = Date.now();
    for (const p of parties.values()) {
      for (const [id, m] of p.members) if (!m.waiting && now - m.seen > GONE_MS) p.members.delete(id);
      if (!p.members.has(p.hostDeviceId)) end(p);
    }
  };
  const end = (p: Party) => {
    parties.delete(p.id);
    p.version++;
    for (const m of p.members.values()) m.wake?.();
  };
  /** The party, with the caller as a member of it (or a 404). */
  const mine = (req: Parameters<typeof signedIn>[0], id: string) => {
    const auth = signedIn(req);
    const p = parties.get(id);
    const m = p?.members.get(auth.device.id);
    if (!p || !m) throw new HttpError(404, 'That party has ended, or you aren’t in it');
    m.seen = Date.now();
    return { p, m, auth };
  };

  /** Host only: turn the guest link on (a new code each time) or off. `{ on: boolean }` */
  app.post<{ Params: { id: string } }>('/api/together/:id/jam', async (req) => {
    const { p, auth } = mine(req, req.params.id);
    if (p.hostDeviceId !== auth.device.id) throw new HttpError(403, 'Only the host can make a guest link');
    if (auth.user.role === 'kid') throw new HttpError(403, 'Kid profiles can’t make guest links');
    const on = ((req.body ?? {}) as Record<string, unknown>).on !== false;
    p.jam = on ? randomBytes(9).toString('base64url') : undefined;
    if (on) audit(db, { actorId: auth.user.id, action: 'together.jamLink', target: p.name, ip: clientIp(req) });
    changed(p);
    return view(p, auth.device.id);
  });

  /** The party a guest link belongs to, or a 404 once it's off or the party ended. */
  const jamParty = (code: string) => {
    sweep();
    const c = String(code).slice(0, 32);
    const p = [...parties.values()].find((x) => x.jam && x.jam === c);
    if (!p) throw new HttpError(404, 'This Jam has ended');
    return p;
  };
  const kidsIn = (p: Party) => {
    const ids = [...new Set([...p.members.values()].map((m) => m.userId))];
    return ids.some((id) => (db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined)?.role === 'kid');
  };

  app.get<{ Params: { code: string } }>('/jam/:code', async (req, reply) => {
    const p = [...parties.values()].find((x) => x.jam && x.jam === String(req.params.code).slice(0, 32));
    return reply
      .code(p ? 200 : 404)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      .header('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
      .send(jamPage(p ? { name: p.name, host: p.hostName } : null));
  });

  /** What's playing and up next, by name only. */
  app.get<{ Params: { code: string } }>('/api/jam/:code', async (req) => {
    jamLook.hit(clientIp(req));
    const p = jamParty(req.params.code);
    const s = p.state;
    return {
      name: p.name,
      host: p.hostName,
      guestsAdd: p.guestsAdd,
      playing: s.playing,
      now: s.index >= 0 && s.queue[s.index] ? songName(s.queue[s.index]) : null,
      next: s.queue.slice(s.index + 1, s.index + 11).map(songName),
    };
  });

  /** Search the Hub's copy of the library. Explicit songs are left out when a kid is in the party. */
  app.get<{ Params: { code: string }; Querystring: { q?: string } }>('/api/jam/:code/search', async (req) => {
    jamLook.hit(clientIp(req));
    const p = jamParty(req.params.code);
    const q = String(req.query.q ?? '').slice(0, 100).trim();
    if (q.length < 2 || !(await ctx.libraryIndex.ensure())) return { songs: [] };
    const kids = kidsIn(p);
    const songs = ctx.libraryIndex.search(q, { songs: 40 }).songs.filter((x) => !kids || !songNotForKids(db, x)).slice(0, 25);
    return { songs: songs.map((x) => ({ id: x.id, title: x.title, artist: x.artist, ...(x.album && { album: x.album }), ...(x.duration && { duration: x.duration }) })) };
  });

  /** A guest's pick: goes to the host's device like a party guest's "+ Queue". `{ id, name }` */
  app.post<{ Params: { code: string } }>('/api/jam/:code/add', async (req) => {
    const p = jamParty(req.params.code);
    if (!p.guestsAdd) throw new HttpError(403, 'The host is choosing the songs right now');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = str(b, 'name', 30).replace(/\p{Cc}/gu, '').trim();
    if (!name) throw new HttpError(400, 'Say who you are first');
    jamAdd.hit(clientIp(req));
    const song = ctx.libraryIndex.get(String(b.id ?? ''));
    if (!song) throw new HttpError(404, 'That song isn’t in the library');
    if (kidsIn(p) && songNotForKids(db, song)) throw new HttpError(403, 'That song isn’t for kids');
    const server = ctx.libraryIndex.status().server;
    // shaped like an app track; the host's device finds its own copy on the same Navidrome (lib/together.ts)
    const track = { ...song, kind: 'track', sourceId: 'jam', ...(server && { hubServer: server }) };
    p.requests = [...p.requests, { id: nextId++, action: 'add' as const, tracks: [track], from: `${name} (guest)`, at: Date.now() }].slice(-100);
    p.members.get(p.hostDeviceId)?.wake?.();
    return { ok: true, title: song.title };
  });

  /** Parties going on now, for "Join". */
  app.get('/api/together', async (req) => {
    const { device } = signedIn(req);
    sweep();
    return {
      parties: [...parties.values()].map((p) => ({
        id: p.id, name: p.name, host: p.hostName, members: p.members.size, joined: p.members.has(device.id), isHost: p.hostDeviceId === device.id,
      })),
    };
  });

  /** Start a party with this device as the host. `{ name?, guestsAdd?, guestsControl? }` */
  app.post('/api/together', async (req) => {
    const { user, device } = signedIn(req);
    sweep();
    for (const p of parties.values()) if (p.members.has(device.id)) throw new HttpError(409, 'This device is already in a party. Leave it first');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = randomBytes(6).toString('base64url');
    const p: Party = {
      id,
      name: str(b, 'name', 60) || `${user.displayName}'s party`,
      hostUserId: user.id,
      hostDeviceId: device.id,
      hostName: user.displayName,
      guestsAdd: b.guestsAdd !== false,
      guestsControl: b.guestsControl === true,
      createdAt: Date.now(),
      version: 1,
      state: { queue: [], index: -1, position: 0, duration: 0, playing: false, at: Date.now() },
      members: new Map([[device.id, { userId: user.id, deviceId: device.id, name: user.displayName, device: device.name, seen: Date.now(), waiting: false }]]),
      requests: [],
    };
    parties.set(id, p);
    audit(db, { actorId: user.id, action: 'together.started', target: p.name, ip: clientIp(req) });
    return view(p, device.id);
  });

  app.post<{ Params: { id: string } }>('/api/together/:id/join', async (req) => {
    const { user, device } = signedIn(req);
    sweep();
    const p = parties.get(req.params.id);
    if (!p) throw new HttpError(404, 'That party has ended');
    for (const other of parties.values()) if (other !== p && other.members.has(device.id)) throw new HttpError(409, 'This device is already in another party. Leave it first');
    if (!p.members.has(device.id)) {
      p.members.set(device.id, { userId: user.id, deviceId: device.id, name: user.displayName, device: device.name, seen: Date.now(), waiting: false });
      changed(p);
    }
    return view(p, device.id);
  });

  /** Leave; when the host leaves, the party ends for everyone. */
  app.post<{ Params: { id: string } }>('/api/together/:id/leave', async (req) => {
    const { p, auth } = mine(req, req.params.id);
    if (p.hostDeviceId === auth.device.id) end(p);
    else {
      p.members.get(auth.device.id)?.wake?.();
      p.members.delete(auth.device.id);
      changed(p);
    }
    return { ok: true };
  });

  /** Host only: change who may do what. */
  app.patch<{ Params: { id: string } }>('/api/together/:id', async (req) => {
    const { p, auth } = mine(req, req.params.id);
    if (p.hostDeviceId !== auth.device.id) throw new HttpError(403, 'Only the host can change that');
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.guestsAdd === 'boolean') p.guestsAdd = b.guestsAdd;
    if (typeof b.guestsControl === 'boolean') p.guestsControl = b.guestsControl;
    changed(p);
    return view(p, auth.device.id);
  });

  /** Host only: what's playing, which every guest follows. */
  app.put<{ Params: { id: string } }>('/api/together/:id/state', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const { p, auth } = mine(req, req.params.id);
    if (p.hostDeviceId !== auth.device.id) throw new HttpError(403, 'Only the host plays the music');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const queue = tracksOf(b.queue, MAX_QUEUE);
    p.state = {
      queue,
      index: Math.round(num(b.index, -1, queue.length - 1, -1)),
      position: num(b.position, 0, 24 * 3600),
      duration: num(b.duration, 0, 24 * 3600),
      playing: b.playing === true && queue.length > 0,
      at: Date.now(),
    };
    changed(p);
    return { ok: true, version: p.version };
  });

  /** A guest asks the host's device to add songs or (if allowed) skip, pause, seek. */
  app.post<{ Params: { id: string } }>('/api/together/:id/request', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const { p, auth } = mine(req, req.params.id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const action = b.action as RequestAction;
    if (!(REQUESTS as readonly string[]).includes(action)) throw new HttpError(400, `action must be one of ${REQUESTS.join(', ')}`);
    const host = p.hostDeviceId === auth.device.id;
    if (!host && (action === 'add' || action === 'playNext') && !p.guestsAdd) throw new HttpError(403, 'The host is choosing the songs');
    if (!host && CONTROL.includes(action) && !p.guestsControl) throw new HttpError(403, 'Only the host can skip or pause');
    const r: PartyRequest = { id: nextId++, action, from: auth.user.displayName, at: Date.now() };
    if (action === 'add' || action === 'playNext') {
      r.tracks = tracksOf(b.tracks, 100);
      if (!r.tracks.length) throw new HttpError(400, 'No songs to add');
    }
    if (action === 'seek') r.value = num(b.value, 0, 24 * 3600);
    if (action === 'jump') r.index = Math.round(num(b.index, 0, MAX_QUEUE));
    p.requests = [...p.requests, r].slice(-100);
    p.members.get(p.hostDeviceId)?.wake?.();
    return { ok: true };
  });

  /**
   * Wait until the party changes past `version` (or `timeout` ms, 25 s at most). The host also gets the
   * guests' requests. `{ party: null }` once the party has ended.
   */
  app.get<{ Params: { id: string }; Querystring: { version?: string; timeout?: string } }>('/api/together/:id/wait', async (req) => {
    const auth = signedIn(req);
    const p = parties.get(req.params.id);
    const m = p?.members.get(auth.device.id);
    if (!p || !m) return { party: null, requests: [] };
    const isHost = p.hostDeviceId === auth.device.id;
    const ready = () => p.version > num(req.query.version, 0, Number.MAX_SAFE_INTEGER) || (isHost && p.requests.length > 0) || !parties.has(p.id);
    if (!ready()) {
      m.wake?.();
      m.waiting = true;
      await new Promise<void>((done) => {
        const timer = setTimeout(finish, num(req.query.timeout, 0, MAX_WAIT_MS, MAX_WAIT_MS));
        req.raw.once('close', finish);
        function finish() {
          clearTimeout(timer);
          req.raw.off('close', finish);
          if (m!.wake === finish) {
            m!.wake = undefined;
            m!.waiting = false;
          }
          done();
        }
        m.wake = finish;
      });
    }
    m.seen = Date.now();
    if (!parties.has(p.id) || !p.members.has(auth.device.id)) return { party: null, requests: [] };
    const requests = isHost ? p.requests : [];
    if (isHost) p.requests = [];
    return { party: view(p, auth.device.id), requests };
  });
}
