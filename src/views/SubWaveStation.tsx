import { useEffect, useMemo, useState } from 'react';
import {
  archiveDays,
  blankPersona,
  type SubWaveSource,
  type SwArchive,
  type SwDoctorReport,
  type SwPersonaFull,
  type SwSettings,
  type SwSkill,
  type SwStationProfile,
} from '../sources/subwave';
import { Cover, Spinner } from '../components/common';
import { IconRefresh } from '../components/Icons';
import { sourceFor } from '../sources/registry';
import { useSettings } from '../store/settings';
import { useShallow } from 'zustand/react/shallow';

/*
 * The station-running screens of SUB/WAVE's own admin, inside Wavelength: DJs (personas), what the DJ does between
 * songs (skills), the AI and voice settings, the health check, the hourly archive and station profiles. Everything
 * goes through the same admin login as the other SUB/WAVE tabs (on this device, or kept on the Hub).
 */

/** Wraps an admin action with busy/result feedback. */
function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState<string>();
  const run = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
      return false;
    } finally {
      setBusy(undefined);
    }
  };
  const view = msg && <div className={msg.ok ? 'ok small' : 'errors'}>{msg.text}</div>;
  return { run, busy, view };
}

/** Load once (and again on demand). */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    fn()
      .then((d) => alive && (setData(d), setError(undefined)))
      .catch((e) => alive && setError(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, [...deps, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1) };
}

const FREQUENCIES: [string, string][] = [
  ['silent', 'Silent (music only)'],
  ['quiet', 'Quiet'],
  ['moderate', 'Moderate'],
  ['chatty', 'Chatty'],
  ['aggressive', 'Talks a lot'],
];
const SCRIPT_LENGTHS: [string, string][] = [
  ['one-liner', 'One-liners'],
  ['concise', 'Short'],
  ['extended', 'Longer'],
  ['storyteller', 'Storyteller'],
];
const DIALS: ['humour' | 'warmth' | 'localColour', string][] = [
  ['humour', 'Humour'],
  ['warmth', 'Warmth'],
  ['localColour', 'Local colour'],
];
const ENGINE_NAMES: Record<string, string> = {
  inherit: "The station's default",
  piper: 'Piper',
  kokoro: 'Kokoro',
  chatterbox: 'Chatterbox (voice cloning)',
  'pocket-tts': 'PocketTTS',
  cloud: 'Cloud (OpenAI / ElevenLabs…)',
  remote: 'Remote server',
  gemini: 'Gemini',
};
const label = (pairs: [string, string][], v?: string) => pairs.find(([k]) => k === v)?.[1] ?? v ?? '';

/** Shrink a picked image to a square JPEG small enough for SUB/WAVE (300 KB at most). */
async function avatarDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(512, side);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    for (const q of [0.88, 0.75, 0.6, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length * 0.75 < 290 * 1024) return data;
    }
    throw new Error('That picture is too big even after shrinking it');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ------------------------------------------------------------------ DJs (personas)

export function SwPersonas({ sw }: { sw: SubWaveSource }) {
  const settings = useLoad(() => sw.settings(), [sw]);
  const [editing, setEditing] = useState<SwPersonaFull | null>(null);
  const [catalog, setCatalog] = useState<{ slug: string; displayName?: string; tagline?: string }[] | null>(null);
  const { run, busy, view } = useAction();

  if (settings.error) return <div className="errors">{settings.error}</div>;
  const s = settings.data;
  if (!s) return <Spinner />;
  const personas = s.values.personas ?? [];
  const defaultId = s.values.activePersonaId;
  const onAirId = s.onAir?.personaId;

  const browse = () =>
    run('catalog', async () => setCatalog((await sw.communityPersonas()).community ?? []), 'Catalog loaded');

  return (
    <div className="sw-admin">
      {view}
      <div className="row gap wrap">
        <h2>DJs <small className="muted">{personas.length}</small></h2>
        <div className="push row gap">
          <button className="btn small" disabled={!!busy} onClick={browse}>Browse the catalog</button>
          <button className="btn small primary" onClick={() => setEditing(blankPersona(s.defaults?.personas))}>New DJ</button>
        </div>
      </div>
      <p className="muted small">
        The <b>default DJ</b> hosts whenever no show is on. A show's own host takes over during that show.
      </p>

      {catalog && (
        <section className="panel">
          <div className="row gap">
            <h3>Ready-made DJs</h3>
            <button className="btn small ghost push" onClick={() => setCatalog(null)}>Close</button>
          </div>
          {!catalog.length && <p className="muted">The catalog is empty.</p>}
          <div className="show-list">
            {catalog.map((c) => {
              const have = personas.some((p) => p.name === c.displayName);
              return (
                <div key={c.slug} className="show-card">
                  <div className="track-main">
                    <div className="track-title">{c.displayName ?? c.slug}</div>
                    {c.tagline && <div className="track-sub">{c.tagline}</div>}
                  </div>
                  <button className="btn small" disabled={!!busy || have} onClick={() => run(`i${c.slug}`, async () => { await sw.installPersona(c.slug); settings.reload(); }, `Added ${c.displayName ?? c.slug}`)}>
                    {have ? 'Added' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {editing && (
        <PersonaEditor sw={sw} s={s} persona={editing} busy={!!busy}
          onCancel={() => setEditing(null)}
          onSave={(p) => run('save', async () => { await sw.savePersona(p); setEditing(null); settings.reload(); }, `Saved ${p.name}`)} />
      )}

      <div className="show-list">
        {personas.map((p) => (
          <div key={p.id ?? p.name} className="show-card">
            <Cover src={sw.avatarFor(p)} alt={p.name} round className="avatar" />
            <div className="track-main">
              <div className="track-title">
                {p.name}
                {p.id === defaultId && <span className="chip on tiny-chip">Default</span>}
                {p.id === onAirId && <span className="chip tiny-chip">On air</span>}
              </div>
              <div className="track-sub">
                {[p.tagline, label(FREQUENCIES, p.frequency), label(SCRIPT_LENGTHS, p.scriptLength), ENGINE_NAMES[p.tts?.engine ?? ''] ?? p.tts?.engine].filter(Boolean).join(' · ')}
              </div>
              {p.soul && <div className="muted small clamp">{p.soul}</div>}
            </div>
            {p.id && p.id !== defaultId && (
              <button className="btn small" disabled={!!busy} onClick={() => run(`d${p.id}`, async () => { await sw.setDefaultPersona(p.id!); settings.reload(); }, `${p.name} is now the default DJ`)}>Make default</button>
            )}
            <button className="btn small" onClick={() => setEditing({ ...p })}>Edit</button>
            <button className="btn small ghost" disabled={!!busy || personas.length < 2} title={personas.length < 2 ? 'A station needs at least one DJ' : undefined}
              onClick={() => {
                if (p.id && confirm(`Delete ${p.name}? Shows they host are deleted too, and their hours go back to default programming.`)) {
                  run(`x${p.id}`, async () => { await sw.deletePersona(p.id!); settings.reload(); }, `Deleted ${p.name}`);
                }
              }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonaEditor({ sw, s, persona, busy, onSave, onCancel }: {
  sw: SubWaveSource;
  s: SwSettings;
  persona: SwPersonaFull;
  busy: boolean;
  onSave: (p: SwPersonaFull) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<SwPersonaFull>(persona);
  const [avatarMsg, setAvatarMsg] = useState<string>();
  const [avatarV, setAvatarV] = useState(0);
  const engines = ['inherit', ...(s.tts?.engines ?? Object.keys(ENGINE_NAMES).filter((e) => e !== 'inherit'))];
  const available = new Set(s.tts?.available ?? []);
  const engine = p.tts?.engine ?? 'inherit';
  const setTts = (patch: Partial<NonNullable<SwPersonaFull['tts']>>) => setP({ ...p, tts: { ...(p.tts ?? {}), ...patch } });

  const pickAvatar = async (file?: File) => {
    if (!file || !p.id) return;
    setAvatarMsg('Uploading…');
    try {
      await sw.setAvatar(p.id, await avatarDataUrl(file));
      setP({ ...p, avatar: `${p.id}.jpg` });
      setAvatarV((v) => v + 1);
      setAvatarMsg('Picture saved');
    } catch (e) {
      setAvatarMsg(String((e as Error).message ?? e));
    }
  };
  const avatar = sw.avatarFor(p);

  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); onSave(p); }}>
      <div className="row gap">
        <Cover src={avatar ? `${avatar}&r=${avatarV}` : undefined} alt={p.name || 'DJ'} round className="avatar" />
        {p.id ? (
          <div className="row gap wrap">
            <label className="btn small">
              Change picture
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickAvatar(e.target.files?.[0])} />
            </label>
            {p.avatar && (
              <button type="button" className="btn small ghost" onClick={async () => {
                try {
                  await sw.clearAvatar(p.id!);
                  setP({ ...p, avatar: '' });
                  setAvatarMsg('Picture removed');
                } catch (e) {
                  setAvatarMsg(String((e as Error).message ?? e));
                }
              }}>Remove picture</button>
            )}
            {avatarMsg && <span className="muted small">{avatarMsg}</span>}
          </div>
        ) : (
          <span className="muted small">Save the new DJ first, then add a picture.</span>
        )}
      </div>
      <div className="editor-grid">
        <label>Name<input required maxLength={40} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <label>Tagline<input maxLength={80} value={p.tagline ?? ''} onChange={(e) => setP({ ...p, tagline: e.target.value })} placeholder="Late nights, deep cuts" /></label>
        <label>How much they talk
          <select value={p.frequency ?? 'moderate'} onChange={(e) => setP({ ...p, frequency: e.target.value })}>
            {FREQUENCIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>How long they talk
          <select value={p.scriptLength ?? 'concise'} onChange={(e) => setP({ ...p, scriptLength: e.target.value })}>
            {SCRIPT_LENGTHS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {DIALS.map(([k, name]) => (
          <label key={k}>{name}: {p[k] ?? 5}
            <input type="range" min={0} max={10} step={1} value={p[k] ?? 5} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />
          </label>
        ))}
        <label>Language <input maxLength={60} value={p.language ?? ''} onChange={(e) => setP({ ...p, language: e.target.value })} placeholder="Empty = the station's" /></label>
        <label className="span2">Personality and backstory (the DJ's "soul")
          <textarea rows={5} maxLength={2000} value={p.soul ?? ''} onChange={(e) => setP({ ...p, soul: e.target.value })}
            placeholder="A night-shift raccoon who grew up on pirate radio. Dry, warm, a little conspiratorial…" />
          <small className="muted">{(p.soul ?? '').length} / 2000. It's sent with every call the DJ makes, so a long one costs more.</small>
        </label>
        <label>Voice engine
          <select value={engine} onChange={(e) => setTts({ engine: e.target.value, voice: '' })}>
            {engines.map((e) => (
              <option key={e} value={e}>{ENGINE_NAMES[e] ?? e}{e !== 'inherit' && available.size && !available.has(e) ? ' (not running)' : ''}</option>
            ))}
          </select>
        </label>
        <label>Voice
          {engine === 'kokoro' && s.tts?.kokoroVoices?.length ? (
            <select value={p.tts?.voice ?? ''} onChange={(e) => setTts({ voice: e.target.value })}>
              <option value="">Engine default</option>
              {s.tts.kokoroVoices.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ) : (
            <input value={p.tts?.voice ?? ''} disabled={engine === 'inherit'} onChange={(e) => setTts({ voice: e.target.value })}
              placeholder={engine === 'inherit' ? "Uses the station's voice" : 'Voice name or file'} />
          )}
        </label>
      </div>
      <p className="muted small">Skills, music leanings and fine voice tuning are kept as they are. Change those in SUB/WAVE's own admin.</p>
      <div className="row gap">
        <button className="btn primary" disabled={busy || !p.name.trim()}>Save DJ</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ skills

export function SwSkills({ sw }: { sw: SubWaveSource }) {
  const loaded = useLoad(() => sw.skillCatalog(), [sw]);
  const [skills, setSkills] = useState<SwSkill[]>();
  const { run, busy, view } = useAction();
  useEffect(() => {
    setSkills(loaded.data?.skills);
  }, [loaded.data]);

  if (loaded.error) return <div className="errors">{loaded.error}</div>;
  if (!skills) return <Spinner />;

  return (
    <div className="sw-admin">
      {view}
      <h2>What the DJ does between songs</h2>
      <p className="muted small">
        Switched-on skills air by themselves when they fit, like the weather, a time check or a look back at a song. A skill that's off can
        still be fired by hand from <b>DJ control</b>.
      </p>
      <div className="show-list">
        {skills.map((k) => (
          <label key={k.name} className="show-card check">
            <span className="switch">
              <input type="checkbox" checked={!!k.enabled} disabled={!!busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  run(k.name, async () => setSkills((await sw.toggleSkill(k.name, on)).skills), `${k.label ?? k.name} ${on ? 'on' : 'off'}`);
                }} />
              <span />
            </span>
            <div className="track-main">
              <div className="track-title">
                {k.label ?? k.name}
                {k.custom && <span className="chip tiny-chip">Custom</span>}
                {k.ready === false && <span className="chip tiny-chip">Needs setup</span>}
              </div>
              {k.description && <div className="track-sub clamp">{k.description}</div>}
            </div>
            {k.cooldownMs ? <div className="track-meta">every {Math.round(k.cooldownMs / 60_000)} min at most</div> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AI and voice settings

/** The API key each cloud provider reads (SUB/WAVE keeps them in its secrets file). */
const PROVIDER_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  requesty: 'REQUESTY_API_KEY',
  gateway: 'AI_GATEWAY_API_KEY',
};

export function SwStationSettings({ sw }: { sw: SubWaveSource }) {
  const loaded = useLoad(() => sw.settings(), [sw]);
  const [form, setForm] = useState<{ provider: string; model: string; cap: string; talk: boolean; engine: string; kokoro: string; key: string }>();
  const [models, setModels] = useState<string[]>([]);
  const { run, busy, view } = useAction();

  useEffect(() => {
    const v = loaded.data?.values;
    if (!v) return;
    setForm({
      provider: v.llm?.provider ?? 'ollama',
      model: v.llm?.model ?? '',
      cap: v.llm?.dailyTokenCap ? String(v.llm.dailyTokenCap) : '',
      talk: v.tts?.enabled !== false,
      engine: v.tts?.defaultEngine ?? 'piper',
      kokoro: v.tts?.kokoro?.voice ?? '',
      key: '',
    });
  }, [loaded.data]);

  const s = loaded.data;
  const keyEnv = form ? PROVIDER_KEYS[form.provider] : undefined;
  const env = s?.env;

  if (loaded.error) return <div className="errors">{loaded.error}</div>;
  if (!s || !form) return <Spinner />;
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const available = new Set(s.tts?.available ?? []);

  const save = () =>
    run('save', async () => {
      if (keyEnv && form.key.trim()) await sw.saveSecrets({ [keyEnv]: form.key.trim() });
      const cap = Number(form.cap);
      const r = await sw.saveSettings({
        llm: { provider: form.provider, model: form.model.trim(), dailyTokenCap: Number.isFinite(cap) && cap > 0 ? Math.round(cap) : 0 },
        tts: { enabled: form.talk, defaultEngine: form.engine, ...(form.kokoro ? { kokoro: { voice: form.kokoro } } : {}) },
      });
      loaded.reload();
      if (r?.managed?.length) throw new Error(`Saved, except ${r.managed.join(', ')}: those are managed by your SUB/WAVE host`);
    }, 'Settings saved');

  return (
    <div className="sw-admin">
      {view}
      <div className="tiles">
        <div className="tile"><div className="muted small">Model in use</div><div className="tile-v">{s.llm?.active || '—'}</div></div>
        <div className="tile"><div className="muted small">Daily budget</div><div className="tile-v">{s.budget?.mode === 'hard' ? 'Used up' : s.budget?.mode === 'soft' ? 'Running low' : 'OK'}</div></div>
        <div className="tile"><div className="muted small">Stream</div><div className="tile-v">{s.streamOnAir === false ? 'Off air' : s.streamOnAir ? 'On air' : '—'}</div></div>
      </div>

      <section className="panel">
        <h2>The DJ's brain</h2>
        <div className="editor-grid">
          <label>AI provider
            <select value={form.provider} onChange={(e) => { set({ provider: e.target.value, model: '', key: '' }); setModels([]); }}>
              {(s.llm?.providers ?? [form.provider]).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Model
            <div className="row gap">
              <input list="sw-models" value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="Empty = the provider's default" />
              <button type="button" className="btn small" disabled={!!busy} title="Ask the provider which models it has"
                onClick={() => run('models', async () => {
                  const r = await sw.llmModels(form.provider);
                  if (r.error) throw new Error(r.error);
                  setModels(r.models ?? []);
                }, 'Models loaded')}><IconRefresh /></button>
            </div>
            <datalist id="sw-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          {keyEnv && (
            <label className="span2">API key
              <input type="password" autoComplete="off" value={form.key} onChange={(e) => set({ key: e.target.value })}
                placeholder={env?.[keyEnv] ? 'A key is saved. Paste a new one to replace it' : 'Paste the key'} />
            </label>
          )}
          <label>Daily token limit
            <input type="number" min={0} step={10000} value={form.cap} onChange={(e) => set({ cap: e.target.value })} placeholder="No limit" />
            <small className="muted">Near it the DJ talks less; at it the music carries on without the DJ.</small>
          </label>
        </div>
        <p className="muted small">Ollama addresses, OpenAI-compatible servers, a backup model and the finer agent settings are in SUB/WAVE's own admin.</p>
      </section>

      <section className="panel">
        <h2>The DJ's voice</h2>
        <label className="check">
          <span className="switch"><input type="checkbox" checked={form.talk} onChange={(e) => set({ talk: e.target.checked })} /><span /></span>
          <span>The DJ talks <small className="muted">(off = music and jingles only, and no AI calls for talk)</small></span>
        </label>
        <div className="editor-grid">
          <label>Default voice engine
            <select value={form.engine} onChange={(e) => set({ engine: e.target.value })}>
              {(s.tts?.engines ?? [form.engine]).map((e) => (
                <option key={e} value={e}>{ENGINE_NAMES[e] ?? e}{available.size && !available.has(e) ? ' (not running)' : ''}</option>
              ))}
            </select>
          </label>
          {form.engine === 'kokoro' && (
            <label>Kokoro voice
              <select value={form.kokoro} onChange={(e) => set({ kokoro: e.target.value })}>
                {!form.kokoro && <option value="">Pick a voice</option>}
                {(s.tts?.kokoroVoices ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}
        </div>
        <p className="muted small">Each DJ can have a voice of their own under <b>DJs</b>.</p>
      </section>

      <div className="row gap">
        <button className="btn primary" disabled={!!busy} onClick={save}>Save settings</button>
        <button className="btn" disabled={!!busy} onClick={() => {
          if (confirm('Restart the mixer? The stream drops for a few seconds.')) run('mixer', () => sw.restartMixer(), 'Mixer restarting');
        }}>Restart the mixer</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ health check

const STATUS_ICON: Record<string, string> = { ok: '✓', warn: '!', fail: '✕', skip: '–' };

export function SwHealth({ sw }: { sw: SubWaveSource }) {
  const last = useLoad(() => sw.doctorLast().catch(() => null), [sw]);
  const [report, setReport] = useState<SwDoctorReport | null>();
  const [onlyProblems, setOnlyProblems] = useState(true);
  const { run, busy, view } = useAction();
  useEffect(() => {
    if (last.data !== undefined) setReport((r) => r ?? last.data);
  }, [last.data]);

  const check = () => run('run', async () => setReport(await sw.doctor()), 'Check finished');
  const counts = report?.counts;

  return (
    <div className="sw-admin">
      {view}
      <div className="row gap wrap">
        <h2>Health check</h2>
        {report?.t && <span className="muted small">Last run {new Date(report.t).toLocaleString()}</span>}
        <div className="push row gap">
          <label className="check"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only problems</label>
          <button className="btn primary" disabled={!!busy} onClick={check}>{busy === 'run' ? 'Checking… (up to a minute)' : 'Run the check'}</button>
        </div>
      </div>
      {last.data === undefined && !report && <Spinner />}
      {report === null && <p className="muted">No check has run yet. Run one to see how the station is doing: music server, AI, voices, stream and library.</p>}
      {counts && (
        <div className="tiles">
          <div className="tile"><div className="muted small">Fine</div><div className="tile-v">{counts.ok}</div></div>
          <div className="tile"><div className="muted small">Worth a look</div><div className="tile-v">{counts.warn}</div></div>
          <div className="tile"><div className="muted small">Broken</div><div className="tile-v">{counts.fail}</div></div>
        </div>
      )}
      {report?.sections?.map((sec) => {
        const rows = onlyProblems ? sec.findings.filter((f) => f.status === 'warn' || f.status === 'fail') : sec.findings;
        if (!rows.length) return null;
        return (
          <section key={sec.name} className="panel">
            <h3>{sec.name}</h3>
            {rows.map((f, i) => (
              <div key={i} className={`station-row health-${f.status}`}>
                <span className="health-dot" aria-label={f.status}>{STATUS_ICON[f.status] ?? '?'}</span>
                <div className="track-main">
                  <div className="track-title">{f.label}</div>
                  {f.detail && <div className="track-sub">{f.detail}</div>}
                  {f.hint && <div className="muted small">{f.hint}</div>}
                </div>
                {f.fix && (
                  <button className="btn small" disabled={!!busy} onClick={() => run(`fix${f.fix!.id}`, () => sw.runFix(f.fix!.id), `${f.fix!.label}: started`)}>{f.fix.label}</button>
                )}
              </div>
            ))}
          </section>
        );
      })}
      {report && onlyProblems && counts && !counts.warn && !counts.fail && <p className="ok">Everything checked out.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ archives

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export function SwArchives({ sw }: { sw: SubWaveSource }) {
  const loaded = useLoad(() => sw.archives(), [sw]);
  const days = useMemo(() => archiveDays(loaded.data?.archives ?? []), [loaded.data]);
  const [playing, setPlaying] = useState<{ path: string; url: string }>();
  const { run, busy, view } = useAction();
  useEffect(() => () => playing && URL.revokeObjectURL(playing.url), [playing]);

  if (loaded.error) return <div className="errors">{loaded.error}</div>;
  if (!loaded.data) return <Spinner />;
  const total = days.reduce((n, d) => n + d.bytes, 0);

  const listen = (a: SwArchive) =>
    run(`p${a.path}`, async () => {
      const { blob } = await sw.archiveFile(a);
      setPlaying({ path: a.path, url: URL.createObjectURL(blob) });
    }, `Playing ${a.date} ${a.hour}:00`);
  const download = (a: SwArchive) =>
    run(`d${a.path}`, async () => {
      const { name, blob } = await sw.archiveFile(a);
      saveBlob(blob, name);
    }, `Saved ${a.date} ${a.hour}:00`);

  return (
    <div className="sw-admin">
      {view}
      <div className="row gap wrap">
        <h2>Archive</h2>
        <span className="muted small">{days.length ? `Every hour on air, ${mb(total)} in all` : ''}</span>
        <div className="push row gap">
          <button className="btn small" onClick={loaded.reload}><IconRefresh /> Refresh</button>
          <button className="btn small ghost" disabled={!!busy || !days.length} onClick={() => {
            if (confirm('Delete every archived hour? This can’t be undone.')) run('clear', async () => { await sw.clearArchives(); loaded.reload(); }, 'Archive cleared');
          }}>Clear the archive</button>
        </div>
      </div>
      {playing && (
        <section className="panel">
          <div className="row gap">
            <b>{playing.path.replace('/', ' · ').replace('.mp3', '')}</b>
            <button className="btn small ghost push" onClick={() => setPlaying(undefined)}>Close</button>
          </div>
          <audio src={playing.url} controls autoPlay style={{ width: '100%' }} />
        </section>
      )}
      {!days.length && <p className="muted">Nothing archived yet. Turn on hourly archives in SUB/WAVE's admin (Settings → Archive) and each hour on air is kept here.</p>}
      {days.map((d) => (
        <section key={d.date} className="panel">
          <h3>{new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} <small className="muted">{mb(d.bytes)}</small></h3>
          {d.hours.map((a) => (
            <div key={a.path} className="station-row">
              <div className="track-main"><div className="track-title">{String(a.hour).padStart(2, '0')}:00 to {String((a.hour + 1) % 24).padStart(2, '0')}:00</div></div>
              <div className="track-meta">{mb(a.bytes)}</div>
              <button className="btn small" disabled={!!busy} onClick={() => listen(a)}>{busy === `p${a.path}` ? 'Loading…' : 'Listen'}</button>
              <button className="btn small ghost" disabled={!!busy} onClick={() => download(a)}>{busy === `d${a.path}` ? 'Saving…' : 'Save'}</button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ station profiles

export function SwStations({ sw }: { sw: SubWaveSource }) {
  const loaded = useLoad(() => sw.stations(), [sw]);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'fresh' | 'duplicate'>('duplicate');
  const { run, busy, view } = useAction();

  if (loaded.error) return <div className="errors">{loaded.error}</div>;
  const d = loaded.data;
  if (!d) return <Spinner />;
  const full = d.limit !== undefined && d.stations.length >= d.limit;

  const goLive = (st: SwStationProfile) => {
    if (!st.id) return;
    if (!confirm(`Put ${st.name} on air? The stream stops for a moment while SUB/WAVE switches over.`)) return;
    run(`a${st.id}`, async () => {
      await sw.activateStation(st.id!);
      // SUB/WAVE restarts itself to switch; give it a moment before asking again
      setTimeout(loaded.reload, 8000);
    }, `Switching to ${st.name}. It's back on air in a few seconds`);
  };

  return (
    <div className="sw-admin">
      {view}
      <h2>Station profiles</h2>
      <p className="muted small">
        One SUB/WAVE keeps up to {d.limit ?? 8} stations, each with its own DJs, shows, schedule and settings. One is on air at a time.
        To run two stations at once, run a second SUB/WAVE and add it as another source.
      </p>
      <div className="show-list">
        {d.stations.map((st) => (
          <div key={st.id ?? 'main'} className="show-card">
            <div className="track-main">
              <div className="track-title">{st.name}{st.active && <span className="chip on tiny-chip">On air</span>}</div>
              <div className="track-sub">
                {st.configured === false ? 'Not set up yet: it opens SUB/WAVE’s setup when it goes on air' : 'Set up'}
                {st.createdAt ? ` · made ${new Date(st.createdAt).toLocaleDateString()}` : ''}
              </div>
            </div>
            {st.id && !st.active && <button className="btn small primary" disabled={!!busy} onClick={() => goLive(st)}>Go on air</button>}
            {st.id && (
              <button className="btn small" disabled={!!busy} onClick={() => {
                const n = prompt('New name', st.name)?.trim();
                if (n && n !== st.name) run(`r${st.id}`, async () => { await sw.renameStation(st.id!, n); loaded.reload(); }, `Renamed to ${n}`);
              }}>Rename</button>
            )}
            {st.id && !st.active && (
              <button className="btn small ghost" disabled={!!busy} onClick={() => {
                if (confirm(`Delete ${st.name} and everything in it (DJs, shows, jingles, archive)? This can't be undone.`)) {
                  run(`x${st.id}`, async () => { await sw.deleteStation(st.id!); loaded.reload(); }, `Deleted ${st.name}`);
                }
              }}>Delete</button>
            )}
          </div>
        ))}
      </div>
      <form className="editor" onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (n) run('new', async () => { await sw.createStation(n, mode); setName(''); loaded.reload(); }, `Made ${n}. Put it on air to set it up`);
      }}>
        <h3>New station</h3>
        <div className="row gap wrap">
          <input maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Holiday radio" disabled={full} />
          <div className="seg">
            <button type="button" className={mode === 'duplicate' ? 'on' : ''} onClick={() => setMode('duplicate')}>Copy this station</button>
            <button type="button" className={mode === 'fresh' ? 'on' : ''} onClick={() => setMode('fresh')}>Start empty</button>
          </div>
          <button className="btn primary" disabled={!!busy || !name.trim() || full}>Make it</button>
        </div>
        {full && <p className="muted small">This SUB/WAVE has the most stations it can keep. Delete one first.</p>}
        <p className="muted small">A copy takes the DJs, shows, schedule and jingles. It doesn't take the music server login, library analysis or archive.</p>
      </form>
      <CopyFromStation sw={sw} />
    </div>
  );
}

/** Make this SUB/WAVE a copy of another of your SUB/WAVE servers, all but its name. */
function CopyFromStation({ sw }: { sw: SubWaveSource }) {
  const others = useSettings(useShallow((s) => s.sources.filter((x) => x.kind === 'subwave' && x.enabled && x.id !== sw.config.id)));
  const [fromId, setFromId] = useState('');
  const { run, busy, view } = useAction();
  const from = others.find((o) => o.id === fromId) ?? others[0];
  const here = sw.config.name || 'this station';

  return (
    <section className="panel">
      <h3>Copy from another SUB/WAVE</h3>
      {!others.length ? (
        <p className="muted small">
          Running a second SUB/WAVE? Add it under Settings → Sources, and you can copy one into the other here, all but its name.
        </p>
      ) : (
        <>
          <p className="muted small">
            Makes {here} a copy of another of your SUB/WAVE servers: its settings, DJs and their pictures, shows, schedule, jingles, sound
            effects, voices, skills and library analysis. {here} keeps its own name, music server login and API keys. Everything else
            here is replaced.
          </p>
          {view}
          <div className="row gap wrap">
            <select value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)}>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="btn primary" disabled={!!busy || !from} onClick={() => {
              if (!from || !confirm(`Replace ${here}'s DJs, shows, schedule and settings with a copy of ${from.name}'s? ${here} keeps its name. This can't be undone.`)) return;
              run('copy', async () => {
                const r = await sw.copyFrom(sourceFor(from) as SubWaveSource);
                if (r.requiresRestart) await sw.restartMixer().catch(() => undefined);
              }, `${here} is now a copy of ${from.name}. Its API keys stay its own, so check AI & voice`);
            }}>{busy === 'copy' ? 'Copying… (can take a minute)' : 'Copy it here'}</button>
          </div>
        </>
      )}
    </section>
  );
}
