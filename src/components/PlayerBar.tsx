import { canDesktop, toggleMiniPlayer } from '../lib/desktop';
import { useSettings } from '../store/settings';
import { ShuffleButton } from './ShuffleButton';
import { SkipButton } from './SpokenControls';
import { isSpoken } from '../lib/spoken';
import { trackArt, useArtworkList } from '../lib/artwork';
import { useUi } from '../store/ui';
import { Cover } from './common';
import { Elapsed, Seek, usePlayerControls } from './PlayerClock';
import { DevicesButton } from './Devices';
import { CastButton } from './CastButton';
import { DjModeButton, DjStationPanel } from './DjStation';
import { TogetherButton } from './Together';
import { EqButton } from './Equalizer';
import { IconNext, IconPause, IconPlay, IconPrev, IconMini, IconQueue, IconRepeat, IconVolume } from './Icons';
import { Visualizer } from './Visualizer';

/** Bottom deck: Plexamp layout with a Winamp LCD in the middle. */
export function PlayerBar() {
  const p = usePlayerControls();
  const smart = useSettings((s) => s.smartShuffle);
  const ui = useUi();
  // Now Playing covers the whole window: nothing down here needs to animate under it
  const covered = ui.nowPlayingOpen;
  const t = p.current();
  useArtworkList();
  const art = p.liveCover ?? trackArt(t);
  const live = t?.kind === 'radio';
  const marquee = t ? `${live && p.liveTitle ? p.liveTitle : `${t.artist} — ${t.title}`}` : 'Wavelength  ·  nothing playing';

  return (
    <footer className={`deck ${covered ? 'covered' : ''}`}>
      <button className="deck-now" onClick={() => t && ui.setNowPlaying(true)} title="Open Now Playing">
        <Cover key={art} src={art} alt={t?.title ?? 'Wavelength'} />
        <div className="deck-meta">
          <div className="deck-title">{t ? (live ? p.liveTitle ?? t.title : t.title) : 'Nothing playing'}</div>
          <div className="deck-sub">{t ? (live ? (p.liveTitle ? t.title : 'Live radio') : t.artist) : 'Pick something from your library'}</div>
        </div>
      </button>

      <div className="deck-center">
        <div className="lcd">
          <div className="lcd-time">
            {p.buffering && t ? <span className="blink">BUF</span> : live ? <span>LIVE</span> : <Elapsed />}
          </div>
          <div className="lcd-mid">
            <div className="lcd-marquee"><span>{marquee}&nbsp;&nbsp;&nbsp;***&nbsp;&nbsp;&nbsp;{marquee}&nbsp;&nbsp;&nbsp;***&nbsp;&nbsp;&nbsp;</span></div>
            <div className="lcd-flags">
              <span className={p.playing ? 'on' : ''}>PLAY</span>
              <span className={p.shuffle ? 'on' : ''}>{p.shuffle && smart ? 'SMRT' : 'SHUF'}</span>
              <span className={p.repeat !== 'off' ? 'on' : ''}>{p.repeat === 'one' ? 'REP1' : 'REP'}</span>
              {p.error && <span className="err" title={p.error}>ERR</span>}
              {!p.error && p.noSignal && <span className="on" title="No signal: playing saved songs">OFFL</span>}
            </div>
          </div>
          <Visualizer className="lcd-viz" bars={19} mode="classic" off={covered} />
        </div>
        <div className="transport">
          {/* audiobooks and podcasts: 15 s back and 30 s on in place of shuffle and repeat */}
          {isSpoken(t) ? <SkipButton back /> : <ShuffleButton />}
          <button className="tbtn" onClick={p.prev} title="Previous"><IconPrev /></button>
          <button className="tbtn play" onClick={p.toggle} title="Play/Pause">{p.playing ? <IconPause /> : <IconPlay />}</button>
          <button className="tbtn" onClick={p.next} title="Next"><IconNext /></button>
          {isSpoken(t) ? <SkipButton /> : (
            <button className={`tbtn small ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} title={`Repeat: ${p.repeat}`}>
              <IconRepeat />{p.repeat === 'one' && <sup>1</sup>}
            </button>
          )}
        </div>
        <Seek live={live} disabled={!t} />
      </div>

      <div className="deck-right">
        <DjModeButton />
        <TogetherButton />
        <DevicesButton />
        <CastButton />
        <EqButton />
        {canDesktop && <button type="button" className="tbtn small" onClick={() => void toggleMiniPlayer()} title="Mini player"><IconMini /></button>}
        <button className={`tbtn small ${ui.queueOpen ? 'on' : ''}`} onClick={ui.toggleQueue} title="Queue"><IconQueue /></button>
        <IconVolume className="vol-icon" />
        <input className="vol" type="range" min={0} max={1} step={0.01} value={p.volume} aria-label="Volume" aria-valuetext={`${Math.round(p.volume * 100)}%`} onChange={(e) => p.setVolume(Number(e.target.value))}
          style={{ ['--pct' as string]: `${p.volume * 100}%` }} />
      </div>
      <DjStationPanel />
    </footer>
  );
}
