import type { SourceConfig } from '../sources/types';

/** Sources that list albums and artists (Audiobookshelf and SUB/WAVE don't). */
export const isMusicSource = (s: SourceConfig) => s.kind === 'navidrome' || s.kind === 'plex';

/** Whether switching `s` off leaves no music source on, so Albums, Artists and Songs go empty. */
export function isLastMusicSource(sources: SourceConfig[], s: SourceConfig): boolean {
  return isMusicSource(s) && s.enabled && !sources.some((x) => x.id !== s.id && x.enabled && isMusicSource(x));
}

/** The confirm shown before switching off the last music source. */
export function lastMusicSourceWarning(s: SourceConfig): string {
  const viaHub = s.kind === 'navidrome' && /\/nd\/[^/]+\/?$/.test(s.url);
  return `Switch off ${s.name}? It's your only music source, so Albums, Artists and Songs will be empty until you switch it back on.`
    + (viaHub ? `\n\nThis one is your library through the Hub, even with Navidrome off on the Hub.` : '');
}
