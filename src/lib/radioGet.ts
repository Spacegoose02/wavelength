import { create } from 'zustand';
import { songKey } from '../sources/charts';
import type { DeemixItem } from './deemixQueue';
import { NotOnDeezer, sendSong, type Wanted } from './getSong';

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

// ---- songs sent from a DJ station's "songs you don't have" list (components/DjStation.tsx) ----

export interface SongSend {
  sending?: boolean;
  sent?: RadioSent;
  error?: string;
  notOnDeezer?: boolean;
}

/**
 * What was sent from the DJ's list, by song (sources/charts.ts songKey). Kept outside the panel, so folding it away,
 * closing it or the next segment doesn't forget a song was sent and offer Get again as if nothing happened.
 */
export const useSongSends = create<{ songs: Record<string, SongSend> }>()(() => ({ songs: {} }));

const setSend = (k: string, s: SongSend) => useSongSends.setState((st) => ({ songs: { ...st.songs, [k]: s } }));

/** Send one song (lib/getSong.ts sendSong). Never throws: the outcome is in useSongSends. */
export async function sendOne(e: Wanted): Promise<boolean> {
  const k = songKey(e);
  setSend(k, { sending: true });
  try {
    const r = await sendSong(e);
    setSend(k, { sent: { ...r, at: Date.now() } });
    return true;
  } catch (err) {
    setSend(k, { error: String((err as Error)?.message ?? err).slice(0, 120), notOnDeezer: err instanceof NotOnDeezer });
    return false;
  }
}

/** What a row says for a song, and whether Get (again) can be pressed. */
export function songSendStatus(s: SongSend | undefined, items: DeemixItem[], read: boolean, now = Date.now()): RadioGetStatus & { canGet: boolean } {
  if (!s) return { label: '', kind: 'busy', canGet: true };
  if (s.sending) return { label: 'Sending…', kind: 'busy', canGet: false };
  if (s.error) return { label: s.notOnDeezer ? 'Not on Deezer' : 'Failed · try again', detail: s.error, kind: 'error', canGet: !s.notOnDeezer };
  const st = radioGetStatus(s.sent!, items, read, now);
  return { ...st, canGet: st.kind === 'error' };
}
