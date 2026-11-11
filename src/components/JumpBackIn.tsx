import { useMemo } from 'react';
import { useFeature } from '../lib/features';
import { kidSafe } from '../lib/kids';
import type { Album } from '../sources/types';
import { useLibrary } from '../store/library';
import { useUi } from '../store/ui';
import { useHub } from '../store/hub';
import { AlbumCard } from './common';

/**
 * Home → Jump back in: the albums played most recently on this device (and, with a Hub, the others: the play
 * history syncs), newest first. Part of the Home page that comes with Made for you mixes.
 */
export function JumpBackIn() {
  // without a Hub it's always there; with one it comes and goes with the Home mixes switch
  const mixesOn = useFeature('homeMixes');
  const hasHub = useHub((s) => !!s.token);
  const on = mixesOn || !hasHub;
  const history = useLibrary((s) => s.history);
  const go = useUi((s) => s.go);
  const albums = useMemo(() => {
    const out: Album[] = [];
    const seen = new Set<string>();
    for (const p of history) {
      const t = p.track;
      if (t.kind !== 'track' || !t.albumId || !t.album) continue;
      if (!kidSafe([t]).length) continue;
      const k = `${t.sourceId}:${t.albumId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ id: t.albumId, sourceId: t.sourceId, title: t.album, artist: t.artist, coverUrl: t.coverUrl });
      if (out.length >= 12) break;
    }
    return out;
  }, [history]);
  if (!on || albums.length < 2) return null;
  return (
    <section>
      <h2>Jump back in</h2>
      <div className="row-scroll">
        {albums.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={(album) => go({ view: 'album', album: { ...album, refs: [album] } })} />)}
      </div>
    </section>
  );
}
