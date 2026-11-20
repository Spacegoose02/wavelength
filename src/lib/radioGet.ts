import type { DeemixItem } from './deemixQueue';

/**
 * Following a song sent from a radio station's **Get this song** (components/RadioGetButton.tsx) until it's in the
 * library: deemix's queue says how the download is going, and the library is checked again until the song shows up
 * (Navidrome only sees it after its next scan).
 */

export interface RadioSent {
  via: 'request' | 'deemix' | 'yt-dlp';
  /** The Deezer link it sent, when it went to deemix or was requested. */
  link?: string;
  at: number;
}

export interface RadioGetStatus {
  label: string;
  /** Longer words for the tooltip. */
  detail?: string;
  /** busy: still going; done: downloaded, waiting for the library; error: click to try again. */
  kind: 'busy' | 'done' | 'error';
}

/** How long a sent song may be missing from deemix's queue before it counts as lost. */
export const LOST_MS = 2 * 60_000;

/** The Deezer track id in a link such as https://www.deezer.com/en/track/123. */
export function deezerTrackId(link: string | undefined): string | undefined {
  return /deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/(\d+)/i.exec(link ?? '')?.[1];
}

/** What the button says about a song it sent. `read`: deemix's queue has been read, so "not there" means something. */
export function radioGetStatus(sent: RadioSent, items: DeemixItem[], read: boolean, now = Date.now()): RadioGetStatus {
  if (sent.via === 'request') return { label: 'Requested', detail: 'Sent to your Hub admin. It shows in the Inbox once it’s in your library', kind: 'done' };
  if (sent.via === 'yt-dlp') return { label: 'Downloading', detail: 'Getting it with yt-dlp (see Downloads)', kind: 'busy' };
  const id = deezerTrackId(sent.link);
  const item = id ? items.find((i) => i.type === 'track' && i.id === id) : undefined;
  if (item) {
    const why = item.errors[0]?.message;
    if (item.stalled) return { label: 'Stuck · try again', detail: 'deemix has stopped moving on it (see Downloads)', kind: 'error' };
    switch (item.status) {
      case 'inQueue': return { label: item.position && item.position > 1 ? `Waiting · ${item.position} in line` : 'Waiting', detail: 'In deemix’s queue', kind: 'busy' };
      case 'downloading': return { label: `Downloading ${Math.round(item.progress)}%`, kind: 'busy' };
      case 'completed': return { label: 'Adding to library', detail: 'Downloaded. It plays from your library after your server’s next scan', kind: 'done' };
      case 'withErrors':
      case 'failed': return { label: 'Failed · try again', detail: why ? `deemix couldn’t get it: ${why}` : 'deemix couldn’t get it', kind: 'error' };
    }
  }
  if (read && id && now - sent.at > LOST_MS) return { label: 'Sent to deemix', detail: 'It isn’t in deemix’s queue any more. It may already be in your library, or the list was cleared', kind: 'done' };
  return { label: 'Sent to deemix', kind: 'busy' };
}
