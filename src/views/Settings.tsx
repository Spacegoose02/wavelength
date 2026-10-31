import { useEffect, useState } from 'react';
import { ytdlp as ytdlpApi } from '../sources/ytdlp';
import { isAndroid } from '../lib/platform';
import { Equalizer } from '../components/Equalizer';
import { SCENES } from '../components/Scenes';
import { Critter, CRITTERS } from '../components/critters/Critter';
import { sourceFor } from '../sources/registry';
import { SOURCE_COLORS, SOURCE_LABELS, type SourceConfig, type SourceKind } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { useIsKid } from '../lib/kids';
import { SKIN_GROUPS, SKINS, useSettings, type Skin } from '../store/settings';
import { useUi, type SettingsTab } from '../store/ui';
import { hubClient, useCan, useHub } from '../store/hub';
import { deemixClient, hubKeeps, loadHubServices, saveDownloaderToHub, saveSourceToHub, useHubRuns } from '../lib/hubServices';
import { AccountTab, HubAccess, UsersTab } from './HubSettings';
import { ServerTab } from './ServerTab';
import { UpdatesTab } from '../components/Updates';
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

function SourceEditor({ initial, isNew, onDone }: { initial: SourceConfig; isNew: boolean; onDone(): void }) {
  const upsert = useSettings((s) => s.upsertSource);
  const canKeys = useHub((s) => !!s.token && s.permissions.includes('keys.manage'));
  const [cfg, setCfg] = useState(initial);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const hint = HINTS[cfg.kind];
  const set = (k: keyof SourceConfig, v: string) => setCfg({ ...cfg, [k]: v });
  // a Hub admin adds Plex, Audiobookshelf and SUB/WAVE to the Hub, so everyone signed in gets them
  const toHub = canKeys && hubKeeps(cfg.kind) && (cfg.hubId !== undefined || isNew);

  return (
    <form className="editor" onSubmit={async (e) => {
      e.preventDefault();
      if (toHub) {
        try {
          setTest({ ok: true, msg: 'Saving to your Hub…' });
          await saveSourceToHub(cfg);
        } catch (err) {
          setTest({ ok: false, msg: String((err as Error).message ?? err) });
          return;
        }
      } else upsert(cfg);
      onDone();
      useCatalog.getState().load();
    }}>
      <div className="editor-grid">
        <label>Type
          <select value={cfg.kind} disabled={cfg.hubId !== undefined} onChange={(e) => setCfg({ ...cfg, kind: e.target.value as SourceKind, name: cfg.name || SOURCE_LABELS[e.target.value as SourceKind] })}>
            {(Object.keys(SOURCE_LABELS) as SourceKind[]).map((k) => <option key={k} value={k}>{SOURCE_LABELS[k]}</option>)}
          </select>
        </label>
        <label>Name<input value={cfg.name} onChange={(e) => set('name', e.target.value)} placeholder={SOURCE_LABELS[cfg.kind]} /></label>
        <label className="span2">Server URL<input value={cfg.url} onChange={(e) => set('url', e.target.value)} placeholder={hint.url} required /></label>
        {hint.fields.map((f) => (
          <label key={f}>{hint.labels?.[f] ?? LABELS[f]}
            <input type={f === 'password' || f === 'token' ? 'password' : 'text'} value={(cfg[f] as string) ?? ''} onChange={(e) => set(f, e.target.value)}
              placeholder={cfg.hubId !== undefined && ['username', 'password', 'token'].includes(f) ? 'Kept on the Hub; type to replace' : undefined} />
          </label>
        ))}
      </div>
      <p className="muted small">{hint.help}</p>
      {toHub && <p className="muted small">Saved on your Hub, not this device. Devices signed in to the Hub get this server{cfg.kind === 'subwave' ? ', but only admins get the SUB/WAVE admin login' : ''}.</p>}
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
        <button className="btn primary">{toHub ? 'Save to Hub' : 'Save'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function SourcesTab() {
  const { sources, removeSource, moveSource, upsertSource } = useSettings();
  const signedIn = useHub((s) => !!s.token);
  const canKeys = useHub((s) => !!s.token && s.permissions.includes('keys.manage'));
  const [editing, setEditing] = useState<SourceConfig | null>(null);
  const [err, setErr] = useState('');
  const hubDo = async (f: () => Promise<unknown>) => {
    try {
      setErr('');
      await f();
      await loadHubServices();
      useCatalog.getState().load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };
  return (
    <>
      <section>
        <h2>Sources</h2>
        <p className="muted small">When the same album is on several servers, the source listed first wins. Use the arrows to reorder.</p>
        {signedIn && <p className="muted small">Plex, Audiobookshelf and SUB/WAVE logins can be kept on your Hub, so signed-in devices get them without typing them in. Admins give people their own Navidrome login under Settings → Server.{canKeys ? ' Use Move to Hub on a server that is only on this device.' : ''}</p>}
        {err && <div className="errors">{err}</div>}
        {sources.map((s, i) => (
          <div key={s.id}>
            <div className={`source-row ${s.enabled ? '' : 'off'}`}>
              <i className="dot big" style={{ background: SOURCE_COLORS[s.kind] }} />
              <div className="track-main">
                <div className="track-title">{s.name}</div>
                <div className="track-sub">
                  {SOURCE_LABELS[s.kind]} · {s.url}
                  {s.hubId !== undefined ? ' · from your Hub' : signedIn && hubKeeps(s.kind) ? ' · this device only' : ''}
                </div>
              </div>
              <button className="icon-btn" disabled={i === 0} onClick={() => moveSource(s.id, -1)}>▲</button>
              <button className="icon-btn" disabled={i === sources.length - 1} onClick={() => moveSource(s.id, 1)}>▼</button>
              <label className="switch"><input type="checkbox" checked={s.enabled} onChange={(e) => {
                upsertSource({ ...s, enabled: e.target.checked });
                useCatalog.getState().load();
              }} /><span /></label>
              {canKeys && s.hubId === undefined && hubKeeps(s.kind) && (
                <button className="btn small" onClick={() => confirm(`Move ${s.name} to your Hub? Everyone signed in to the Hub gets it${s.kind === 'subwave' ? ' (the SUB/WAVE admin login goes to admins only)' : ''}.`) && hubDo(() => saveSourceToHub(s))}>Move to Hub</button>
              )}
              {(s.hubId === undefined || canKeys) && <button className="btn small" onClick={() => setEditing(s)}>Edit</button>}
              {s.hubId === undefined ? (
                <button className="btn small ghost" onClick={() => confirm(`Remove ${s.name}?`) && removeSource(s.id)}>Remove</button>
              ) : canKeys && (
                <button className="btn small ghost" onClick={() => confirm(`Remove ${s.name} from your Hub? It goes from every signed-in device.`) && hubDo(() => hubClient()!.deleteService(s.hubId!))}>Remove</button>
              )}
            </div>
            {canKeys && s.hubId !== undefined && editing?.id === s.id && <HubAccess serviceId={s.hubId} kind={s.kind} />}
          </div>
        ))}
        {editing ? (
          <SourceEditor key={editing.id} initial={editing} isNew={!sources.some((x) => x.id === editing.id)} onDone={() => setEditing(null)} />
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

/** Where a downloader's settings come from when signed in to a Hub, and the admin's Save/Move button. */
function HubDownloader({ kind, onMsg }: { kind: 'deemix' | 'ytdlp'; onMsg(m: string): void }) {
  const canKeys = useHub((s) => !!s.token && s.permissions.includes('keys.manage'));
  const onHub = useHubRuns(kind);
  if (!useHub((s) => !!s.token)) return null;
  const save = async () => {
    onMsg('Saving to your Hub…');
    try {
      await saveDownloaderToHub(kind);
      onMsg('✓ Saved on your Hub');
    } catch (e) {
      onMsg(String((e as Error).message ?? e));
    }
  };
  const what = kind === 'deemix'
    ? 'Your Hub runs deemix with the ARL it keeps; no device is sent it.'
    : "Your Hub runs yt-dlp and saves into its music folder, from any device (Android too). No share login needed.";
  return (
    <div className="row gap">
      {canKeys && <button className="btn" onClick={save}>{onHub ? 'Save to Hub' : 'Move to Hub'}</button>}
      <span className="muted small">
        {onHub
          ? `${what} Admins and people with Autodownload can use it.${canKeys ? ' Change it here, then Save to Hub.' : ' Your admin changes the settings.'}`
          : canKeys ? `Only on this device. Move to Hub so you and people with Autodownload can use it on every device. ${what}` : ''}
      </span>
    </div>
  );
}

const YT_FORMATS = (
  <>
    <option value="opus">Opus (best quality from YouTube)</option>
    <option value="m4a">M4A / AAC</option>
    <option value="mp3">MP3 (most compatible)</option>
    <option value="flac">FLAC (lossless container, not lossless source)</option>
  </>
);

function DownloadsTab() {
  const { deemix, setDeemix, ytdlp, setYtdlp } = useSettings();
  const [dmTest, setDmTest] = useState<string>();
  const [ytTest, setYtTest] = useState<string>();
  const signedIn = useHub((s) => !!s.token);
  const canDownload = useCan('downloads.run');
  const hubDm = useHubRuns('deemix');
  const hubYt = useHubRuns('ytdlp');
  // a downloader who isn't an admin uses the Hub's settings as they are
  const locked = useHub((s) => !!s.token && !s.permissions.includes('keys.manage'));
  if (signedIn && !canDownload) {
    return (
      <section>
        <h2>Downloads</h2>
        <p className="muted">Your Hub admin looks after downloads. Ask them to turn on <b>Autodownload</b> for you to download music yourself.</p>
      </section>
    );
  }
  return (
    <>
      <section>
        <h2>deemix</h2>
        <div className="editor">
          <fieldset className="plain" disabled={hubDm && locked}>
          <div className="editor-grid">
            <label className="span2">deemix server URL{hubDm ? ' (as the Hub reaches it)' : ''}<input value={deemix.url} onChange={(e) => setDeemix({ url: e.target.value })} placeholder="http://192.168.1.10:6595" /></label>
            {!(hubDm && locked) && (
              <label>ARL (only if deemix asks to log in)
                <input type="password" value={deemix.arl} onChange={(e) => setDeemix({ arl: e.target.value })} placeholder={hubDm ? 'Kept on the Hub; type a new one to replace it' : ''} autoComplete="new-password" />
              </label>
            )}
            <label>Quality
              <select value={deemix.bitrate} onChange={(e) => setDeemix({ bitrate: Number(e.target.value) })}>
                <option value={9}>FLAC</option>
                <option value={3}>MP3 320</option>
                <option value={1}>MP3 128</option>
              </select>
            </label>
          </div>
          </fieldset>
          <div className="row gap">
            <button className="btn" onClick={async () => {
              setDmTest('Testing…');
              try {
                setDmTest(await deemixClient().test());
              } catch (e) {
                setDmTest(String((e as Error).message ?? e));
              }
            }}>Test deemix</button>
            {dmTest && <span className="muted">{dmTest}</span>}
          </div>
          <HubDownloader kind="deemix" onMsg={setDmTest} />
        </div>
      </section>

      {(hubYt || !isAndroid) && <section>
        <h2>yt-dlp <small className="muted">backup downloader</small></h2>
        <div className="editor">
          {hubYt ? (
            <>
              <p className="muted small">For anything deemix can't find: YouTube, YouTube Music, SoundCloud, Bandcamp and more. Your Hub downloads into a folder inside its music folder, so new songs show up after a Navidrome scan.</p>
              <fieldset className="plain" disabled={locked}>
                <div className="editor-grid">
                  <label>Folder inside the Hub's music folder<input value={ytdlp.hubFolder} onChange={(e) => setYtdlp({ hubFolder: e.target.value })} placeholder="yt-dlp" /></label>
                  <label>Audio format<select value={ytdlp.format} onChange={(e) => setYtdlp({ format: e.target.value })}>{YT_FORMATS}</select></label>
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <p className="muted small">For anything deemix can't find: YouTube, YouTube Music, SoundCloud, Bandcamp and more. Point the folder at your Navidrome music library (a mapped drive or <code>\\server\music</code> share works) so downloads show up after a rescan.</p>
              <div className="editor-grid">
                <label className="span2">Download folder<input value={ytdlp.outDir} onChange={(e) => setYtdlp({ outDir: e.target.value })} placeholder="\\nas\music\yt-dlp  or  D:\Music\yt-dlp" /></label>
                <label>Audio format<select value={ytdlp.format} onChange={(e) => setYtdlp({ format: e.target.value })}>{YT_FORMATS}</select></label>
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
              </div>
            </>
          )}
          {ytTest && <p className="muted small">{ytTest}</p>}
          <HubDownloader kind="ytdlp" onMsg={setYtTest} />
        </div>
      </section>}

      {signedIn && <SlskdSettings />}
    </>
  );
}

/**
 * Soulseek through slskd, run by the Hub (hub/src/slskd.ts): admins give it slskd's address and API key, which
 * stays on the Hub. slskd should save into a folder inside the music library so Navidrome finds the downloads.
 */
function SlskdSettings() {
  const canKeys = useHub((s) => s.permissions.includes('keys.manage'));
  const svc = useHub((s) => s.services.find((x) => x.kind === 'slskd'));
  const [url, setUrl] = useState(svc?.url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState('');
  if (!canKeys && !svc) return null;
  const save = async () => {
    setMsg('Saving…');
    try {
      const c = hubClient()!;
      const body = { name: 'slskd', url: url.trim(), ...(apiKey && { secrets: { apiKey } }) };
      if (svc) await c.updateService(svc.id, body);
      else await c.createService({ kind: 'slskd', ...body });
      await loadHubServices();
      setApiKey('');
      setMsg(`Saved. ${(await c.slskdTest()).message}`);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  return (
    <section>
      <h2>Soulseek <small className="muted">via slskd</small></h2>
      <div className="editor">
        <p className="muted small">
          Find albums people share on Soulseek, often in FLAC, from the <b>Soulseek</b> tab in Downloads and from requests in the Inbox.
          Your Hub talks to slskd for you; its API key stays on the Hub. Set slskd to save downloads into a folder inside your music
          library (e.g. <code>/music/slskd</code>), so Navidrome picks them up.
        </p>
        {canKeys ? (
          <div className="editor-grid">
            <label>slskd address (as the Hub reaches it)<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:5030" /></label>
            <label>API key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={svc ? 'Kept on the Hub; type a new one to replace it' : 'From slskd.yml, web → authentication → api_keys'} autoComplete="new-password" /></label>
          </div>
        ) : <p className="small">Set up on your Hub. Admins and people with Autodownload can use it.</p>}
        <div className="row gap">
          {canKeys && <button className="btn primary" onClick={save} disabled={!url.trim() || (!svc && !apiKey)}>{svc ? 'Save' : 'Add to Hub'}</button>}
          {svc && <button className="btn" onClick={async () => {
            setMsg('Testing…');
            try {
              setMsg((await hubClient()!.slskdTest()).message);
            } catch (e) {
              setMsg(String((e as Error).message ?? e));
            }
          }}>Test slskd</button>}
          {canKeys && svc && <button className="btn ghost" onClick={async () => {
            if (!confirm('Remove slskd from your Hub?')) return;
            await hubClient()!.deleteService(svc.id).catch(() => undefined);
            await loadHubServices();
            setMsg('Removed');
          }}>Remove</button>}
          {msg && <span className="small">{msg}</span>}
        </div>
      </div>
    </section>
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

/** Settings → Playback: which Now Playing visualizer, and which critter the critter scene shows (both sync to the Hub). */
function NowPlayingPicker() {
  const { npScene, setNpScene, raccoon, setRaccoon } = useSettings();
  return (
    <section id="visualizer">
      <h2>Now Playing visualizer</h2>
      <p className="muted small">You can also tap the artwork in Now Playing to step through these.</p>
      <div className="chips">
        {SCENES.map((s) => (
          <button key={s.id} className={`chip ${npScene === s.id ? 'on' : ''}`} onClick={() => setNpScene(s.id)}>{s.label}</button>
        ))}
      </div>
      <h3>Critters</h3>
      <p className="muted small">Pick who plays along. They dress for your theme: hazmat suits on Nuclear skins, laser visors, glow sticks, 8-bit shades, coder glasses and holiday hats.</p>
      <div className="critter-picks">
        {CRITTERS.map((r) => (
          <button
            key={r.id}
            className={`critter-pick ${npScene === 'raccoon' && raccoon === r.id ? 'on' : ''}`}
            onClick={() => {
              setRaccoon(r.id);
              setNpScene('raccoon');
            }}
          >
            <Critter kind={r.id} still />
            <b>{r.label}</b>
            <small className="muted">{r.blurb}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

const TABS: { id: SettingsTab; label: string; admin?: boolean }[] = [
  { id: 'account', label: 'Account' },
  { id: 'users', label: 'Users', admin: true },
  { id: 'server', label: 'Server', admin: true },
  { id: 'sources', label: 'Sources' },
  { id: 'playback', label: 'Playback' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'themes', label: 'Themes' },
  { id: 'discover', label: 'Discover' },
  { id: 'updates', label: 'Updates' },
];

/** Explicit / clean versions (lib/versions.ts). Kid profiles always get the clean one. */
function PlaybackOptions() {
  const pb = useSettings((s) => s.playback);
  const setPlayback = useSettings((s) => s.setPlayback);
  return (
    <section id="between-songs">
      <h2>Volume levelling and crossfade</h2>
      <p className="muted small">
        <b>ReplayGain</b> plays every song at about the same loudness, using the loudness tags in your files (Navidrome
        passes them on). <b>Album</b> keeps an album's quiet and loud songs as they were meant.
      </p>
      <div className="chips">
        {([['off', 'Off'], ['track', 'Track'], ['album', 'Album']] as const).map(([v, label]) => (
          <button key={v} className={`chip ${pb.replayGain === v ? 'on' : ''}`} onClick={() => setPlayback({ replayGain: v })}>{label}</button>
        ))}
      </div>
      {pb.replayGain !== 'off' && (
        <label className="range-field">
          <span>Boost levelled songs by {pb.replayGainPreamp > 0 ? '+' : ''}{pb.replayGainPreamp} dB</span>
          <input type="range" min={-6} max={6} step={1} value={pb.replayGainPreamp} onChange={(e) => setPlayback({ replayGainPreamp: Number(e.target.value) })} style={{ ['--pct' as string]: `${((pb.replayGainPreamp + 6) / 12) * 100}%` }} />
        </label>
      )}
      <p className="muted small">
        <b>Crossfade</b> fades the next song in over the end of this one. With it off, the next song is still loaded
        ahead, so albums play without gaps. Music only, and only from servers that allow it (the equalizer works there too).
      </p>
      <label className="range-field">
        <span>{pb.crossfade ? `Crossfade ${pb.crossfade} s` : 'Crossfade off (gapless)'}</span>
        <input type="range" min={0} max={12} step={1} value={pb.crossfade} onChange={(e) => setPlayback({ crossfade: Number(e.target.value) })} style={{ ['--pct' as string]: `${(pb.crossfade / 12) * 100}%` }} />
      </label>
    </section>
  );
}

function VersionsPicker() {
  const versions = useSettings((s) => s.versions);
  const setVersions = useSettings((s) => s.setVersions);
  const kid = useIsKid();
  return (
    <section id="versions">
      <h2>Explicit and clean versions</h2>
      <p className="muted small">
        When the library has both versions of an album, the album page has an Explicit / Clean switch. Pick one here to see only
        that version in album lists and open albums on it.{kid ? ' On this profile it’s always the clean version.' : ''}
      </p>
      <div className="chips">
        {([['both', 'Show both'], ['clean', 'Prefer clean'], ['explicit', 'Prefer explicit']] as const).map(([v, label]) => (
          <button key={v} className={`chip ${(kid ? 'clean' : versions) === v ? 'on' : ''}`} disabled={kid} onClick={() => setVersions(v)}>{label}</button>
        ))}
      </div>
    </section>
  );
}

export function Settings({ tab: initial }: { tab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initial ?? 'sources');
  // Users is for Hub admins only (the Hub refuses its calls from anyone else anyway)
  const isAdmin = useHub((s) => !!s.token && s.permissions.includes('users.manage'));
  const tabs = TABS.filter((t) => !t.admin || isAdmin);
  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Settings</h1></header>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'account' && <AccountTab />}
      {tab === 'users' && isAdmin && <UsersTab />}
      {tab === 'server' && isAdmin && <ServerTab />}
      {tab === 'sources' && <SourcesTab />}
      {tab === 'playback' && (
        <>
          <NowPlayingPicker />
          <PlaybackOptions />
          <VersionsPicker />
          <section id="equalizer">
            <h2>Equalizer</h2>
            <Equalizer />
          </section>
        </>
      )}
      {tab === 'downloads' && <DownloadsTab />}
      {tab === 'themes' && <ThemesTab />}
      {tab === 'discover' && <DiscoverCharts />}
      {tab === 'updates' && <UpdatesTab />}
    </div>
  );
}
