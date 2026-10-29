import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { HttpError, signedIn } from '../http.ts';

/**
 * Remote control and handoff (docs/USERS-AND-ADMIN.md §7.1): a person's signed-in devices see each other,
 * show what each is playing, and send each other commands: play/pause, next, seek, volume, or "play this
 * queue from here" to move playback from one device to another. Devices wait for commands with a long
 * poll (GET /api/me/remote/wait) and report their state with PUT /api/me/remote/state. Only a person's own
 * devices can control each other. Everything is in memory; nothing is stored.
 */

const ONLINE_MS = 45_000; // a device that hasn't waited or reported for this long is gone
const MAX_WAIT_MS = 25_000;
const MAX_QUEUE = 300;
const ACTIONS = ['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'volume', 'jump', 'load'] as const;
type Action = (typeof ACTIONS)[number];

interface State { queue: unknown[]; index: number; position: number; duration: number; playing: boolean; volume: number; at: number }
interface Command { id: number; action: Action; value?: number; queue?: unknown[]; index?: number; position?: number; play?: boolean; from: string; at: number }
interface Live {
  userId: number;
  deviceId: number;
  name: string;
  platform: string;
  seen: number;
  state?: State;
  commands: Command[];
  wake?: () => void;
}

const num = (v: unknown, min: number, max: number, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

function readQueue(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'queue must be a list of songs');
  if (v.length > MAX_QUEUE) return v.slice(0, MAX_QUEUE);
  return v.filter((t) => t && typeof t === 'object' && JSON.stringify(t).length <= 16 * 1024);
}

export function remoteRoutes(app: FastifyInstance, _ctx: Ctx) {
  const live = new Map<number, Live>(); // by device
  let nextId = 1;
  // let waiting devices go when the Hub shuts down, instead of holding it open
  app.addHook('preClose', async () => {
    for (const d of live.values()) d.wake?.();
  });

  const touch = (req: Parameters<typeof signedIn>[0]) => {
    const { user, device } = signedIn(req);
    let d = live.get(device.id);
    if (!d) live.set(device.id, (d = { userId: user.id, deviceId: device.id, name: device.name, platform: device.platform, seen: 0, commands: [] }));
    d.seen = Date.now();
    return d;
  };
  const online = (d: Live) => !!d.wake || Date.now() - d.seen < ONLINE_MS;
  const sweep = () => {
    for (const [id, d] of live) if (!d.wake && Date.now() - d.seen > 10 * 60_000) live.delete(id);
  };

  app.put('/api/me/remote/state', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const d = touch(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const queue = readQueue(b.queue ?? []);
    d.state = {
      queue,
      index: Math.round(num(b.index, -1, queue.length - 1, -1)),
      position: num(b.position, 0, 24 * 3600),
      duration: num(b.duration, 0, 24 * 3600),
      playing: b.playing === true && queue.length > 0,
      volume: num(b.volume, 0, 1, 1),
      at: Date.now(),
    };
    return { ok: true };
  });

  /** Wait for commands for this device (up to `timeout` ms, 25 s at most). Being here is what makes a device show up. */
  app.get<{ Querystring: { timeout?: string } }>('/api/me/remote/wait', async (req) => {
    const d = touch(req);
    if (!d.commands.length) {
      d.wake?.(); // a newer wait from the same device replaces the old one
      await new Promise<void>((done) => {
        const timer = setTimeout(finish, num(req.query.timeout, 0, MAX_WAIT_MS, MAX_WAIT_MS));
        req.raw.once('close', finish);
        function finish() {
          clearTimeout(timer);
          req.raw.off('close', finish);
          if (d.wake === finish) d.wake = undefined;
          done();
        }
        d.wake = finish;
      });
      d.seen = Date.now();
    }
    const commands = d.commands;
    d.commands = [];
    return { commands };
  });

  /** This device stops showing up (the person turned remote control off on it). */
  app.delete('/api/me/remote', async (req) => {
    const { device } = signedIn(req);
    const d = live.get(device.id);
    live.delete(device.id);
    d?.wake?.();
    return { ok: true };
  });

  /** This person's devices that are online, with what each is playing (`position` is worked out to now). */
  app.get('/api/me/remote/devices', async (req) => {
    const me = touch(req);
    sweep();
    const devices = [...live.values()]
      .filter((d) => d.userId === me.userId && online(d))
      .map((d) => {
        const s = d.state;
        const position = s ? Math.min(s.position + (s.playing ? (Date.now() - s.at) / 1000 : 0), s.duration || Infinity) : 0;
        return {
          id: d.deviceId,
          name: d.name,
          platform: d.platform,
          current: d.deviceId === me.deviceId,
          listening: !!d.wake,
          state: s ? { ...s, position } : null,
        };
      })
      .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    return { devices };
  });

  app.post('/api/me/remote/command', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const me = touch(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const target = live.get(Number(b.deviceId));
    if (!target || target.userId !== me.userId || !online(target)) throw new HttpError(404, "That device isn't online");
    if (target.deviceId === me.deviceId) throw new HttpError(400, 'That’s this device');
    const action = b.action as Action;
    if (!(ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, `action must be one of ${ACTIONS.join(', ')}`);
    const cmd: Command = { id: nextId++, action, from: me.name, at: Date.now() };
    if (action === 'seek') cmd.value = num(b.value, 0, 24 * 3600);
    if (action === 'volume') cmd.value = num(b.value, 0, 1, 1);
    if (action === 'jump') cmd.index = Math.round(num(b.index, 0, MAX_QUEUE));
    if (action === 'load') {
      cmd.queue = readQueue(b.queue);
      if (!cmd.queue.length) throw new HttpError(400, 'Nothing to play');
      cmd.index = Math.round(num(b.index, 0, cmd.queue.length - 1));
      cmd.position = num(b.position, 0, 24 * 3600);
      cmd.play = b.play !== false;
    }
    target.commands = [...target.commands, cmd].slice(-50);
    target.wake?.();
    return { ok: true, id: cmd.id };
  });
}
