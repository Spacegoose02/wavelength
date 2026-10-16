import { useEffect, useMemo, useState } from 'react';
import { list, swTrack, txt, type SubWaveSource, type SwSchedule as Schedule, type SwShow, type SwTrack } from '../sources/subwave';
import { Cover, Spinner } from '../components/common';
import { IconRefresh } from '../components/Icons';
import { SwList, usePoll } from './subwaveShared';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // display Monday first
const SHOW_COLORS = ['#f6b21b', '#4f8cff', '#18c7b4', '#ff5a5f', '#a77bf3', '#7ed957', '#ff8a3d', '#e86bd2', '#5ad1ff', '#c7a17a'];

/** Wraps an admin action with busy/result feedback. */
function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState<string>();
  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(undefined);
    }
  };
  const view = msg && <div className={msg.ok ? 'ok small' : 'errors'}>{msg.text}</div>;
  return { run, busy, view };
}

// ------------------------------------------------------------------ DJ control

export function SwControl({ sw }: { sw: SubWaveSource }) {
  const { run, busy, view } = useAction();
  const [say, setSay] = useState('');
  const [mode, setMode] = useState<'styled' | 'raw'>('styled');
  const skills = usePoll(() => sw.skills(), 120_000, [sw]);
  const jingles = usePoll(() => sw.jingles(), 120_000, [sw]);
  const sfx = usePoll(() => sw.sfx(), 120_000, [sw]);

  return (
    <div className="sw-admin">
      {view}
      <div className="sw-cols">
        <section className="panel">
          <h2>On air</h2>
          <div className="row gap wrap">
            <button className="btn primary" disabled={!!busy} onClick={() => run('skip', () => sw.skip(), 'Skipped')}>⏭ Skip track</button>
            <button className="btn" disabled={!!busy} onClick={() => run('refresh', () => sw.refreshPlaylist(), 'Fallback playlist rebuilt')}><IconRefresh /> Rebuild playlist</button>
          </div>
          <h3>Make the DJ say something</h3>
          <textarea rows={3} value={say} onChange={(e) => setSay(e.target.value)}
            placeholder={mode === 'styled' ? 'Shout out to everyone in the kitchen tonight…  (the DJ rewrites it in their voice)' : 'Read exactly this text'} />
          <div className="row gap">
            <div className="seg">
              <button className={mode === 'styled' ? 'on' : ''} onClick={() => setMode('styled')}>In DJ's style</button>
              <button className={mode === 'raw' ? 'on' : ''} onClick={() => setMode('raw')}>Word for word</button>
            </div>
            <button className="btn primary push" disabled={!say.trim() || !!busy} onClick={() => run('say', async () => { await sw.say(say.trim(), mode); setSay(''); }, 'Queued for the mic')}>Say it</button>
          </div>

          <h3>Segments</h3>
          {skills.error && <div className="muted small">{skills.error}</div>}
          <div className="row gap wrap">
            {list<any>(skills.data?.skills).map((s) => (
              <button key={s.kind} className="chip" disabled={!!busy} title={s.cooldownMin ? `Cooldown ${s.cooldownMin} min` : undefined}
                onClick={() => run(s.kind, () => sw.runSkill(s.kind), `${txt(s.label ?? s.kind)} coming up`)}>{txt(s.label ?? s.kind)}</button>
            ))}
          </div>

          <h3>Jingles</h3>
          <div className="row gap wrap">
            {list<any>(jingles.data?.jingles).map((j) => (
              <button key={j.filename} className="chip" title={j.text} disabled={!!busy}
                onClick={() => run(j.filename, () => sw.playJingle(j.filename), 'Jingle queued for the next break')}>{txt(j.text ?? j.filename).slice(0, 32)}</button>
            ))}
            {!jingles.data?.jingles?.length && <span className="muted small">None</span>}
          </div>

          <h3>Sound effects</h3>
          <div className="row gap wrap">
            {list<any>(sfx.data?.sfx).map((s) => (
              <button key={s.name} className="chip" title={s.description} disabled={!!busy} onClick={() => run(s.name, () => sw.playSfx(s.name), `${txt(s.name)} fired`)}>{txt(s.name)}</button>
            ))}
            {!sfx.data?.sfx?.length && <span className="muted small">None</span>}
          </div>
        </section>

        <section className="panel">
          <h2>Queue from the library</h2>
          <QueueSearch sw={sw} />
        </section>
      </div>
    </div>
  );
}

/** Search the station's library and put songs, albums or artist blocks on air next. */
export function QueueSearch({ sw }: { sw: SubWaveSource }) {
  const { run, busy, view } = useAction();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SwTrack[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    setSearching(true);
    const h = window.setTimeout(
      () => sw.searchLibrary(q.trim())
        .then((r) => setResults(list<SwTrack>(r?.results).map(swTrack)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false)),
      350,
    );
    return () => window.clearTimeout(h);
  }, [q]);

  return (
    <div className="queue-search">
      <input className="filter wide" placeholder="Search the station's library to queue a song, album or artist…" value={q} onChange={(e) => setQ(e.target.value)} />
      {view}
      {searching && <Spinner />}
      {q.trim().length >= 2 && !searching && (
        <SwList sw={sw} tracks={results.slice(0, 12)} action={(t) => (
          <div className="row gap">
            <button className="chip on" disabled={!!busy} onClick={() => run(`q${t.id}`, () => sw.queueTrack(t), `Queued "${t.title}"`)}>Queue</button>
            <button className="chip" disabled={!!busy} title="Queue the whole album" onClick={() => run(`a${t.id}`, () => sw.queueBlock('album', String(t.id)), `Queued album ${t.album ?? ''}`)}>Album</button>
            <button className="chip" disabled={!!busy} title="Queue an artist block" onClick={() => run(`r${t.id}`, () => sw.queueBlock('artist', String(t.id)), `Queued a ${t.artist} block`)}>Artist</button>
          </div>
        )} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ schedule

function stationNow(tz?: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
    return { day: DAYS.indexOf(wd), hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0) };
  } catch {
    const d = new Date();
    return { day: d.getDay(), hour: d.getHours() };
  }
}

export function SwSchedule({ sw }: { sw: SubWaveSource }) {
  const [sched, setSched] = useState<Schedule>();
  const [grid, setGrid] = useState<(string | null)[][]>([]);
  const [brush, setBrush] = useState<string | null>(null);
  const [painting, setPainting] = useState(false);
  const [error, setError] = useState<string>();
  const { run, busy, view } = useAction();
  const [takeShow, setTakeShow] = useState<string>('');
  const [takeFor, setTakeFor] = useState<string>('schedule-change');

  const load = () =>
    sw.schedule()
      .then((s) => {
        setSched(s);
        setGrid(s.grid.map((d) => [...d]));
        setBrush((b) => b ?? s.shows[0]?.id ?? null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  useEffect(() => {
    load();
    const up = () => setPainting(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [sw]);

  const color = useMemo(() => new Map(sched?.shows.map((s, i) => [s.id, SHOW_COLORS[i % SHOW_COLORS.length]]) ?? []), [sched]);
  const showName = (id: string | null) => (id ? sched?.shows.find((s) => s.id === id)?.name ?? 'Unknown show' : 'Default programming');

  if (error) return <div className="errors">{error}</div>;
  if (!sched) return <Spinner />;

  const dirty = JSON.stringify(grid) !== JSON.stringify(sched.grid);
  const now = stationNow(sched.timezone);
  const paint = (d: number, h: number) => {
    if (!sw.hasAdmin || grid[d][h] === brush) return;
    setGrid((g) => g.map((day, di) => (di === d ? day.map((v, hi) => (hi === h ? brush : v)) : day)));
  };
  const ov = sched.override;

  return (
    <div className="sw-admin">
      {view}
      {ov && (
        <div className="override">
          <b>Takeover active:</b> {showName(ov.showId)} until {new Date(ov.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {sw.hasAdmin && <button className="btn small push" disabled={!!busy} onClick={() => run('cancel', async () => { await sw.cancelOverride(); await load(); }, 'Back to the schedule')}>End takeover</button>}
        </div>
      )}

      {sw.hasAdmin && (
        <section className="panel">
          <h2>Change what's on right now</h2>
          <div className="row gap wrap">
            <select value={takeShow} onChange={(e) => setTakeShow(e.target.value)}>
              <option value="">Default programming</option>
              {sched.shows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={takeFor} onChange={(e) => setTakeFor(e.target.value)}>
              <option value="schedule-change">until the next scheduled show</option>
              <option value="30">for 30 minutes</option>
              <option value="60">for 1 hour</option>
              <option value="120">for 2 hours</option>
              <option value="240">for 4 hours</option>
            </select>
            <button className="btn primary" disabled={!!busy} onClick={() => run('take', async () => {
              await sw.override(takeShow || null, takeFor === 'schedule-change' ? 'schedule-change' : 'fixed', takeFor === 'schedule-change' ? undefined : Number(takeFor));
              await load();
            }, `Switched to ${showName(takeShow || null)}`)}>Go live</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="row gap wrap">
          <h2>Weekly schedule</h2>
          <span className="muted small">{sched.timezone ? `Station time (${sched.timezone})` : ''}</span>
          {sw.hasAdmin && (
            <div className="push row gap">
              <button className="btn small ghost" disabled={!dirty} onClick={() => setGrid(sched.grid.map((d) => [...d]))}>Revert</button>
              <button className="btn small primary" disabled={!dirty || !!busy} onClick={() => run('save', async () => {
                const r = await sw.saveSchedule({ ...sched, grid });
                await load();
                if (r?.dropped) throw new Error(`Saved, but ${r.dropped} slot(s) pointed at missing shows and were cleared`);
              }, 'Schedule saved')}>Save schedule</button>
            </div>
          )}
        </div>
        {sw.hasAdmin ? (
          <div className="palette">
            <span className="muted small">Paint with:</span>
            {sched.shows.map((s) => (
              <button key={s.id} className={`swatch ${brush === s.id ? 'on' : ''}`} onClick={() => setBrush(s.id)}>
                <i style={{ background: color.get(s.id) }} /> {s.name}
              </button>
            ))}
            <button className={`swatch ${brush === null ? 'on' : ''}`} onClick={() => setBrush(null)}><i className="empty-swatch" /> Default</button>
          </div>
        ) : (
          <p className="muted small">Add admin credentials in Settings to edit the schedule.</p>
        )}
        <div className="grid24" onMouseLeave={() => setPainting(false)}>
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="hour">{h % 3 === 0 ? `${h}` : ''}</div>)}
          {DAY_ORDER.map((d) => (
            <div key={d} className="contents">
              <div className={`day ${d === now.day ? 'today' : ''}`}>{DAYS[d]}</div>
              {grid[d].map((id, h) => (
                <div key={h}
                  className={`slot ${d === now.day && h === now.hour ? 'now' : ''} ${id !== sched.grid[d][h] ? 'changed' : ''}`}
                  style={{ background: id ? color.get(id) ?? '#666' : undefined }}
                  title={`${DAYS[d]} ${h}:00 — ${showName(id)}`}
                  onMouseDown={(e) => { e.preventDefault(); setPainting(true); paint(d, h); }}
                  onMouseEnter={() => painting && paint(d, h)} />
              ))}
            </div>
          ))}
        </div>
        <div className="legend">
          {sched.shows.map((s) => {
            const host = sched.personas.find((p) => p.id === s.personaId);
            return <span key={s.id}><i style={{ background: color.get(s.id) }} /> {s.name}{host ? ` · ${host.name}` : ''}</span>;
          })}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ shows

const BLANK: Partial<SwShow> = { name: '', topic: '', personaId: '', guestPersonaIds: [], moods: [] };

export function SwShows({ sw }: { sw: SubWaveSource }) {
  const [shows, setShows] = useState<SwShow[]>();
  const [personas, setPersonas] = useState<Schedule['personas']>([]);
  const [editing, setEditing] = useState<Partial<SwShow> | null>(null);
  const [error, setError] = useState<string>();
  const { run, busy, view } = useAction();

  const load = async () => {
    try {
      const [full, sched] = await Promise.all([sw.fullShows(), sw.schedule()]);
      setShows(full.length ? full : sched.shows);
      setPersonas(sched.personas);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  useEffect(() => {
    load();
  }, [sw]);

  if (error) return <div className="errors">{error}</div>;
  if (!shows) return <Spinner />;
  const persona = (id?: string) => personas.find((p) => p.id === id);

  return (
    <div className="sw-admin">
      {view}
      <div className="row gap">
        <h2>Shows <small className="muted">{shows.length}</small></h2>
        <button className="btn small primary push" onClick={() => setEditing({ ...BLANK, personaId: personas[0]?.id })}>New show</button>
      </div>

      {editing && (
        <form className="editor" onSubmit={(e) => {
          e.preventDefault();
          run('save', async () => {
            await sw.upsertShow(editing);
            setEditing(null);
            await load();
          }, `Saved "${editing.name}"`);
        }}>
          <div className="editor-grid">
            <label>Name<input required value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>Host
              <select value={editing.personaId ?? ''} onChange={(e) => setEditing({ ...editing, personaId: e.target.value })}>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="span2">Topic / brief for the DJ
              <textarea rows={3} value={(editing.topic as string) ?? ''} onChange={(e) => setEditing({ ...editing, topic: e.target.value })}
                placeholder="Late-night downtempo, talk about the city after dark, keep it chill" />
            </label>
            <label className="span2">Moods (comma separated)
              <input value={(editing.moods ?? []).join(', ')} onChange={(e) => setEditing({ ...editing, moods: e.target.value.split(',').map((m) => m.trim()).filter(Boolean) })} />
            </label>
            <div className="span2">
              <div className="muted small">Guests</div>
              <div className="row gap wrap">
                {personas.filter((p) => p.id !== editing.personaId).map((p) => {
                  const on = editing.guestPersonaIds?.includes(p.id);
                  return (
                    <button type="button" key={p.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setEditing({
                      ...editing,
                      guestPersonaIds: on ? editing.guestPersonaIds!.filter((g) => g !== p.id) : [...(editing.guestPersonaIds ?? []), p.id],
                    })}>{p.name}</button>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="muted small">Genres, eras, playlists and other advanced filters are kept as they are — edit those in SubWave's own admin.</p>
          <div className="row gap">
            <button className="btn primary" disabled={!!busy}>Save show</button>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="show-list">
        {shows.map((s) => {
          const host = persona(s.personaId);
          return (
            <div key={s.id} className="show-card">
              <Cover src={sw.abs(host?.avatar)} alt={host?.name ?? s.name} round className="avatar" />
              <div className="track-main">
                <div className="track-title">{s.name}</div>
                <div className="track-sub">
                  {host?.name ?? 'No host'}
                  {s.guestPersonaIds?.length ? ` + ${s.guestPersonaIds.map((g) => persona(g)?.name ?? g).join(', ')}` : ''}
                  {s.moods?.length ? ` · ${s.moods.join(', ')}` : ''}
                </div>
                {s.topic && <div className="muted small clamp">{s.topic}</div>}
              </div>
              <button className="btn small" onClick={() => setEditing({ id: s.id, name: s.name, topic: s.topic, personaId: s.personaId, guestPersonaIds: s.guestPersonaIds ?? [], moods: s.moods ?? [] })}>Edit</button>
              <button className="btn small ghost" disabled={!!busy} onClick={() => {
                if (confirm(`Delete "${s.name}"? Its hours on the schedule go back to default programming.`)) {
                  run(`del${s.id}`, async () => { await sw.deleteShow(s.id); await load(); }, `Deleted "${s.name}"`);
                }
              }}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stats

export function SwStats({ sw }: { sw: SubWaveSource }) {
  const stats = usePoll(() => sw.stats(), 30_000, [sw]);
  const conns = usePoll(() => sw.connections(), 15_000, [sw]);
  if (stats.error) return <div className="errors">{stats.error}</div>;
  if (!stats.data) return <Spinner />;
  const s = stats.data;
  const tiles: [string, string | number | undefined][] = [
    ['Listening now', conns.data?.count],
    ['LLM', [s.llm?.provider, s.llm?.model].filter(Boolean).join(' · ')],
    ['LLM calls', s.llm?.calls],
    ['TTS engine', s.tts?.engine],
    ['TTS calls', s.tts?.calls],
    ['Requests', s.requests ? `${s.requests.resolved ?? 0} / ${s.requests.total ?? 0} played` : undefined],
  ];
  return (
    <div className="sw-admin">
      <div className="tiles">
        {tiles.map(([k, v]) => (
          <div key={k} className="tile">
            <div className="muted small">{k}</div>
            <div className="tile-v">{txt(v) || '—'}</div>
          </div>
        ))}
      </div>
      <section className="panel">
        <h2>Connected listeners</h2>
        {!conns.data?.connections?.length ? <p className="muted">Nobody tuned in.</p> : conns.data.connections.map((c, i) => (
          <div key={i} className="station-row">
            <div className="track-main">
              <div className="track-title">{txt(c.userAgent) || 'Unknown player'}</div>
              <div className="track-sub">{txt(c.mount)}</div>
            </div>
            <div className="track-meta">{c.connectedFor ? `${Math.round(c.connectedFor / 60)} min` : ''}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
