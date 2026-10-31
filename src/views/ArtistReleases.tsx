import { useEffect, useState } from 'react';
import { notOneArtist, useCanGet, useDeezerArtist } from '../components/ArtistNews';
import { DeemixQueuePanel } from '../components/DeemixQueue';
import { Empty, Spinner } from '../components/common';
import { IconBack } from '../components/Icons';
import { useHidden } from '../lib/kids';
import { searchDeezer, type DeezerResult } from '../sources/deemix';
import type { Artist } from '../sources/types';
import { useUi } from '../store/ui';
import { DeezerAlbum, DeezerArtist, DeezerPlaylist, DzRow, statusKey, useDeezerBrowse, type Browse } from './DeezerBrowse';

/**
 * **Browse releases** on a library artist page: the artist's whole Deezer discography, the same page as
 * Downloads → Deezer (E / C badges, Clean only, Get or Request), with what you already have marked
 * **In library**. Albums and other artists open on top, and Back walks back through them, then to the
 * library artist. See docs/USER-GUIDE.md#browse-an-artists-releases.
 */
export function ArtistReleases({ artist, open: first }: { artist: Artist; open?: Browse }) {
  const lookup = useDeezerArtist(artist.name);
  const { canGet, ask } = useCanGet();
  const hidden = useHidden();
  const { stack, setStack, browse } = useDeezerBrowse({ request: ask });

  // the artist's page at the bottom of the stack once they're found, with a release from the banner on top
  const dz = lookup.state === 'found' ? lookup.artist : undefined;
  useEffect(() => {
    if (dz) setStack([{ type: 'artist', id: dz.id, title: dz.name }, ...(first ? [first] : [])]);
  }, [dz?.id]);

  if (hidden.artist(artist)) return <div className="page"><Empty title="Not available">Ask a grown-up about this one.</Empty></div>;

  const current = stack[stack.length - 1];
  const back = () => (stack.length > 1 ? setStack((s) => s.slice(0, -1)) : useUi.getState().back());
  // Back from a page opened on top keeps the Deezer artist page; picking another artist starts from them
  const openFromSearch = (b: Browse) => setStack([b]);

  return (
    <div className="page">
      <div className="dz-crumbs artist-releases-crumbs">
        <button className="btn small ghost" onClick={back}><IconBack /> Back</button>
        <button className="dz-link" onClick={() => useUi.getState().back()}>{artist.name}</button>
        <span> / {stack.length > 1 ? <button className="dz-link" onClick={() => setStack((s) => s.slice(0, 1))}>Releases</button> : <b>Releases</b>}</span>
        {stack.slice(1).map((b, i) => (
          <span key={`${b.type}:${b.id}:${i}`}> / {i === stack.length - 2 ? <b>{b.title}</b> : <span className="muted">{b.title}</span>}</span>
        ))}
      </div>
      {lookup.state === 'found' && !lookup.sure && stack.length > 0 && stack[0].id === lookup.artist.id && (
        <p className="muted small artist-releases-unsure">
          Not sure this is the right {artist.name}:{' '}
          {lookup.libraryAlbums ? `none of your albums by ${artist.name} are in this discography.` : `Deezer has more than one artist by that name, and this is the one with the most fans.`}
          {lookup.others.length > 0 && <>{' '}Others called {artist.name}:{' '}
            {lookup.others.slice(0, 6).map((o, i) => (
              <span key={o.id}>{i > 0 && ' · '}<button className="dz-link" onClick={() => openFromSearch({ type: 'artist', id: o.id, title: o.name })}>{o.name} ({fansLabel(o.fans)})</button></span>
            ))}
          </>}
        </p>
      )}
      {!canGet && <p className="muted small">To get music from here, set up deemix in Settings → Downloads, or ask your Hub admin to turn on Autodownload for you.</p>}
      <div className={canGet && !ask ? 'dl-layout' : undefined}>
        <div>
          {current ? (
            current.type === 'artist'
              ? <DeezerArtist key={current.id} id={current.id} {...browse} />
              : current.type === 'album'
              ? <DeezerAlbum key={current.id} id={current.id} {...browse} />
              : <DeezerPlaylist key={current.id} id={current.id} {...browse} />
          ) : lookup.state === 'loading' || (dz && !stack.length) ? (
            <div className="row gap muted small"><Spinner /> Finding {artist.name} on Deezer…</div>
          ) : notOneArtist(artist.name) ? (
            <Empty title="No one artist">“{artist.name}” isn’t one artist, so there’s no discography to browse.</Empty>
          ) : (
            <NotOnDeezer artist={artist} error={lookup.state === 'error' ? lookup.error : undefined} open={openFromSearch} browse={browse} />
          )}
        </div>
        {canGet && !ask && <DeemixQueuePanel />}
      </div>
    </div>
  );
}

const fansLabel = (n: number) => `${n.toLocaleString()} fan${n === 1 ? '' : 's'}`;

/** No artist on Deezer with exactly this name: the closest ones, to pick the right one. */
function NotOnDeezer({ artist, error, open, browse }: { artist: Artist; error?: string; open(b: Browse): void; browse: ReturnType<typeof useDeezerBrowse>['browse'] }) {
  const [results, setResults] = useState<DeezerResult[]>();
  useEffect(() => {
    let alive = true;
    searchDeezer(artist.name).then((r) => alive && setResults(r.filter((x) => x.type === 'artist')), () => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [artist.name]);
  return (
    <>
      <p className="muted">{error ? `Couldn’t reach Deezer: ${error}` : `Deezer has no artist called exactly “${artist.name}”.`}{results?.length ? ' Is it one of these?' : ''}</p>
      {!results ? <Spinner /> : results.map((r) => <DzRow key={statusKey(r)} r={r} {...browse} open={open} />)}
    </>
  );
}
