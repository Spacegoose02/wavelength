import { useEffect, useState } from 'react';
import { useIsKid } from '../lib/kids';
import { maskForKids } from '../lib/lyrics';
import { forgetSearches, hubSearch, recentSearches, rememberSearch } from '../lib/hubSearch';
import { mergeAlbums, mergeArtists, sourceFor } from '../sources/registry';
import { radioBrowser, stationToTrack } from '../sources/radio';
import type { SearchResults, Track } from '../sources/types';
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
  const [didYouMean, setDidYouMean] = useState<string>();
  const [lyricHits, setLyricHits] = useState<{ track: Track; line: string }[]>([]);
  const [recent, setRecent] = useState(recentSearches);
  const go = useUi((s) => s.go);
  const playTracks = usePlayer((s) => s.playTracks);
  const kid = useIsKid();

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(EMPTY);
      setLyricHits([]);
      setBusy(false); // a search still running for the old text is dropped
      return;
    }
    let alive = true;
    const h = window.setTimeout(async () => {
      setBusy(true);
      setDidYouMean(undefined);
      setLyricHits([]);
      const sources = enabledSources();
      // The Hub answers for its own Navidrome (typo-tolerant, ranked by your plays); every other server and the
      // radio directory are asked at the same time. The Navidrome the Hub covers isn't asked again.
      const viaHub = hubSearch(q, sources);
      const ask = (cfg: (typeof sources)[number]) => sourceFor(cfg).search?.(q).catch(() => ({})) ?? Promise.resolve({});
      const parts = await Promise.all([
        ...sources.filter((c) => c.kind !== 'navidrome').map(ask),
        viaHub.then(async (h) => {
          const left = sources.filter((c) => c.kind === 'navidrome' && c.id !== h?.sourceId);
          return [h?.results ?? {}, ...(await Promise.all(left.map(ask)))];
        }),
        radioBrowser.search(q).then((stations) => ({ stations: stations.slice(0, 12) })).catch(() => ({})),
      ]);
      if (!alive) return;
      const all = parts.flat() as Partial<SearchResults>[];
      const hub = await viaHub;
      const next: SearchResults = {
        artists: mergeArtists(all.map((p) => p.artists ?? [])),
        albums: mergeAlbums(all.map((p) => p.albums ?? [])),
        tracks: all.flatMap((p) => p.tracks ?? []).slice(0, 80),
        books: all.flatMap((p) => p.books ?? []),
        podcasts: all.flatMap((p) => p.podcasts ?? []),
        stations: all.flatMap((p) => p.stations ?? []),
      };
      setRes(next);
      setDidYouMean(hub?.didYouMean);
      setLyricHits(hub?.lyrics ?? []);
      if (next.artists.length || next.albums.length || next.tracks.length) setRecent(rememberSearch(q));
      setBusy(false);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [q]);

  const nothing = !busy && q.length >= 2 && Object.values(res).every((l) => !l.length) && !lyricHits.length;
  return (
    <div className="page">
      <header className="page-head">
        <input autoFocus className="search-big" placeholder="Search artists, albums, tracks, audiobooks, stations…" value={q} onChange={(e) => setQ(e.target.value)} />
        {busy && <Spinner />}
      </header>
      {!q.trim() && recent.length > 0 && (
        <section className="recent-searches">
          <h2>Recent searches <button className="link" onClick={() => { forgetSearches(); setRecent([]); }}>Clear</button></h2>
          <div className="shelf">{recent.map((r) => <button key={r} className="chip" onClick={() => setQ(r)}>{r}</button>)}</div>
        </section>
      )}
      {didYouMean && didYouMean !== q.trim().toLowerCase() && (
        <p className="muted did-you-mean">Showing results for <button className="link" onClick={() => setQ(didYouMean)}>{didYouMean}</button></p>
      )}
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
      {lyricHits.length > 0 && (
        <section>
          <h2>In the lyrics</h2>
          {lyricHits.map((h) => (
            <button key={`${h.track.sourceId}:${h.track.id}`} className="lyric-hit" onClick={() => playTracks([h.track])}>
              <Cover src={h.track.coverUrl} alt={h.track.album ?? h.track.title} className="tiny" />
              <span className="lyric-hit-main">
                <span className="track-title">{h.track.title} <span className="muted">· {h.track.artist}</span></span>
                <span className="lyric-hit-line">“{kid ? maskForKids(h.line) : h.line}”</span>
              </span>
            </button>
          ))}
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
