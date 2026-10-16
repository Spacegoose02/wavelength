import { useEffect, useMemo, useState } from 'react';
import { sourceFor } from '../sources/registry';
import type { Album } from '../sources/types';
import { SOURCE_COLORS } from '../sources/types';
import { enabledSources, useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { AlbumCard, Empty, Grid, Spinner } from '../components/common';
import { IconRefresh } from '../components/Icons';

const BUCKETS: [string, number][] = [
  ['Today', 1],
  ['This week', 7],
  ['This month', 31],
  ['Last 3 months', 92],
  ['Earlier', Infinity],
];

export function RecentlyAdded() {
  const sources = useSettings((s) => s.sources);
  const [albums, setAlbums] = useState<Album[]>();
  const [only, setOnly] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setAlbums(undefined);
    Promise.all(enabledSources().map((cfg) => sourceFor(cfg).getRecentAlbums?.(150).catch(() => []) ?? Promise.resolve([] as Album[])))
      .then((lists) => setAlbums(lists.flat().sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))));
  }, [nonce]);

  const groups = useMemo(() => {
    const now = Date.now();
    const shown = (albums ?? []).filter((a) => !only || a.sourceId === only);
    return BUCKETS.map(([label, days], i) => {
      const lo = i ? BUCKETS[i - 1][1] : 0;
      return {
        label,
        items: shown.filter((a) => {
          const age = a.addedAt ? (now - a.addedAt) / 86_400_000 : Infinity;
          return age >= lo && age < days;
        }),
      };
    }).filter((g) => g.items.length);
  }, [albums, only]);

  const musicSources = sources.filter((s) => s.enabled && (s.kind === 'navidrome' || s.kind === 'plex'));
  return (
    <div className="page">
      <header className="page-head">
        <h1>Recently added</h1>
        <button className="btn small" onClick={() => setNonce(nonce + 1)}><IconRefresh /> Refresh</button>
      </header>
      {musicSources.length > 1 && (
        <div className="chips">
          <button className={`chip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>All</button>
          {musicSources.map((s) => (
            <button key={s.id} className={`chip ${only === s.id ? 'on' : ''}`} onClick={() => setOnly(s.id)}>
              <i className="dot" style={{ background: SOURCE_COLORS[s.kind] }} /> {s.name}
            </button>
          ))}
        </div>
      )}
      {!albums ? <Spinner /> : !groups.length ? <Empty title="Nothing new" /> : groups.map((g) => (
        <section key={g.label}>
          <h2>{g.label} <small className="muted">{g.items.length}</small></h2>
          <Grid>{g.items.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={(album) => useUi.getState().go({ view: 'album', album })} />)}</Grid>
        </section>
      ))}
    </div>
  );
}
