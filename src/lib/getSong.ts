import { deezerLookup } from '../sources/charts';
import { useDownloads, ytSearch } from '../store/downloads';
import { useHub } from '../store/hub';
import { useSettings } from '../store/settings';
import { deemixClient, hubRuns } from './hubServices';
import { mustRequest, requestMusic } from './inbox';
import { primaryArtist } from './match';
import { isAndroid } from './platform';

/**
 * Get a song the library doesn't have (Discover, playlist import): ask the Hub admin for it without
 * Autodownload, else send it to deemix, with yt-dlp only as a backup for songs Deezer doesn't have. A deemix
 * *failure* (not logged in, unreachable) is shown, not silently swapped for yt-dlp.
 */

export interface Wanted {
  title: string;
  artist: string;
  cover?: string;
  deezerLink?: string;
}

export class NotOnDeezer extends Error {
  constructor() {
    super('Not on Deezer');
  }
}

export const ytdlpAvailable = () => hubRuns('ytdlp') || (!isAndroid && !!useSettings.getState().ytdlp.outDir);

const deezerLinkFor = async (e: Wanted) => e.deezerLink ?? (await deezerLookup(e)).link;

export async function viaYtdlp(e: Wanted): Promise<'yt-dlp'> {
  const [hit] = await ytSearch(`${primaryArtist(e.artist)} - ${e.title} audio`);
  if (!hit) throw new Error('No YouTube match');
  useDownloads.getState().start(hit);
  return 'yt-dlp';
}

/** Returns how it was sent. Throws NotOnDeezer when Deezer doesn't have it and yt-dlp can't stand in. */
export async function getSong(e: Wanted): Promise<'request' | 'deemix' | 'yt-dlp'> {
  if (mustRequest()) {
    const link = await deezerLinkFor(e);
    if (!link) throw new NotOnDeezer();
    await requestMusic({ link, kind: 'track', title: e.title, artist: e.artist, cover: e.cover });
    return 'request';
  }
  const deemix = useSettings.getState().deemix;
  if (!deemix.url) {
    if (ytdlpAvailable()) return viaYtdlp(e);
    const { token, permissions } = useHub.getState();
    throw new Error(token && !permissions.includes('downloads.run') ? 'Ask your Hub admin for Autodownload' : 'Set your deemix URL in Settings');
  }
  const link = await deezerLinkFor(e);
  if (!link) {
    if (ytdlpAvailable()) return viaYtdlp(e);
    throw new NotOnDeezer();
  }
  await deemixClient().addToQueue(link, deemix.bitrate);
  return 'deemix';
}
