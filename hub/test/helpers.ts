import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { Config, SsoConfig } from '../src/config.ts';
import { openDb, type Db } from '../src/db.ts';

export const ADMIN_PW = 'correct horse battery';

export function makeHub(sso: Partial<SsoConfig> = {}, extra: Partial<Config> = {}): { app: FastifyInstance; db: Db; config: Config } {
  const db = openDb(':memory:');
  const config: Config = {
    version: 'test',
    port: 0,
    host: '127.0.0.1',
    dataDir: '.',
    publicUrl: 'https://hub.test',
    secretKey: Buffer.alloc(32, 7),
    musicDir: '',
    ytdlpBin: 'yt-dlp',
    webDir: '',
    sso: { enabled: false, trustedProxies: [], proxySecret: '', autoCreate: false, admins: [], adminGroup: '', ...sso },
    ...extra,
  };
  return { app: buildApp(db, config, { watchLibrary: false }), db, config };
}

export async function json(app: FastifyInstance, method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await app.inject({
    method: method as 'GET',
    url,
    headers: { ...(opts.token && { authorization: `Bearer ${opts.token}` }), ...opts.headers },
    ...(opts.body !== undefined && { payload: opts.body as object }),
  });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? res.json() : res.body };
}

export async function form(app: FastifyInstance, url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams(fields).toString(),
  });
  return { status: res.statusCode, body: res.body };
}

/** A Hub with an admin (`boss`), a member (`mia`) and a kid (`kit`), each signed in on one device. */
export async function seeded(sso: Partial<SsoConfig> = {}, extra: Partial<Config> = {}) {
  const hub = makeHub(sso, extra);
  const setup = await json(hub.app, 'POST', '/auth/setup', { body: { username: 'boss', password: ADMIN_PW, deviceName: 'PC' } });
  const admin = setup.body.token as string;
  const tokens: Record<string, string> = { admin };
  const ids: Record<string, number> = { admin: setup.body.user.id };
  for (const [name, role] of [['mia', 'member'], ['kit', 'kid']] as const) {
    const c = await json(hub.app, 'POST', '/api/admin/users', { token: admin, body: { username: name, role, password: `${name}-password-123` } });
    ids[role] = c.body.user.id;
    const l = await json(hub.app, 'POST', '/auth/login', { body: { username: name, password: `${name}-password-123`, deviceName: 'Phone' } });
    tokens[role] = l.body.token;
  }
  return { ...hub, tokens, ids };
}
