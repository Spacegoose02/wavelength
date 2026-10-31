import { useEffect, useMemo, useState } from 'react';
import { libraryAlbumsBy, matchArtist, type ArtistCandidate } from '../lib/artistMatch';
import { localToday, newestRelease, useOwnedRelease } from '../lib/artistReleases';
import { followed, useFollows } from '../lib/follows';
import { useHubRuns } from '../lib/hubServices';
import { useMustRequest } from '../lib/inbox';
import { useHidden } from '../lib/kids';
import { useVersionPref } from '../lib/versions';
import { getDeezerReleases, type DeezerResult } from '../sources/deemix';
import { albumPreview, deezerArtistsNamed, WINDOW_DAYS, type DeezerArtistHit } from '../sources/releaseRadar';
import type { Artist } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useCan } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { GetButton, useDeezerBrowse } from '../views/DeezerBrowse';
import { Cover, Rating } from './common';
import { IconPlay } from './Icons';

/**
 * The newest release banner on a library artist page, and the lookups behind it and **Browse releases**
 * (views/ArtistReleases.tsx). See docs/USER-GUIDE.md#browse-an-artists-releases.
 */

/** Names that aren't one artist, so there's nothing to look up. */
export const notOneArtist = (name: string) => !name.trim() || /^(various artists|unknown artist)$/i.test(name.trim());

export type DeezerArtistLookup =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; error: string }
  | { state: 'found'; artist: DeezerArtistHit; sure: boolean; others: ArtistCandidate[]; /** Your albums by this artist, checked against it. */ libraryAlbums: number };

/**
 * The library artist on Deezer: the one you follow with this name (the Hub already matched it) when it has your
 * albums, or else the Deezer artist with exactly this name that has your albums, or the most fans (lib/artistMatch.ts). `sure` says
 * whether the match checked out against your library; the newest release banner only shows when it did, and
 * Browse releases offers the `others` with the same name when it didn't.
 */
export function useDeezerArtist(name: string): DeezerArtistLookup {
  const mine = useFollows((s) => followed(s.follows, { name }));
  const all = useCatalog((s) => s.albums);
  const library = useMemo(() => libraryAlbumsBy(name, all), [name, all]);
  const libraryKey = library.map((a) => a.id).sort().join('|');
  const [found, setFound] = useState<DeezerArtistLookup>({ state: 'loading' });
  useEffect(() => {
    if (notOneArtist(name)) return;
    let alive = true;
    setFound({ state: 'loading' });
    const releasesOf = (c: ArtistCandidate) => getDeezerReleases(c.id, c);
    const byName = () => deezerArtistsNamed(name).then((list) => matchArtist(list, library, releasesOf));
    const pick = async () => {
      if (!mine) return byName();
      const m = await matchArtist([{ id: mine.id, name: mine.name, picture: mine.picture ?? undefined, fans: 0 }], library, releasesOf);
      if (m?.sure) return m;
      // the followed artist has none of your albums: an earlier lookup may have followed a same-name stranger
      const other = await byName().catch(() => undefined);
      return other?.sure ? other : m && { ...m, others: (other ? [other.artist, ...other.others] : []).filter((x) => x.id !== mine.id) };
    };
    pick().then(
      (m) => alive && setFound(m ? { state: 'found', artist: { id: m.artist.id, name: m.artist.name, picture: m.artist.picture }, sure: m.sure, others: m.others, libraryAlbums: library.length } : { state: 'missing' }),
      (e) => alive && setFound({ state: 'error', error: String((e as Error)?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [name, mine?.id, libraryKey]);
  if (notOneArtist(name)) return { state: 'missing' };
  return found;
}

/** Whether this person can get music from Deezer here: deemix (theirs or the Hub's), or a request to the admin. */
export function useCanGet(): { canGet: boolean; ask: boolean } {
  const ask = useMustRequest();
  const canDownload = useCan('downloads.run');
  const deemixUrl = useSettings((s) => s.deemix.url);
  const hubDeemix = useHubRuns('deemix');
  return { ask, canGet: ask || (canDownload && (!!deemixUrl || hubDeemix)) };
}

const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString([], { dateStyle: 'medium' });
const typeLabel = (r: DeezerResult) => (r.recordType && r.recordType !== 'compile' ? r.recordType : r.recordType === 'compile' ? 'compilation' : 'album');

/**
 * "New release: Title (single), Oct 24" by the artist's name, with a preview, Get (or Request) when you don't
 * have it, and "In library" when you do. Older than Release Radar's 6 weeks it says "Latest release". Also
 * names the next announced release, if Deezer lists one. Kid profiles see the newest release they may have.
 */
export function ArtistNews({ artist }: { artist: Artist }) {
  const lookup = useDeezerArtist(artist.name);
  const [releases, setReleases] = useState<DeezerResult[]>();
  const owned = useOwnedRelease();
  const hidden = useHidden();
  const pref = useVersionPref();
  const { canGet, ask } = useCanGet();
  const { browse } = useDeezerBrowse({ request: ask });
  const [previewMsg, setPreviewMsg] = useState<string>();

  // only when the match checked out: a same-name stranger's newest release is worse than no banner
  const dz = lookup.state === 'found' && lookup.sure ? lookup.artist : undefined;
  useEffect(() => {
    if (!dz) return;
    let alive = true;
    setReleases(undefined);
    getDeezerReleases(dz.id, dz).then((r) => alive && setReleases(r), () => alive && setReleases([]));
    return () => {
      alive = false;
    };
  }, [dz?.id]);

  const news = useMemo(
    () => (releases ? newestRelease(releases, { today: localToday(), windowDays: WINDOW_DAYS, pref, hide: hidden.deezer }) : undefined),
    [releases, pref, hidden],
  );
  const latest = news?.latest;
  if (!dz || !latest) return null;
  const mine = owned(latest);

  const openRelease = (r: DeezerResult) => useUi.getState().go({ view: 'artistReleases', artist, open: { type: 'album', id: r.id, title: r.title } });
  const preview = async () => {
    setPreviewMsg(undefined);
    const p = await albumPreview(latest.id);
    if (!p.url) return setPreviewMsg('No preview');
    usePlayer.getState().playTracks([{ id: `preview:${p.url}`, sourceId: 'preview', kind: 'track', title: p.title ?? latest.title, artist: latest.artist, album: `${latest.title} (preview)`, coverUrl: latest.cover, streamUrl: p.url, duration: 30, explicit: latest.version === 'explicit' || latest.explicit ? 'explicit' : undefined }]);
  };

  return (
    <div className={`artist-news ${news.isNew ? 'new' : ''}`} role="status">
      <button className="artist-news-art" title="Open this release" onClick={() => openRelease(latest)}>
        <Cover src={latest.cover} alt={latest.title} />
      </button>
      <div className="artist-news-text">
        <div className="kicker">{news.isNew ? 'New release' : 'Latest release'}</div>
        <button className="artist-news-title dz-link" title={latest.title} onClick={() => openRelease(latest)}>
          <Rating explicit={latest.version ?? latest.explicit} />{latest.title}
        </button>
        <div className="muted small">
          <span className="tag">{typeLabel(latest)}</span> {fmtDate(latest.releaseDate!)}
        </div>
        {news.upcoming && (
          <div className="muted small">
            Coming soon: <button className="dz-link" onClick={() => openRelease(news.upcoming!)}>{news.upcoming.title}</button>, out {fmtDate(news.upcoming.releaseDate!)}
          </div>
        )}
        {previewMsg && <div className="muted small">{previewMsg}</div>}
        {browse.status[`album:${latest.id}`]?.s === 'error' && <div className="card-err">{browse.status[`album:${latest.id}`].msg}</div>}
      </div>
      <div className="artist-news-actions">
        <button className="icon-btn" title="Play a 30-second preview" onClick={() => void preview()}><IconPlay /></button>
        {mine
          ? <button className="btn small ghost" title="You have this one. Open it" onClick={() => useUi.getState().go({ view: 'album', album: mine })}>✓ In library</button>
          : canGet && <GetButton r={latest} send={browse.send} status={browse.status} />}
      </div>
    </div>
  );
}
