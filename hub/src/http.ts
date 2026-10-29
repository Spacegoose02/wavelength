import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Device } from './devices.ts';
import type { Permission } from './roles.ts';
import type { User } from './users.ts';

export interface Auth {
  user: User;
  device: Device;
  permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

/** Throw from a handler to answer `{ error }` with this status. */
export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** The signed-in caller, or 401. */
export function signedIn(req: FastifyRequest): Auth {
  if (!req.auth) throw new HttpError(401, 'Sign in to the Hub first');
  return req.auth;
}

/** The signed-in caller if they hold `perm`, else 401/403. This is the admin-only check: UI hiding is not. */
export function need(req: FastifyRequest, perm: Permission): Auth {
  const auth = signedIn(req);
  if (!auth.permissions.includes(perm)) throw new HttpError(403, 'You do not have permission to do that');
  return auth;
}

/** Remote address without the IPv4-mapped prefix. */
export const clientIp = (req: FastifyRequest) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

/** Small in-memory limiter for sign-in endpoints. Good enough for one Hub process. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Count a hit for `key`; throws 429 once the window's budget is spent. */
  hit(key: string) {
    const now = Date.now();
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.reset < now) this.hits.set(key, { n: 1, reset: now + this.windowMs });
    else if (++h.n > this.max) throw new HttpError(429, 'Too many attempts. Wait a minute and try again');
  }

  clear(key: string) {
    this.hits.delete(key);
  }
}

export const html = (reply: FastifyReply, body: string, status = 200) =>
  reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-frame-options', 'DENY')
    .header('referrer-policy', 'no-referrer')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
    .send(body);

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Read a string field from a JSON or form body, trimmed and length-capped. */
export function str(body: unknown, key: string, max = 200): string {
  const v = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
