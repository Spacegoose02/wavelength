import { HubError } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { setSharedLyrics } from './lyrics';

/**
 * Lyrics through the Hub's shared cache (hub/src/lyricsCache.ts) while a Hub is signed in. An older Hub answers
 * 404, which turns the cache off until the app restarts, so it isn't asked again for every song.
 */
export function enableSharedLyrics() {
  let missing = false;
  const apply = () => {
    const hub = hubClient();
    if (!hub || missing) return setSharedLyrics(undefined);
    setSharedLyrics({
      get: (key) =>
        hub.lyricsGet(key).then(
          (r) => r.lyrics,
          (e) => {
            if (e instanceof HubError && e.status === 404) {
              missing = true;
              setSharedLyrics(undefined);
            }
            return undefined;
          },
        ),
      put: (key, artist, title, lyrics) => void hub.lyricsPut({ key, artist, title, lyrics }).catch(() => undefined),
    });
  };
  apply();
  useHub.subscribe((s, prev) => {
    if (s.token !== prev.token || s.url !== prev.url) apply();
  });
}
