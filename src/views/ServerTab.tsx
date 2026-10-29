import { useEffect, useState } from 'react';
import type { HubLibraryStatus, HubServerStatus } from '../sources/hub';
import { hubClient } from '../store/hub';

const gb = (n: number) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0, Math.round(n / 1e6))} MB`);
const since = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

function Disk({ d }: { d: { free: number; total: number } | null }) {
  if (!d) return <span className="muted">can't read</span>;
  const used = d.total ? 1 - d.free / d.total : 0;
  return (
    <span className="server-disk">
      <span className="progress thin"><i style={{ width: `${Math.round(used * 100)}%` }} /></span>
      <span className={used > 0.9 ? 'kid-blocked' : ''}>{gb(d.free)} free of {gb(d.total)}</span>
    </span>
  );
}

/**
 * Rescans after downloads (hub/src/library.ts): with a Navidrome admin login, the Hub asks Navidrome to scan
 * once a download finishes, then tells whoever requested it that it's ready.
 */
function LibraryScan() {
  const [st, setSt] = useState<HubLibraryStatus>();
  const [form, setForm] = useState({ url: '', username: '', password: '' });
  const [msg, setMsg] = useState('');
  const c = hubClient();
  const load = () => c?.library().then((r) => {
    setSt(r);
    if (r.navidrome) setForm((f) => ({ ...f, url: f.url || r.navidrome!.url, username: f.username || r.navidrome!.username }));
  }).catch((e) => setMsg(String((e as Error).message ?? e)));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!st?.scanning) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: () => Promise<HubLibraryStatus>, done: string) => {
    setMsg('…');
    try {
      setSt(await f());
      setForm((x) => ({ ...x, password: '' }));
      setMsg(done);
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  if (!st) return null;
  return (
    <section>
      <h2>Library updates</h2>
      <p className="muted small">
        With a Navidrome admin login, the Hub asks Navidrome to scan as soon as a download finishes, and tells whoever asked
        for it that their song is ready (with a Play button in their Inbox). Without one, requests show as ready once they've
        downloaded and Navidrome picks them up on its own schedule. The login stays on the Hub.
      </p>
      <form className="editor" onSubmit={(e) => { e.preventDefault(); act(() => c!.setScanLogin({ ...form, password: form.password || undefined }), 'Saved'); }}>
        <div className="editor-grid">
          <label className="span2">Navidrome address (as the Hub reaches it)<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://192.168.1.10:4533" required /></label>
          <label>Admin username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></label>
          <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={st.navidrome ? 'saved, leave empty to keep' : ''} autoComplete="new-password" /></label>
        </div>
        <div className="row gap wrap">
          <button className="btn primary">{st.navidrome ? 'Save' : 'Check and save'}</button>
          {st.navidrome && <button type="button" className="btn" disabled={st.scanning} onClick={() => act(() => c!.scanLibrary(), 'Scanning…')}>{st.scanning ? 'Scanning…' : 'Scan now'}</button>}
          {st.navidrome && <button type="button" className="btn ghost" onClick={() => confirm('Remove the Navidrome login from the Hub?') && act(() => c!.removeScanLogin(), 'Removed')}>Remove</button>}
          {msg && <span className="small">{msg}</span>}
        </div>
        {st.navidrome && (
          <p className="muted small">
            {st.scanning ? 'Navidrome is scanning now.' : st.scanQueued ? 'A scan starts in a moment (waiting for more downloads to finish).' : st.lastScanAt ? `Last scan ${since(st.lastScanAt)} ago.` : 'No scan since the Hub started.'}
            {st.lastError && <span className="kid-blocked"> Last try failed: {st.lastError}</span>}
          </p>
        )}
      </form>
    </section>
  );
}

/** Settings → Server (Hub admins): how the Hub is doing, and a backup of its database. */
export function ServerTab() {
  const [s, setS] = useState<HubServerStatus>();
  const [err, setErr] = useState('');
  const [backup, setBackup] = useState('');
  const load = () =>
    hubClient()?.server().then((r) => { setS(r); setErr(''); }).catch((e) => setErr(String((e as Error).message ?? e)));
  useEffect(() => {
    load();
  }, []);

  const download = async () => {
    setBackup('Making a backup…');
    try {
      const { name, blob } = await hubClient()!.backup();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      setBackup(`Saved ${name} (${gb(blob.size)})`);
    } catch (e) {
      setBackup(`Failed: ${(e as Error).message ?? e}`);
    }
  };

  if (err) return <div className="errors">{err}</div>;
  if (!s) return <p className="muted">Loading…</p>;
  const rows: [string, React.ReactNode][] = [
    ['Version', `Wavelength Hub ${s.version} · Node ${s.node.replace(/^v/, '')}`],
    ['Running for', since(s.startedAt)],
    ['Address', s.publicUrl],
    ['In a browser', s.web ? <a href={s.publicUrl} target="_blank" rel="noreferrer">{s.publicUrl}</a> : 'Not available in this build'],
    ['Single sign-on', s.sso ? 'On (tinyauth)' : 'Off'],
    ['yt-dlp', s.ytdlp ?? <span className="kid-blocked">not found</span>],
  ];
  return (
    <>
      <section>
        <h2>Hub</h2>
        <div className="server-grid">
          {rows.map(([k, v]) => <div key={k}><span className="muted">{k}</span><b>{v}</b></div>)}
        </div>
      </section>
      <section>
        <h2>Storage</h2>
        <div className="server-grid">
          <div><span className="muted">Music folder</span>
            <b>{!s.music ? 'Not set up' : !s.music.exists ? <span className="kid-blocked">{s.music.dir} is missing</span> : <>{s.music.dir}{s.music.writable ? '' : <span className="kid-blocked"> (read-only: downloads can't save)</span>}</>}</b>
          </div>
          {s.music?.exists && <div><span className="muted">Music disk</span><b><Disk d={s.music.disk} /></b></div>}
          <div><span className="muted">Hub data</span><b>{s.data.dir} · database {gb(s.data.dbBytes)}</b></div>
          <div><span className="muted">Data disk</span><b><Disk d={s.data.disk} /></b></div>
        </div>
      </section>
      <section>
        <h2>Household</h2>
        <div className="server-grid">
          <div><span className="muted">People</span><b>{s.counts.users} ({s.counts.admins} admin{s.counts.admins === 1 ? '' : 's'}, {s.counts.kids} kid{s.counts.kids === 1 ? '' : 's'})</b></div>
          <div><span className="muted">Listening today</span><b>{s.counts.activeToday} on {s.counts.devices} signed-in device{s.counts.devices === 1 ? '' : 's'}</b></div>
          <div><span className="muted">Requests waiting</span><b>{s.counts.pendingRequests}</b></div>
          <div><span className="muted">Servers kept on the Hub</span><b>{s.counts.services}</b></div>
          <div><span className="muted">Kid-safe</span><b>{s.counts.flags} flag{s.counts.flags === 1 ? '' : 's'} · {s.counts.ratedAlbums} albums checked</b></div>
        </div>
        <div className="row gap" style={{ marginTop: 10 }}><button className="btn small ghost" onClick={load}>Refresh</button></div>
      </section>
      <LibraryScan />
      <section>
        <h2>Backup</h2>
        <p className="muted small">
          A copy of everything the Hub keeps: people, devices, settings, requests, shares, kid rules and server logins. The logins in it
          stay encrypted with the Hub's secret key (<code>secret.key</code> in its data folder), which isn't in the backup, so keep a
          copy of that file somewhere safe too. To restore, stop the Hub, put the backup in its data folder as <code>hub.db</code>, and start it.
        </p>
        <div className="row gap"><button className="btn" onClick={download}>Download backup</button>{backup && <span className="small">{backup}</span>}</div>
      </section>
    </>
  );
}
