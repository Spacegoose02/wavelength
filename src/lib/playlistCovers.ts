import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { HubError, type HubPlaylistCover } from '../sources/hub';
import type { SourceKind, Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { trackArt } from './artwork';
import { http } from './http';
import { cleanTitle, primaryArtist } from './match';

/**
 * Playlist covers (docs/USER-GUIDE.md "Playlist covers", docs/HUB.md "Playlist covers"). Anyone can pick a
 * picture for a playlist: a Wavelength one, a Navidrome or Plex one, or a household one. Signed in to a Hub,
 * the picture is kept there so it shows on every device (Windows, Android, Android Auto, the web app). With
 * no Hub it stays on this device. With no picture, a Wavelength playlist shows a mosaic of its first four
 * albums and a server playlist shows the server's own cover.
 *
 * Covers are found by key: `wavelength:<id>`, `household:<id>`, `navidrome:<id>` or `plex:<id>`.
 */

/** Pictures are cropped square and made this many pixels wide before they're saved. */
const SIZE = 600;

interface CoverState {
  /** The signed-in Hub's covers, kept so they still show offline. */
  hub: HubPlaylistCover[];
  /** Picked on this device with no Hub: key → `data:` URL. */
  local: Record<string, string>;
}

export const usePlaylistCovers = create<CoverState>()(persist(() => ({ hub: [] as HubPlaylistCover[], local: {} as Record<string, string> }), { name: 'tonearm.playlistCovers' }));

export const wavelengthCoverKey = (id: string) => `wavelength:${id}`;
export const householdCoverKey = (id: number | string) => `household:${id}`;
/** A Navidrome or Plex playlist, by the server kind of the source it came from. */
export function serverCoverKey(p: { sourceId: string; id: string }): string | undefined {
  const kind = useSettings.getState().sources.find((s) => s.id === p.sourceId)?.kind as SourceKind | undefined;
  return kind === 'navidrome' || kind === 'plex' ? `${kind}:${p.id}` : undefined;
}

export async function loadPlaylistCovers() {
  const c = hubClient();
  if (!c) return usePlaylistCovers.setState({ hub: [] });
  try {
    usePlaylistCovers.setState({ hub: (await c.playlistCovers()).covers });
  } catch (e) {
    // a Hub from before playlist covers has none; offline keeps the last list
    if (e instanceof HubError && e.status === 404) usePlaylistCovers.setState({ hub: [] });
  }
}

let started = false;
/** Keep the list fresh: now, when the profile changes, and every ten minutes. */
export function startPlaylistCoverChecks() {
  if (started) return;
  started = true;
  loadPlaylistCovers();
  setInterval(loadPlaylistCovers, 600_000);
  useHub.subscribe((s, prev) => (s.token !== prev.token || s.url !== prev.url) && loadPlaylistCovers());
}

/** The picture picked for this playlist, if any: the Hub's first, then this device's. */
export function playlistCoverOf(key?: string): string | undefined {
  if (!key) return undefined;
  const { hub, local } = usePlaylistCovers.getState();
  const h = hub.find((c) => c.key === key);
  if (h) return `${useHub.getState().url.replace(/\/+$/, '')}${h.url}`;
  return local[key];
}

/** Hook: the picture picked for this playlist, re-rendering when it changes. */
export function usePlaylistCover(key?: string): string | undefined {
  usePlaylistCovers((s) => s.hub);
  usePlaylistCovers((s) => s.local);
  useHub((s) => s.url);
  return playlistCoverOf(key);
}

/** Whether a picture was picked for this playlist (so "Use the automatic cover" makes sense). */
export const hasPlaylistCover = (key: string) => !!playlistCoverOf(key);

/**
 * The default cover of a Wavelength playlist: the first four different albums, one picture each. Songs on
 * the same album count once, however the server names their pictures. Fewer than four: the first one.
 */
export function mosaicOf(tracks: Track[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tracks) {
    const art = trackArt(t);
    if (!art) continue;
    const album = t.kind === 'track' && t.album ? `${primaryArtist(t.artist).toLowerCase()}|${cleanTitle(t.album)}` : art;
    if (seen.has(album) || out.includes(art)) continue;
    seen.add(album);
    out.push(art);
    if (out.length === 4) break;
  }
  return out.length === 4 ? out : out.slice(0, 1);
}

/** Save a picture (a `data:` URL from squareImage) for a playlist: on the Hub when signed in, else here. */
export async function setPlaylistCover(key: string, image: string) {
  const c = hubClient();
  if (c) {
    try {
      const { cover } = await c.setPlaylistCover(key, image);
      usePlaylistCovers.setState((s) => ({ hub: [cover, ...s.hub.filter((x) => x.key !== key)], local: without(s.local, key) }));
      return;
    } catch (e) {
      // an older Hub: keep it on this device instead
      if (!(e instanceof HubError && e.status === 404)) throw e;
    }
  }
  usePlaylistCovers.setState((s) => ({ local: { ...s.local, [key]: image } }));
}

/** Back to the mosaic, or the server's own cover. */
export async function resetPlaylistCover(key: string) {
  const c = hubClient();
  if (c && usePlaylistCovers.getState().hub.some((x) => x.key === key)) {
    await c.deletePlaylistCover(key);
  }
  usePlaylistCovers.setState((s) => ({ hub: s.hub.filter((x) => x.key !== key), local: without(s.local, key) }));
}

/** When a playlist is deleted: drop its picture too, quietly. */
export function forgetPlaylistCover(key: string) {
  if (hasPlaylistCover(key)) resetPlaylistCover(key).catch(() => undefined);
}

function without(o: Record<string, string>, key: string) {
  if (!(key in o)) return o;
  const { [key]: _gone, ...rest } = o;
  return rest;
}

// ---- making the picture ----

/** Crop a picture to the middle square and shrink it to SIZE, as a JPEG `data:` URL. */
export async function squareImage(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That file isn't a picture Wavelength can read"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("That file isn't a picture Wavelength can read");
    const out = Math.min(SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = out;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A picture from a link: an album cover in the playlist, or any image link someone pasted. */
export async function imageFromLink(link: string): Promise<string> {
  if (link.startsWith('data:')) return squareImage(await (await fetch(link)).blob());
  let res: Response;
  try {
    res = await http(link);
  } catch {
    throw new Error("Couldn't download that picture. Save it and use Upload a picture instead.");
  }
  if (!res.ok) throw new Error(`That link didn't send a picture (${res.status})`);
  const blob = await res.blob();
  if (blob.size > 15 * 1024 * 1024) throw new Error('That image is bigger than 15 MB');
  return squareImage(blob);
}
