import { useEffect, useMemo, useState } from 'react';
import { deemixClient } from '../lib/hubServices';
import { follow, loadRadar, setAutoGet, unfollow, useFollows } from '../lib/follows';
import { mustRequest, requestMusic, useMustRequest } from '../lib/inbox';
import { useHidden } from '../lib/kids';
import type { HubMixTrack, HubRadarRelease, HubSuggestion } from '../sources/hub';
import { albumPreview, releaseRadar, type Release } from '../sources/releaseRadar';
import { norm } from '../sources/registry';
import { findInLibrary } from '../lib/match';
import type { Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient, useHub } from '../store/hub';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Cover, Spinner } from './common';
import { FollowButton } from './FollowButton';
import { IconDownload, IconPlay, IconRefresh, IconX } from './Icons';

type Mode = 'following' | 'played' | 'mix';
const MODE_KEY = 'tonearm.radarMode';

/**
 * "Release Radar" (docs/RELEASE-RADAR.md): new albums and singles. Signed in to a Hub, it has two lists: the
 * artists you follow (the Hub looks them up in the background, with suggestions of who else to follow) and
 * the artists you play (worked out by this app). Without a Hub only the second one.
 */
export function ReleaseRadar() {
  const signedIn = useHub((s) => !!s.token);
  const supported = useFollows((s) => s.supported);
  const follows = useFollows((s) => s.follows.length);
  const [picked, setPicked] = useState<Mode | undefined>(() => {
    try {
      return (localStorage.getItem(MODE_KEY) as Mode | null) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (signedIn) void loadRadar();
  }, [signedIn]);

  const mode: Mode = !supported ? 'played' : picked ?? (follows ? 'following' : 'played');
  const pick = (m: Mode) => {
    setPicked(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* non-essential */
    }
  };

  return (
    <section className="radar">
      <h2>
        Release Radar
        {supported ? (
          <span className="chips inline">
            <button className={`chip ${mode === 'following' ? 'on' : ''}`} onClick={() => pick('following')}>Following{follows ? ` (${follows})` : ''}</button>
            <button className={`chip ${mode === 'played' ? 'on' : ''}`} onClick={() => pick('played')}>Artists you play</button>
            <button className={`chip ${mode === 'mix' ? 'on' : ''}`} onClick={() => pick('mix')}>Weekly Mix</button>
          </span>
        ) : <small className="muted">new from artists you play</small>}
        <button className="link small" onClick={() => setNonce(nonce + 1)}><IconRefresh /> Refresh</button>
      </h2>
      {mode === 'following' ? <FollowingRadar nonce={nonce} /> : mode === 'mix' ? <WeeklyMix nonce={nonce} /> : <PlayedRadar nonce={nonce} />}
    </section>
  );
}

/** New releases from the artists you follow, from the Hub, plus who to follow next. */
function FollowingRadar({ nonce }: { nonce: number }) {
  const radar = useFollows((s) => s.radar);
  const follows = useFollows((s) => s.follows);
  const [checking, setChecking] = useState(false);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    if (!nonce) return;
    let alive = true;
    setChecking(true);
    hubClient()?.radarCheck()
      .catch(() => undefined)
      .then(() => loadRadar())
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [nonce]);

  // still looking some up (just followed): ask again in a moment
  useEffect(() => {
    if (!radar?.pending) return;
    const t = setTimeout(() => void loadRadar(), 5000);
    return () => clearTimeout(t);
  }, [radar]);

  const releases = useMemo(() => (radar?.releases ?? []).map(fromHub), [radar]);
  const upcoming = useMemo(() => (radar?.upcoming ?? []).map(fromHub), [radar]);

  return (
    <>
      <div className="row gap muted small radar-status">
        {checking || radar?.pending ? <><Spinner /> Looking up {radar?.pending || follows.length} artists on Deezer…</>
          : radar?.checkedAt ? <>Checked {new Date(radar.checkedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{radar.failed ? ` · ${radar.failed} couldn’t be looked up, trying again later` : ''}</>
          : null}
        {follows.length > 0 && <button className="link small" onClick={() => setManaging(!managing)}>{managing ? 'Done' : `Manage ${follows.length} followed`}</button>}
      </div>
      {managing && <ManageFollows />}
      {!radar ? (
        <div className="row gap muted small"><Spinner /> Asking your Hub…</div>
      ) : !follows.length ? (
        <p className="muted">Follow artists to build your own radar: press <b>Follow</b> on an artist’s page, add one below, or pick from the suggestions. Their new albums and singles show up here, and you get a notification when one comes out.</p>
      ) : !releases.length && !radar.pending ? (
        <p className="muted">Nothing new in the last {Math.round(radar.windowDays / 7)} weeks from the {follows.length} artists you follow.</p>
      ) : <ReleaseCards releases={releases} />}
      {upcoming.length > 0 && (
        <>
          <h3 className="dz-section">Coming soon <small className="muted">announced, not out yet</small></h3>
          <ReleaseCards releases={upcoming} upcoming />
        </>
      )}
      {!follows.length && !managing && <ManageFollows />}
      <Suggestions />
    </>
  );
}

const fromHub = (r: HubRadarRelease): Release => ({ id: r.id, title: r.title, artist: r.artist, type: r.type, released: r.released, cover: r.cover ?? undefined, deezerLink: r.link, explicit: r.explicit });

/** The artists you follow, to unfollow, and a box to follow one by name. */
function ManageFollows() {
  const follows = useFollows((s) => s.follows);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const f = await follow({ name: name.trim() });
      setMsg(`Following ${f.name}`);
      setName('');
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="radar-manage">
      <form className="row gap" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input placeholder="Follow an artist by name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn small" disabled={busy || !name.trim()}>Follow</button>
        {msg && <span className="muted small">{msg}</span>}
      </form>
      {follows.length > 0 && (
        <div className="chips">
          {follows.map((f) => (
            <span key={f.id} className="chip">
              {f.name}
              <button
                className={`chip-auto ${f.autoGetAt ? 'on' : ''}`}
                title={f.autoGetAt ? 'New releases are got automatically. Click to stop' : `Get new releases from ${f.name} automatically`}
                onClick={() => void setAutoGet(f.id, !f.autoGetAt).catch(() => undefined)}
              >Auto</button>
              <button className="chip-x" title={`Stop following ${f.name}`} onClick={() => void unfollow(f.id)}><IconX /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Artists like the ones you follow and play, and ones you play a lot but don't follow yet. */
function Suggestions() {
  const follows = useFollows((s) => s.follows.length);
  const [list, setList] = useState<HubSuggestion[]>();
  const hidden = useHidden();

  // worked out again when you follow or unfollow someone (the Hub keeps them a few hours otherwise)
  useEffect(() => {
    let alive = true;
    hubClient()?.radarSuggestions()
      .then((r) => alive && setList(r.suggestions))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [follows]);

  const notInterested = (s: HubSuggestion) => {
    setList((l) => l?.filter((x) => x.id !== s.id));
    void hubClient()?.hideSuggestion(s.id).catch(() => undefined);
  };

  const shown = (list ?? []).filter((s) => !hidden.artist({ id: '', sourceId: '', name: s.name }));
  if (!list) return <div className="row gap muted small"><Spinner /> Finding artists you might like…</div>;
  if (!shown.length) return null;
  return (
    <>
      <h3 className="dz-section">Artists you might like <small className="muted">follow them to see their new music here</small></h3>
      <div className="row-scroll radar-suggest">
        {shown.map((s) => (
          <div key={s.id} className="card radar-card">
            <Cover src={s.picture ?? undefined} alt={s.name} round />
            <div className="card-title" title={s.name}>{s.name}</div>
            <div className="card-sub" title={s.because.join(', ')}>
              <span>{s.plays ? `You played them ${s.plays} times` : s.because.length ? `Like ${s.because.slice(0, 2).join(' and ')}` : s.fans ? `${s.fans.toLocaleString()} fans` : ''}</span>
            </div>
            <div className="row gap">
              <FollowButton id={s.id} name={s.name} picture={s.picture} className="btn small" />
              <button className="icon-btn" title="Not interested" onClick={() => notInterested(s)}><IconX /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** New releases from the artists you actually play, worked out by this app (sources/releaseRadar.ts). */
function PlayedRadar({ nonce }: { nonce: number }) {
  const [data, setData] = useState<{ releases: Release[]; artists: number }>();
  const [progress, setProgress] = useState<string>();

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

  if (!data) return <div className="row gap muted small"><Spinner /> {progress ?? 'Finding your artists…'}</div>;
  if (!data.releases.length) return <p className="muted">Nothing new in the last 6 weeks from your top {data.artists} artists. Play more music (or ♥ some) and check back.</p>;
  return <ReleaseCards releases={data.releases} />;
}

/** A row of releases, each with a preview and Get (or Request), or "In library" when you have it. */
function ReleaseCards({ releases, upcoming }: { releases: Release[]; upcoming?: boolean }) {
  const [status, setStatus] = useState<Record<number, string>>({});
  const albums = useCatalog((s) => s.albums);
  const deemix = useSettings((s) => s.deemix);
  const ask = useMustRequest();
  const hidden = useHidden();

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
    <div className="row-scroll">
      {releases.filter((r) => !hidden.deezer({ type: 'album', id: r.id, title: r.title, artist: r.artist, link: r.deezerLink, explicit: r.explicit })).map((r) => {
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
            {upcoming ? (
              <span className="muted small">Out {new Date(r.released + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            ) : mine ? (
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
  );
}

/**
 * Weekly Mix: songs from this week's new releases by the artists you follow and from artists like them,
 * picked by the Hub every Friday (hub/src/radar.ts weeklyMix). They're Deezer previews, so each has Get or
 * Request, or plays the full song when it's already in your library.
 */
function WeeklyMix({ nonce }: { nonce: number }) {
  const [mix, setMix] = useState<{ week: string; tracks: HubMixTrack[] }>();
  const [err, setErr] = useState<string>();
  const [status, setStatus] = useState<Record<number, string>>({});
  const [found, setFound] = useState<Map<number, Track>>(new Map());
  const deemix = useSettings((s) => s.deemix);
  const ask = useMustRequest();
  const hidden = useHidden();

  useEffect(() => {
    let alive = true;
    setMix(undefined);
    setErr(undefined);
    setFound(new Map());
    hubClient()?.weeklyMix(nonce > 0)
      .then(async (m) => {
        if (!alive) return;
        setMix(m);
        // which of them you already have, one search at a time so a big mix doesn't flood the server
        const find = findInLibrary();
        for (const t of m.tracks) {
          const hit = await find(t);
          if (!alive) return;
          if (hit) setFound((f) => new Map(f).set(t.id, hit));
        }
      })
      .catch((e) => alive && setErr(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const owned = (t: HubMixTrack) => found.get(t.id);

  const shown = (mix?.tracks ?? []).filter((t) => !hidden.deezer({ type: 'track', id: t.id, title: t.title, artist: t.artist, link: t.link, explicit: t.explicit }));
  // the full song when you have it, otherwise the preview
  const asTrack = (t: HubMixTrack): Track | undefined => owned(t) ?? (t.preview
    ? { id: `preview:${t.preview}`, sourceId: 'preview', kind: 'track' as const, title: t.title, artist: t.artist, album: `${t.album} (preview)`, coverUrl: t.cover ?? undefined, streamUrl: t.preview, duration: 30 }
    : undefined);
  const playFrom = (i: number) => {
    const list = shown.slice(i).map(asTrack).filter((t): t is Track => !!t);
    if (list.length) usePlayer.getState().playTracks(list);
  };

  const get = async (t: HubMixTrack) => {
    setStatus((s) => ({ ...s, [t.id]: '…' }));
    try {
      if (mustRequest()) {
        await requestMusic({ link: t.link, kind: 'track', title: t.title, artist: t.artist, cover: t.cover ?? undefined });
        setStatus((s) => ({ ...s, [t.id]: 'Requested' }));
      } else {
        await deemixClient().addToQueue(t.link, deemix.bitrate);
        setStatus((s) => ({ ...s, [t.id]: 'Queued' }));
      }
    } catch (e) {
      setStatus((s) => ({ ...s, [t.id]: String((e as Error).message ?? e) }));
    }
  };

  if (err) return <p className="muted">Couldn’t get your Weekly Mix: {err}</p>;
  if (!mix) return <div className="row gap muted small"><Spinner /> Putting your Weekly Mix together…</div>;
  if (!shown.length) return <p className="muted">Nothing for your Weekly Mix yet. Follow a few artists (or play more music) and it fills up every Friday.</p>;
  return (
    <>
      <div className="row gap muted small radar-status">
        Week of {new Date(mix.week + 'T12:00:00').toLocaleDateString([], { dateStyle: 'medium' })} · {shown.length} songs
        <button className="btn small" onClick={() => playFrom(0)}><IconPlay /> Play all</button>
      </div>
      <ol className="mix-list">
        {shown.map((t, i) => {
          const mine = owned(t);
          const st = status[t.id];
          return (
            <li key={t.id} className="mix-row">
              <button className="icon-btn" title={mine ? 'Play' : 'Play preview'} disabled={!mine && !t.preview} onClick={() => playFrom(i)}><IconPlay /></button>
              <Cover src={t.cover ?? undefined} alt={t.album} />
              <div className="mix-text">
                <div className="ellipsis" title={t.title}>{t.title}</div>
                <div className="muted small ellipsis">{t.artist} · <span title={t.because}>{t.because}</span></div>
              </div>
              {mine ? <span className="tag">In library</span> : (
                <button className="btn small" disabled={(!deemix.url && !ask) || st === '…' || st === 'Queued' || st === 'Requested'} title={st} onClick={() => get(t)}>
                  <IconDownload /> {st && st.length < 12 ? st : ask ? 'Request' : 'Get'}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
