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
  if (!hasAbs) return <Empty title="No Audiobookshelf connected">Add your Audiobookshelf server in Settings.</Empty>;
  const f = filter.toLowerCase();
  const shown = podcasts.filter((p) => !f || p.title.toLowerCase().includes(f) || p.author.toLowerCase().includes(f));
  return (
    <div className="page">
      <header className="page-head">
        <h1>Podcasts <small>{shown.length}</small></h1>
        {loading && <Spinner />}
        <input className="filter" placeholder="Filter podcasts…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </header>
      {!loading && !podcasts.length && <Empty title="No podcasts">Your Audiobookshelf has no podcast libraries yet.</Empty>}
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

  const shown = episodes?.filter((e) => !hidePlayed || (e.progress ?? 0) < 1) ?? [];
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
                const i = resume ? episodes.indexOf(resume) : 0;
                playTracks(episodes, i);
              }}><IconPlay /> {resume ? 'Resume' : 'Play latest'}</button>
            ) : null}
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
