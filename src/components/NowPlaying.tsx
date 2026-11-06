import { isSmartPick, useSmartPicks } from '../lib/smartShuffle';
import { ShuffleButton } from './ShuffleButton';
import { SoundsLikeButton } from './SoundsLikeButton';
import { trackArt, useArtworkList } from '../lib/artwork';
import { Cover } from './common';
import { Seek, usePlayerControls } from './PlayerClock';
import { IconChevronDown, IconNext, IconPause, IconPlay, IconPrev, IconRepeat } from './Icons';
import { Visualizer } from './Visualizer';
import { NowPlayingStage } from './Scenes';
import { AddToPlaylist } from './AddToPlaylist';
import { EqButton } from './Equalizer';
import { DevicesButton } from './Devices';
import { CastButton } from './CastButton';
import { CreditsButton } from './CreditsButton';
import { TogetherButton } from './Together';
import { RadioGetButton } from './RadioGetButton';
import { SongRadioButton } from './SongRadioButton';
import { SleepButton } from './SleepButton';
import { DjModeButton } from './DjStation';
import { useStation } from '../lib/djStation';
import { TrashPanda, DJ_NAME } from './TrashPanda';
import { LyricsPanel } from './Lyrics';
import { SingButton, SingControls } from './SingButton';
import { VideoButton } from './VideoButton';
import { useState } from 'react';
import { useSleep } from '../lib/sleep';
import { useSing } from '../lib/singMode';
import { useCatalog } from '../store/catalog';
import { useUi } from '../store/ui';
import { albumOfTrack, artistOfTrack } from '../lib/trackLinks';
import type { Track } from '../sources/types';

/** Full-screen Plexamp-style view: blurred artwork backdrop, big art, big visualizer. */
export function NowPlaying() {
  const p = usePlayerControls();
  const [showLyrics, setShowLyrics] = useState(false);
  const [more, setMore] = useState(savedMore);
  // a running sleep timer or Sing mode stays in sight even with More folded
  const sleeping = useSleep((s) => !!s.endsAt || s.endOfTrack);
  const singing = useSing((s) => s.on);
  const toggleMore = () => {
    setMore(!more);
    try {
      localStorage.setItem(MORE_KEY, more ? '0' : '1');
    } catch {
      /* no storage */
    }
  };
  const close = () => window.history.back(); // pops the entry setNowPlaying(true) pushed
  const t = p.current();
  const albums = useCatalog((s) => s.albums);
  const artists = useCatalog((s) => s.artists);
  useArtworkList();
  if (!t) return null;
  const live = t.kind === 'radio';
  const art = p.liveCover ?? trackArt(t);
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
          {p.error && <div className="np-error" role="status">{p.error}</div>}
          {!p.error && p.noSignal && <div className="np-note muted small" role="status">No signal · playing songs saved on this device until it's back</div>}
          {/* the actions people use most, then the rest behind More (remembered on this device) */}
          <div className="np-actions">
            {t.kind !== 'book' && <AddToPlaylist tracks={[t]} label="Add to playlist" />}
            {t.kind === 'track' && <button className={`chip ${showLyrics ? 'on' : ''}`} onClick={() => setShowLyrics(!showLyrics)} title="Lyrics">Lyrics</button>}
            {live && <RadioGetButton text={p.liveTitle} />}
            <CastButton className="chip" />
            <DjModeButton />
            {singing && t.kind === 'track' && <SingButton onOn={() => setShowLyrics(true)} />}
            {sleeping && <SleepButton />}
            <button type="button" className={`chip np-more ${more ? 'on' : ''}`} aria-expanded={more} onClick={toggleMore}>{more ? 'Less' : 'More'}</button>
          </div>
          {more && (
            <div className="np-actions np-actions-more">
              {t.kind === 'track' && t.sourceId !== 'preview' && <SongRadioButton artist={t.artist} track={t} className="chip" />}
              {t.kind === 'track' && t.sourceId !== 'preview' && <SoundsLikeButton track={t} />}
              {t.kind === 'track' && <>
                {!singing && <SingButton onOn={() => setShowLyrics(true)} />}
                <VideoButton track={t} />
              </>}
              <CreditsButton track={t} />
              <TogetherButton className="chip" />
              <DevicesButton className="chip" />
              <EqButton className="chip" />
              {!sleeping && <SleepButton />}
            </div>
          )}
          <Visualizer className="np-viz" bars={48} mode="smooth" />
          {!live && <Seek className="seek big" remaining />}
          <div className="transport big">
            <ShuffleButton />
            <button className="tbtn" onClick={p.prev}><IconPrev /></button>
            <button className="tbtn play" onClick={p.toggle}>{p.playing ? <IconPause /> : <IconPlay />}</button>
            <button className="tbtn" onClick={p.next}><IconNext /></button>
            <button className={`tbtn small ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat}><IconRepeat /></button>
          </div>
          {showLyrics && t.kind === 'track' && <><SingControls /><LyricsPanel track={t} /></>}
          {!(showLyrics && t.kind === 'track') && <UpNext />}
        </div>
      </div>
    </div>
  );
}

const MORE_KEY = 'tonearm.npMore';
function savedMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
}

const UP_NEXT_KEY = 'tonearm.npUpNext';
function savedOpen(): boolean {
  try {
    const v = localStorage.getItem(UP_NEXT_KEY);
    if (v) return v === '1';
  } catch {
    /* no storage */
  }
  // open on a computer, folded on a phone (where the screen is mostly the art and the controls)
  return typeof window === 'undefined' || window.innerWidth > 760;
}

/**
 * Up next (and Played, what came before) under the controls: folds away with the arrow, scrolls through the
 * whole queue, and a tap plays a song. In DJ mode the last row says the DJ adds more when these run out.
 */
function UpNext() {
  const p = usePlayerControls();
  const station = { on: useStation((s) => s.on), busy: useStation((s) => s.busy) };
  const [open, setOpen] = useState(savedOpen);
  const [tab, setTab] = useState<'next' | 'back'>('next');
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(UP_NEXT_KEY, open ? '0' : '1');
    } catch {
      /* no storage */
    }
  };
  const next = p.queue.slice(p.index + 1, p.index + 101);
  const back = p.queue.slice(Math.max(0, p.index - 100), p.index).reverse();
  const rows = tab === 'next' ? next : back;
  if (!next.length && !back.length && !station.on) return null;
  return (
    <div className={`np-next ${open ? 'open' : ''}`}>
      <div className="np-next-head">
        <button className={`np-next-tab ${tab === 'next' ? 'on' : ''}`} onClick={() => { setTab('next'); if (!open) toggle(); }}>
          Up next{next.length ? ` · ${p.queue.length - p.index - 1}` : ''}
        </button>
        {back.length > 0 && <button className={`np-next-tab ${tab === 'back' ? 'on' : ''}`} onClick={() => { setTab('back'); if (!open) toggle(); }}>Played</button>}
        <button className="np-next-fold" onClick={toggle} title={open ? 'Hide the queue' : 'Show the queue'} aria-expanded={open}><IconChevronDown /></button>
      </div>
      {open && (
        <div className="np-next-list">
          {rows.map((q, i) => (
            <UpNextRow key={`${tab}${i}:${q.id}`} track={q} onPlay={() => p.jump(tab === 'next' ? p.index + 1 + i : p.index - 1 - i)} />
          ))}
          {tab === 'next' && station.on && (
            <div className="np-next-dj"><TrashPanda busy={station.busy} /> <small>{station.busy ? `${DJ_NAME} is picking what's next…` : `${DJ_NAME} adds more before these run out`}</small></div>
          )}
          {tab === 'next' && !next.length && !station.on && <small className="np-next-empty">Nothing after this song</small>}
        </div>
      )}
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
  const p = usePlayerControls();
  const picks = useSmartPicks((s) => s.keys);
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
              <div className="track-title">{t.title}{isSmartPick(picks, t) && <span className="smart-pick" title="Smart Shuffle pick"> ✦</span>}</div>
              <div className="track-sub">{t.artist}</div>
            </div>
            {i !== p.index && <button className="x" onClick={() => p.removeAt(i)} title="Remove">×</button>}
          </div>
        ))}
      </div>
    </aside>
  );
}
