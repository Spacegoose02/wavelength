import { http, trimSlash } from '../lib/http';
import type { DeemixItem } from '../lib/deemixQueue';
import type { Track } from './types';

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
  /** Uses two-step sign-in (hub/src/totp.ts); older Hubs don't say. */
  twoFactor?: boolean;
  /** For kids: the people whose approval their requests need, besides the admins (hub/src/family.ts). */
  guardians?: number[];
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

/** A server login kept by the Hub (hub/src/services.ts). Navidrome comes with this person's own login. */
export type HubServiceKind = 'plex' | 'audiobookshelf' | 'subwave' | 'navidrome' | 'deemix' | 'ytdlp' | 'slskd';

/** A folder someone shares on Soulseek (hub/src/slskd.ts): usually an album. */
export interface SlskdFolder {
  username: string;
  folder: string;
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
export interface SlskdDownload { username: string; folder: string; name: string; files: number; done: number; failed: number; progress: number; state: string }
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
  /** Navidrome through the Hub's relay at `/nd/<id>`: the login is for the Hub, the real one stays there. */
  relay?: boolean;
}

/** Tags the tag editor reads and writes (hub/src/tags.ts). */
export type HubTagKey = 'title' | 'artist' | 'album' | 'albumArtist' | 'track' | 'disc' | 'year' | 'genre';
export type HubTags = Partial<Record<HubTagKey, string>>;
export interface HubTagSong { id: string; path: string; tags: HubTags }
export interface HubTagMatch {
  source: 'Deezer' | 'MusicBrainz';
  id: string;
  title: string;
  artist: string;
  year?: string;
  genre?: string;
  cover?: string;
  tracks: { title: string; artist: string; track: number; disc: number }[];
}
/** An album an admin deleted (GET /api/admin/trash): in the trash until `purgeAt`, unless restored or purged. */
export interface HubTrashAlbum { batch: string; label: string; at: number; files: number; by: string | null; restoredAt: number | null; purgedAt: number | null; purgeAt: number }
export interface HubTagEdit { batch: string; label: string; at: number; files: number; undoneAt: number | null; by: string | null }
/** Tidy genres (hub/src/genres.ts): rules turn variants ("Hip Hop", "Trap") into one genre ("Rap; Hip-Hop"). */
export interface HubGenreRule { from: string; to: string }
export interface HubGenreSettings { auto: boolean; rules: HubGenreRule[]; defaults: boolean; kept: number; genres: string[] }
export interface HubGenreAlbum { id: string; name: string; artist: string; songs: number; current: string; proposed: string }
export interface HubGenreReview { albums: HubGenreAlbum[]; unknown: { genre: string; albums: number; examples: string[] }[]; total: number; kept: number; genres: string[] }

/** One of this person's Wavelength playlists, as kept on the Hub. `deleted` ones are tombstones. */
export interface HubPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
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
  /** The download finished. */
  downloadedAt: number | null;
  /** In the library (Navidrome scanned it in): "your song is ready". */
  readyAt: number | null;
  seen: boolean;
  /** Downloading with deemix: how it's going (hub/src/library.ts). */
  progress?: HubDownloadProgress;
}
export interface HubDownloadProgress {
  /** "Downloading · 5 of 12 songs", "Waiting · 2 in line", "Waiting for deemix to be free"… */
  label: string;
  percent: number;
  done: number;
  total: number;
  failed: number;
  stuck: boolean;
  errors: { title: string; artist: string; message: string }[];
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
/** Push notifications through ntfy (hub/src/push.ts). */
export interface HubPush {
  /** An admin has set up an ntfy server. */
  available: boolean;
  server: string | null;
  /** This person's topic, when they've turned it on. */
  topic: string | null;
  /** `ntfy://host/topic`: the ntfy app opens it and offers to subscribe. */
  subscribeUrl: string | null;
  webUrl: string | null;
}
/** A playlist the household adds to together (hub/src/routes/household.ts). */
export interface HouseholdPlaylist {
  id: number;
  name: string;
  songs: number;
  cover: string | null;
  createdAt: number;
  updatedAt: number;
  owner: { id: number; displayName: string } | null;
}
export interface HouseholdEntry {
  id: number;
  track: SharedTrack;
  addedAt: number;
  addedBy: { id: number; displayName: string } | null;
}
/** Something the Hub tells this person about (hub/src/notify.ts), shown as a system notification. */
export interface HubNotice {
  id: number;
  kind: 'request.new' | 'request.ready' | 'request.rejected' | 'request.have' | 'request.failed' | 'share' | 'radar' | 'library' | 'report' | 'rewind';
  title: string;
  body: string;
  createdAt: number;
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

/** A kid-safe flag: `block` hides it from kids, `allow` lets something explicit through. */
export type FlagVersion = '' | 'explicit' | 'clean' | 'any';
export interface HubFlag {
  id: number;
  kind: 'track' | 'album' | 'artist';
  artist: string;
  /** Song or album title; '' for an artist. */
  title: string;
  /**
   * Which version of the song or album it's for (src/lib/kids.ts `FlagVersion`): '' untagged, 'explicit',
   * 'clean', or 'any' (artists). Missing from a Hub older than 0.17.2.
   */
  version?: FlagVersion;
  verdict: 'block' | 'allow';
  setBy: string | null;
  createdAt: number;
}

/** Explicit / clean, found by looking the library up on Deezer. `title` is '' for an album row. */
export interface HubRating {
  kind: 'album' | 'track';
  artist: string;
  album: string;
  title: string;
  rating: 'explicit' | 'clean' | 'unknown';
  cleanLink: string | null;
  checkedAt: number;
}
export interface HubCleanJob {
  link: string;
  state: 'waiting' | 'queued' | 'failed';
  error?: string;
  at: number;
  /** While waiting: what for. */
  detail?: string;
  /** deemix's queue has stopped moving. */
  stuck?: boolean;
  /** Place in the Hub's line of clean versions (1 = next). */
  position?: number;
  /** Being handed to deemix: too late to cancel. */
  starting?: boolean;
}
export interface HubAlbumRating {
  artist: string;
  album: string;
  rating: HubRating['rating'];
  cleanLink?: string;
  explicitTracks?: string[];
}

/** Cover art an admin picked on the Hub (docs/HUB.md "Cover art"). `url` is a path on the Hub; `album` is '' for an artist. */
export interface HubArtwork {
  id: number;
  kind: 'album' | 'artist';
  artist: string;
  album: string;
  url: string;
  source: string;
  setBy: string | null;
  updatedAt: number;
}
/** A picture the Hub's lookup found. */
export interface HubArtCandidate {
  source: string;
  title: string;
  subtitle?: string;
  thumb: string;
  url: string;
}
/** A picture someone picked for a playlist (docs/HUB.md "Playlist covers"). `url` is a path on the Hub. */
export interface HubPlaylistCover {
  key: string;
  url: string;
  updatedAt: number;
}
export type HubArtworkInput = { kind: HubArtwork['kind']; artist: string; album?: string; source?: string } & ({ url: string } | { image: string });

/** The admin server page (GET /api/admin/server). */
export interface HubServerStatus {
  version: string;
  node: string;
  startedAt: number;
  publicUrl: string;
  sso: boolean;
  web: boolean;
  data: { dir: string; dbBytes: number; disk: { free: number; total: number } | null };
  music: { dir: string; exists: boolean; writable: boolean; disk: { free: number; total: number } | null } | null;
  ytdlp: string | null;
  counts: { users: number; admins: number; kids: number; devices: number; activeToday: number; pendingRequests: number; services: number; flags: number; ratedAlbums: number };
}

/** A container admins may control (GET /api/admin/docker). `state` is Docker's, or 'missing'. */
export interface HubContainer {
  name: string;
  image: string;
  state: string;
  status: string;
  created: number | null;
}

/** Someone playing something right now (GET /api/admin/listening). */
export interface HubListening {
  userId: number;
  displayName: string;
  role: string;
  deviceId: number;
  deviceName: string;
  platform: string;
  title: string;
  artist: string;
  album: string;
  source: string;
  at: number;
}

/** Rescans after downloads (GET /api/admin/library). */
export interface HubLibraryStatus {
  navidrome: { url: string; username: string } | null;
  scanning: boolean;
  lastScanAt: number | null;
  lastError: string | null;
  scanQueued: boolean;
}

/** A kid's bedtime ('HH:MM', device time) and daily listening limit; null = none. */
export interface KidRules {
  bedtimeFrom: string | null;
  bedtimeTo: string | null;
  dailyMinutes: number | null;
}

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

export interface HubParty {
  id: string;
  name: string;
  host: string;
  isHost: boolean;
  guestsAdd: boolean;
  guestsControl: boolean;
  version: number;
  /** The Hub's clock when it answered, to line positions up. */
  now: number;
  state: { queue: Track[]; index: number; position: number; duration: number; playing: boolean; at: number };
  members: { name: string; device: string; host: boolean }[];
}
export interface HubPartyRequest { id: number; action: 'add' | 'playNext' | 'next' | 'prev' | 'toggle' | 'seek' | 'jump'; tracks?: Track[]; value?: number; index?: number; from: string; at: number }

export interface HubRemoteState { queue: Track[]; index: number; position: number; duration: number; playing: boolean; volume: number; at: number }
export interface HubRemoteDevice { id: number; name: string; platform: string; current: boolean; listening: boolean; state: HubRemoteState | null }
export interface HubRemoteCommand {
  id: number;
  action: 'toggle' | 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'volume' | 'jump' | 'load';
  value?: number;
  queue?: Track[];
  index?: number;
  position?: number;
  play?: boolean;
  from: string;
  at: number;
}

/** One person's year or month of listening (hub/src/rewind.ts). */
export interface HubRewind {
  year: number;
  month: number | null;
  plays: number;
  minutes: number;
  songs: number;
  artists: number;
  albums: number;
  topArtists: { artist: string; plays: number; minutes: number; track: Track }[];
  topSongs: { title: string; artist: string; plays: number; track: Track }[];
  topAlbums: { album: string; artist: string; plays: number; track: Track }[];
  favourite: { title: string; artist: string; plays: number; firstPlayedAt: number | null } | null;
  newArtists: { count: number; top: { artist: string; plays: number }[] };
  byHour: number[];
  byWeekday: number[];
  byMonth: number[] | null;
  busiestDay: { day: string; plays: number } | null;
  daysListened: number;
  streak: number;
  playlist: Track[];
}

/** An artist this person follows for Release Radar (hub/src/radar.ts), by Deezer artist id. */
export interface HubFollow {
  id: number;
  name: string;
  picture: string | null;
  followedAt: number;
  /** "Get new releases automatically" is on (since then); missing on older Hubs. */
  autoGetAt?: number | null;
}

/** A new release from a followed artist, found by the Hub on Deezer. */
export interface HubRadarRelease {
  id: number;
  artistId: number;
  artist: string;
  title: string;
  /** album, ep, single or compile */
  type: string;
  /** YYYY-MM-DD */
  released: string;
  cover: string | null;
  link: string;
  explicit: boolean;
  foundAt: number;
}

export interface HubRadar {
  follows: HubFollow[];
  releases: HubRadarRelease[];
  /** Announced, not out yet (older Hubs don't send it). */
  upcoming?: HubRadarRelease[];
  windowDays: number;
  /** When the Hub last looked any of them up; null before the first look. */
  checkedAt: number | null;
  /** Followed artists not looked up yet, and ones whose last look failed. */
  pending: number;
  failed: number;
}

/** A song in this week's Weekly Mix (hub/src/radar.ts weeklyMix): Deezer's, with a 30-second preview. */
export interface HubMixTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  link: string;
  preview: string | null;
  explicit: boolean;
  duration: number;
  because: string;
}

/** A ListenBrainz or Last.fm account plays are sent to (hub/src/scrobble.ts). */
export interface HubScrobbleAccount {
  service: 'listenbrainz' | 'lastfm';
  username: string;
  connectedAt: number;
  /** why sending stopped (a revoked token); null while it works */
  error: string | null;
}

/** An artist to follow: like ones you follow or play (`because`), or one you play a lot (`plays`). */
export interface HubSuggestion {
  id: number;
  name: string;
  picture: string | null;
  fans: number | null;
  because: string[];
  plays?: number;
}

export interface HubInvite {
  id: number;
  role: HubRole;
  displayName: string;
  autodownload: boolean;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
}

/** An error the Hub answered with (as opposed to "couldn't reach it"). */
export class HubError extends Error {
  status: number;
  /** A password sign-in that also needs a two-step code (hub/src/totp.ts). */
  twoFactor: boolean;
  constructor(status: number, message: string, twoFactor = false) {
    super(message);
    this.status = status;
    this.twoFactor = twoFactor;
  }
}

/** AI DJ (hub/src/dj/, docs/AI-DJ.md): the chat runs on the Hub, which keeps the API key. */
export interface HubDjStatus { available: boolean; reason: string | null; model: string; spent: number; limit: number | null }
export interface HubDjChat { id: number; title: string; createdAt: number; updatedAt: number; turns: number }
export interface HubDjCall { id: string; name: string; input: unknown }
export interface HubDjTurn { chat: HubDjChat; status: 'done' | 'tools'; reply: string; calls?: HubDjCall[]; full?: boolean; spent: number; limit: number | null }
export interface HubDjEntry { role: 'user' | 'assistant'; text: string; tools?: string[] }
export interface HubDjPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface HubDjSettings {
  enabled: boolean;
  provider: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  baseUrl: string;
  fallback: boolean;
  prices: Record<string, HubDjPrice>;
  householdLimit: number | null;
  defaultUserLimit: number | null;
}
export interface HubDjAdmin {
  settings: HubDjSettings;
  key: { set: boolean; hint: string | null; unreadable: boolean };
  providers: string[];
  efforts: HubDjSettings['effort'][];
  models: { id: string; label: string; blurb: string; price: HubDjPrice }[];
  defaultModel: string;
  price: HubDjPrice | null;
  users: { id: number; displayName: string; username: string; role: HubRole; disabled: boolean; enabled: boolean; monthlyLimit: number | null; spent: number; calls: number }[];
  month: { spent: number; byModel: { model: string; calls: number; inputTokens: number; outputTokens: number; cost: number }[]; byDay: { day: string; cost: number; calls: number }[] };
  allTime: number;
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
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; twoFactor?: boolean };
    if (!res.ok && res.status !== 202) throw new HubError(res.status, data.error || `${res.status} ${res.statusText || 'error'}`, !!data.twoFactor);
    return { status: res.status, data };
  }
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.req<T>(method, path, body)).data;
  }

  health = () => this.call<HubHealth>('GET', '/api/health');
  setup = (b: { username: string; password: string; displayName?: string; deviceName: string; platform: string }) => this.call<HubSession>('POST', '/auth/setup', b);
  login = (b: { username: string; password: string; otp?: string; deviceName: string; platform: string }) => this.call<HubSession>('POST', '/auth/login', b);
  logout = () => this.call<{ ok: true }>('POST', '/auth/logout', {});
  startPairing = (b: { deviceName: string; platform: string }) => this.call<HubPairing>('POST', '/auth/device', b);

  /** null while the code hasn't been approved yet. Throws HubError 403 (denied) / 410 (expired). */
  async pollPairing(deviceCode: string): Promise<HubSession | null> {
    const r = await this.req<HubSession>('POST', '/auth/device/token', { deviceCode });
    return r.status === 202 ? null : r.data;
  }

  me = () => this.call<{ user: HubUser; device: HubDevice; permissions: HubPermission[]; twoFactor?: boolean; kids?: { id: number; displayName: string }[] }>('GET', '/api/me');
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
  /** A clean version, into its own "… (Clean)" folder once deemix is free (hub/src/cleanDownloads.ts). */
  deemixClean = (link: string, bitrate?: number) => this.call<{ job: HubCleanJob }>('POST', '/api/downloads/deemix/clean', { link, bitrate });
  deemixCleanJobs = () => this.call<{ jobs: HubCleanJob[] }>('GET', '/api/downloads/deemix/clean');
  deemixCleanCancel = (link: string) => this.call('DELETE', '/api/downloads/deemix/clean', { link });
  /** deemix's queue made readable, with stalls noticed by the Hub (hub/src/deemixQueue.ts). */
  deemixProgress = () => this.call<{ items: DeemixItem[]; clean: HubCleanJob[] }>('GET', '/api/downloads/deemix/progress');
  deemixCancel = (uuid: string) => this.call('POST', `/api/downloads/deemix/queue/${encodeURIComponent(uuid)}/cancel`);
  deemixRetry = (uuid: string) => this.call('POST', `/api/downloads/deemix/queue/${encodeURIComponent(uuid)}/retry`);
  deemixClearFinished = () => this.call('POST', '/api/downloads/deemix/queue/clear');
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
  /** Notifications after `after` (the `last` from the previous call); without it, only where to start. */
  notifications = (after?: number) =>
    this.call<{ notifications: HubNotice[]; last: number }>('GET', `/api/notifications${after === undefined ? '' : `?after=${after}`}`);
  sharesSeen = (ids?: number[]) => this.call('POST', '/api/shares/seen', ids ? { ids } : {});
  hideShare = (id: number) => this.call('POST', `/api/shares/${id}/hide`, {});
  unshare = (id: number) => this.call('DELETE', `/api/shares/${id}`);

  // Release Radar (lib/follows.ts): artists this person follows and their new releases
  radar = () => this.call<HubRadar>('GET', '/api/radar');
  radarCheck = () => this.call<Pick<HubRadar, 'releases' | 'checkedAt' | 'pending' | 'failed'>>('POST', '/api/radar/check', {});
  /** By Deezer id, or by name alone (the Hub finds them on Deezer; HubError 404 when it can't). */
  follow = (a: { id?: number; name: string; picture?: string | null }) => this.call<{ follow: HubFollow }>('POST', '/api/radar/follows', a);
  unfollow = (id: number) => this.call('DELETE', `/api/radar/follows/${id}`);
  radarSuggestions = (fresh = false) => this.call<{ suggestions: HubSuggestion[] }>('GET', `/api/radar/suggestions${fresh ? '?fresh=1' : ''}`);
  hideSuggestion = (id: number) => this.call('POST', `/api/radar/suggestions/${id}/hide`, {});
  setAutoGet = (id: number, autoGet: boolean) => this.call<{ follow: HubFollow }>('PATCH', `/api/radar/follows/${id}`, { autoGet });
  weeklyMix = (fresh = false) => this.call<{ week: string; tracks: HubMixTrack[] }>('GET', `/api/radar/mix${fresh ? '?fresh=1' : ''}`);
  // Two-step sign-in (hub/src/totp.ts)
  twoFactor = () => this.call<{ enabled: boolean; recoveryLeft: number }>('GET', '/api/me/2fa');
  twoFactorSetup = (password: string) => this.call<{ secret: string; uri: string }>('POST', '/api/me/2fa/setup', { password });
  twoFactorEnable = (code: string) => this.call<{ recoveryCodes: string[] }>('POST', '/api/me/2fa/enable', { code });
  twoFactorOff = (password: string, otp: string) => this.call('DELETE', '/api/me/2fa', { password, otp });
  householdPlaylists = () => this.call<{ playlists: HouseholdPlaylist[] }>('GET', '/api/household/playlists');
  householdPlaylist = (id: number) => this.call<{ playlist: HouseholdPlaylist; tracks: HouseholdEntry[] }>('GET', `/api/household/playlists/${id}`);
  createHouseholdPlaylist = (name: string, tracks?: SharedTrack[]) => this.call<{ playlist: HouseholdPlaylist }>('POST', '/api/household/playlists', { name, tracks });
  renameHouseholdPlaylist = (id: number, name: string) => this.call<{ playlist: HouseholdPlaylist }>('PATCH', `/api/household/playlists/${id}`, { name });
  deleteHouseholdPlaylist = (id: number) => this.call<{ ok: true }>('DELETE', `/api/household/playlists/${id}`);
  addToHousehold = (id: number, tracks: SharedTrack[]) => this.call<{ added: number }>('POST', `/api/household/playlists/${id}/tracks`, { tracks });
  removeFromHousehold = (id: number, entry: number) => this.call<{ ok: true }>('DELETE', `/api/household/playlists/${id}/tracks/${entry}`);
  orderHousehold = (id: number, ids: number[]) => this.call<{ ok: true }>('PUT', `/api/household/playlists/${id}/order`, { ids });
  setGuardians = (kidId: number, ids: number[]) => this.call<{ user: HubAdminUser }>('PUT', `/api/admin/users/${kidId}/guardians`, { ids });
  resetTwoFactor = (userId: number) => this.call<{ user: HubAdminUser }>('DELETE', `/api/admin/users/${userId}/2fa`);
  // Scrobbling (hub/src/scrobble.ts)
  push = () => this.call<HubPush>('GET', '/api/me/push');
  pushOn = () => this.call<HubPush>('POST', '/api/me/push', {});
  pushOff = () => this.call<HubPush>('DELETE', '/api/me/push');
  pushTest = () => this.call<{ ok: true }>('POST', '/api/me/push/test', {});
  pushSettings = () => this.call<{ server: string; hasToken: boolean }>('GET', '/api/admin/push');
  /** `server: ''` turns push off; `token: null` removes the saved one, leaving it out keeps it. */
  savePushSettings = (b: { server: string; token?: string | null }) => this.call<{ server: string; hasToken: boolean }>('PUT', '/api/admin/push', b);
  scrobbleAccounts = () => this.call<{ accounts: HubScrobbleAccount[]; lastfmAvailable: boolean }>('GET', '/api/me/scrobble');
  connectListenBrainz = (token: string) => this.call<{ account: HubScrobbleAccount }>('POST', '/api/me/scrobble/listenbrainz', { token });
  connectLastfm = (username: string, password: string) => this.call<{ account: HubScrobbleAccount }>('POST', '/api/me/scrobble/lastfm', { username, password });
  disconnectScrobble = (service: HubScrobbleAccount['service']) => this.call('DELETE', `/api/me/scrobble/${service}`);

  flags = () => this.call<{ flags: HubFlag[] }>('GET', '/api/flags');
  server = () => this.call<HubServerStatus>('GET', '/api/admin/server');
  library = () => this.call<HubLibraryStatus>('GET', '/api/admin/library');
  containers = () => this.call<{ enabled: boolean; containers: HubContainer[] }>('GET', '/api/admin/docker');
  container = (name: string, action: 'start' | 'stop' | 'restart') =>
    this.call<{ name: string; state: string; status: string }>('POST', `/api/admin/docker/${encodeURIComponent(name)}/${action}`, {});
  containerLogs = (name: string, lines = 200) => this.call<{ name: string; logs: string }>('GET', `/api/admin/docker/${encodeURIComponent(name)}/logs?lines=${lines}`);
  setScanLogin = (b: { url: string; username: string; password?: string }) => this.call<HubLibraryStatus>('PUT', '/api/admin/library/navidrome', b);
  removeScanLogin = () => this.call<HubLibraryStatus>('DELETE', '/api/admin/library/navidrome');
  scanLibrary = () => this.call<HubLibraryStatus>('POST', '/api/admin/library/scan', {});
  /** A copy of the Hub's database, as a file to save. */
  async backup(): Promise<{ name: string; blob: Blob }> {
    const res = await http(`${this.url}/api/admin/backup`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new HubError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error || `${res.status} error`);
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'wavelength-hub.db';
    return { name, blob: await res.blob() };
  }
  /** Put a backup back. The Hub checks it and restarts to swap it in; HubError 409 = locked with another secret key. */
  async restore(file: Blob, force = false): Promise<{ users: number; admins: number; keyMismatch: boolean }> {
    const res = await http(`${this.url}/api/admin/restore${force ? '?force=1' : ''}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/vnd.sqlite3' },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; users: number; admins: number; keyMismatch: boolean };
    if (!res.ok) throw new HubError(res.status, data.error || `${res.status} error`);
    return data;
  }
  ratings = () => this.call<{ ratings: HubRating[] }>('GET', '/api/ratings');
  artwork = () => this.call<{ artwork: HubArtwork[] }>('GET', '/api/artwork');
  playlistCovers = () => this.call<{ covers: HubPlaylistCover[] }>('GET', '/api/playlist-covers');
  setPlaylistCover = (key: string, image: string) => this.call<{ cover: HubPlaylistCover }>('PUT', '/api/playlist-covers', { key, image });
  deletePlaylistCover = (key: string) => this.call('DELETE', `/api/playlist-covers/${encodeURIComponent(key)}`);
  kidStatus = (day: string) => this.call<{ kid: boolean; rules: KidRules; usedSeconds: number; pinSet: boolean }>('GET', `/api/me/kid?day=${day}`);
  listened = (day: string, seconds: number) => this.call<{ usedSeconds: number }>('POST', '/api/me/listened', { day, seconds });
  kidUnlock = (pin: string) => this.call<{ ok: true }>('POST', '/api/kid/unlock', { pin });

  // ---- admin (the Hub refuses these unless the user holds the permission) ----
  users = () => this.call<{ users: HubAdminUser[] }>('GET', '/api/admin/users');
  createUser = (b: { username: string; role: HubRole; displayName?: string; password?: string; ssoSubject?: string; autodownload?: boolean }) =>
    this.call<{ user: HubAdminUser }>('POST', '/api/admin/users', b);
  updateUser = (id: number, b: Partial<{ displayName: string; role: HubRole; password: string | null; ssoSubject: string | null; autodownload: boolean; disabled: boolean }>) =>
    this.call<{ user: HubAdminUser }>('PATCH', `/api/admin/users/${id}`, b);
  deleteUser = (id: number) => this.call('DELETE', `/api/admin/users/${id}`);
  invites = () => this.call<{ invites: HubInvite[] }>('GET', '/api/admin/invites');
  createInvite = (b: { role: HubRole; displayName?: string; autodownload?: boolean; days?: number }) =>
    this.call<{ id: number; url: string; code: string; expiresAt: number }>('POST', '/api/admin/invites', b);
  cancelInvite = (id: number) => this.call('DELETE', `/api/admin/invites/${id}`);
  /** Make an account from an invite link (or its code) and sign this device in. */
  acceptInvite = (b: { code: string; username: string; password: string; displayName?: string; deviceName: string; platform: string }) => this.call<HubSession>('POST', '/auth/invite', b);
  devices = () => this.call<{ devices: (HubDevice & { username?: string; displayName?: string })[] }>('GET', '/api/admin/devices');
  signOutDevice = (id: number) => this.call('DELETE', `/api/admin/devices/${id}`);
  adminServices = () => this.call<{ services: HubAdminService[] }>('GET', '/api/admin/services');
  createService = (b: HubServiceInput) => this.call<{ service: HubAdminService }>('POST', '/api/admin/services', b);
  updateService = (id: number, b: HubServiceInput) => this.call<{ service: HubAdminService }>('PATCH', `/api/admin/services/${id}`, b);
  deleteService = (id: number) => this.call('DELETE', `/api/admin/services/${id}`);
  setServiceUser = (id: number, userId: number, secrets?: Record<string, string | null>) =>
    this.call<{ service: HubAdminService }>('PUT', `/api/admin/services/${id}/users/${userId}`, { secrets });
  /** Make a Navidrome account for someone with the admin login the Hub keeps, saved as their own login. */
  createNavidromeAccount = (id: number, userId: number) => this.call<{ service: HubAdminService }>('POST', `/api/admin/services/${id}/users/${userId}/navidrome-account`, {});
  playing = (b: { title: string; artist?: string; album?: string; source?: string } | { stopped: true }) => this.call('POST', '/api/me/playing', b);
  listening = () => this.call<{ listening: HubListening[] }>('GET', '/api/admin/listening');
  // this person's own Wavelength playlists and play history (lib/librarySync.ts)
  myPlaylists = () => this.call<{ playlists: HubPlaylist[] }>('GET', '/api/me/playlists');
  putMyPlaylists = (playlists: HubPlaylist[]) => this.call<{ playlists: HubPlaylist[] }>('PUT', '/api/me/playlists', { playlists });
  myHistory = () => this.call<{ history: { playedAt: number; track: Track }[] }>('GET', '/api/me/history');
  tagAlbum = (albumId: string) => this.call<{ songs: HubTagSong[] }>('GET', `/api/admin/tags/album/${encodeURIComponent(albumId)}`);
  tagMatches = (artist: string, album: string) => this.call<{ candidates: HubTagMatch[] }>('GET', `/api/admin/tags/match?${new URLSearchParams({ artist, album })}`);
  saveTags = (label: string, changes: { path: string; tags: HubTags }[]) => this.call<{ batch: string | null; changed: string[]; failed: { path: string; error: string }[] }>('PUT', '/api/admin/tags', { label, changes });
  /** Several albums' songs (Navidrome album ids), each with `albumId`; `missing` = files the Hub can't find. */
  tagAlbums = (albumIds: string[]) => this.call<{ songs: (HubTagSong & { albumId: string })[]; missing: string[] }>('GET', `/api/admin/tags/albums?ids=${albumIds.map(encodeURIComponent).join(',')}`);
  tagValues = () => this.call<{ artists: string[]; genres: string[] }>('GET', '/api/admin/tags/values');
  deleteAlbum = (albumId: string) => this.call<{ batch: string; label: string; files: number; failed: string[] }>('DELETE', `/api/admin/library/album/${encodeURIComponent(albumId)}`);
  trash = () => this.call<{ albums: HubTrashAlbum[] }>('GET', '/api/admin/trash');
  restoreAlbum = (batch: string) => this.call<{ files: number; failed: string[] }>('POST', `/api/admin/trash/${encodeURIComponent(batch)}/restore`, {});
  purgeAlbum = (batch: string) => this.call('DELETE', `/api/admin/trash/${encodeURIComponent(batch)}`);
  tagHistory = () => this.call<{ edits: HubTagEdit[] }>('GET', '/api/admin/tags/history');
  genreSettings = () => this.call<HubGenreSettings>('GET', '/api/admin/genres');
  /** `rules: null` goes back to the default rules. */
  saveGenreSettings = (b: { auto?: boolean; rules?: HubGenreRule[] | null }) => this.call<HubGenreSettings>('PUT', '/api/admin/genres', b);
  genreReview = () => this.call<HubGenreReview>('GET', '/api/admin/genres/review');
  applyGenres = (albums: { id: string; genre: string }[]) =>
    this.call<{ batch: string | null; label: string; changed: string[]; failed: { path: string; error: string }[]; missing: string[] }>('POST', '/api/admin/genres/apply', { albums });
  keepGenres = (ids: string[], keep = true) => this.call<HubGenreSettings>('POST', '/api/admin/genres/keep', { ids, keep });
  undoTags = (batch: string) => this.call<{ undone: number; failed: { path: string; error: string }[] }>('POST', `/api/admin/tags/undo/${encodeURIComponent(batch)}`);
  importYoutube = (url: string) => this.call<{ tracks: { title: string; artist: string; duration?: number }[] }>('POST', '/api/import/youtube', { url });
  // remote control and handoff between this person's devices (lib/remote.ts)
  remoteWait = () => this.call<{ commands: HubRemoteCommand[] }>('GET', '/api/me/remote/wait');
  remoteState = (s: Omit<HubRemoteState, 'at'>) => this.call('PUT', '/api/me/remote/state', s);
  remoteLeave = () => this.call('DELETE', '/api/me/remote');
  remoteDevices = () => this.call<{ devices: HubRemoteDevice[] }>('GET', '/api/me/remote/devices');
  remoteCommand = (deviceId: number, c: Omit<HubRemoteCommand, 'id' | 'from' | 'at'>) => this.call('POST', '/api/me/remote/command', { deviceId, ...c });
  // listen together (lib/together.ts)
  parties = () => this.call<{ parties: { id: string; name: string; host: string; members: number; joined: boolean; isHost: boolean }[] }>('GET', '/api/together');
  startParty = (b: { name?: string; guestsAdd?: boolean; guestsControl?: boolean }) => this.call<HubParty>('POST', '/api/together', b);
  joinParty = (id: string) => this.call<HubParty>('POST', `/api/together/${encodeURIComponent(id)}/join`, {});
  leaveParty = (id: string) => this.call('POST', `/api/together/${encodeURIComponent(id)}/leave`, {});
  setParty = (id: string, b: { guestsAdd?: boolean; guestsControl?: boolean }) => this.call<HubParty>('PATCH', `/api/together/${encodeURIComponent(id)}`, b);
  partyState = (id: string, s: Omit<HubParty['state'], 'at'>) => this.call('PUT', `/api/together/${encodeURIComponent(id)}/state`, s);
  partyRequest = (id: string, r: { action: HubPartyRequest['action']; tracks?: Track[]; value?: number; index?: number }) => this.call('POST', `/api/together/${encodeURIComponent(id)}/request`, r);
  partyWait = (id: string, version: number) => this.call<{ party: HubParty | null; requests: HubPartyRequest[] }>('GET', `/api/together/${encodeURIComponent(id)}/wait?version=${version}`);
  rewindPeriods = () => this.call<{ periods: { year: number; month: number; plays: number }[] }>('GET', `/api/me/rewind/periods?tz=${new Date().getTimezoneOffset()}`);
  rewind = (year: number, month?: number) =>
    this.call<HubRewind>('GET', `/api/me/rewind?${new URLSearchParams({ year: String(year), ...(month && { month: String(month) }), tz: String(new Date().getTimezoneOffset()) })}`);
  addMyHistory = (plays: { playedAt: number; track: Track }[]) => this.call('POST', '/api/me/history', { plays });
  removeServiceUser = (id: number, userId: number) => this.call<{ service: HubAdminService }>('DELETE', `/api/admin/services/${id}/users/${userId}`);
  allRequests = (status?: string) => this.call<{ requests: HubRequest[] }>('GET', `/api/admin/requests${status ? `?status=${status}` : ''}`);
  approveRequest = (id: number, bitrate?: number, slskd?: { username: string; files: { filename: string; size: number }[] }) =>
    this.call<{ request: HubRequest }>('POST', `/api/admin/requests/${id}/approve`, { bitrate, slskd });

  slskdTest = () => this.call<{ message: string }>('POST', '/api/slskd/test', {});
  slskdSearch = (query: string) => this.call<{ id: string }>('POST', '/api/slskd/searches', { query });
  slskdResults = (id: string) => this.call<{ done: boolean; responses: number; folders: SlskdFolder[] }>('GET', `/api/slskd/searches/${encodeURIComponent(id)}`);
  slskdDownload = (f: Pick<SlskdFolder, 'username' | 'files' | 'name'>) => this.call<{ ok: true; files: number }>('POST', '/api/slskd/downloads', { username: f.username, files: f.files, label: f.name });
  slskdDownloads = () => this.call<{ downloads: SlskdDownload[] }>('GET', '/api/slskd/downloads');
  rejectRequest = (id: number, reason?: string) => this.call<{ request: HubRequest }>('POST', `/api/admin/requests/${id}/reject`, { reason });
  haveRequest = (id: number) => this.call<{ request: HubRequest }>('POST', `/api/admin/requests/${id}/have`, {});
  deleteRequest = (id: number) => this.call('DELETE', `/api/admin/requests/${id}`);
  saveRatings = (albums: HubAlbumRating[]) => this.call<{ saved: number }>('POST', '/api/admin/ratings', { albums });
  clearRatings = () => this.call('DELETE', '/api/admin/ratings');
  findArt = (kind: HubArtwork['kind'], artist: string, album = '') =>
    this.call<{ candidates: HubArtCandidate[]; failed: string[] }>('GET', `/api/admin/artwork/search?${new URLSearchParams({ kind, artist, album })}`);
  setArtwork = (b: HubArtworkInput) => this.call<{ artwork: HubArtwork }>('PUT', '/api/admin/artwork', b);
  deleteArtwork = (id: number) => this.call('DELETE', `/api/admin/artwork/${id}`);
  setFlag = (b: { kind: HubFlag['kind']; artist: string; title?: string; version?: FlagVersion; verdict: HubFlag['verdict'] }) => this.call<{ flag: HubFlag }>('POST', '/api/admin/flags', b);
  deleteFlag = (id: number) => this.call('DELETE', `/api/admin/flags/${id}`);
  adminKids = (day: string) => this.call<{ pinSet: boolean; kids: { userId: number; displayName: string; rules: KidRules; usedSeconds: number }[] }>('GET', `/api/admin/kids?day=${day}`);
  setKidRules = (userId: number, rules: Partial<KidRules>) => this.call<{ rules: KidRules }>('PUT', `/api/admin/kids/${userId}`, rules);
  setKidPin = (pin: string | null) => this.call<{ pinSet: boolean }>('PUT', '/api/admin/kid-pin', { pin });
  // AI DJ
  djStatus = () => this.call<HubDjStatus>('GET', '/api/dj');
  djChats = () => this.call<{ chats: HubDjChat[]; spent: number; limit: number | null }>('GET', '/api/dj/chats');
  djChat = (id: number) => this.call<{ chat: HubDjChat; messages: HubDjEntry[]; calls: HubDjCall[] | null; full: boolean }>('GET', `/api/dj/chats/${id}`);
  djDeleteChat = (id: number) => this.call('DELETE', `/api/dj/chats/${id}`);
  djSend = (chatId: number | null, message: string) => this.call<HubDjTurn>('POST', '/api/dj/chat', { chatId: chatId ?? undefined, message });
  djToolResults = (chatId: number, results: { id: string; content: string; isError?: boolean }[]) => this.call<HubDjTurn>('POST', `/api/dj/chats/${chatId}/tools`, { results });
  djAdmin = () => this.call<HubDjAdmin>('GET', '/api/admin/dj');
  /** `apiKey`: a new key, '' to remove it, left out to keep it. */
  saveDjAdmin = (b: Partial<HubDjSettings> & { apiKey?: string }) => this.call<HubDjAdmin>('PUT', '/api/admin/dj', b);
  setDjAccess = (userId: number, b: { enabled?: boolean; monthlyLimit?: number | null }) => this.call('PUT', `/api/admin/dj/users/${userId}`, b);
  testDj = () => this.call<{ message: string }>('POST', '/api/admin/dj/test', {});
  audit = (limit = 50) => this.call<{ entries: HubAuditEntry[] }>('GET', `/api/admin/audit?limit=${limit}`);
}
