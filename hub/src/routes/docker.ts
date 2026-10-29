import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.ts';
import { audit } from '../audit.ts';
import { clientIp, HttpError, need } from '../http.ts';

/**
 * Docker control (docs/USERS-AND-ADMIN.md Phase 6): admins see the household's containers on the server
 * page and can start, stop or restart them, and read their recent logs. The Hub never gets the Docker socket
 * itself: it talks to a socket proxy (WAVELENGTH_DOCKER_URL) that only lets container calls through, and only
 * containers named in WAVELENGTH_DOCKER_CONTAINERS are shown or touched.
 */

const ACTIONS = ['start', 'stop', 'restart'] as const;
type Action = (typeof ACTIONS)[number];

interface DockerContainer { Id: string; Names: string[]; Image: string; State: string; Status: string; Created: number }

/** Docker's log stream without a TTY: 8-byte headers (stream, 0, 0, 0, length) before each chunk. */
export function demux(buf: Buffer): string {
  if (buf.length < 8 || buf[0] > 2 || buf[1] !== 0 || buf[2] !== 0 || buf[3] !== 0) return buf.toString('utf8');
  const out: Buffer[] = [];
  for (let i = 0; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, i + 8 + len));
    i += 8 + len;
  }
  return Buffer.concat(out).toString('utf8');
}

export function dockerRoutes(app: FastifyInstance, { db, config }: Ctx) {
  const allowed = new Set(config.dockerContainers);

  async function docker(method: string, path: string): Promise<Response> {
    if (!config.dockerUrl) throw new HttpError(501, 'Docker control is off. See docs/HUB.md "Docker control" to turn it on');
    const res = await fetch(config.dockerUrl + path, { method, signal: AbortSignal.timeout(method === 'GET' ? 10_000 : 60_000) }).catch((e: Error) => {
      throw new HttpError(502, `Can't reach Docker at ${config.dockerUrl}: ${e.message}`);
    });
    // 304: already started / already stopped
    if (!res.ok && res.status !== 304) {
      const text = await res.text().catch(() => '');
      const msg = (() => {
        try {
          return (JSON.parse(text) as { message?: string }).message;
        } catch {
          return text.slice(0, 200);
        }
      })();
      throw new HttpError(res.status === 403 ? 403 : 502, `Docker answered ${res.status}${msg ? `: ${msg}` : ''}${res.status === 403 ? ' (the socket proxy needs CONTAINERS=1 and POST=1)' : ''}`);
    }
    return res;
  }

  const nameOf = (c: DockerContainer) => (c.Names[0] ?? '').replace(/^\//, '');
  async function listed(): Promise<DockerContainer[]> {
    const all = (await (await docker('GET', '/containers/json?all=1')).json()) as DockerContainer[];
    return all.filter((c) => allowed.has(nameOf(c)));
  }
  async function find(name: string): Promise<DockerContainer> {
    const c = (await listed()).find((x) => nameOf(x) === name);
    if (!c) throw new HttpError(404, `${name.slice(0, 60)} isn't one of the containers the Hub may control`);
    return c;
  }

  app.get('/api/admin/docker', async (req) => {
    need(req, 'server.view');
    if (!config.dockerUrl) return { enabled: false, containers: [] };
    const found = await listed();
    return {
      enabled: true,
      containers: config.dockerContainers.map((name) => {
        const c = found.find((x) => nameOf(x) === name);
        return c
          ? { name, image: c.Image, state: c.State, status: c.Status, created: c.Created * 1000 }
          : { name, image: '', state: 'missing', status: 'Not found on this Docker host', created: null };
      }),
    };
  });

  app.post<{ Params: { name: string; action: string } }>('/api/admin/docker/:name/:action', async (req) => {
    const { user } = need(req, 'server.view');
    const action = req.params.action as Action;
    if (!(ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, `action must be ${ACTIONS.join(', ')}`);
    const c = await find(req.params.name);
    await docker('POST', `/containers/${encodeURIComponent(c.Id)}/${action}?t=10`);
    audit(db, { actorId: user.id, action: `docker.${action}`, target: nameOf(c), ip: clientIp(req) });
    const after = (await listed()).find((x) => x.Id === c.Id);
    return { name: nameOf(c), state: after?.State ?? 'unknown', status: after?.Status ?? '' };
  });

  app.get<{ Params: { name: string }; Querystring: { lines?: string } }>('/api/admin/docker/:name/logs', async (req) => {
    need(req, 'server.view');
    const c = await find(req.params.name);
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 10), 2000);
    const res = await docker('GET', `/containers/${encodeURIComponent(c.Id)}/logs?stdout=1&stderr=1&timestamps=1&tail=${lines}`);
    return { name: nameOf(c), logs: demux(Buffer.from(await res.arrayBuffer())) };
  });
}
