import { useEffect, useState } from 'react';
import { sourceFor } from '../sources/registry';
import type { Podcast, Track } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { AddToPlaylist } from '../components/AddToPlaylist';
import { Cover, Empty, Grid, Spinner, TrackList } from '../components/common';
import { IconPlay } from '../components/Icons';
import { SortSelect } from '../components/SortSelect';
import { EPISODE_SORTS, PODCAST_SORTS, saveChoice, savedChoice, sortEpisodes, sortPodcasts, type EpisodeSort, type PodcastSort } from '../lib/shelfSort';

const SORT_KEY = 'wavelength.podcastsSort';
const EPISODE_SORT_KEY = 'wavelength.episodesSort';

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
  const { podcasts, loading } = useCatalog();
  const hasAbs = useSettings((s) => s.sources.some((x) => x.kind === 'audiobookshelf' && x.enabled));
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<PodcastSort>(() => savedChoice(SORT_KEY, PODCAST_SORTS, 'updated'));
  if (!hasAbs) return <Empty title="No Audiobookshelf connected">Add your Audiobookshelf server in Settings.</Empty>;
  const f = filter.toLowerCase();
  const shown = sortPodcasts(podcasts.filter((p) => !f || p.title.toLowerCase().includes(f) || p.author.toLowerCase().includes(f)), sort);
  return (
    <div className="page">
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
    </div>
  );
}

export function PodcastView({ podcast }: { podcast: Podcast }) {
  const cfg = useSettings((s) => s.sources.find((x) => x.id === podcast.sourceId));
  const playTracks = usePlayer((s) => s.playTracks);
  const [episodes, setEpisodes] = useState<Track[] | null>(null);
  const [error, setError] = useState<string>();
  const [hidePlayed, setHidePlayed] = useState(false);
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

  const shown = sortEpisodes(episodes?.filter((e) => !hidePlayed || (e.progress ?? 0) < 1) ?? [], sort);
  const resume = episodes?.find((e) => e.progress && e.progress > 0 && e.progress < 1);

  return (
    <div className="page">
      <header className="hero">
        <Cover src={podcast.coverUrl} alt={podcast.title} className="hero-art" />
        <div>
          <div className="kicker">Podcast</div>
          <h1>{podcast.title}</h1>
          <div className="muted">{podcast.author}</div>
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
          </div>
        </div>
      </header>
      {podcast.description && <p className="muted desc">{stripTags(podcast.description).slice(0, 400)}</p>}
      {error && <div className="errors">{error}</div>}
      {!episodes && !error ? <Spinner /> : (
        <TrackList tracks={shown}
          sub={(t) => t.description || t.artist}
          meta={(t) => (t.publishedAt ? new Date(t.publishedAt).toLocaleDateString() : '')} />
      )}
    </div>
  );
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
