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

/** A server login kept by the Hub (hub/src/services.ts). Navidrome stays a per-person login on each device. */
export type HubServiceKind = 'plex' | 'audiobookshelf' | 'subwave' | 'deemix' | 'ytdlp';
export type HubAccess = 'everyone' | 'admins' | 'chosen';
type Config = Record<string, string | number>;

/** What this device gets: only servers its user may use, with the logins filled in. */
export interface HubService {
  id: number;
  kind: HubServiceKind;
  name: string;
  url: string;
  config: Config;
  secrets: Record<string, string>;
  ownLogin: boolean;
  /** SUB/WAVE: admin controls work through the Hub (the admin login itself stays there). */
  hubAdmin?: boolean;
}

/** A yt-dlp download the Hub is running. */
export interface HubYtJob {
  jobId: string;
  username: string;
  title: string;
  channel: string;
  url: string;
  status: 'queued' | 'downloading' | 'processing' | 'done' | 'error';
  percent: number;
  message?: string;
}

/** A music request (docs/USERS-AND-ADMIN.md §6.3). */
export interface HubRequest {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  link: string;
  kind: string;
  title: string;
  artist: string;
  cover: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'have' | 'failed';
  reason: string | null;
  via: string | null;
  decidedBy: string | null;
  createdAt: number;
  decidedAt: number | null;
  seen: boolean;
}
export type HubRequestInput = { link: string; kind: string; title: string; artist: string; cover?: string; note?: string };

export interface HubPerson {
  id: number;
  username: string;
  displayName: string;
  kid: boolean;
}

export type ShareKind = 'playlist' | 'album' | 'track' | 'artist' | 'station' | 'favorites';
/** A song in a share: enough to find it again in someone else's library. */
export interface SharedTrack {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  coverUrl?: string;
}
export interface SharePayload {
  tracks?: SharedTrack[];
  station?: { name: string; streamUrl: string; favicon?: string; homepage?: string; nowPlayingUrl?: string };
  artist?: string;
}
export interface HubShare {
  id: number;
  kind: ShareKind;
  title: string;
  subtitle: string | null;
  cover: string | null;
  note: string | null;
  payload: SharePayload;
  createdAt: number;
  from: { id: number; displayName: string; username: string };
  /** null: shared with everyone. */
  to: { id: number; displayName: string } | null;
  seen: boolean;
}
export type HubShareInput = { to: number | null; kind: ShareKind; title: string; subtitle?: string; cover?: string; note?: string; payload: SharePayload };

/** What an admin sees: which secrets are set, never their values. */
export interface HubAdminService {
  id: number;
  kind: HubServiceKind;
  name: string;
  url: string;
  access: HubAccess;
  config: Config;
  secretsSet: string[];
  unreadable: boolean;
  users: { userId: number; secretsSet: string[]; unreadable: boolean }[];
}

/** Secrets to save: a value sets it, '' or null clears it, a missing key keeps it. */
export type HubServiceInput = Partial<{ kind: HubServiceKind; name: string; url: string; access: HubAccess; config: Record<string, string | number | null>; secrets: Record<string, string | null> }>;

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

  services = () => this.call<{ services: HubService[] }>('GET', '/api/me/services');

  // ---- calls the Hub makes with its own saved logins ----
  /** A SUB/WAVE admin call (path relative to its API, e.g. `/dj/skip?x=1`). Needs subwave.control. */
  subwaveAdmin = <T>(serviceId: number, method: string, path: string, body?: unknown) => this.call<T>(method, `/api/admin/subwave/${serviceId}${path}`, body);
  deemixStatus = () => this.call<{ user: string | null }>('GET', '/api/downloads/deemix');
  deemixQueue = () => this.call<any>('GET', '/api/downloads/deemix/queue');
  deemixAdd = (link: string, bitrate?: number) => this.call<any>('POST', '/api/downloads/deemix/queue', { link, bitrate });
  ytSearch = (query: string) => this.call<{ results: { id: string; title: string; channel: string; url: string; duration?: number; thumbnail?: string }[] }>('POST', '/api/downloads/ytdlp/search', { query });
  ytJobs = () => this.call<{ jobs: HubYtJob[] }>('GET', '/api/downloads/ytdlp/jobs');
  ytStart = (r: { url: string; title?: string; channel?: string }) => this.call<{ job: HubYtJob }>('POST', '/api/downloads/ytdlp/jobs', r);
  ytClear = () => this.call('DELETE', '/api/downloads/ytdlp/jobs');

  // ---- requests and sharing ----
  request = (b: HubRequestInput) => this.call<{ request: HubRequest }>('POST', '/api/requests', b);
  myRequests = () => this.call<{ requests: HubRequest[] }>('GET', '/api/requests');
  requestCounts = () => this.call<{ unseen: number; pending: number }>('GET', '/api/requests/counts');
  requestsSeen = () => this.call('POST', '/api/requests/seen', {});
  cancelRequest = (id: number) => this.call('DELETE', `/api/requests/${id}`);
  people = () => this.call<{ people: HubPerson[] }>('GET', '/api/people');
  share = (b: HubShareInput) => this.call<{ share: HubShare }>('POST', '/api/shares', b);
  shares = (sent = false) => this.call<{ shares: HubShare[] }>('GET', `/api/shares${sent ? '?sent=1' : ''}`);
  shareCounts = () => this.call<{ unseen: number }>('GET', '/api/shares/counts');
  sharesSeen = (ids?: number[]) => this.call('POST', '/api/shares/seen', ids ? { ids } : {});
  hideShare = (id: number) => this.call('POST', `/api/shares/${id}/hide`, {});
  unshare = (id: number) => this.call('DELETE', `/api/shares/${id}`);

  // ---- admin (the Hub refuses these unless the user holds the permission) ----
  users = () => this.call<{ users: HubAdminUser[] }>('GET', '/api/admin/users');
  createUser = (b: { username: string; role: HubRole; displayName?: string; password?: string; ssoSubject?: string; autodownload?: boolean }) =>
    this.call<{ user: HubAdminUser }>('POST', '/api/admin/users', b);
  updateUser = (id: number, b: Partial<{ displayName: string; role: HubRole; password: string | null; ssoSubject: string | null; autodownload: boolean; disabled: boolean }>) =>
    this.call<{ user: HubAdminUser }>('PATCH', `/api/admin/users/${id}`, b);
  deleteUser = (id: number) => this.call('DELETE', `/api/admin/users/${id}`);
  devices = () => this.call<{ devices: (HubDevice & { username?: string; displayName?: string })[] }>('GET', '/api/admin/devices');
  signOutDevice = (id: number) => this.call('DELETE', `/api/admin/devices/${id}`);
  adminServices = () => this.call<{ services: HubAdminService[] }>('GET', '/api/admin/services');
  createService = (b: HubServiceInput) => this.call<{ service: HubAdminService }>('POST', '/api/admin/services', b);
  updateService = (id: number, b: HubServiceInput) => this.call<{ service: HubAdminService }>('PATCH', `/api/admin/services/${id}`, b);
  deleteService = (id: number) => this.call('DELETE', `/api/admin/services/${id}`);
  setServiceUser = (id: number, userId: number, secrets?: Record<string, string | null>) =>
    this.call<{ service: HubAdminService }>('PUT', `/api/admin/services/${id}/users/${userId}`, { secrets });
  removeServiceUser = (id: number, userId: number) => this.call<{ service: HubAdminService }>('DELETE', `/api/admin/services/${id}/users/${userId}`);
  allRequests = (status?: string) => this.call<{ requests: HubRequest[] }>('GET', `/api/admin/requests${status ? `?status=${status}` : ''}`);
  approveRequest = (id: number, bitrate?: number) => this.call<{ request: HubRequest }>('POST', `/api/admin/requests/${id}/approve`, { bitrate });
  rejectRequest = (id: number, reason?: string) => this.call<{ request: HubRequest }>('POST', `/api/admin/requests/${id}/reject`, { reason });
  haveRequest = (id: number) => this.call<{ request: HubRequest }>('POST', `/api/admin/requests/${id}/have`, {});
  deleteRequest = (id: number) => this.call('DELETE', `/api/admin/requests/${id}`);
  audit = (limit = 50) => this.call<{ entries: HubAuditEntry[] }>('GET', `/api/admin/audit?limit=${limit}`);
}
