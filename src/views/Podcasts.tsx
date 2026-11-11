import { useEffect, useMemo, useState } from 'react';
import { sourceFor } from '../sources/registry';
import type { Podcast, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { enabledSources, useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { Cover, Empty, Grid, Spinner, TrackList } from '../components/common';
import { IconPlay } from '../components/Icons';
import { SortSelect } from '../components/SortSelect';
import { useTabStrip } from '../components/TabStrip';
import { EPISODE_SORTS, PODCAST_SORTS, saveChoice, savedChoice, sortEpisodes, sortPodcasts, type EpisodeSort, type PodcastSort } from '../lib/shelfSort';
import {
  filterLatest,
  isPlayed,
  isStarted,
  LATEST_DAYS,
  loadInProgress,
  mergeEpisodes,
  savedLatestFilter,
  saveLatestFilter,
  setPlayed,
  timeLeft,
  useMarks,
  withMarks,
  episodeDate,
  type LatestFilter,
} from '../lib/episodes';

const SORT_KEY = 'wavelength.podcastsSort';
const EPISODE_SORT_KEY = 'wavelength.episodesSort';
const TAB_KEY = 'wavelength.podcastsTab';

type Tab = 'latest' | 'shows';
const TABS: [Tab, string][] = [
  ['latest', 'Latest episodes'],
  ['shows', 'Shows'],
];

export function PodcastCard({ podcast }: { podcast: Podcast }) {
  return (
    <button className="card" onClick={() => useUi.getState().go({ view: 'podcast', podcast })}>
      <Cover src={podcast.coverUrl} alt={podcast.title} />
      <div className="card-title" title={podcast.title}>{podcast.title}</div>
      <div className="card-sub"><span>{podcast.author}{podcast.episodeCount ? ` · ${podcast.episodeCount} episodes` : ''}</span></div>
    </button>
  );
}

export function Podcasts() {
  const hasAbs = useSettings((s) => s.sources.some((x) => x.kind === 'audiobookshelf' && x.enabled));
  const [tab, setTab] = useState<Tab>(() => savedChoice(TAB_KEY, TABS, 'latest'));
  const tabsRef = useTabStrip();
  if (!hasAbs) return <Empty title="No Audiobookshelf connected">Add your Audiobookshelf server in Settings.</Empty>;
  return (
    <div className="page">
      <div className="tabs podcast-tabs" ref={tabsRef}>
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); saveChoice(TAB_KEY, k); }}>{label}</button>
        ))}
      </div>
      {tab === 'latest' ? <LatestEpisodes /> : <Shows />}
    </div>
  );
}

function Shows() {
  const { podcasts, loading } = useCatalog();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<PodcastSort>(() => savedChoice(SORT_KEY, PODCAST_SORTS, 'updated'));
  const f = filter.toLowerCase();
  const shown = sortPodcasts(podcasts.filter((p) => !f || p.title.toLowerCase().includes(f) || p.author.toLowerCase().includes(f)), sort);
  return (
    <>
      <header className="page-head">
        <h1>Podcasts <small>{shown.length}</small></h1>
        {loading && <Spinner />}
        <input className="filter" placeholder="Filter podcasts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {!loading && !podcasts.length && <Empty title="No podcasts">Your Audiobookshelf has no podcast libraries yet.</Empty>}
      {podcasts.length > 1 && (
        <div className="shelf-bar">
          <SortSelect value={sort} options={PODCAST_SORTS} onChange={(v) => { setSort(v); saveChoice(SORT_KEY, v); }} />
        </div>
      )}
      <Grid>{shown.map((p) => <PodcastCard key={p.id} podcast={p} />)}</Grid>
    </>
  );
}

/** An episode row's second line: the show (a link to it), then how far you are. */
function EpisodeSub({ t, showLink = true }: { t: Track; showLink?: boolean }) {
  const podcasts = useCatalog((s) => s.podcasts);
  const show = showLink ? podcasts.find((p) => p.id === t.bookId && p.sourceId === t.sourceId) : undefined;
  const state = isPlayed(t) ? 'Played' : timeLeft(t.duration, t.progress);
  return (
    <>
      {show ? <button className="sub-link" title="Go to show" onClick={() => useUi.getState().go({ view: 'podcast', podcast: show })}>{t.album}</button> : showLink ? t.album : null}
      {state ? <>{showLink ? ' · ' : ''}<span className={isPlayed(t) ? 'ep-played' : 'ep-left'}>{state}</span></> : null}
      {!showLink && t.description ? <>{state ? ' · ' : ''}{t.description}</> : null}
    </>
  );
}

function EpisodeCard({ t, onPlay }: { t: Track; onPlay: () => void }) {
  return (
    <button className="card" onClick={onPlay} title={`Resume ${t.title}`}>
      <div className="book-cover">
        <Cover src={t.coverUrl} alt={t.album ?? t.title} />
        {t.progress ? <div className="progress"><i style={{ width: `${Math.round(t.progress * 100)}%` }} /></div> : null}
        <span className="cover-play"><IconPlay /></span>
      </div>
      <div className="card-title" title={t.title}>{t.title}</div>
      <div className="card-sub"><span>{t.album}{timeLeft(t.duration, t.progress) ? ` · ${timeLeft(t.duration, t.progress)}` : ''}</span></div>
    </button>
  );
}

/**
 * Podcasts → Latest episodes: every show's new episodes in one list, outside their shows. Pick the shows you want
 * (or all of them), leave out what you've heard, and Play runs through the list in order.
 */
function LatestEpisodes() {
  const podcasts = useCatalog((s) => s.podcasts);
  const sources = useSettings((s) => s.sources);
  const marks = useMarks((s) => s.marks);
  const playTracks = usePlayer((s) => s.playTracks);
  const [filter, setFilterState] = useState<LatestFilter>(savedLatestFilter);
  const [recent, setRecent] = useState<Track[] | null>(null);
  const [perShow, setPerShow] = useState<Record<string, Track[]>>({});
  const [inProgress, setInProgress] = useState<Track[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const setFilter = (f: Partial<LatestFilter>) => {
    const next = { ...filter, ...f };
    setFilterState(next);
    saveLatestFilter(next);
  };

  // every server's latest-episodes list, and what you're part way through
  useEffect(() => {
    let alive = true;
    const srcs = enabledSources().map(sourceFor).filter((s) => s.getLatestEpisodes);
    const errs: string[] = [];
    Promise.all(srcs.map((s) => s.getLatestEpisodes!().catch((e: Error) => {
      errs.push(`${s.config.name}: ${e.message ?? e}`);
      return [] as Track[];
    }))).then((lists) => {
      if (!alive) return;
      setRecent(mergeEpisodes(lists));
      setErrors(errs);
    });
    loadInProgress().then((l) => alive && setInProgress(l));
    return () => {
      alive = false;
    };
  }, [sources, reload]);

  // a show you picked is read in full, so one you're catching up on isn't cut off by the server's latest list
  const picked = podcasts.filter((p) => filter.shows.includes(p.id));
  useEffect(() => {
    let alive = true;
    for (const p of picked) {
      if (perShow[p.id]) continue;
      const cfg = sources.find((s) => s.id === p.sourceId);
      const src = cfg && sourceFor(cfg);
      src?.getEpisodes?.(p.id).then((list) => alive && setPerShow((m) => ({ ...m, [p.id]: list }))).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [filter.shows.join(','), podcasts, reload]);

  const all = withMarks(mergeEpisodes([recent ?? [], ...picked.map((p) => perShow[p.id] ?? [])]), marks);
  const shown = filterLatest(all, filter);
  const continuing = withMarks(inProgress, marks).filter(isStarted);
  // shows with something new first, so the picker starts with the ones you're likely to want
  const showList = sortPodcasts(podcasts, 'updated');
  const unplayedByShow = new Map<string, number>();
  for (const t of all) if (!isPlayed(t) && t.bookId) unplayedByShow.set(t.bookId, (unplayedByShow.get(t.bookId) ?? 0) + 1);

  const toggleShow = (id: string) => setFilter({ shows: filter.shows.includes(id) ? filter.shows.filter((x) => x !== id) : [...filter.shows, id] });
  const markAll = async () => {
    if (!shown.length || !window.confirm(`Mark ${shown.length} episode${shown.length === 1 ? '' : 's'} as played?`)) return;
    setBusy(true);
    try {
      await setPlayed(shown, true);
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {continuing.length > 0 && (
        <section>
          <h2>Continue listening</h2>
          <div className="row-scroll">{continuing.map((t, i) => <EpisodeCard key={`${t.sourceId}:${t.id}`} t={t} onPlay={() => playTracks(continuing, i)} />)}</div>
        </section>
      )}
      <div className="latest-head">
        <h2>Latest episodes {recent ? <small className="muted">{shown.length}</small> : null}</h2>
        {!recent && <Spinner />}
        <button className="btn ghost small" onClick={() => { setPerShow({}); setReload((n) => n + 1); }} title="Look for new episodes">Refresh</button>
      </div>
      <div className="shelf-bar">
        <button className="btn primary" disabled={!shown.length} onClick={() => playTracks(shown, 0)}>
          <IconPlay /> {shown.length ? `Play ${shown.length} episode${shown.length === 1 ? '' : 's'}` : 'Play'}
        </button>
        <select aria-label="Order" value={filter.order} onChange={(e) => setFilter({ order: e.target.value as LatestFilter['order'] })}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <div className="chips" role="group" aria-label="Out">
          {LATEST_DAYS.map(([d, label]) => (
            <button key={d} className={`chip ${filter.days === d ? 'on' : ''}`} onClick={() => setFilter({ days: d })}>{label}</button>
          ))}
        </div>
        <label className="row gap small muted"><input type="checkbox" checked={filter.unplayedOnly} onChange={(e) => setFilter({ unplayedOnly: e.target.checked })} /> Unplayed only</label>
        {shown.length > 0 && <AddToPlaylist tracks={() => shown} label="Add to playlist" className="btn ghost small" />}
        {shown.some((t) => !isPlayed(t)) && <button className="btn ghost small" disabled={busy} onClick={markAll}>Mark all played</button>}
      </div>
      {podcasts.length > 1 && (
        <div className="show-picker">
          <div className="chips" role="group" aria-label="Shows">
            <button className={`chip ${!filter.shows.length ? 'on' : ''}`} onClick={() => setFilter({ shows: [] })}>All shows</button>
            {(picking ? showList : showList.filter((p) => filter.shows.includes(p.id) || unplayedByShow.has(p.id)).slice(0, picking ? undefined : 12)).map((p) => (
              <button key={p.id} className={`chip show-chip ${filter.shows.includes(p.id) ? 'on' : ''}`} onClick={() => toggleShow(p.id)} title={p.title}>
                <Cover src={p.coverUrl} alt={p.title} className="tiny" />
                <span>{p.title}</span>
                {unplayedByShow.get(p.id) ? <small>{unplayedByShow.get(p.id)}</small> : null}
              </button>
            ))}
            <button className="chip ghost" onClick={() => setPicking(!picking)}>{picking ? 'Fewer' : 'Every show…'}</button>
          </div>
        </div>
      )}
      {errors.length > 0 && <div className="errors">{errors.join('\n')}</div>}
      {recent && !shown.length ? (
        <p className="muted">
          {filter.unplayedOnly && all.length ? "You're all caught up. " : 'No episodes here. '}
          {filter.unplayedOnly || filter.days || filter.shows.length ? 'Try showing played episodes, a longer time or more shows.' : ''}
        </p>
      ) : (
        <TrackList tracks={shown} showCover sub={(t) => <EpisodeSub t={t} />} meta={(t) => episodeDate(t.publishedAt)} />
      )}
    </>
  );
}

export function PodcastView({ podcast }: { podcast: Podcast }) {
  const cfg = useSettings((s) => s.sources.find((x) => x.id === podcast.sourceId));
  const playTracks = usePlayer((s) => s.playTracks);
  const marks = useMarks((s) => s.marks);
  const [loaded, setEpisodes] = useState<Track[] | null>(null);
  const [error, setError] = useState<string>();
  const [hidePlayed, setHidePlayed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<EpisodeSort>(() => savedChoice(EPISODE_SORT_KEY, EPISODE_SORTS, 'newest'));

  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    sourceFor(cfg).getEpisodes!(podcast.id)
      .then((e) => alive && setEpisodes(e))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [podcast.id]);

  const episodes = useMemo(() => (loaded ? withMarks(loaded, marks) : null), [loaded, marks]);
  const shown = sortEpisodes(episodes?.filter((e) => !hidePlayed || !isPlayed(e)) ?? [], sort);
  const resume = episodes?.find(isStarted);
  const unplayed = episodes?.filter((e) => !isPlayed(e)).length ?? 0;

  const markAll = async (played: boolean) => {
    const list = shown.filter((e) => isPlayed(e) !== played);
    if (!list.length || !window.confirm(`Mark ${list.length} episode${list.length === 1 ? '' : 's'} as ${played ? 'played' : 'unplayed'}?`)) return;
    setBusy(true);
    try {
      await setPlayed(list, played);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <Cover src={podcast.coverUrl} alt={podcast.title} className="hero-art" />
        <div>
          <div className="kicker">Podcast</div>
          <h1>{podcast.title}</h1>
          <div className="muted">{podcast.author}{episodes ? ` · ${episodes.length} episodes · ${unplayed} unplayed` : ''}</div>
          <div className="hero-actions">
            {episodes?.length ? (
              <button className="btn primary" onClick={() => {
                // plays on through the list in the order shown (oldest first plays a show from the start)
                const list = shown.length ? shown : episodes;
                const i = resume && list.includes(resume) ? list.indexOf(resume) : 0;
                playTracks(list, i);
              }}><IconPlay /> {resume ? 'Resume' : sort === 'oldest' ? 'Play from the start' : 'Play latest'}</button>
            ) : null}
            <SortSelect value={sort} options={EPISODE_SORTS} onChange={(v) => { setSort(v); saveChoice(EPISODE_SORT_KEY, v); }} />
            <label className="row gap small muted"><input type="checkbox" checked={hidePlayed} onChange={(e) => setHidePlayed(e.target.checked)} /> Hide played</label>
            {episodes?.length ? <AddToPlaylist tracks={() => shown} label="Add all to playlist" className="btn" /> : null}
            {unplayed > 0 && <button className="btn ghost" disabled={busy} onClick={() => markAll(true)}>Mark all played</button>}
            {episodes && unplayed < episodes.length && !hidePlayed && <button className="btn ghost" disabled={busy} onClick={() => markAll(false)}>Mark all unplayed</button>}
          </div>
        </div>
      </header>
      {podcast.description && <p className="muted desc">{stripTags(podcast.description).slice(0, 400)}</p>}
      {error && <div className="errors">{error}</div>}
      {!episodes && !error ? <Spinner /> : (
        <TrackList tracks={shown}
          sub={(t) => <EpisodeSub t={t} showLink={false} />}
          meta={(t) => episodeDate(t.publishedAt)} />
      )}
    </div>
  );
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
