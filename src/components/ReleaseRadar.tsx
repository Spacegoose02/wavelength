import { useEffect, useMemo, useState } from 'react';
import { deemixClient } from '../lib/hubServices';
import { mustRequest, requestMusic, useMustRequest } from '../lib/inbox';
import { albumPreview, releaseRadar, type Release } from '../sources/releaseRadar';
import { norm } from '../sources/registry';
import { useCatalog } from '../store/catalog';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Cover, Spinner } from './common';
import { IconDownload, IconPlay, IconRefresh } from './Icons';

/** "Release Radar": new albums/singles from the artists you actually play. */
export function ReleaseRadar() {
  const [data, setData] = useState<{ releases: Release[]; artists: number }>();
  const [progress, setProgress] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<Record<number, string>>({});
  const albums = useCatalog((s) => s.albums);
  const deemix = useSettings((s) => s.deemix);
  const ask = useMustRequest();

  useEffect(() => {
    let alive = true;
    setData(undefined);
    releaseRadar(nonce > 0, (d, t) => alive && setProgress(`Checking ${d}/${t} artists…`))
      .then((r) => alive && setData(r))
      .catch((e) => alive && setProgress(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [nonce]);

  // already in your library? (same artist + title)
  const owned = useMemo(() => {
    const m = new Map(albums.map((a) => [`${norm(a.artist)}|${norm(a.title)}`, a]));
    return (r: Release) => m.get(`${norm(r.artist)}|${norm(r.title)}`);
  }, [albums]);

  const get = async (r: Release) => {
    setStatus((s) => ({ ...s, [r.id]: '…' }));
    try {
      if (mustRequest()) {
        await requestMusic({ link: r.deezerLink, kind: 'album', title: r.title, artist: r.artist, cover: r.cover });
        setStatus((s) => ({ ...s, [r.id]: 'Requested' }));
      } else {
        await deemixClient().addToQueue(r.deezerLink, deemix.bitrate);
        setStatus((s) => ({ ...s, [r.id]: 'Queued' }));
      }
    } catch (e) {
      setStatus((s) => ({ ...s, [r.id]: String((e as Error).message ?? e) }));
    }
  };

  const preview = async (r: Release) => {
    const p = await albumPreview(r.id);
    if (!p.url) return setStatus((s) => ({ ...s, [r.id]: 'No preview' }));
    usePlayer.getState().playTracks([{ id: `preview:${p.url}`, sourceId: 'preview', kind: 'track', title: p.title ?? r.title, artist: r.artist, album: `${r.title} (preview)`, coverUrl: r.cover, streamUrl: p.url, duration: 30 }]);
  };

  return (
    <section className="radar">
      <h2>
        Release Radar <small className="muted">new from artists you play</small>
        <button className="link small" onClick={() => setNonce(nonce + 1)}><IconRefresh /> Refresh</button>
      </h2>
      {!data ? (
        <div className="row gap muted small"><Spinner /> {progress ?? 'Finding your artists…'}</div>
      ) : !data.releases.length ? (
        <p className="muted">Nothing new in the last 6 weeks from your top {data.artists} artists. Play more music (or ♥ some) and check back.</p>
      ) : (
        <div className="row-scroll">
          {data.releases.map((r) => {
            const mine = owned(r);
            return (
              <div key={r.id} className="card radar-card">
                <div className="book-cover">
                  <Cover src={r.cover} alt={r.title} />
                  <button className="radar-play" title="Preview" onClick={() => preview(r)}><IconPlay /></button>
                </div>
                <div className="card-title" title={r.title}>{r.title}</div>
                <div className="card-sub"><span>{r.artist}</span></div>
                <div className="card-sub"><span className="tag">{r.type}</span><span>{new Date(r.released + 'T12:00:00').toLocaleDateString()}</span></div>
                {mine ? (
                  <button className="btn small" onClick={() => useUi.getState().go({ view: 'album', album: mine })}>In library</button>
                ) : (
                  <button className="btn small" disabled={(!deemix.url && !ask) || status[r.id] === '…' || status[r.id] === 'Queued' || status[r.id] === 'Requested'} title={status[r.id]} onClick={() => get(r)}>
                    <IconDownload /> {status[r.id] && status[r.id].length < 12 ? status[r.id] : ask ? 'Request' : 'Get'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
