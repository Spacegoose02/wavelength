import { useState } from 'react';
import { Deemix } from '../sources/deemix';
import { ytdlp as ytdlpApi } from '../sources/ytdlp';
import { isAndroid } from '../lib/platform';
import { sourceFor } from '../sources/registry';
import { SOURCE_COLORS, SOURCE_LABELS, type SourceConfig, type SourceKind } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { SKINS, useSettings } from '../store/settings';

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

export function Settings() {
  const { sources, removeSource, moveSource, upsertSource, skin, setSkin, deemix, setDeemix, ytdlp, setYtdlp } = useSettings();
  const [editing, setEditing] = useState<SourceConfig | null>(null);
  const [dmTest, setDmTest] = useState<string>();
  const [ytTest, setYtTest] = useState<string>();

  return (
    <div className="page narrow">
      <header className="page-head"><h1>Settings</h1></header>

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

      <section>
        <h2>Skin</h2>
        <div className="skins">
          {SKINS.map(({ id: k, label }) => (
            <button key={k} className={`skin-card ${k} ${skin === k ? 'on' : ''}`} onClick={() => setSkin(k)}>
              <div className="skin-preview"><span /><span /><span /></div>
              {label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
