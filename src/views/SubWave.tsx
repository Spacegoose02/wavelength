import { useEffect, useMemo, useRef, useState } from 'react';
import { sourceFor } from '../sources/registry';
import { stationToTrack } from '../sources/radio';
import { list, swTrack, txt, type SubWaveSource, type SwTrack } from '../sources/subwave';
import { useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useUi } from '../store/ui';
import { Cover, Empty, Spinner, fmtTime } from '../components/common';
import { IconHeart, IconPause, IconPlay } from '../components/Icons';
import { QueueSearch, SwControl, SwSchedule, SwShows, SwStats } from './SubWaveAdmin';
import { SwList, usePoll } from './subwaveShared';

type Tab = 'air' | 'control' | 'schedule' | 'shows' | 'stats';

export function SubWave({ sourceId }: { sourceId?: string }) {
  const sources = useSettings((s) => s.sources.filter((x) => x.kind === 'subwave' && x.enabled));
  const cfg = sources.find((s) => s.id === sourceId) ?? sources[0];
  const [tab, setTab] = useState<Tab>('air');
  const sw = useMemo(() => (cfg ? (sourceFor(cfg) as SubWaveSource) : undefined), [cfg]);

  if (!cfg || !sw) {
    return (
      <Empty title="SUB/WAVE isn't connected">
        <p>Add it in Settings with your station URL (e.g. <code>http://server:7700</code>). Admin user/password unlock the station controls.</p>
        <button className="btn primary" onClick={() => useUi.getState().go({ view: 'settings' })}>Open Settings</button>
      </Empty>
    );
  }

  const tabs: [Tab, string, boolean][] = [
    ['air', 'On air', false],
    ['control', 'DJ control', true],
    ['schedule', 'Schedule', false],
    ['shows', 'Shows', true],
    ['stats', 'Stats', true],
  ];

  return (
    <div className="page sw">
      <div className="tabs">
        {tabs.map(([k, label, admin]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}{admin && <small>admin</small>}
          </button>
        ))}
        {sources.length > 1 && (
          <select className="push" value={cfg.id} onChange={(e) => useUi.getState().go({ view: 'subwave', sourceId: e.target.value })}>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      {(tab === 'control' || tab === 'shows' || tab === 'stats') && !sw.hasAdmin ? (
        <Empty title="Admin login needed">
          <p>Enter SubWave's <code>ADMIN_USER</code> / <code>ADMIN_PASS</code> on the SubWave source in Settings.</p>
          <button className="btn" onClick={() => useUi.getState().go({ view: 'settings' })}>Open Settings</button>
        </Empty>
      ) : tab === 'air' ? <OnAir sw={sw} /> : tab === 'control' ? <SwControl sw={sw} /> : tab === 'schedule' ? <SwSchedule sw={sw} /> : tab === 'shows' ? <SwShows sw={sw} /> : <SwStats sw={sw} />}
    </div>
  );
}

function OnAir({ sw }: { sw: SubWaveSource }) {
  const np = usePoll(() => sw.nowPlaying(), 10_000, [sw]);
  const state = usePoll(() => sw.state(), 20_000, [sw]);
  const current = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const station = sw.station();
  const tunedIn = current?.id === `radio:${station.id}`;
  const [, tick] = useState(0);
  useEffect(() => {
    const h = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, []);

  const seen = useRef<{ key?: string; at: number }>({ at: Date.now() });
  if (np.error && !np.data) return <div className="errors">{np.error}</div>;
  if (!np.data) return <Spinner />;
  const d = np.data ?? {};
  const t = swTrack(d.nowPlaying);
  const cover = sw.coverFor(t);

  // Timing: now-playing may only carry a duration. Fall back to /state's current item
  // (ISO startedAt), and finally to when we first saw this song.
  const key = `${t.title}|${t.artist}`;
  if (seen.current.key !== key) seen.current = { key, at: Date.now() };
  const cur = swTrack(state.data?.current);
  const sameSong = !!cur.title && cur.title === t.title;
  const startedAt = t.startedAt ?? (sameSong ? cur.startedAt : undefined);
  const duration = t.duration ?? (sameSong ? cur.duration : undefined);
  const rawElapsed = startedAt ? (Date.now() - startedAt) / 1000 : t.elapsed ?? (Date.now() - seen.current.at) / 1000;
  const elapsed = Math.max(0, duration ? Math.min(rawElapsed, duration) : rawElapsed);
  const show = d.activeShow ?? d.context?.activeShow;
  const showName = txt(show?.name ?? show);
  const guests = list(show?.guests).map(txt).filter(Boolean);
  const dj = d.dj && typeof d.dj === 'object' ? d.dj : undefined;
  const lst = d.listeners ?? d.context?.listeners;
  const listeners = txt(lst && typeof lst === 'object' ? lst.current ?? lst.count : lst) || '0';
  const upcoming = list(state.data?.upcoming).map(swTrack);
  const history = list(state.data?.history).map(swTrack);
  const tags = [t.genre, t.year, t.bpm && `${Math.round(t.bpm)} BPM`, t.musicalKey, ...(t.moods ?? []).slice(0, 3)].filter(Boolean);

  return (
    <>
      <section className="sw-hero">
        <div className="sw-hero-bg" style={{ backgroundImage: cover ? `url("${cover}")` : undefined }} />
        <Cover key={cover} src={cover} alt={t.title ?? 'SUB/WAVE'} className="sw-art" />
        <div className="sw-hero-body">
          <div className="kicker"><span className="live-dot inline" /> {txt(dj?.station) || 'SUB/WAVE'} · {listeners} listening{d.streamOnline === false ? ' · stream offline' : ''}</div>
          <h1>{t.title ?? 'Off air'}</h1>
          <div className="sw-artist">{t.artist}{t.album ? ` — ${t.album}` : ''}</div>
          {tags.length > 0 && <div className="chips">{tags.map((x) => <span key={String(x)} className="chip">{String(x)}</span>)}</div>}
          {t.title && (
            <div className="sw-progress">
              <span>{fmtTime(elapsed)}</span>
              <div className="progress"><i style={{ width: duration ? `${Math.min(100, (elapsed / duration) * 100)}%` : '0%' }} /></div>
              <span>{duration ? fmtTime(duration) : 'LIVE'}</span>
            </div>
          )}
          <div className="hero-actions">
            <button className="btn primary big" onClick={() => (tunedIn ? usePlayer.getState().toggle() : usePlayer.getState().playTracks([stationToTrack(station)]))}>
              {tunedIn && playing ? <><IconPause /> Pause</> : <><IconPlay /> {tunedIn ? 'Resume' : 'Tune in'}</>}
            </button>
            {t.title && <LikeButton key={t.subsonic_id ?? t.title} sw={sw} songId={t.subsonic_id} />}
          </div>
        </div>
        <div className="sw-dj">
          {dj && (
            <div className="persona">
              <Cover src={typeof dj.avatar === 'string' ? sw.abs(dj.avatar) : undefined} alt={txt(dj.name) || 'DJ'} round className="avatar" />
              <div>
                <div className="kicker">On the mic</div>
                <b>{txt(dj.name)}</b>
                <div className="muted small">{txt(dj.tagline)}</div>
              </div>
            </div>
          )}
          {showName && (
            <div className="sw-show">
              <div className="kicker">Now on</div>
              <b>{showName}</b>
              {guests.length ? <div className="muted small">with {guests.join(', ')}</div> : null}
            </div>
          )}
        </div>
      </section>

      <div className="sw-cols">
        <section>
          {sw.hasAdmin && (
            <>
              <h2>Queue up music</h2>
              <QueueSearch sw={sw} />
              <h2 className="mt">Ask the DJ <small className="muted">free-text request, the AI picks</small></h2>
            </>
          )}
          {!sw.hasAdmin && <h2>Request a song</h2>}
          <RequestBox sw={sw} />
          {upcoming.length > 0 && (
            <>
              <h2 className="mt">Up next <small className="muted">{upcoming.length}</small></h2>
              <UpNext sw={sw} tracks={upcoming} onChange={state.refresh} />
            </>
          )}
        </section>
        <section>
          <h2>Recently played</h2>
          {state.error && <div className="errors">{state.error}</div>}
          <SwList sw={sw} tracks={[...history].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 15)} timestamps />
        </section>
      </div>
    </>
  );
}

/** Up next, with admin cancel buttons (single song, or the rest of an album/artist block). */
function UpNext({ sw, tracks, onChange }: { sw: SubWaveSource; tracks: SwTrack[]; onChange(): void }) {
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(undefined);
    }
  };
  type Block = { id: string; label: string; index: number; size: number };
  const blockOf = (t: SwTrack) => (t.block && typeof t.block === 'object' ? (t.block as Block) : undefined);
  const firstOfBlock = new Set<string>();
  const seen = new Set<string>();
  tracks.forEach((t, i) => {
    const b = blockOf(t);
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      firstOfBlock.add(`${i}`);
    }
  });
  return (
    <>
      {msg && <div className={msg.ok ? 'ok small' : 'errors'}>{msg.text}</div>}
      <SwList sw={sw} tracks={tracks} action={sw.hasAdmin ? (t, i) => {
        const b = blockOf(t);
        const id = t.subsonic_id ?? t.id;
        return (
          <div className="row gap upnext-actions">
            {b && <span className="tag" title={b.label}>{b.index}/{b.size}</span>}
            {b && firstOfBlock.has(`${i}`) && (
              <button className="chip" disabled={!!busy} title={`Cancel the rest of ${b.label}`}
                onClick={() => confirm(`Cancel the rest of "${b.label}"? Songs already sent to air will still play.`) &&
                  run(`b${b.id}`, async () => {
                    const r = await sw.cancelBlock(b.id);
                    if (r?.kept) setMsg({ ok: true, text: `Cancelled ${r.removed ?? 0}; ${r.kept} already on their way to air` });
                  }, `Cancelled the rest of ${b.label}`)}>
                Cancel block
              </button>
            )}
            {id && (
              <button className="icon-btn upnext-x" disabled={!!busy} title="Remove from Up next"
                onClick={() => run(`t${id}${i}`, () => sw.removeUpcoming(String(id)), `Removed "${t.title}"`)}>
                ✕
              </button>
            )}
          </div>
        );
      } : undefined} />
    </>
  );
}

/** ♥ the song on air — SubWave mirrors likes into Navidrome stars, so it lands in Favorites. */
function LikeButton({ sw, songId }: { sw: SubWaveSource; songId?: string }) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState<number>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    sw.likeState().then((s) => {
      if (!songId || s.songId === songId) {
        setLiked(!!s.liked);
        setCount(s.count);
      }
    }).catch(() => {});
  }, [songId]);
  return (
    <button className={`btn big like ${liked ? 'on' : ''}`} title={err ?? (liked ? 'You liked this' : 'Like this song')} disabled={liked}
      onClick={async () => {
        try {
          const r = await sw.likeCurrent(songId);
          setLiked(true);
          setCount(r.count);
        } catch (e) {
          setErr(String((e as Error).message ?? e));
        }
      }}>
      <IconHeart /> {liked ? 'Liked' : 'Like'}{count ? ` · ${count}` : ''}
    </button>
  );
}

function RequestBox({ sw }: { sw: SubWaveSource }) {
  const [text, setText] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('tonearm.swName') ?? '');
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setStatus('Sending to the DJ…');
    try {
      localStorage.setItem('tonearm.swName', name);
      const { requestId } = await sw.request(text.trim(), name || undefined);
      setText('');
      // the DJ agent resolves requests asynchronously — poll for the outcome
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await sw.requestStatus(requestId);
        if (r.status === 'pending') continue;
        setStatus(
          r.status === 'resolved'
            ? `Queued: ${swTrack(r.track).artist ?? ''} — ${swTrack(r.track).title ?? ''}${r.queuePosition != null ? ` (#${txt(r.queuePosition)} in line)` : ''}`
            : `The DJ passed on that one${r.reason ? `: ${txt(r.reason)}` : ''}.`,
        );
        return;
      }
      setStatus('Still thinking — it may show up in the queue shortly.');
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="request" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <input placeholder='"something mellow by Bonobo" or "Roygbiv"' value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row gap">
        <input className="grow" placeholder="Your name (optional — the DJ may shout you out)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={busy || !text.trim()}>Request</button>
      </div>
      {status && <div className="muted small">{status}</div>}
    </form>
  );
}
