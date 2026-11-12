import type { SourceConfig } from '../sources/types';
import { useSettings } from '../store/settings';

/**
 * What the app calls the household's music server in its words.
 *
 * With Navidrome off on the Hub (docs/HUB.md "Without Navidrome") the Hub scans, plays and keeps the playlists itself,
 * so "Navidrome" would be wrong: the Hub hands its login out marked `hubServed` and the app says "the Hub" instead.
 * Turn Navidrome back on and the mark goes, so everything says Navidrome again and the two are never mixed up.
 */

/** The server's name shown for a Hub login: the Hub's own default name "Navidrome" becomes "Hub" while the Hub serves. */
export function hubSourceName(name: string, hubServed: boolean | undefined): string {
  return hubServed && /^\s*navidrome\s*$/i.test(name) ? 'Hub' : name;
}

/** Whether the library server this device uses is the Hub itself (Navidrome off). */
export const hubServesLibrary = (sources: SourceConfig[]) =>
  sources.some((s) => s.enabled && s.kind === 'navidrome' && s.hubServed);

/** "the Hub" or "Navidrome", for use mid-sentence. */
export const libraryServer = (sources: SourceConfig[] = useSettings.getState().sources) =>
  (hubServesLibrary(sources) ? 'the Hub' : 'Navidrome');

/** "The Hub" or "Navidrome", for the start of a sentence. */
export const LibraryServer = (sources?: SourceConfig[]) => {
  const s = libraryServer(sources);
  return s[0].toUpperCase() + s.slice(1);
};

/** "the Hub's" or "Navidrome's". */
export const libraryServers = (sources?: SourceConfig[]) => `${libraryServer(sources)}'s`;
