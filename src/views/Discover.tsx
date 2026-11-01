import { useEffect, useMemo, useRef, useState } from 'react';
import { useHubRuns } from '../lib/hubServices';
import { primaryArtist } from '../lib/match';
import { CHART_COLORS, CHART_LABELS, CHART_SHORT, GENRES, chartKey, deezerLookup, getChart, getMix, songKey, sourcesFor, type ChartEntry, type ChartSource, type Genre } from '../sources/charts';
import { norm } from '../sources/registry';
import type { Artist, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient, useHub } from '../store/hub';
import { useLibrary } from '../store/library';
import { usePlayer } from '../store/player';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Cover, Spinner } from '../components/common';
import { IconDownload, IconPause, IconPlay, IconRefresh, IconX } from '../components/Icons';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { QueueAllOnSubwave, QueueOnSubwave } from '../components/TrackButtons';
import { SongRadioButton } from '../components/SongRadioButton';
import { FollowButton } from '../components/FollowButton';
import { isMobileApp } from '../lib/platform';
import { useMustRequest } from '../lib/inbox';
import { isKid, useHidden, useIsKid } from '../lib/kids';
import { RadarStrip, ReleaseRadar } from '../components/ReleaseRadar';
import { chartMoves, moveLabel, type ChartMoves } from '../lib/chartMoves';
import { matchChart } from '../lib/discoverMatch';
import { clearGetAll, getAll, getOne, stopGetAll, useChartGets } from '../lib/chartGets';

type View = 'mix' | 'foryou' | ChartSource;
type Show = 'all' | 'missing' | 'owned';
type Row = ChartEntry & {
  lib?: Track | null;
  /** false = looked it up, Deezer has no clip */
  hasPreview?: boolean;
  /** For you: why it's here */
  because?: string;
};

const SHOW_KEY = 'tonearm.discoverShow';

/** A 30s preview as a playable (unsaveable) track. */
function previewTrack(r: ChartEntry, url: string): Track {
  return { id: `preview:${url}`, sourceId: 'preview', kind: 'track', title: r.title, artist: r.artist, album: '30-second preview', coverUrl: r.cover, streamUrl: url, duration: 30, explicit: r.explicit ? 'explicit' : undefined };
}

/** The artist's page in the library when you have them, else their Deezer discography. */
function goArtist(name: string) {
  const artists = useCatalog.getState().artists;
  const main = primaryArtist(name);
  const a = artists.find((x) => norm(x.name) === norm(name)) ?? artists.find((x) => norm(x.name) === norm(main));
  const ui = useUi.getState();
  if (a) ui.go({ view: 'artist', artist: a });
  else ui.go({ view: 'artistReleases', artist: { id: '', sourceId: '', name: main } as Artist });
}

export function Discover({ initialGenre }: { initialGenre?: Genre } = {}) {
  const [genre, setGenre] = useState<Genre>(initialGenre ?? 'all');
  const [view, setView] = useState<View>('mix');
  const [rows, setRows] = useState<Row[]>();
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [checked, setChecked] = useState(0);
  const [moves, setMoves] = useState<ChartMoves>();
  const [show, setShowState] = useState<Show>(() => {
    try {
      return (localStorage.getItem(SHOW_KEY) as Show | null) ?? 'all';
    } catch {
      return 'all';
    }
  });
  const setShow = (s: Show) => {
    setShowState(s);
    try {
      localStorage.setItem(SHOW_KEY, s);
    } catch {
      /* non-essential */
    }
  };
  const [showHidden, setShowHidden] = useState(false);
  const [justHidden, setJustHidden] = useState<{ key: string; title: string }>();
  const [confirming, setConfirming] = useState(false);
  const custom = useSettings((s) => s.discoverCharts);
  const notInterested = useSettings((s) => s.discoverHidden);
  const setNotInterested = useSettings((s) => s.setDiscoverHidden);
  const signedIn = useHub((s) => !!s.token);
  const available = sourcesFor(genre, custom);
  // switching genre can remove the current tab (e.g. Billboard has no current rap chart)
  useEffect(() => {
    if (view !== 'mix' && view !== 'foryou' && !available.includes(view)) setView('mix');
    if (view === 'foryou' && !signedIn) setView('mix');
  }, [genre, available.join(), signedIn]);
  const [nonce, setNonce] = useState(0);
  const deemix = useSettings((s) => s.deemix);
  const yt = useSettings((s) => s.ytdlp);
  const playTracks = usePlayer((s) => s.playTracks);
  const run = useRef(0);
  /** Refresh skips this app's 30-minute copy of the charts (the Hub keeps its own). */
  const fresh = useRef(false);

  // load the chart, then check the songs against the library in the background
  useEffect(() => {
    const id = ++run.current;
    const alive = () => id === run.current;
    const force = fresh.current;
    fresh.current = false;
    setRows(undefined);
    setError(undefined);
    setInfo(undefined);
    setChecked(0);
    setMoves(undefined);
    setConfirming(false);
    (async () => {
      try {
        let entries: Row[];
        if (view === 'mix' || view === 'foryou') {
          const m = await getMix(genre, available, force);
          entries = m.entries;
          if (!m.used.length) throw new Error(m.failed.map((f) => f.reason).join(' · ') || "Couldn't reach any chart service.");
          if (m.failed.length) setError(`Skipped: ${m.failed.map((f) => f.reason).join(' · ')}`);
          if (view === 'foryou') {
            const hub = hubClient();
            if (!hub) throw new Error('For you needs a Wavelength Hub.');
            const r = await hub.discoverForYou(entries.map((e) => ({ title: e.title, artist: e.artist })));
            if (!alive()) return;
            entries = entries
              .map((e, i) => ({ e, s: r.scores[i] ?? { score: 0 } }))
              .filter((x) => x.s.score > 0)
              .sort((a, b) => b.s.score - a.s.score || a.e.rank - b.e.rank)
              .map((x, i) => ({ ...x.e, rank: i + 1, because: x.s.because }));
            setInfo(r.basis
              ? `Songs from ${m.used.map((s) => CHART_LABELS[s]).join(' + ')} close to what you play, best match first`
              : undefined);
            if (!r.basis) throw new Error('Play some music first: For you picks chart songs by the artists you listen to.');
            if (!entries.length) throw new Error(`Nothing on these ${GENRES.find((g) => g.id === genre)!.label} charts is close to what you play yet. Try another genre.`);
          } else setInfo(`Combining ${m.used.map((s) => CHART_LABELS[s]).join(' + ')}`);
        } else {
          const c = await getChart(view, genre, force);
          entries = c.entries;
          setInfo(c.asOf ? `${CHART_LABELS[view]} · ${c.asOf}` : CHART_LABELS[view]);
          if (!entries.length) throw new Error(`${CHART_LABELS[view]} has no ${GENRES.find((g) => g.id === genre)!.label} songs right now.`);
        }
        if (!alive()) return;
        setRows(entries);
        // movement: the For you order is personal, so it has none
        if (view !== 'foryou') {
          chartMoves(chartKey(view, genre, available), entries).then((m) => alive() && setMoves(m), () => undefined);
        }
        let done = 0;
        const kid = isKid();
        await matchChart(entries, (i, hit) => {
          if (!alive()) return;
          const e = entries[i];
          setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, lib: hit } : r)));
          setChecked(++done);
          // kids: a song not in the library has no rating from the server, so ask Deezer before it's shown
          if (kid && !hit && e.explicit === undefined) {
            deezerLookup(e).catch(() => ({}) as Awaited<ReturnType<typeof deezerLookup>>).then((look) => {
              if (!alive()) return;
              setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, explicit: look.explicit, preview: r.preview ?? look.preview, hasPreview: look.preview ? true : r.hasPreview } : r)));
            });
          }
        }, alive);
      } catch (e) {
        if (alive()) setError(String((e as Error).message ?? e));
      }
    })();
  }, [genre, view, nonce, available.join()]);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const hubYt = useHubRuns('ytdlp');
  const ask = useMustRequest();
  const hidden = useHidden();
  const kid = useIsKid();
  const gets = useChartGets((s) => s.songs);
  const job = useChartGets((s) => s.job);
  /**
   * Kid profiles: hidden when explicit or flagged. A song not in the library stays hidden until Deezer has said
   * whether it's explicit, so nothing unrated slips through while the library check runs.
   */
  const kidHidden = (r: Row) => {
    if (!kid) return false;
    if (r.lib) return hidden.track(r.lib);
    if (r.explicit === undefined) return true;
    return hidden.track({ kind: 'track', id: '', sourceId: '', title: r.title, artist: r.artist, explicit: r.explicit ? 'explicit' : 'clean' });
  };
  const hiddenSet = useMemo(() => new Set(notInterested), [notInterested]);
  const isNotInterested = (r: Row) => hiddenSet.has(songKey(r));
  const ytAvailable = hubYt || (!isMobileApp && !!yt.outDir);
  const nowPlayingId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);

  /** Play (or stop) the 30s Deezer clip for a song you don't own yet. */
  const preview = async (i: number) => {
    const r = rows![i];
    const found = r.preview ? undefined : await deezerLookup(r);
    const url = r.preview ?? found?.preview;
    const explicit = r.explicit ?? found?.explicit;
    if (!url) return patch(i, { hasPreview: false, explicit });
    patch(i, { preview: url, hasPreview: true, explicit });
    if (nowPlayingId === `preview:${url}`) return usePlayer.getState().toggle();
    playTracks([previewTrack({ ...r, explicit }, url)]);
  };

  const hide = (r: Row) => {
    setNotInterested(songKey(r), true);
    setJustHidden({ key: songKey(r), title: r.title });
  };

  const all = (rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !kidHidden(r));
  const wanted = all.filter(({ r }) => !isNotInterested(r));
  const owned = wanted.filter(({ r }) => r.lib).map(({ r }) => r.lib!) as Track[];
  const missing = wanted.filter(({ r }) => r.lib === null && gets[songKey(r)]?.state !== 'queued' && gets[songKey(r)]?.state !== 'sending').map(({ r }) => r);
  const hiddenHere = all.filter(({ r }) => isNotInterested(r)).length;
  const shown = all.filter(({ r }) => (showHidden || !isNotInterested(r)) && (show === 'all' || (show === 'missing' ? r.lib === null : !!r.lib)));
  const total = rows?.length ?? 0;
  const label = `${view === 'mix' ? 'Mix' : view === 'foryou' ? 'For you' : CHART_LABELS[view]} · ${GENRES.find((g) => g.id === genre)!.label}`;
  const since = moves?.since ? new Date(`${moves.since}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Discover</h1>
        <button className="btn small" onClick={() => {
          fresh.current = true;
          setNonce(nonce + 1);
        }}><IconRefresh /> Refresh</button>
        <button className="btn small ghost" onClick={() => {
          useUi.getState().go({ view: 'settings', tab: 'discover' });
        }} title="Pick which charts each genre uses">Edit charts</button>
      </header>
      <div className="chips">
        {GENRES.map((g) => <button key={g.id} className={`chip ${genre === g.id ? 'on' : ''}`} onClick={() => setGenre(g.id)}>{g.label}</button>)}
      </div>

      {genre === 'new' ? <ReleaseRadar /> : <RadarStrip onSeeAll={() => setGenre('new')} />}
      {genre === 'new' && <h2 className="mt">Editors' new music</h2>}

      <div className="tabs">
        <button className={view === 'mix' ? 'on' : ''} onClick={() => setView('mix')}>Mix <small>all charts combined</small></button>
        {signedIn && <button className={view === 'foryou' ? 'on' : ''} onClick={() => setView('foryou')} title="The combined chart, only songs close to what you play">For you</button>}
        {available.map((s) => (
          <button key={s} className={view === s ? 'on' : ''} onClick={() => setView(s)}>{CHART_LABELS[s]}</button>
        ))}
      </div>

      {info && <div className="muted small chart-info">{info}{since && <> · movement since {since}</>}</div>}
      {error && <div className="errors">{error}</div>}
      {job && (
        <div className={`getall-job ${job.running ? '' : 'done'}`} role="status">
          <span>
            {job.running
              ? <>{ask ? 'Requesting' : 'Getting'} {job.total} songs from {job.label} · {job.done} of {job.total}</>
              : <>{job.stopped ? 'Stopped' : 'Done'}: {job.done - job.failed} of {job.total} {ask ? 'requested' : 'sent'}{job.failed ? `, ${job.failed} couldn't be (see the rows)` : ''}</>}
          </span>
          <progress max={job.total} value={job.done} />
          {job.running ? <button className="btn small ghost" onClick={stopGetAll}>Stop</button> : <button className="btn small ghost" onClick={clearGetAll}>Dismiss</button>}
        </div>
      )}
      {rows && (
        <div className="discover-bar">
          <span className="muted small">
            {checked < total ? <>Checking your library… {checked}/{total}</> : <>{owned.length} of {total} already in your library</>}
          </span>
          <div className="seg" role="group" aria-label="Show">
            <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button>
            <button className={show === 'missing' ? 'on' : ''} onClick={() => setShow('missing')} title="Only songs your library doesn't have">Don't have</button>
            <button className={show === 'owned' ? 'on' : ''} onClick={() => setShow('owned')} title="Only songs already in your library">Have</button>
          </div>
          <button className="btn small primary" disabled={!owned.length} onClick={() => playTracks(owned)}><IconPlay /> Play what I have</button>
          <AddToPlaylist tracks={() => owned} label="Save owned as playlist" className="btn small" />
          {owned.length > 0 && <QueueAllOnSubwave tracks={() => owned} className="btn small" />}
          {confirming ? (
            <span className="confirm-inline">
              {ask ? `Request ${missing.length} songs from your Hub admin?` : `Send ${missing.length} songs to ${deemix.url ? 'deemix' : 'yt-dlp'}?`}
              <button className="btn small primary" onClick={() => {
                setConfirming(false);
                getAll(missing, label);
              }}>Yes</button>
              <button className="btn small ghost" onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn small" disabled={!missing.length || checked < total || !!job?.running} title={job?.running ? 'Already getting songs' : undefined} onClick={() => setConfirming(true)}>
              <IconDownload /> {ask ? 'Request' : 'Get'} all missing ({missing.length})
            </button>
          )}
          <button className="btn small ghost" disabled={!owned.length} onClick={() => {
            const id = useLibrary.getState().createPlaylist(`${label} — ${new Date().toLocaleDateString()}`, owned);
            useUi.getState().go({ view: 'playlist', id });
          }}>New playlist from chart</button>
        </div>
      )}
      {(justHidden || hiddenHere > 0) && rows && (
        <div className="muted small hidden-note">
          {justHidden && notInterested.includes(justHidden.key) && (
            <>Hid “{justHidden.title}” from Discover. <button className="link small" onClick={() => {
              setNotInterested(justHidden.key, false);
              setJustHidden(undefined);
            }}>Undo</button>{hiddenHere > 0 && ' · '}</>
          )}
          {hiddenHere > 0 && <button className="link small" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Hide' : 'Show'} {hiddenHere} you're not interested in</button>}
        </div>
      )}

      {!rows ? (error ? null : <Spinner />) : (
        <div className="tracklist">
          {!shown.length && <p className="muted">{show === 'missing' ? (checked < total ? 'Still checking your library…' : 'You have every song on this chart.') : show === 'owned' ? (checked < total ? 'Still checking your library…' : 'None of these are in your library yet.') : 'Nothing to show.'}</p>}
          {shown.map(({ r, i }) => {
            const key = songKey(r);
            const dl = gets[key];
            const off = isNotInterested(r);
            const mv = view === 'foryou' ? undefined : moves?.moves[i];
            const move = moveLabel(r.rank, mv, moves?.since ?? null);
            return (
              <div key={`${i}:${r.title}`} className={`track-row chart-row ${r.lib ? 'owned' : ''} ${off ? 'not-interested' : ''}`} onDoubleClick={() => r.lib && playTracks([r.lib])}>
                <div className="chart-rank">
                  {r.rank}
                  {move && (
                    <span className={`chart-move ${move.kind}`} title={mv?.prev ? `#${mv.prev} on ${since}` : `Not on this chart on ${since}`}>{move.text}</span>
                  )}
                </div>
                <Cover src={r.cover ?? r.lib?.coverUrl} alt={r.title} className="tiny" />
                <div className="track-main">
                  <div className="track-title">{r.title}</div>
                  <div className="track-sub">
                    <button className="sub-link" title="Go to artist" onClick={(e) => { e.stopPropagation(); goArtist(r.artist); }}>{r.artist}</button>
                    {mv && mv.weeks >= 2 && <span className="chart-weeks" title={`${mv.weeks} weeks in a row on this chart`}> · {mv.weeks} wks</span>}
                    {r.because && <span className="chart-because"> · {r.because}</span>}
                  </div>
                </div>
                {(view === 'mix' || view === 'foryou') && (
                  <div className="chart-badges">
                    {r.sources.map((s) => (
                      <span key={s.source} title={`#${s.rank} on ${CHART_LABELS[s.source]}`} style={{ background: CHART_COLORS[s.source] }}>
                        {CHART_SHORT[s.source]}{s.rank}
                      </span>
                    ))}
                  </div>
                )}
                {r.lib === null && (
                  <button className={`icon-btn preview-btn ${r.preview && nowPlayingId === `preview:${r.preview}` ? 'on' : ''}`}
                    disabled={r.hasPreview === false}
                    title={r.hasPreview === false ? 'No preview available' : 'Play a 30-second preview'}
                    onClick={(e) => { e.stopPropagation(); preview(i); }}>
                    {r.preview && nowPlayingId === `preview:${r.preview}` && playing ? <IconPause /> : <IconPlay />}
                  </button>
                )}
                <div className="chart-action">
                  <span className="chart-more">
                    <SongRadioButton artist={primaryArtist(r.artist)} track={r.lib ?? undefined} className="chip" />
                    <FollowButton name={primaryArtist(r.artist)} className="chip" />
                  </span>
                  {r.lib === undefined ? <span className="muted small">checking…</span>
                    : r.lib ? (
                      <>
                        <QueueOnSubwave track={r.lib} />
                        <AddToPlaylist tracks={[r.lib]} />
                        <button className="btn small primary" onClick={() => playTracks([r.lib!])}><IconPlay /> Play</button>
                      </>
                    ) : dl?.state === 'queued' ? <span className="ok small">{dl.via === 'request' ? 'Requested' : `Queued via ${dl.via}`}</span>
                    : dl?.state === 'error' ? (
                      <div className="dl-err">
                        <span className="card-err" title={dl.msg}>{dl.msg}</span>
                        {!dl.notOnDeezer && <button className="btn small" onClick={() => void getOne(r)}>{ask ? 'Retry' : 'Retry deemix'}</button>}
                        {ytAvailable && <button className="btn small ghost" onClick={() => void getOne(r, 'ytdlp')}>Use yt-dlp</button>}
                      </div>
                    )
                    : <button className="btn small" disabled={dl?.state === 'sending'} onClick={() => void getOne(r)}><IconDownload /> {dl?.state === 'sending' ? '…' : ask ? 'Request' : 'Get'}</button>}
                  {off
                    ? <button className="btn small ghost" title="Show this song in Discover again" onClick={() => setNotInterested(key, false)}>Show again</button>
                    : <button className="icon-btn not-interested-btn" title="Not interested: hide this song from Discover" aria-label="Not interested" onClick={(e) => { e.stopPropagation(); hide(r); }}><IconX /></button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
