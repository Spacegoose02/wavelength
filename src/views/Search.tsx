import { useEffect, useState } from 'react';
import { mergeAlbums, mergeArtists, sourceFor } from '../sources/registry';
import { radioBrowser, stationToTrack } from '../sources/radio';
import type { SearchResults } from '../sources/types';
import { enabledSources } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { AlbumCard, ArtistCard, Cover, Empty, Spinner, TrackList } from '../components/common';
import { BookCard } from './Books';
import { PodcastCard } from './Podcasts';

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [], stations: [], books: [], podcasts: [] };

/** One search box across every source: library, audiobooks and radio. */
export function Search({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? '');
  const [res, setRes] = useState<SearchResults>(EMPTY);
  const [busy, setBusy] = useState(false);
  const go = useUi((s) => s.go);
  const playTracks = usePlayer((s) => s.playTracks);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(EMPTY);
      setBusy(false); // a search still running for the old text is dropped
      return;
    }
    let alive = true;
    const h = window.setTimeout(async () => {
      setBusy(true);
      const parts = await Promise.all([
        ...enabledSources().map((cfg) => sourceFor(cfg).search?.(q).catch(() => ({})) ?? Promise.resolve({})),
        radioBrowser.search(q).then((stations) => ({ stations: stations.slice(0, 12) })).catch(() => ({})),
      ]);
      if (!alive) return;
      const all = parts as Partial<SearchResults>[];
      setRes({
        artists: mergeArtists(all.map((p) => p.artists ?? [])),
        albums: mergeAlbums(all.map((p) => p.albums ?? [])),
        tracks: all.flatMap((p) => p.tracks ?? []).slice(0, 80),
        books: all.flatMap((p) => p.books ?? []),
        podcasts: all.flatMap((p) => p.podcasts ?? []),
        stations: all.flatMap((p) => p.stations ?? []),
      });
      setBusy(false);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [q]);

  const nothing = !busy && q.length >= 2 && Object.values(res).every((l) => !l.length);
  return (
    <div className="page">
      <header className="page-head">
        <input autoFocus className="search-big" placeholder="Search artists, albums, tracks, audiobooks, stations…" value={q} onChange={(e) => setQ(e.target.value)} />
        {busy && <Spinner />}
      </header>
      {nothing && <Empty title="Nothing found">Not in your library? Try the Downloads tab to grab it with deemix.</Empty>}
      {res.artists.length > 0 && (
        <section>
          <h2>Artists</h2>
          <div className="row-scroll">
            {res.artists.map((a) => <ArtistCard key={`${a.sourceId}:${a.id}`} artist={a} onOpen={(artist) => go({ view: 'artist', artist })} />)}
          </div>
        </section>
      )}
      {res.albums.length > 0 && (
        <section>
          <h2>Albums</h2>
          <div className="row-scroll">{res.albums.map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={(album) => go({ view: 'album', album })} />)}</div>
        </section>
      )}
      {res.tracks.length > 0 && (
        <section>
          <h2>Tracks</h2>
          <TrackList tracks={res.tracks} showAlbum showCover />
        </section>
      )}
      {res.books.length > 0 && (
        <section>
          <h2>Audiobooks</h2>
          <div className="row-scroll">{res.books.map((b) => <BookCard key={b.id} book={b} />)}</div>
        </section>
      )}
      {res.podcasts.length > 0 && (
        <section>
          <h2>Podcasts</h2>
          <div className="row-scroll">{res.podcasts.map((p) => <PodcastCard key={p.id} podcast={p} />)}</div>
        </section>
      )}
      {res.stations.length > 0 && (
        <section>
          <h2>Radio</h2>
          <div className="shelf">
            {res.stations.map((s) => (
              <button key={s.id} className="station-pill" onClick={() => playTracks([stationToTrack(s)])}>
                <Cover src={s.favicon} alt={s.name} className="tiny" /> {s.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
