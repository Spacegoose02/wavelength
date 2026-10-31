import { useEffect, useState } from 'react';
import { refreshInbox, requestStatus, useInbox } from '../lib/inbox';
import { cleanTitle, findTrackOnSource, pool, primaryArtist } from '../lib/match';
import type { HubRequest, HubShare } from '../sources/hub';
import { norm, sourceFor } from '../sources/registry';
import { useCatalog } from '../store/catalog';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useHubRuns } from '../lib/hubServices';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { enabledSources } from '../store/settings';
import { useUi } from '../store/ui';
import { Cover, Empty, Spinner, timeAgo } from '../components/common';
import { IconPlay, IconX } from '../components/Icons';
import { useCleanOffers } from '../lib/cleanVersions';
import { CleanVersions } from './CleanVersions';

export type InboxTab = 'shared' | 'requests' | 'approve' | 'sent' | 'clean';
type Tab = InboxTab;

/** Everything the household sends you: things shared with you, answers to your requests, and (admins) requests to approve. */
export function Inbox({ tab: start }: { tab?: InboxTab } = {}) {
  const signedIn = useHub((s) => !!s.token);
  // parents decide their own kids' requests (hub/src/family.ts)
  const approver = useHub((s) => s.permissions.includes('requests.approve') || s.kids.length > 0);
  // Clean versions: for people who can download or request, once the library check found any
  const getter = useHub((s) => s.user?.role !== 'kid' && (s.permissions.includes('downloads.run') || s.permissions.includes('requests.create')));
  const cleanCount = useCleanOffers().length;
  const counts = useInbox();
  const [tab, setTab] = useState<Tab>(start ?? (counts.shared || (!counts.decided && !counts.pending) ? 'shared' : counts.decided ? 'requests' : 'approve'));

  if (!signedIn) return <div className="page"><header className="page-head"><h1>Inbox</h1></header><Empty title="Sign in to your Hub">Requests and sharing go through your Wavelength Hub. Sign in under Settings → Hub.</Empty></div>;

  return (
    <div className="page">
      <header className="page-head"><h1>Inbox</h1></header>
      <div className="tabs">
        <button className={tab === 'shared' ? 'on' : ''} onClick={() => setTab('shared')}>Shared with you {counts.shared > 0 && <span className="badge">{counts.shared}</span>}</button>
        <button className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>My requests {counts.decided > 0 && <span className="badge">{counts.decided}</span>}</button>
        {approver && <button className={tab === 'approve' ? 'on' : ''} onClick={() => setTab('approve')}>To approve {counts.pending > 0 && <span className="badge">{counts.pending}</span>}</button>}
        <button className={tab === 'sent' ? 'on' : ''} onClick={() => setTab('sent')}>You shared</button>
        {getter && (cleanCount > 0 || tab === 'clean') && <button className={tab === 'clean' ? 'on' : ''} onClick={() => setTab('clean')}>Clean versions <small>{cleanCount}</small></button>}
      </div>
      {tab === 'shared' ? <SharedWithYou /> : tab === 'requests' ? <MyRequests /> : tab === 'approve' ? <Approve /> : tab === 'clean' && getter ? <CleanVersions /> : <Sent />}
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = () => load().then(setData).catch((e) => setError(String((e as Error).message ?? e)));
  useEffect(() => {
    reload();
  }, deps);
  return { data, error, reload, setData };
}

// ---- shared with you ----

function SharedWithYou() {
  const { data, error, setData } = useLoad(async () => (await hubClient()!.shares()).shares);
  useEffect(() => {
    if (!data?.some((s) => !s.seen)) return;
    hubClient()?.sharesSeen().then(refreshInbox).catch(() => undefined);
  }, [data]);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  if (!data.length) return <Empty title="Nothing shared with you yet">When someone on your Hub shares a playlist, album, song or station, it shows up here.</Empty>;
  const hide = async (s: HubShare) => {
    setData(data.filter((x) => x.id !== s.id));
    await hubClient()?.hideShare(s.id).catch(() => undefined);
  };
  return <div className="share-list">{data.map((s) => <ShareCard key={s.id} s={s} onHide={() => hide(s)} />)}</div>;
}

const KIND_LABEL: Record<HubShare['kind'], string> = { playlist: 'Playlist', album: 'Album', track: 'Song', artist: 'Artist', station: 'Station', favorites: 'Favorites' };

/** Find the shared songs in this person's own library (Navidrome / Plex), by title and artist. */
async function findShared(s: HubShare, onProgress: (done: number) => void): Promise<{ found: Track[]; missing: number }> {
  const libs = enabledSources().filter((c) => c.kind === 'navidrome' || c.kind === 'plex').map(sourceFor);
  const list = s.payload.tracks ?? [];
  let done = 0;
  const hits = await pool(list, 4, async (t) => {
    let hit: Track | undefined;
    for (const src of libs) if (!hit) hit = await findTrackOnSource(src, t).catch(() => undefined);
    onProgress(++done);
    return hit;
  });
  const found = hits.filter((t): t is Track => !!t);
  return { found, missing: list.length - found.length };
}

function ShareCard({ s, onHide, onUnshare }: { s: HubShare; onHide?: () => void; onUnshare?: () => void }) {
  const playTracks = usePlayer((p) => p.playTracks);
  const [found, setFound] = useState<{ found: Track[]; missing: number }>();
  const [progress, setProgress] = useState<number>();
  const [msg, setMsg] = useState<string>();
  const songs = s.payload.tracks?.length ?? 0;

  const match = async () => {
    if (found) return found;
    setProgress(0);
    const r = await findShared(s, setProgress);
    setFound(r);
    setProgress(undefined);
    return r;
  };

  const play = async () => {
    const st = s.payload.station;
    if (st) {
      return playTracks([{ id: `radio:shared:${s.id}`, sourceId: 'radio', kind: 'radio', title: st.name, artist: 'Live radio', coverUrl: st.favicon, streamUrl: st.streamUrl, nowPlayingUrl: st.nowPlayingUrl }]);
    }
    if (s.payload.artist) return useUi.getState().go({ view: 'search', q: s.payload.artist });
    const r = await match();
    if (r.found.length) playTracks(r.found);
    else setMsg('None of these are in your library yet');
  };

  const save = async () => {
    const r = await match();
    if (!r.found.length) return setMsg('None of these are in your library yet');
    const id = useLibrary.getState().createPlaylist(`${s.title} (from ${s.from.displayName})`, r.found);
    setMsg(`Saved ${r.found.length} song${r.found.length === 1 ? '' : 's'}`);
    window.setTimeout(() => useUi.getState().go({ view: 'playlist', id }), 700);
  };

  return (
    <div className="share-card">
      <Cover src={s.cover ?? undefined} alt={s.title} className="share-cover" />
      <div className="track-main">
        <div className="kicker">{KIND_LABEL[s.kind]}</div>
        <div className="track-title">{s.title}</div>
        <div className="track-sub">
          {s.subtitle ? `${s.subtitle} · ` : ''}
          {onUnshare ? `to ${s.to ? s.to.displayName : 'everyone'}` : `from ${s.from.displayName}`} · {timeAgo(s.createdAt)}
        </div>
        {s.note && <div className="share-note">“{s.note}”</div>}
        {progress !== undefined && <div className="muted small">Looking in your library… {progress}/{songs}</div>}
        {found && found.missing > 0 && <div className="muted small">{found.found.length} of {songs} are in your library</div>}
        {msg && <div className="muted small">{msg}</div>}
      </div>
      <div className="share-actions">
        <button className="btn small primary" disabled={progress !== undefined} onClick={play}><IconPlay /> {s.kind === 'artist' ? 'Find' : 'Play'}</button>
        {songs > 0 && <button className="btn small" disabled={progress !== undefined} onClick={save}>Save as playlist</button>}
        {onHide && <button className="icon-btn" title="Remove from your inbox" onClick={onHide}><IconX /></button>}
        {onUnshare && <button className="btn small ghost" onClick={onUnshare}>Unshare</button>}
      </div>
    </div>
  );
}

function Sent() {
  const { data, error, setData } = useLoad(async () => (await hubClient()!.shares(true)).shares);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  if (!data.length) return <Empty title="You haven't shared anything yet">Use <b>Share</b> on a playlist, album, artist, station or your favorites.</Empty>;
  const unshare = async (s: HubShare) => {
    if (!confirm(`Stop sharing "${s.title}"?`)) return;
    await hubClient()?.unshare(s.id);
    setData(data.filter((x) => x.id !== s.id));
  };
  return <div className="share-list">{data.map((s) => <ShareCard key={s.id} s={s} onUnshare={() => unshare(s)} />)}</div>;
}

// ---- requests ----

function RequestRow({ r, who, children }: { r: HubRequest; who?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`station-row request-row req-${r.status}`}>
      <Cover src={r.cover ?? undefined} alt={r.title} className="tiny" />
      <div className="track-main">
        <div className="track-title"><a href={r.link} target="_blank" rel="noreferrer">{r.title}</a></div>
        <div className="track-sub">
          {r.artist}{r.artist ? ' · ' : ''}{r.kind}{who ? ` · asked by ${r.displayName}` : ''} · {timeAgo(r.createdAt)}
        </div>
        {r.note && <div className="share-note">“{r.note}”</div>}
        {r.reason && <div className={r.status === 'failed' ? 'card-err small' : 'muted small'}>{r.reason}</div>}
      </div>
      <span className={`req-status ${r.readyAt ? 'ready' : r.status}`}>
        {requestStatus(r)}{r.status === 'approved' && r.via && !r.readyAt ? ` via ${r.via}` : ''}{r.decidedBy && r.status !== 'pending' && !who ? ` · ${r.decidedBy}` : ''}
      </span>
      {children}
    </div>
  );
}

/**
 * "Your song is ready": find what was asked for in this person's own library (it was just scanned in) and
 * play it. Albums and playlists play the album with that name; anything else plays the song.
 */
async function findRequested(r: HubRequest): Promise<Track[]> {
  const libs = enabledSources().filter((c) => c.kind === 'navidrome' || c.kind === 'plex').map(sourceFor);
  const artist = norm(primaryArtist(r.artist));
  const title = cleanTitle(r.title.replace(/\s*\((clean|explicit)\)$/i, ''));
  for (const src of libs) {
    if (r.kind === 'album' || r.kind === 'playlist' || r.kind === 'artist') {
      const res = await src.search?.(`${primaryArtist(r.artist)} ${r.title}`).catch(() => undefined);
      const album = res?.albums?.find((a) => cleanTitle(a.title) === title && (!artist || norm(primaryArtist(a.artist)) === artist))
        ?? res?.albums?.find((a) => cleanTitle(a.title) === title);
      const tracks = album && (await src.getAlbumTracks?.(album.id).catch(() => undefined));
      if (tracks?.length) return tracks;
    }
    const hit = await findTrackOnSource(src, { title: r.title, artist: r.artist }).catch(() => undefined);
    if (hit) return [hit];
  }
  return [];
}

function PlayRequest({ r }: { r: HubRequest }) {
  const [state, setState] = useState<string>();
  const play = async () => {
    setState('Finding…');
    const tracks = await findRequested(r);
    if (!tracks.length) return setState('Not in your library yet');
    setState(undefined);
    usePlayer.getState().playTracks(tracks);
    useCatalog.getState().load();
  };
  return (
    <button className="btn small primary" disabled={state === 'Finding…'} onClick={play} title="Play it from your library">
      <IconPlay /> {state ?? 'Play'}
    </button>
  );
}

function MyRequests() {
  const { data, error, reload } = useLoad(async () => (await hubClient()!.myRequests()).requests);
  useEffect(() => {
    if (data?.some((r) => !r.seen)) hubClient()?.requestsSeen().then(refreshInbox).catch(() => undefined);
  }, [data]);
  if (error) return <div className="errors">{error}</div>;
  if (!data) return <Spinner />;
  if (!data.length) return <Empty title="No requests yet">Find a song in Downloads or Discover and press <b>Request</b>. Your Hub admin gets it here.</Empty>;
  return (
    <div className="tracklist">
      {data.map((r) => (
        <RequestRow key={r.id} r={r}>
          {(r.readyAt || r.status === 'have') && <PlayRequest r={r} />}
          {r.status === 'pending' && (
            <button className="btn small ghost" onClick={async () => {
              await hubClient()?.cancelRequest(r.id);
              reload();
              refreshInbox();
            }}>Cancel</button>
          )}
        </RequestRow>
      ))}
    </div>
  );
}

function Approve() {
  const [filter, setFilter] = useState<'pending' | ''>('pending');
  const { data, error, reload } = useLoad(async () => (await hubClient()!.allRequests(filter || undefined)).requests, [filter]);
  const [busy, setBusy] = useState<number>();
  // a parent (not an approver) decides only their kids' requests, without picking files or clearing the list
  const admin = useHub((s) => s.permissions.includes('requests.approve'));
  const slskd = useHubRuns('slskd') && admin;

  const act = async (r: HubRequest, fn: () => Promise<unknown>) => {
    setBusy(r.id);
    try {
      await fn();
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(undefined);
      reload();
      refreshInbox();
    }
  };

  return (
    <>
      <div className="chips">
        <button className={`chip ${filter === 'pending' ? 'on' : ''}`} onClick={() => setFilter('pending')}>Waiting</button>
        <button className={`chip ${filter === '' ? 'on' : ''}`} onClick={() => setFilter('')}>All</button>
      </div>
      {error && <div className="errors">{error}</div>}
      {!data ? <Spinner /> : !data.length ? <Empty title="Nothing to approve">{admin ? 'Requests from the household show up here.' : 'Your kids’ requests show up here.'}</Empty> : (
        <div className="tracklist">
          {data.map((r) => (
            <RequestRow key={r.id} r={r} who>
              <div className="share-actions">
                {(r.status === 'pending' || r.status === 'failed') && (
                  <button className="btn small primary" disabled={busy === r.id} onClick={() => act(r, () => hubClient()!.approveRequest(r.id))}>
                    {busy === r.id ? '…' : r.status === 'failed' ? 'Retry' : 'Approve'}
                  </button>
                )}
                {(r.status === 'pending' || r.status === 'failed') && slskd && (
                  <button className="btn small" title="Pick a folder on Soulseek for this request" onClick={() => useUi.getState().go({ view: 'downloads', soulseek: { q: `${r.artist} ${r.title}`.trim(), requestId: r.id } })}>Soulseek…</button>
                )}
                {r.status === 'pending' && <>
                  <button className="btn small" disabled={busy === r.id} onClick={() => act(r, () => hubClient()!.haveRequest(r.id))}>Already have</button>
                  <button className="btn small ghost" disabled={busy === r.id} onClick={() => {
                    const reason = prompt(`Why not "${r.title}"? (${r.displayName} sees this)`, '');
                    if (reason !== null) act(r, () => hubClient()!.rejectRequest(r.id, reason));
                  }}>Reject</button>
                </>}
                {r.status !== 'pending' && admin && (
                  <button className="icon-btn" title="Remove" onClick={() => act(r, () => hubClient()!.deleteRequest(r.id))}><IconX /></button>
                )}
              </div>
            </RequestRow>
          ))}
        </div>
      )}
    </>
  );
}
