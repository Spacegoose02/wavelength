import { useEffect, useState } from 'react';
import { Deemix } from '../sources/deemix';
import { ytdlp as ytdlpApi } from '../sources/ytdlp';
import { isAndroid } from '../lib/platform';
import { Equalizer } from '../components/Equalizer';
import { sourceFor } from '../sources/registry';
import { SOURCE_COLORS, SOURCE_LABELS, type SourceConfig, type SourceKind } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { SKIN_GROUPS, SKINS, useSettings, type Skin } from '../store/settings';
import { useUi, type SettingsTab } from '../store/ui';
import { SEASONS, activeSkin, seasonFor } from '../lib/seasons';
import { CHART_LABELS, GENRES, chartProvider, chartsFor, defaultSourcesFor, sourcesFor, type ChartSource, type Genre } from '../sources/charts';

/** Settings → Discover charts: tick which charts feed each genre's tabs and Mix. */
function DiscoverCharts() {
  const custom = useSettings((s) => s.discoverCharts);
  const setCharts = useSettings((s) => s.setDiscoverCharts);
  const [genre, setGenre] = useState<Genre>('all');
  const using = sourcesFor(genre, custom);
  const defaults = defaultSourcesFor(genre);
  const isCustom = !!custom[genre]?.length;
  // group by publisher so the 14 iHeartRadio playlists don't drown out the rest
  const groups = new Map<string, ChartSource[]>();
  for (const s of chartsFor(genre)) groups.set(chartProvider(s), [...(groups.get(chartProvider(s)) ?? []), s]);
  const toggle = (s: ChartSource, on: boolean) => {
    // keep the order charts are listed in, so tabs don't jump around
    const next = chartsFor(genre).filter((c) => (c === s ? on : using.includes(c)));
    if (!next.length) return;
    setCharts(genre, next.length === defaults.length && next.every((c) => defaults.includes(c)) ? undefined : next);
  };
  return (
    <section id="discover-charts">
      <h2>Discover charts</h2>
      <p className="muted small">Pick which charts show up as tabs for each genre and get combined into its Mix. Charts that work for any genre (iHeartRadio, RadioWave and Deezer playlists) can be added anywhere; Billboard and Apple Music only offer the genres they publish.</p>
      <div className="chips">
        {GENRES.map((g) => (
          <button key={g.id} className={`chip ${genre === g.id ? 'on' : ''}`} onClick={() => setGenre(g.id)}>
            {g.label}{custom[g.id]?.length ? ' •' : ''}
          </button>
        ))}
      </div>
      <div className="editor">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted small">{using.length} chart{using.length === 1 ? '' : 's'} in {GENRES.find((g) => g.id === genre)!.label} · {isCustom ? 'customised' : 'defaults'}</span>
          <button className="btn small ghost" disabled={!isCustom} onClick={() => setCharts(genre, undefined)}>Reset to defaults</button>
        </div>
        <div className="chart-picker">
          {[...groups].map(([provider, list]) => (
            <div key={provider}>
              <div className="kicker">{provider}</div>
              {list.map((s) => (
                <label key={s} className="check">
                  <input type="checkbox" checked={using.includes(s)} disabled={using.length === 1 && using.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />
                  {CHART_LABELS[s]}{defaults.includes(s) ? <small className="muted"> default</small> : null}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const HINTS: Record<SourceKind, { url: string; fields: (keyof SourceConfig)[]; help: string; labels?: Partial<Record<keyof SourceConfig, string>> }> = {
  navidrome: { url: 'http://192.168.1.10:4533', fields: ['username', 'password'], help: 'Your Navidrome login. Any Subsonic-compatible server works too.' },
  plex: { url: 'http://192.168.1.10:32400', fields: ['token'], help: 'Your X-Plex-Token: in Plex Web, open any item, choose "Get Info", then "View XML", and copy the X-Plex-Token from the URL.' },
  audiobookshelf: { url: 'http://192.168.1.10:13378', fields: ['token'], help: 'Create an API key in Audiobookshelf under Settings → Users → your user (or API Keys).' },
  subwave: {
    url: 'http://192.168.1.10:7700',
    fields: ['username', 'password', 'token', 'streamUrl', 'apiUrl'],
    labels: {
      username: 'Admin user (ADMIN_USER)',
      password: 'Admin password (ADMIN_PASS)',
      token: 'Station password (only if private)',
      streamUrl: 'Stream URL (optional)',
      apiUrl: 'API URL (optional)',
    },
    help: 'Use the address you open SubWave at (port 7700 by default). Admin login unlocks DJ controls, the schedule and shows. Now-playing, stream (/stream.mp3) and API (/api) are found automatically — only fill the optional fields if yours differ, e.g. API on http://server:7701.',
  },
};

const LABELS: Partial<Record<keyof SourceConfig, string>> = {
  username: 'Username',
  password: 'Password',
  token: 'Token / API key',
};

function SourceEditor({ initial, onDone }: { initial: SourceConfig; onDone(): void }) {
  const upsert = useSettings((s) => s.upsertSource);
  const [cfg, setCfg] = useState(initial);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const hint = HINTS[cfg.kind];
  const set = (k: keyof SourceConfig, v: string) => setCfg({ ...cfg, [k]: v });

  return (
    <form className="editor" onSubmit={(e) => {
      e.preventDefault();
      upsert(cfg);
      onDone();
      useCatalog.getState().load();
    }}>
      <div className="editor-grid">
        <label>Type
          <select value={cfg.kind} onChange={(e) => setCfg({ ...cfg, kind: e.target.value as SourceKind, name: cfg.name || SOURCE_LABELS[e.target.value as SourceKind] })}>
            {(Object.keys(SOURCE_LABELS) as SourceKind[]).map((k) => <option key={k} value={k}>{SOURCE_LABELS[k]}</option>)}
          </select>
        </label>
        <label>Name<input value={cfg.name} onChange={(e) => set('name', e.target.value)} placeholder={SOURCE_LABELS[cfg.kind]} /></label>
        <label className="span2">Server URL<input value={cfg.url} onChange={(e) => set('url', e.target.value)} placeholder={hint.url} required /></label>
        {hint.fields.map((f) => (
          <label key={f}>{hint.labels?.[f] ?? LABELS[f]}
            <input type={f === 'password' || f === 'token' ? 'password' : 'text'} value={(cfg[f] as string) ?? ''} onChange={(e) => set(f, e.target.value)} />
          </label>
        ))}
      </div>
      <p className="muted small">{hint.help}</p>
      {test && <div className={test.ok ? 'ok' : 'errors'}>{test.msg}</div>}
      <div className="row gap">
        <button type="button" className="btn" onClick={async () => {
          setTest({ ok: true, msg: 'Testing…' });
          try {
            setTest({ ok: true, msg: await sourceFor(cfg).test() });
          } catch (e) {
            const msg = String((e as Error).message ?? e);
            setTest({
              ok: false,
              msg: isAndroid && /error sending request/i.test(msg)
                ? `${msg} — couldn't reach the server. On Android 17+ allow Wavelength to access your local network (Settings → Apps → Wavelength → Permissions → Nearby devices / Local network), and make sure this device is on the same Wi-Fi (or VPN) as the server.`
                : msg,
            });
          }
        }}>Test connection</button>
        <button className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function SourcesTab() {
  const { sources, removeSource, moveSource, upsertSource } = useSettings();
  const [editing, setEditing] = useState<SourceConfig | null>(null);
  return (
    <>
      <section>
        <h2>Sources</h2>
        <p className="muted small">When the same album is on several servers, the source listed first wins. Use the arrows to reorder.</p>
        {sources.map((s, i) => (
          <div key={s.id} className={`source-row ${s.enabled ? '' : 'off'}`}>
            <i className="dot big" style={{ background: SOURCE_COLORS[s.kind] }} />
            <div className="track-main">
              <div className="track-title">{s.name}</div>
              <div className="track-sub">{SOURCE_LABELS[s.kind]} · {s.url}</div>
            </div>
            <button className="icon-btn" disabled={i === 0} onClick={() => moveSource(s.id, -1)}>▲</button>
            <button className="icon-btn" disabled={i === sources.length - 1} onClick={() => moveSource(s.id, 1)}>▼</button>
            <label className="switch"><input type="checkbox" checked={s.enabled} onChange={(e) => {
              upsertSource({ ...s, enabled: e.target.checked });
              useCatalog.getState().load();
            }} /><span /></label>
            <button className="btn small" onClick={() => setEditing(s)}>Edit</button>
            <button className="btn small ghost" onClick={() => confirm(`Remove ${s.name}?`) && removeSource(s.id)}>Remove</button>
          </div>
        ))}
        {editing ? (
          <SourceEditor key={editing.id} initial={editing} onDone={() => setEditing(null)} />
        ) : (
          <div className="row gap wrap">
            {(Object.keys(SOURCE_LABELS) as SourceKind[]).map((k) => (
              <button key={k} className="btn" onClick={() => setEditing({ id: crypto.randomUUID(), kind: k, name: SOURCE_LABELS[k], url: '', enabled: true })}>
                <i className="dot" style={{ background: SOURCE_COLORS[k] }} /> Add {SOURCE_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function DownloadsTab() {
  const { deemix, setDeemix, ytdlp, setYtdlp } = useSettings();
  const [dmTest, setDmTest] = useState<string>();
  const [ytTest, setYtTest] = useState<string>();
  return (
    <>
      <section>
        <h2>deemix</h2>
        <div className="editor">
          <div className="editor-grid">
            <label className="span2">deemix server URL<input value={deemix.url} onChange={(e) => setDeemix({ url: e.target.value })} placeholder="http://192.168.1.10:6595" /></label>
            <label>ARL (only if deemix asks to log in)<input type="password" value={deemix.arl} onChange={(e) => setDeemix({ arl: e.target.value })} /></label>
            <label>Quality
              <select value={deemix.bitrate} onChange={(e) => setDeemix({ bitrate: Number(e.target.value) })}>
                <option value={9}>FLAC</option>
                <option value={3}>MP3 320</option>
                <option value={1}>MP3 128</option>
              </select>
            </label>
          </div>
          <div className="row gap">
            <button className="btn" onClick={async () => {
              setDmTest('Testing…');
              try {
                setDmTest(await new Deemix(deemix.url, deemix.arl).test());
              } catch (e) {
                setDmTest(String((e as Error).message ?? e));
              }
            }}>Test deemix</button>
            {dmTest && <span className="muted">{dmTest}</span>}
          </div>
        </div>
      </section>

      {!isAndroid && <section>
        <h2>yt-dlp <small className="muted">backup downloader</small></h2>
        <div className="editor">
          <p className="muted small">For anything deemix can't find: YouTube, YouTube Music, SoundCloud, Bandcamp and more. Point the folder at your Navidrome music library (a mapped drive or <code>\\server\music</code> share works) so downloads show up after a rescan.</p>
          <div className="editor-grid">
            <label className="span2">Download folder<input value={ytdlp.outDir} onChange={(e) => setYtdlp({ outDir: e.target.value })} placeholder="\\nas\music\yt-dlp  or  D:\Music\yt-dlp" /></label>
            <label>Audio format
              <select value={ytdlp.format} onChange={(e) => setYtdlp({ format: e.target.value })}>
                <option value="opus">Opus (best quality from YouTube)</option>
                <option value="m4a">M4A / AAC</option>
                <option value="mp3">MP3 (most compatible)</option>
                <option value="flac">FLAC (lossless container, not lossless source)</option>
              </select>
            </label>
            <label>yt-dlp.exe path (optional)<input value={ytdlp.bin} onChange={(e) => setYtdlp({ bin: e.target.value })} placeholder="auto-detect" /></label>
            {/^(\\\\|\/\/)/.test(ytdlp.outDir) && (
              <>
                <label>Network share username<input value={ytdlp.shareUser} onChange={(e) => setYtdlp({ shareUser: e.target.value })} placeholder={'NAS\\user or user'} autoComplete="off" /></label>
                <label>Network share password<input type="password" value={ytdlp.sharePass} onChange={(e) => setYtdlp({ sharePass: e.target.value })} autoComplete="new-password" /></label>
              </>
            )}
          </div>
          <div className="row gap">
            <button className="btn" onClick={async () => {
              setYtTest('Testing…');
              try {
                setYtTest(await ytdlpApi.version(ytdlp.bin));
              } catch (e) {
                setYtTest(`${e} — install with: winget install yt-dlp.yt-dlp`);
              }
            }}>Test yt-dlp</button>
            <button className="btn" disabled={!ytdlp.outDir} onClick={async () => {
              setYtTest('Checking folder…');
              try {
                setYtTest(`✓ ${await ytdlpApi.connectShare(ytdlp.outDir, ytdlp.shareUser, ytdlp.sharePass)}`);
              } catch (e) {
                setYtTest(`Folder problem: ${e}`);
              }
            }}>Test folder</button>
            {ytTest && <span className="muted">{ytTest}</span>}
          </div>
        </div>
      </section>}
    </>
  );
}

const SEASONAL_SKINS = new Set<Skin>(SEASONS.map((s) => s.skin));

/** Settings → Themes: grouped skin picker with search, live preview on hover/focus, Seasonal and Random daily. */
function ThemesTab() {
  const { skin, setSkin, seasonal, randomDaily, setThemeMode } = useSettings();
  const setPreview = useUi((s) => s.setPreviewSkin);
  const [q, setQ] = useState('');
  // never leave a hover preview stuck on screen after leaving the tab
  useEffect(() => () => setPreview(undefined), [setPreview]);
  const now = new Date();
  const season = seasonFor(now);
  const shown = activeSkin({ skin, seasonal, randomDaily }, now);
  const label = (id: Skin) => SKINS.find((s) => s.id === id)?.label ?? id;
  const needle = q.trim().toLowerCase();
  const matches = SKINS.filter((s) => !needle || s.label.toLowerCase().includes(needle) || s.group.toLowerCase().includes(needle) || s.id.includes(needle));

  return (
    <>
      <section>
        <h2>Theme</h2>
        <div className="editor">
          <label className="check">
            <input type="checkbox" checked={seasonal} onChange={(e) => setThemeMode({ seasonal: e.target.checked })} />
            <span><b>Seasonal</b> — switch to the holiday theme in the weeks around Valentine's Day, July 4th, Halloween, Thanksgiving and Christmas, then back to your pick.</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={randomDaily} onChange={(e) => setThemeMode({ randomDaily: e.target.checked })} />
            <span><b>Random daily</b> — a different theme every day (holiday themes left out).</span>
          </label>
          <p className="muted small">
            {shown === skin
              ? <>Showing <b>{label(skin)}</b>.</>
              : <>Showing <b>{label(shown)}</b> today{seasonal && season ? ` for ${season.label}` : ''}. Your pick, <b>{label(skin)}</b>, comes back {seasonal && season ? 'after the holiday' : 'when you turn Random daily off'}.</>}
            {' '}Point at (or focus) a card to preview it; tap it to choose.
          </p>
        </div>
      </section>

      <section>
        <input className="filter wide" placeholder="Search themes…" value={q} onChange={(e) => setQ(e.target.value)} />
        {SKIN_GROUPS.map((group) => {
          const list = matches.filter((s) => s.group === group);
          if (!list.length) return null;
          return (
            <div key={group} className="skin-group">
              <h3>{group}</h3>
              {group === 'Holidays' && (
                <p className="muted small">{SEASONS.map((s) => `${s.label}: ${s.window}`).join(' · ')}. Turn on Seasonal above to have these switch on by themselves.</p>
              )}
              <div className="skins">
                {list.map(({ id: k, label }) => (
                  <button
                    key={k}
                    className={`skin-card ${k} ${skin === k ? 'on' : ''}`}
                    onMouseEnter={() => setPreview(k)}
                    onMouseLeave={() => setPreview(undefined)}
                    onFocus={() => setPreview(k)}
                    onBlur={() => setPreview(undefined)}
                    onClick={() => {
                      setSkin(k);
                      setPreview(undefined);
                      // picking a skin by hand means "show me this one": daily shuffle would hide it
                      if (randomDaily) setThemeMode({ randomDaily: false });
                    }}
                  >
                    <div className="skin-preview"><span /><span /><span /></div>
                    {label}
                    {SEASONAL_SKINS.has(k) && season?.skin === k ? <small className="muted">in season</small> : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!matches.length && <p className="muted">No theme matches “{q}”.</p>}
      </section>
    </>
  );
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'playback', label: 'Playback' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'themes', label: 'Themes' },
  { id: 'discover', label: 'Discover' },
];

export function Settings({ tab: initial }: { tab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initial ?? 'sources');
  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Settings</h1></header>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'sources' && <SourcesTab />}
      {tab === 'playback' && (
        <section id="equalizer">
          <h2>Equalizer</h2>
          <Equalizer />
        </section>
      )}
      {tab === 'downloads' && <DownloadsTab />}
      {tab === 'themes' && <ThemesTab />}
      {tab === 'discover' && <DiscoverCharts />}
    </div>
  );
}
