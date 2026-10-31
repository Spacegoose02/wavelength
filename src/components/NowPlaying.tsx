import { trackArt, useArtworkList } from '../lib/artwork';
import { usePlayer } from '../store/player';
import { Cover, fmtTime } from './common';
import { IconChevronDown, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconShuffle } from './Icons';
import { Visualizer } from './Visualizer';
import { NowPlayingStage } from './Scenes';
import { AddToPlaylist } from './AddToPlaylist';
import { EqButton } from './Equalizer';
import { DevicesButton } from './Devices';
import { TogetherButton } from './Together';
import { RadioGetButton } from './RadioGetButton';
import { SongRadioButton } from './SongRadioButton';
import { SleepButton } from './SleepButton';
import { LyricsPanel } from './Lyrics';
import { useState } from 'react';
import { useCatalog } from '../store/catalog';
import { useUi } from '../store/ui';
import { albumOfTrack, artistOfTrack } from '../lib/trackLinks';
import type { Track } from '../sources/types';

/** Full-screen Plexamp-style view: blurred artwork backdrop, big art, big visualizer. */
export function NowPlaying() {
  const p = usePlayer();
  const [showLyrics, setShowLyrics] = useState(false);
  const close = () => window.history.back(); // pops the entry setNowPlaying(true) pushed
  const t = p.current();
  const albums = useCatalog((s) => s.albums);
  const artists = useCatalog((s) => s.artists);
  useArtworkList();
  if (!t) return null;
  const live = t.kind === 'radio';
  const art = p.liveCover ?? trackArt(t);
  const upNext = p.queue.slice(p.index + 1, p.index + 8);
  const album = albumOfTrack(t, albums);
  const artist = artistOfTrack(t, artists, album);
  const go = useUi.getState().go; // closes Now Playing

  return (
    <div className="np">
      <div className="np-bg" style={{ backgroundImage: art ? `url("${art}")` : undefined }} />
      <button className="np-close" onClick={close} title="Close"><IconChevronDown /></button>
      <div className="np-body">
        <NowPlayingStage art={art} alt={t.title} />
        <div className="np-side">
          {/* the album, song and artist open their library pages (and close Now Playing) */}
          <div className="np-kicker">{live ? 'Live radio' : t.kind === 'book' ? 'Audiobook' : album
            ? <button className="np-link" title="Go to album" onClick={() => go({ view: 'album', album })}>{t.album}</button>
            : t.album}</div>
          <h1 className="np-title">{album && !live
            ? <button className="np-link" title="Show in album" onClick={() => go({ view: 'album', album, track: { id: t.id, sourceId: t.sourceId, title: t.title } })}>{t.title}</button>
            : live ? p.liveTitle ?? t.title : t.title}</h1>
          <div className="np-artist">{artist && !live
            ? <button className="np-link" title="Go to artist" onClick={() => go({ view: 'artist', artist })}>{t.artist}</button>
            : live ? t.title : t.artist}</div>
          <div className="np-actions">
            {t.kind !== 'book' && <AddToPlaylist tracks={[t]} label="Add to playlist" />}
            <EqButton className="chip" />
            <DevicesButton className="chip" />
            <TogetherButton className="chip" />
            {live && <RadioGetButton text={p.liveTitle} />}
            {t.kind === 'track' && t.sourceId !== 'preview' && <SongRadioButton artist={t.artist} track={t} className="chip" />}
            {t.kind === 'track' && (
              <button className={`chip ${showLyrics ? 'on' : ''}`} onClick={() => setShowLyrics(!showLyrics)} title="Lyrics">Lyrics</button>
            )}
            <SleepButton />
          </div>
          <Visualizer className="np-viz" bars={48} mode="smooth" />
          {!live && (
            <div className="seek big">
              <span>{fmtTime(p.position)}</span>
              <input type="range" min={0} max={p.duration || 1} step={0.5} value={p.position}
                onChange={(e) => p.seek(Number(e.target.value))} style={{ ['--pct' as string]: `${(p.position / (p.duration || 1)) * 100}%` }} />
              <span>-{fmtTime(Math.max(0, p.duration - p.position))}</span>
            </div>
          )}
          <div className="transport big">
            <button className={`tbtn small ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle}><IconShuffle /></button>
            <button className="tbtn" onClick={p.prev}><IconPrev /></button>
            <button className="tbtn play" onClick={p.toggle}>{p.playing ? <IconPause /> : <IconPlay />}</button>
            <button className="tbtn" onClick={p.next}><IconNext /></button>
            <button className={`tbtn small ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat}><IconRepeat /></button>
          </div>
          {showLyrics && t.kind === 'track' && <LyricsPanel track={t} />}
          {!(showLyrics && t.kind === 'track') && upNext.length > 0 && (
            <div className="np-next">
              <div className="np-kicker">Up next</div>
              {upNext.map((q, i) => <UpNextRow key={i} track={q} onPlay={() => p.jump(p.index + 1 + i)} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** An "Up next" row: plays the song; its artist opens the artist's page. */
function UpNextRow({ track: q, onPlay }: { track: Track; onPlay(): void }) {
  const artists = useCatalog((s) => s.artists);
  const artist = artistOfTrack(q, artists);
  return (
    <div className="np-next-row">
      <button className="np-next-play" onClick={onPlay} title="Play">
        <Cover src={trackArt(q)} alt={q.title} className="tiny" />
        <span>{q.title}</span>
      </button>
      {artist
        ? <button className="np-link" title="Go to artist" onClick={() => useUi.getState().go({ view: 'artist', artist })}><small>{q.artist}</small></button>
        : <small>{q.artist}</small>}
    </div>
  );
}

export function QueuePanel() {
  const p = usePlayer();
  return (
    <aside className="queue">
      <div className="queue-head">
        <h3>Queue</h3>
        <span>{p.queue.length} items</span>
        {p.queue.length > 0 && <AddToPlaylist tracks={() => p.queue} label="Save" />}
      </div>
      <div className="queue-list">
        {p.queue.map((t, i) => (
          <div key={`${i}:${t.id}`} className={`queue-row ${i === p.index ? 'active' : ''} ${i < p.index ? 'played' : ''}`} onDoubleClick={() => p.jump(i)}>
            <Cover src={trackArt(t)} alt={t.title} className="tiny" />
            <div className="track-main" onClick={() => p.jump(i)}>
              <div className="track-title">{t.title}</div>
              <div className="track-sub">{t.artist}</div>
            </div>
            {i !== p.index && <button className="x" onClick={() => p.removeAt(i)} title="Remove">×</button>}
          </div>
        ))}
      </div>
    </aside>
  );
}
