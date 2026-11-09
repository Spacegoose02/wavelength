import { useMemo, useState } from 'react';
import { AlbumCard, ArtistCard, Empty, Grid, Spinner } from '../components/common';
import { IconPlay, IconShuffle } from '../components/Icons';
import { ALBUM_SORTS, type BrowseQuery, decadeCounts, decadeLabel, findGenre, genreKey, genreTree, queryAlbums, queryArtists, sample, tagCounts, type AlbumSort, type GenreNode, type TagFacet } from '../lib/browse';
import { useItemTags } from '../lib/itemTags';
import { SaveSmartButton } from '../components/SaveSmartButton';
import { useHidden } from '../lib/kids';
import { sourceFor } from '../sources/registry';
import type { Album, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/** What Browse is showing: any mix of genre, decade, style, mood and collection. */
export type BrowseSlice = Pick<BrowseQuery, 'genre' | 'decade' | 'style' | 'mood' | 'collection'>;

/**
 * Browse (lib/browse.ts): the library by genre, decade, style, mood and collection. With none, tiles for every
 * collection, genre (sub-genres listed on each) and decade, and the styles and moods. With any, that slice of the
 * library: chips to narrow it, Shuffle, the artists in it and its albums. Styles, moods and collections come from
 * the Hub (lib/itemTags.ts).
 */
export function Browse(slice: BrowseSlice) {
  const { albums: all, artists, loading } = useCatalog();
  const hidden = useHidden();
  // re-work the lists when the Hub's styles, moods and collections arrive
  const tagsAt = useItemTags().albums;
  const albums = useMemo(() => all.filter((a) => !hidden.album(a)), [all, hidden]);
  const tree = useMemo(() => genreTree(albums), [albums]);
  if (!albums.length) return loading ? <div className="page"><Spinner /></div> : <div className="page"><Empty title="Nothing to browse yet">Add a Navidrome or Plex server under Settings → Sources.</Empty></div>;
  const any = slice.genre || slice.decade !== undefined || slice.style || slice.mood || slice.collection;
  return any
    ? <Slice key={Object.keys(tagsAt).length} albums={albums} artists={artists} tree={tree} q={slice} />
    : <Landing key={Object.keys(tagsAt).length} albums={albums} tree={tree} />;
}

const goTo = (q: BrowseSlice) => useUi.getState().go({ view: 'browse', ...q });
const go = (genre?: string, decade?: number) => goTo({ genre, decade });
const FACET_NAME: Record<TagFacet, string> = { style: 'Styles', mood: 'Moods', collection: 'Collections' };

/** Styles or moods as a cloud of chips, most albums first. */
function TagCloud({ albums, f, limit = 40 }: { albums: Album[]; f: TagFacet; limit?: number }) {
  const [all, setAll] = useState(false);
  const counts = useMemo(() => tagCounts(albums, f), [albums, f]);
  if (!counts.length) return null;
  return (
    <>
      <h2>{FACET_NAME[f]} <small className="muted">{counts.length}</small></h2>
      <div className="chips tag-cloud">
        {(all ? counts : counts.slice(0, limit)).map((t) => (
          <button key={t.name} className="chip" onClick={() => goTo({ [f]: t.name })}>{t.name} <small className="muted">{t.albums}</small></button>
        ))}
        {!all && counts.length > limit && <button className="chip" onClick={() => setAll(true)}>All {counts.length}…</button>}
      </div>
    </>
  );
}

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
  const collections = useMemo(() => tagCounts(albums, 'collection'), [albums]);
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
      {collections.length > 0 && !f && (
        <>
          <h2>Collections</h2>
          <div className="browse-tiles">
            {collections.map((c) => (
              <button key={c.name} className="browse-tile" style={{ '--tile-hue': hue(c.name) } as React.CSSProperties} onClick={() => goTo({ collection: c.name })}>
                <b>{c.name}</b>
                <small>{c.albums} album{c.albums === 1 ? '' : 's'}</small>
              </button>
            ))}
          </div>
        </>
      )}
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
      {!f && <TagCloud albums={albums} f="style" />}
      {!f && <TagCloud albums={albums} f="mood" />}
    </div>
  );
}

function Slice({ albums, artists, tree, q }: { albums: Album[]; artists: ReturnType<typeof useCatalog.getState>['artists']; tree: GenreNode[]; q: BrowseSlice }) {
  const { genre, decade } = q;
  const [sort, setSort] = useState<AlbumSort>(decade !== undefined && !genre ? 'artist' : 'newest');
  const tags = { style: q.style, mood: q.mood, collection: q.collection };
  // the same slice with one thing changed (chips keep the rest)
  const with_ = (x: BrowseSlice) => goTo({ ...q, ...x });
  const [busy, setBusy] = useState(false);
  const found = genre ? findGenre(tree, genre) : undefined;
  const top = found?.parent ?? found?.node;
  const pick = found?.node.genre ?? genre;
  const shown = useMemo(() => queryAlbums(albums, { ...tags, genre: pick, decade }, sort), [albums, pick, decade, sort, q.style, q.mood, q.collection]); // eslint-disable-line react-hooks/exhaustive-deps
  const inGenre = useMemo(() => queryAlbums(albums, { ...tags, genre: pick }), [albums, pick, q.style, q.mood, q.collection]); // eslint-disable-line react-hooks/exhaustive-deps
  const decades = useMemo(() => decadeCounts(inGenre), [inGenre]);
  // with no genre picked: the genres of what's shown
  const decadeGenres = useMemo(() => (genre ? [] : genreTree(shown).slice(0, 16)), [genre, shown]);
  const people = useMemo(() => queryArtists(artists, albums, { ...tags, genre: pick, decade }, 'albums').slice(0, 12), [artists, albums, pick, decade, q.style, q.mood, q.collection]); // eslint-disable-line react-hooks/exhaustive-deps
  // styles and moods within this slice, to narrow it (not the one already picked)
  const narrow = useMemo(() => (['style', 'mood'] as const).map((f) => [f, q[f] ? [] : tagCounts(shown, f).slice(0, 16)] as const), [shown, q.style, q.mood]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = [q.collection, found?.node.label ?? genre, q.style, q.mood, decade !== undefined ? decadeLabel(decade) : ''].filter(Boolean).join(' · ');
  const picked = (['collection', 'style', 'mood'] as const).filter((f) => q[f]);

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
          {found?.parent && <><button className="link" onClick={() => with_({ genre: found.parent!.genre })}>{found.parent.label}</button> › </>}
          {title} <small>{shown.length}</small>
        </h1>
        <button className="btn primary" disabled={busy || !shown.length} onClick={() => play(true)}><IconShuffle /> Shuffle</button>
        <button className="btn" disabled={busy || !shown.length} onClick={() => play(false)}><IconPlay /> Play</button>
        <SaveSmartButton q={{ ...q, genre: pick }} name={title} />
        {busy && <Spinner />}
      </header>
      {picked.length > 0 && (
        <div className="chips">
          {picked.map((f) => <button key={f} className="chip on" title="Take this off" onClick={() => with_({ [f]: undefined })}>{q[f]} ×</button>)}
        </div>
      )}
      {top && top.subs.length > 0 && (
        <div className="chips">
          <button className={`chip ${found?.node === top ? 'on' : ''}`} onClick={() => with_({ genre: top.genre })}>All {top.label}</button>
          {top.subs.map((s) => <button key={s.genre} className={`chip ${found?.node === s ? 'on' : ''}`} onClick={() => with_({ genre: s.genre })}>{s.label}</button>)}
        </div>
      )}
      {!genre && decadeGenres.length > 0 && (
        <div className="chips">
          {decadeGenres.map((g) => <button key={g.genre} className="chip" onClick={() => with_({ genre: g.genre })}>{g.label}</button>)}
        </div>
      )}
      {decades.length > 1 && (
        <div className="chips">
          {(genre || picked.length > 0) && <button className={`chip ${decade === undefined ? 'on' : ''}`} onClick={() => with_({ decade: undefined })}>Any year</button>}
          {decades.map((d) => (
            <button key={d.decade} className={`chip ${decade === d.decade ? 'on' : ''}`} onClick={() => with_({ decade: d.decade })}>{decadeLabel(d.decade)}</button>
          ))}
        </div>
      )}
      {narrow.map(([f, list]) => list.length > 1 && (
        <div key={f} className="chips" aria-label={FACET_NAME[f]}>
          <span className="muted small chips-label">{FACET_NAME[f]}</span>
          {list.map((t) => <button key={t.name} className="chip" onClick={() => with_({ [f]: t.name })}>{t.name}</button>)}
        </div>
      ))}
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
      {shown.length > 600 && <p className="muted center">Showing 600 of {shown.length}. Pick a decade, sub-genre or style to narrow it down.</p>}
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
