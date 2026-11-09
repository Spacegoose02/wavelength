import { useState } from 'react';
import type { BrowseQuery } from '../lib/browse';
import { fromBrowse } from '../lib/smartPlaylists';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/**
 * "Save as smart playlist" on Browse and the Albums filters: the slice on screen ("80s", "Christmas", "Southern Rap ·
 * Reckless") becomes a smart playlist (lib/smartPlaylists.ts) that picks fresh songs from it each time it plays.
 * Smart playlists play from Navidrome, so it shows only with a Navidrome server.
 */
export function SaveSmartButton({ q, name }: { q: BrowseQuery; name: string }) {
  const hasNavidrome = useSettings((s) => s.sources.some((x) => x.enabled && x.kind === 'navidrome'));
  const [saved, setSaved] = useState<string>();
  if (!hasNavidrome) return null;
  const save = () => {
    const n = prompt('Name the smart playlist', name)?.trim();
    if (!n) return;
    useSettings.getState().saveSmartPlaylist(fromBrowse(q, n));
    setSaved(n);
  };
  return saved
    ? <button className="btn ghost" title="Open Playlists to play or change it" onClick={() => useUi.getState().go({ view: 'playlists' })}>Saved “{saved}” ›</button>
    : <button className="btn" title="A playlist that picks fresh songs from this each time it plays" onClick={save}>Save as smart playlist</button>;
}
