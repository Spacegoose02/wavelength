import type { FastifyRequest } from 'fastify';
import type { SsoConfig } from './config.ts';
import { safeEqual } from './crypto.ts';
import { clientIp } from './http.ts';

/** Who tinyauth says is signed in, read from the headers the proxy forwards. */
export interface SsoIdentity {
  username: string;
  name: string;
  email: string;
  groups: string[];
}

/**
 * The identity headers are only believed when the request comes from a trusted proxy address and/or
 * carries the shared proxy secret (whichever are configured; config.ts refuses to start with neither).
 * Otherwise anyone who can reach the Hub could send `Remote-User: admin`.
 */
export function ssoIdentity(req: FastifyRequest, sso: SsoConfig): SsoIdentity | null {
  if (!sso.enabled) return null;
  if (sso.trustedProxies.length && !sso.trustedProxies.includes(clientIp(req))) return null;
  if (sso.proxySecret) {
    const got = req.headers['x-wavelength-proxy-secret'];
    if (typeof got !== 'string' || !safeEqual(got, sso.proxySecret)) return null;
  }
  const h = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v ?? '').trim();
  };
  const username = h('remote-user').toLowerCase();
  if (!username) return null;
  return {
    username,
    name: h('remote-name'),
    email: h('remote-email'),
    groups: h('remote-groups').split(',').map((g) => g.trim()).filter(Boolean),
  };
}

export const isSsoAdmin = (id: SsoIdentity, sso: SsoConfig) =>
  sso.admins.includes(id.username) || (!!sso.adminGroup && id.groups.includes(sso.adminGroup));
