import { http, trimSlash } from '../lib/http';

/**
 * The Wavelength Hub API (hub/, docs/HUB.md). The Hub owns accounts, roles and admin-only rules;
 * this is a thin typed client. Every call except sign-in carries the device token.
 */

export type HubRole = 'admin' | 'member' | 'kid';
export type HubPermission =
  | 'users.manage' | 'audit.view' | 'keys.manage' | 'subwave.control' | 'requests.create'
  | 'requests.approve' | 'downloads.run' | 'library.edit' | 'server.view';

export interface HubUser {
  id: number;
  username: string;
  displayName: string;
  role: HubRole;
  ssoSubject: string | null;
  hasPassword: boolean;
  autodownload: boolean;
  disabled: boolean;
  createdAt: number;
}

export interface HubDevice {
  id: number;
  userId: number;
  name: string;
  platform: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface HubSession {
  token: string;
  user: HubUser;
  permissions: HubPermission[];
  device: HubDevice;
}

export interface HubHealth {
  ok: boolean;
  version: string;
  setupNeeded: boolean;
  sso: boolean;
}

export interface HubPairing {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresIn: number;
  interval: number;
}

export type HubPrefs = Record<string, { value: unknown; updatedAt: number }>;

export interface HubAdminUser extends HubUser {
  permissions: HubPermission[];
  devices: number;
  lastSeenAt: number | null;
}

export interface HubAuditEntry {
  id: number;
  at: number;
  actor: string | null;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
}

/** An error the Hub answered with (as opposed to "couldn't reach it"). */
export class HubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class HubClient {
  url: string;
  token?: string;
  constructor(url: string, token?: string) {
    this.url = trimSlash(url);
    this.token = token;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await http(this.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok && res.status !== 202) throw new HubError(res.status, data.error || `${res.status} ${res.statusText || 'error'}`);
    return { status: res.status, data };
  }
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.req<T>(method, path, body)).data;
  }

  health = () => this.call<HubHealth>('GET', '/api/health');
  setup = (b: { username: string; password: string; displayName?: string; deviceName: string; platform: string }) => this.call<HubSession>('POST', '/auth/setup', b);
  login = (b: { username: string; password: string; deviceName: string; platform: string }) => this.call<HubSession>('POST', '/auth/login', b);
  logout = () => this.call<{ ok: true }>('POST', '/auth/logout', {});
  startPairing = (b: { deviceName: string; platform: string }) => this.call<HubPairing>('POST', '/auth/device', b);

  /** null while the code hasn't been approved yet. Throws HubError 403 (denied) / 410 (expired). */
  async pollPairing(deviceCode: string): Promise<HubSession | null> {
    const r = await this.req<HubSession>('POST', '/auth/device/token', { deviceCode });
    return r.status === 202 ? null : r.data;
  }

  me = () => this.call<{ user: HubUser; device: HubDevice; permissions: HubPermission[] }>('GET', '/api/me');
  setDisplayName = (displayName: string) => this.call<{ user: HubUser }>('PATCH', '/api/me', { displayName });
  changePassword = (currentPassword: string, newPassword: string) => this.call('PUT', '/api/me/password', { currentPassword, newPassword });
  myDevices = () => this.call<{ devices: (HubDevice & { current: boolean })[] }>('GET', '/api/me/devices');
  signOutMyDevice = (id: number) => this.call('DELETE', `/api/me/devices/${id}`);
  ssoLink = () => this.call<{ url: string; expiresIn: number }>('POST', '/api/me/sso-link', {});
  unlinkSso = () => this.call<{ user: HubUser }>('DELETE', '/api/me/sso');
  getPrefs = () => this.call<{ prefs: HubPrefs }>('GET', '/api/me/prefs');
  putPrefs = (changes: HubPrefs) => this.call<{ applied: string[]; stale: string[]; prefs: HubPrefs }>('PUT', '/api/me/prefs', { changes });

  // ---- admin (the Hub refuses these unless the user holds the permission) ----
  users = () => this.call<{ users: HubAdminUser[] }>('GET', '/api/admin/users');
  createUser = (b: { username: string; role: HubRole; displayName?: string; password?: string; ssoSubject?: string; autodownload?: boolean }) =>
    this.call<{ user: HubAdminUser }>('POST', '/api/admin/users', b);
  updateUser = (id: number, b: Partial<{ displayName: string; role: HubRole; password: string | null; ssoSubject: string | null; autodownload: boolean; disabled: boolean }>) =>
    this.call<{ user: HubAdminUser }>('PATCH', `/api/admin/users/${id}`, b);
  deleteUser = (id: number) => this.call('DELETE', `/api/admin/users/${id}`);
  devices = () => this.call<{ devices: (HubDevice & { username?: string; displayName?: string })[] }>('GET', '/api/admin/devices');
  signOutDevice = (id: number) => this.call('DELETE', `/api/admin/devices/${id}`);
  audit = (limit = 50) => this.call<{ entries: HubAuditEntry[] }>('GET', `/api/admin/audit?limit=${limit}`);
}
