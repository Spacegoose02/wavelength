/**
 * Streaming quality (docs/USER-GUIDE.md "Streaming quality"): on mobile data, ask Navidrome for a smaller file
 * instead of the original FLAC (about 30–40 MB a song). Navidrome converts it on the fly. Wi-Fi and mobile data
 * each have their own setting, per device. Downloads, bit-perfect output and speakers always get the original.
 */
import { isIOS, isMac } from './platform';

export type StreamQuality = 'original' | 'high' | 'normal' | 'low';

export const QUALITIES: { value: StreamQuality; label: string; kbps?: number; note: string }[] = [
  { value: 'original', label: 'Original', note: 'the file as it is (FLAC: about 35 MB a song)' },
  { value: 'high', label: 'High', kbps: 320, note: '320 kbps, about 9 MB a song' },
  { value: 'normal', label: 'Normal', kbps: 160, note: '160 kbps, about 5 MB a song' },
  { value: 'low', label: 'Data saver', kbps: 96, note: '96 kbps, about 3 MB a song' },
];

/** Whether the device says it's on mobile data (or has Data Saver on). Android's WebView knows; desktops don't say. */
export function onMobileData(): boolean {
  const c = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { connection?: { type?: string; saveData?: boolean } }) | undefined;
  return c?.connection?.type === 'cellular' || !!c?.connection?.saveData;
}

/** Opus is smaller for the same sound, but Apple's WebView only plays MP3 reliably. */
const format = (apple: boolean) => (apple ? 'mp3' : 'opus');

/**
 * A Navidrome (Subsonic) stream link at `quality`. Other links, and links that already ask for a format, are left
 * as they are.
 */
export function withQuality(url: string, quality: StreamQuality, apple = isMac || isIOS): string {
  const q = QUALITIES.find((x) => x.value === quality);
  if (!q?.kbps || !/\/rest\/stream(\.view)?\?/.test(url) || /[?&](format|maxBitRate)=/.test(url)) return url;
  return `${url}&maxBitRate=${q.kbps}&format=${format(apple)}`;
}
