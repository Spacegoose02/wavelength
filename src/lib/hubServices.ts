import type { HubService, HubServiceInput, HubServiceKind } from '../sources/hub';
import type { SourceConfig, SourceKind } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useSettings } from '../store/settings';

/**
 * Server logins kept by the signed-in Wavelength Hub (docs/HUB.md "Server logins").
 *
 * The Hub decides which servers and logins each person gets: Plex, Audiobookshelf and SUB/WAVE show up
 * in Sources marked as from the Hub; deemix and the yt-dlp folder login only reach people allowed to
 * download (admins, and members with Autodownload). Navidrome logins stay on each device.
 */

export const HUB_SOURCE_KINDS: SourceKind[] = ['plex', 'audiobookshelf', 'subwave'];
const isSourceKind = (k: HubServiceKind): k is SourceKind & HubServiceKind => (HUB_SOURCE_KINDS as string[]).includes(k);

/** Ask the Hub what this device may use now. Throws when the Hub can't be reached. */
export async function loadHubServices() {
  const c = hubClient();
  if (!c) return;
  const { services } = await c.services();
  useHub.setState({ services });
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

function toSource(s: HubService, keep?: SourceConfig): SourceConfig {
  return {
    id: keep?.id ?? `hub-${s.id}`,
    hubId: s.id,
    kind: s.kind as SourceKind,
    name: s.name,
    url: s.url,
    username: str(s.secrets.username),
    password: str(s.secrets.password),
    token: str(s.secrets.token),
    streamUrl: str(s.config.streamUrl),
    apiUrl: str(s.config.apiUrl),
    nowPlayingUrl: str(s.config.nowPlayingUrl),
    // switching a Hub server off is a per-device choice
    enabled: keep?.enabled ?? true,
  };
}

/**
 * Write the Hub's servers into Settings. `prev` is what the Hub handed over last time, so a download
 * login that the Hub took away (Autodownload turned off, signed out) is wiped from this device too.
 */
export function applyHubServices(next: HubService[], prev: HubService[]) {
  const st = useSettings.getState();
  const { token, permissions } = useHub.getState();
  const byId = new Map(next.filter((s) => isSourceKind(s.kind)).map((s) => [s.id, s]));

  // keep each Hub server where it is in the list (and its local id, so downloads still match it)
  const sources: SourceConfig[] = [];
  for (const s of st.sources) {
    if (s.hubId === undefined) sources.push(s);
    else if (byId.has(s.hubId)) {
      sources.push(toSource(byId.get(s.hubId)!, s));
      byId.delete(s.hubId);
    }
  }
  for (const s of byId.values()) sources.push(toSource(s));

  const had = (k: HubServiceKind) => prev.some((s) => s.kind === k);
  // signed in without permission to download: no download logins on this device, whoever typed them
  const wipe = (k: HubServiceKind) => had(k) || (!!token && !permissions.includes('downloads.run'));

  let deemix = st.deemix;
  const dm = next.find((s) => s.kind === 'deemix');
  if (dm) deemix = { url: dm.url, arl: str(dm.secrets.arl) ?? '', bitrate: Number(dm.config.bitrate) || st.deemix.bitrate };
  else if (wipe('deemix')) deemix = { ...st.deemix, url: '', arl: '' };

  let ytdlp = st.ytdlp;
  const yt = next.find((s) => s.kind === 'ytdlp');
  // the yt-dlp.exe path is about this computer, so it always stays local
  if (yt) ytdlp = { ...st.ytdlp, outDir: str(yt.config.outDir) ?? '', format: str(yt.config.format) ?? st.ytdlp.format, shareUser: str(yt.secrets.shareUser) ?? '', sharePass: str(yt.secrets.sharePass) ?? '' };
  else if (wipe('ytdlp')) ytdlp = { ...st.ytdlp, outDir: '', shareUser: '', sharePass: '' };

  const same = JSON.stringify([sources, deemix, ytdlp]) === JSON.stringify([st.sources, st.deemix, st.ytdlp]);
  if (!same) useSettings.setState({ sources, deemix, ytdlp });
}

/** The Hub keeps this kind of login for the household (Navidrome logins stay on each device). */
export const hubKeeps = (kind: SourceKind) => HUB_SOURCE_KINDS.includes(kind);

/** Hub fields for a source being saved from Settings → Sources. Empty fields clear the saved login. */
export function sourceToHub(s: SourceConfig) {
  const secrets: Record<string, string | null> = { token: s.token || null };
  const config: Record<string, string | null> = {};
  if (s.kind === 'subwave') {
    secrets.username = s.username || null;
    secrets.password = s.password || null;
    config.streamUrl = s.streamUrl || null;
    config.apiUrl = s.apiUrl || null;
    config.nowPlayingUrl = s.nowPlayingUrl || null;
  }
  return { kind: s.kind as HubServiceKind, name: s.name, url: s.url, secrets, config };
}

/**
 * Save a source to the Hub (new or existing) and keep its place and id on this device, so downloads and
 * the source order carry over. Returns the Hub's id for it.
 */
export async function saveSourceToHub(s: SourceConfig, access?: 'everyone' | 'admins' | 'chosen'): Promise<number> {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub first');
  const body = sourceToHub(s);
  const { service } = s.hubId !== undefined
    ? await c.updateService(s.hubId, { ...body, kind: undefined, ...(access && { access }) })
    : await c.createService({ ...body, access: access ?? 'everyone' });
  // mark the local copy as the Hub's before the fetch, so it's updated in place rather than added again
  useSettings.getState().upsertSource({ ...s, hubId: service.id });
  await loadHubServices();
  return service.id;
}

/** Save this device's deemix or yt-dlp settings as the Hub's. */
export async function saveDownloaderToHub(kind: 'deemix' | 'ytdlp') {
  const c = hubClient();
  if (!c) throw new Error('Sign in to your Hub first');
  const { deemix, ytdlp } = useSettings.getState();
  const body: HubServiceInput = kind === 'deemix'
    ? { name: 'deemix', url: deemix.url, config: { bitrate: deemix.bitrate }, secrets: { arl: deemix.arl || null } }
    : { name: 'yt-dlp', url: '', config: { outDir: ytdlp.outDir || null, format: ytdlp.format }, secrets: { shareUser: ytdlp.shareUser || null, sharePass: ytdlp.sharePass || null } };
  const existing = useHub.getState().services.find((s) => s.kind === kind);
  if (existing) await c.updateService(existing.id, body);
  else await c.createService({ kind, ...body });
  await loadHubServices();
}
