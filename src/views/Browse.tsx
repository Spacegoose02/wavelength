import { useMemo, useState } from 'react';
import { AlbumCard, ArtistCard, Empty, Grid, Spinner } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { ALBUM_SORTS, decadeCounts, decadeLabel, findGenre, genreKey, genreTree, queryAlbums, queryArtists, sample, type AlbumSort, type GenreNode } from '../lib/browse';
import { useHidden } from '../lib/kids';
import { sourceFor } from '../sources/registry';
import type { Album, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/**
 * Browse (lib/browse.ts): the library by genre and by decade. With neither, tiles for every genre (sub-genres
 * listed on each) and every decade. With one or both, that slice of the library: sub-genre and decade chips to
 * narrow it, Shuffle, the artists in it and its albums.
 */
export function Browse({ genre, decade }: { genre?: string; decade?: number }) {
  const { albums: all, artists, loading } = useCatalog();
  const hidden = useHidden();
  const albums = useMemo(() => all.filter((a) => !hidden.album(a)), [all, hidden]);
  const tree = useMemo(() => genreTree(albums), [albums]);
  if (!albums.length) return loading ? <div className="page"><Spinner /></div> : <div className="page"><Empty title="Nothing to browse yet">Add a Navidrome or Plex server under Settings → Sources.</Empty></div>;
  return genre || decade !== undefined
    ? <Slice albums={albums} artists={artists} tree={tree} genre={genre} decade={decade} />
    : <Landing albums={albums} tree={tree} />;
}

const go = (genre?: string, decade?: number) => useUi.getState().go({ view: 'browse', genre, decade });

/** A colour per genre that stays the same everywhere. */
function hue(name: string) {
  let h = 0;
  for (const c of genreKey(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function Landing({ albums, tree }: { albums: Album[]; tree: GenreNode[] }) {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState('');
  const decades = useMemo(() => decadeCounts(albums), [albums]);
  const f = genreKey(filter);
  // searching looks in sub-genres too
  const matching = f ? tree.filter((g) => genreKey(g.label).includes(f) || g.subs.some((s) => genreKey(s.label).includes(f))) : tree;
  const shown = all || f ? matching : matching.slice(0, 24);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Browse</h1>
        <input className="filter" placeholder="Find a genre…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {decades.length > 0 && (
        <>
          <h2>Decades</h2>
          <div className="browse-tiles decades">
            {decades.map((d) => (
              <button key={d.decade} className="browse-tile" style={{ '--tile-hue': (d.decade - 1950) * 23 } as React.CSSProperties} onClick={() => go(undefined, d.decade)}>
                <b>{decadeLabel(d.decade)}</b>
                <small>{d.albums} album{d.albums === 1 ? '' : 's'}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <h2>Genres <small className="muted">{tree.length}</small></h2>
      {!tree.length && <p className="muted">Your albums have no genres yet. An admin can fill them in under Settings → Server → Genres.</p>}
      <div className="browse-tiles">
        {shown.map((g) => (
          <div key={g.genre} className="browse-tile" style={{ '--tile-hue': hue(g.genre) } as React.CSSProperties}>
            <button className="browse-tile-main" onClick={() => go(g.genre)}>
              <b>{g.label}</b>
              <small>{g.albums} album{g.albums === 1 ? '' : 's'}</small>
            </button>
            {g.subs.length > 0 && (
              <span className="browse-subs">
                {g.subs.slice(0, 4).map((s) => <button key={s.genre} className="link" onClick={() => go(s.genre)}>{s.label}</button>)}
                {g.subs.length > 4 && <button className="link" onClick={() => go(g.genre)}>+{g.subs.length - 4} more</button>}
              </span>
            )}
          </div>
        ))}
      </div>
      {!all && !f && matching.length > shown.length && (
        <p className="center"><button className="btn" onClick={() => setAll(true)}>Show all {matching.length} genres</button></p>
      )}
    </div>
  );
}

function Slice({ albums, artists, tree, genre, decade }: { albums: Album[]; artists: ReturnType<typeof useCatalog.getState>['artists']; tree: GenreNode[]; genre?: string; decade?: number }) {
  const [sort, setSort] = useState<AlbumSort>(decade !== undefined && !genre ? 'artist' : 'newest');
  const [busy, setBusy] = useState(false);
  const found = genre ? findGenre(tree, genre) : undefined;
  const top = found?.parent ?? found?.node;
  const pick = found?.node.genre ?? genre;
  const shown = useMemo(() => queryAlbums(albums, { genre: pick, decade }, sort), [albums, pick, decade, sort]);
  const inGenre = useMemo(() => (pick ? queryAlbums(albums, { genre: pick }) : albums), [albums, pick]);
  const decades = useMemo(() => decadeCounts(inGenre), [inGenre]);
  // in a decade with no genre picked: the genres of that decade
  const decadeGenres = useMemo(() => (genre ? [] : genreTree(shown).slice(0, 16)), [genre, shown]);
  const people = useMemo(() => queryArtists(artists, albums, { genre: pick, decade }, 'albums').slice(0, 12), [artists, albums, pick, decade]);
  const title = [found?.node.label ?? genre, decade !== undefined ? decadeLabel(decade) : ''].filter(Boolean).join(' · ');

  const play = async (shuffle: boolean) => {
    setBusy(true);
    try {
      const tracks = await tracksOf(shuffle ? sample(shown, 25) : shown.slice(0, 25));
      if (!tracks.length) return alert('No songs found.');
      const list = shuffle ? sample(tracks, 300) : tracks;
      const p = usePlayer.getState();
      if (p.shuffle) p.toggleShuffle();
      p.playTracks(list, 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>
          {found?.parent && <><button className="link" onClick={() => go(found.parent!.genre, decade)}>{found.parent.label}</button> › </>}
          {title} <small>{shown.length}</small>
        </h1>
        <button className="btn primary" disabled={busy || !shown.length} onClick={() => play(true)}><IconShuffle /> Shuffle</button>
        <button className="btn" disabled={busy || !shown.length} onClick={() => play(false)}><IconPlay /> Play</button>
        {busy && <Spinner />}
      </header>
      {top && top.subs.length > 0 && (
        <div className="chips">
          <button className={`chip ${found?.node === top ? 'on' : ''}`} onClick={() => go(top.genre, decade)}>All {top.label}</button>
          {top.subs.map((s) => <button key={s.genre} className={`chip ${found?.node === s ? 'on' : ''}`} onClick={() => go(s.genre, decade)}>{s.label}</button>)}
        </div>
      )}
      {!genre && decadeGenres.length > 0 && (
        <div className="chips">
          {decadeGenres.map((g) => <button key={g.genre} className="chip" onClick={() => go(g.genre, decade)}>{g.label}</button>)}
        </div>
      )}
      {decades.length > 1 && (
        <div className="chips">
          {genre && <button className={`chip ${decade === undefined ? 'on' : ''}`} onClick={() => go(genre)}>Any year</button>}
          {decades.map((d) => (
            <button key={d.decade} className={`chip ${decade === d.decade ? 'on' : ''}`} onClick={() => go(genre, d.decade)}>{decadeLabel(d.decade)}</button>
          ))}
        </div>
      )}
      {people.length > 0 && (
        <>
          <h2>Artists</h2>
          <div className="row-scroll">
            {people.map((a) => <ArtistCard key={`${a.sourceId}:${a.id}`} artist={a} onOpen={(x) => useUi.getState().go({ view: 'artist', artist: x })} />)}
          </div>
        </>
      )}
      <h2 className="row gap">
        Albums
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as AlbumSort)} style={{ marginLeft: 'auto', fontSize: 13 }}>
          {ALBUM_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </h2>
      {!shown.length && <p className="muted">Nothing here.</p>}
      <Grid>{shown.slice(0, 600).map((a) => <AlbumCard key={`${a.sourceId}:${a.id}`} album={a} onOpen={(x) => useUi.getState().go({ view: 'album', album: x })} />)}</Grid>
      {shown.length > 600 && <p className="muted center">Showing 600 of {shown.length}. Pick a decade or sub-genre to narrow it down.</p>}
    </div>
  );
}

async function tracksOf(albums: Album[]): Promise<Track[]> {
  const sources = useSettings.getState().sources;
  const lists = await Promise.all(albums.map(async (a) => {
    const ref = (a.refs ?? [a])[0];
    const cfg = sources.find((s) => s.id === ref.sourceId);
    return cfg ? (await sourceFor(cfg).getAlbumTracks?.(ref.id).catch(() => [])) ?? [] : [];
  }));
  return lists.flat();
}
