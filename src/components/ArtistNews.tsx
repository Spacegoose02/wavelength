import { useEffect, useMemo, useState } from 'react';
import { localToday, newestRelease, useOwnedRelease } from '../lib/artistReleases';
import { followed, useFollows } from '../lib/follows';
import { useHubRuns } from '../lib/hubServices';
import { useMustRequest } from '../lib/inbox';
import { useHidden } from '../lib/kids';
import { useVersionPref } from '../lib/versions';
import { getDeezerReleases, type DeezerResult } from '../sources/deemix';
import { albumPreview, findDeezerArtist, WINDOW_DAYS, type DeezerArtistHit } from '../sources/releaseRadar';
import type { Artist } from '../sources/types';
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

export type DeezerArtistLookup = { state: 'loading' } | { state: 'missing' } | { state: 'error'; error: string } | { state: 'found'; artist: DeezerArtistHit };

/**
 * The library artist on Deezer: the one you follow with this name (the Hub already matched it), or else the
 * Deezer artist with exactly this name (sources/releaseRadar.ts findDeezerArtist).
 */
export function useDeezerArtist(name: string): DeezerArtistLookup {
  const mine = useFollows((s) => followed(s.follows, { name }));
  const [found, setFound] = useState<DeezerArtistLookup>({ state: 'loading' });
  useEffect(() => {
    if (mine || notOneArtist(name)) return;
    let alive = true;
    setFound({ state: 'loading' });
    findDeezerArtist(name).then(
      (artist) => alive && setFound(artist ? { state: 'found', artist } : { state: 'missing' }),
      (e) => alive && setFound({ state: 'error', error: String((e as Error)?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [name, mine?.id]);
  if (notOneArtist(name)) return { state: 'missing' };
  if (mine) return { state: 'found', artist: { id: mine.id, name: mine.name, picture: mine.picture ?? undefined } };
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

  const dz = lookup.state === 'found' ? lookup.artist : undefined;
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
