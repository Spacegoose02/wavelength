import { trackArt, useArtworkList } from '../lib/artwork';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, fmtTime } from './common';
import { DevicesButton } from './Devices';
import { TogetherButton } from './Together';
import { EqButton } from './Equalizer';
import { IconNext, IconPause, IconPlay, IconPrev, IconQueue, IconRepeat, IconShuffle, IconVolume } from './Icons';
import { Visualizer } from './Visualizer';

/** Bottom deck: Plexamp layout with a Winamp LCD in the middle. */
export function PlayerBar() {
  const p = usePlayer();
  const ui = useUi();
  const t = p.current();
  useArtworkList();
  const art = p.liveCover ?? trackArt(t);
  const live = t?.kind === 'radio';
  const marquee = t ? `${live && p.liveTitle ? p.liveTitle : `${t.artist} — ${t.title}`}` : 'Wavelength  ·  nothing playing';

  return (
    <footer className="deck">
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
            {p.buffering && t ? <span className="blink">BUF</span> : live ? <span>LIVE</span> : fmtTime(p.position)}
          </div>
          <div className="lcd-mid">
            <div className="lcd-marquee"><span>{marquee}&nbsp;&nbsp;&nbsp;***&nbsp;&nbsp;&nbsp;{marquee}&nbsp;&nbsp;&nbsp;***&nbsp;&nbsp;&nbsp;</span></div>
            <div className="lcd-flags">
              <span className={p.playing ? 'on' : ''}>PLAY</span>
              <span className={p.shuffle ? 'on' : ''}>SHUF</span>
              <span className={p.repeat !== 'off' ? 'on' : ''}>{p.repeat === 'one' ? 'REP1' : 'REP'}</span>
              {p.error && <span className="err" title={p.error}>ERR</span>}
            </div>
          </div>
          <Visualizer className="lcd-viz" bars={19} mode="classic" />
        </div>
        <div className="transport">
          <button className={`tbtn small ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle} title="Shuffle"><IconShuffle /></button>
          <button className="tbtn" onClick={p.prev} title="Previous"><IconPrev /></button>
          <button className="tbtn play" onClick={p.toggle} title="Play/Pause">{p.playing ? <IconPause /> : <IconPlay />}</button>
          <button className="tbtn" onClick={p.next} title="Next"><IconNext /></button>
          <button className={`tbtn small ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} title={`Repeat: ${p.repeat}`}>
            <IconRepeat />{p.repeat === 'one' && <sup>1</sup>}
          </button>
        </div>
        <div className="seek">
          <span>{fmtTime(p.position)}</span>
          <input type="range" min={0} max={live ? 1 : p.duration || 1} step={0.5} value={live ? 1 : p.position} disabled={live || !t}
            onChange={(e) => p.seek(Number(e.target.value))}
            style={{ ['--pct' as string]: `${live ? 100 : (p.position / (p.duration || 1)) * 100}%` }} />
          <span>{live ? 'LIVE' : fmtTime(p.duration)}</span>
        </div>
      </div>

      <div className="deck-right">
        <TogetherButton />
        <DevicesButton />
        <EqButton />
        <button className={`tbtn small ${ui.queueOpen ? 'on' : ''}`} onClick={ui.toggleQueue} title="Queue"><IconQueue /></button>
        <IconVolume className="vol-icon" />
        <input className="vol" type="range" min={0} max={1} step={0.01} value={p.volume} onChange={(e) => p.setVolume(Number(e.target.value))}
          style={{ ['--pct' as string]: `${p.volume * 100}%` }} />
      </div>
    </footer>
  );
}
