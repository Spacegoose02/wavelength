import { useMemo, useState } from 'react';
import { findDuplicates, missingAlbums } from '../lib/libraryCare';
import type { Release } from '../sources/releaseRadar';
import type { Album } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient, useCan } from '../store/hub';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Cover, Spinner } from '../components/common';
import { ReleaseCards } from '../components/ReleaseRadar';

/** Library → Library care: duplicates and missing albums (lib/libraryCare.ts). */
export function LibraryCare() {
  const [tab, setTab] = useState<'duplicates' | 'missing'>('duplicates');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Library care</h1>
        <span className="chips inline">
          <button className={`chip ${tab === 'duplicates' ? 'on' : ''}`} onClick={() => setTab('duplicates')}>Duplicates</button>
          <button className={`chip ${tab === 'missing' ? 'on' : ''}`} onClick={() => setTab('missing')}>Missing albums</button>
        </span>
      </header>
      {tab === 'duplicates' ? <Duplicates /> : <Missing />}
    </div>
  );
}

function Duplicates() {
  const albums = useCatalog((s) => s.albums);
  const loaded = useCatalog((s) => s.loaded);
  const canDelete = useCan('library.edit');
  const sources = useSettings((s) => s.sources);
  const cfgOf = (id: string) => sources.find((s) => s.id === id);
  const groups = useMemo(() => findDuplicates(albums), [albums]);
  const [gone, setGone] = useState<Record<string, string>>({});

  const remove = async (a: Album) => {
    if (!confirm(`Delete this copy of ${a.title} (${a.trackCount ?? '?'} songs) from your server?\n\nIts files go to the Hub's trash; Settings → Server → Deleted albums can put it back for 30 days.`)) return;
    setGone((g) => ({ ...g, [a.id]: '…' }));
    try {
      const r = await hubClient()!.deleteAlbum(a.id);
      setGone((g) => ({ ...g, [a.id]: `Deleted (${r.files} songs)` }));
    } catch (e) {
      setGone((g) => ({ ...g, [a.id]: String((e as Error).message ?? e) }));
    }
  };

  if (!loaded) return <Spinner />;
  if (!groups.length) return <p className="muted">No duplicates: every album is in your library once per server. (Explicit and clean versions of an album don't count.)</p>;
  return (
    <>
      <p className="muted small">{groups.length} album{groups.length === 1 ? '' : 's'} you have more than once on the same server, counting editions like “Deluxe” as the same album. The copy with the most songs is first.{canDelete ? ' Delete the copies you don’t want; they go to the Hub’s trash for 30 days.' : ' A Hub admin can delete the extra copies.'}</p>
      {groups.map((g) => (
        <section key={g.key} className="dup-group">
          <h3>{g.artist} · {g.title}</h3>
          {g.copies.map((a, i) => (
            <div key={a.id} className={`source-row ${gone[a.id]?.startsWith('Deleted') ? 'off' : ''}`}>
              <Cover src={a.coverUrl} alt={a.title} />
              <div className="track-main">
                <button className="link track-title" onClick={() => useUi.getState().go({ view: 'album', album: a })}>{a.title}</button>
                <div className="track-sub">
                  {a.trackCount ?? '?'} songs{a.year ? ` · ${a.year}` : ''}{a.addedAt ? ` · added ${new Date(a.addedAt).toLocaleDateString()}` : ''} · {cfgOf(a.sourceId)?.name ?? a.sourceId}{i === 0 ? ' · most complete' : ''}
                </div>
              </div>
              {gone[a.id] ? <span className="muted small">{gone[a.id]}</span>
                : canDelete && cfgOf(a.sourceId)?.kind === 'navidrome' && <button className="btn small ghost" onClick={() => void remove(a)}>Delete</button>}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function Missing() {
  const albums = useCatalog((s) => s.albums);
  const [list, setList] = useState<Release[]>();
  const [progress, setProgress] = useState<string>();
  const [artist, setArtist] = useState<string>();

  const run = async () => {
    setList(undefined);
    setProgress('Looking up your artists…');
    try {
      setList(await missingAlbums(albums, 40, (d, t) => setProgress(`Checked ${d} of ${t} artists…`)));
    } catch (e) {
      setProgress(String((e as Error).message ?? e));
    }
  };

  const byArtist = useMemo(() => {
    const m = new Map<string, Release[]>();
    for (const r of list ?? []) m.set(r.artist, [...(m.get(r.artist) ?? []), r]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [list]);

  if (!list) {
    return (
      <>
        <p className="muted">For the 40 artists you have the most albums by, Deezer's list of their studio albums is compared with yours. Live albums, compilations and remix albums are left out.</p>
        {progress ? <div className="row gap muted small"><Spinner /> {progress}</div> : <button className="btn primary" disabled={!albums.length} onClick={() => void run()}>Find missing albums</button>}
      </>
    );
  }
  if (!list.length) return <p className="muted">You have every studio album by your top artists. <button className="link" onClick={() => void run()}>Check again</button></p>;
  return (
    <>
      <div className="row gap muted small">
        {list.length} albums by {byArtist.length} artists
        <span className="chips inline">
          <button className={`chip ${!artist ? 'on' : ''}`} onClick={() => setArtist(undefined)}>All</button>
          {byArtist.slice(0, 12).map(([a, l]) => <button key={a} className={`chip ${artist === a ? 'on' : ''}`} onClick={() => setArtist(a)}>{a} ({l.length})</button>)}
        </span>
        <button className="link small" onClick={() => void run()}>Check again</button>
      </div>
      <ReleaseCards releases={artist ? list.filter((r) => r.artist === artist) : list} />
    </>
  );
}
