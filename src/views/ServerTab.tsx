import { useEffect, useState } from 'react';
import { HubError, type HubAdminService, type HubCatalogStatus, type HubAdminUser, type HubContainer, type HubLibraryStatus, type HubListening, type HubServerStatus, type HubTagEdit, type HubTrashAlbum } from '../sources/hub';
import { hubClient } from '../store/hub';
import { GenreReview } from './GenreReview';

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

const errText = (e: unknown) => String((e as Error).message ?? e);

/** Admin: the ntfy server the Hub sends push notifications through (hub/src/push.ts). */
/**
 * How hard the Hub's machine is working (GET /api/admin/server `load`). "Answer delay" is how long the Hub's main
 * thread was stuck since the last look: anything over about 100 ms makes every device wait for the Hub.
 */
function ServerLoad({ load, index }: { load: NonNullable<HubServerStatus['load']>; index: HubServerStatus['index'] }) {
  const [one] = load.loadAvg;
  const busy = load.cpus ? one / load.cpus : 0;
  const used = load.memory.total - load.memory.free;
  const slow = load.eventLoopMs.p99 > 100;
  return (
    <section>
      <h2>Load</h2>
      <div className="server-grid">
        <div><span className="muted">CPU</span><b className={busy > 0.9 ? 'kid-blocked' : ''}>{Math.round(busy * 100)}% of {load.cpus} core{load.cpus === 1 ? '' : 's'} (last minute)</b></div>
        <div><span className="muted">Memory</span><b>{gb(used)} of {gb(load.memory.total)} used · Hub {gb(load.memory.hub)}</b></div>
        <div><span className="muted">Answer delay</span><b className={slow ? 'kid-blocked' : ''}>{load.eventLoopMs.p99} ms typical worst, {load.eventLoopMs.max} ms worst{slow ? ' — the Hub is busy; check sound-alike analysis and other containers' : ''}</b></div>
        {index && <div><span className="muted">Library copy</span><b>{index.listedAt ? `${index.songs.toLocaleString()} songs, listed ${since(index.listedAt)} ago` : 'Not listed yet (needs the Library updates login)'} · {index.lyrics.toLocaleString()} songs' lyrics</b></div>}
      </div>
    </section>
  );
}

function PushNotifications() {
  const [s, setS] = useState<{ server: string; hasToken: boolean } | null>();
  const [form, setForm] = useState({ server: '', token: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    hubClient()?.pushSettings().then((r) => {
      setS(r);
      setForm({ server: r.server, token: '' });
    }, () => setS(null));
  }, []);
  if (!s) return null;
  const save = async (b: { server: string; token?: string | null }) => {
    setMsg('…');
    try {
      const r = await hubClient()!.savePushSettings(b);
      setS(r);
      setForm({ server: r.server, token: '' });
      setMsg(r.server ? '✓ Saved. Everyone can turn push on under Settings → Account → Notifications.' : '✓ Push notifications are off');
    } catch (e) {
      setMsg(errText(e));
    }
  };
  return (
    <section>
      <h2>Push notifications</h2>
      <p className="muted small">
        Lets people get their notifications through the ntfy app while Wavelength is closed. Use <code>https://ntfy.sh</code> (free; each
        person gets a long random topic, but ntfy.sh can read what's sent: song and album names) or your own ntfy server, with an access
        token if it needs one.
      </p>
      <form className="editor-grid" onSubmit={(e) => { e.preventDefault(); void save({ server: form.server.trim(), ...(form.token.trim() && { token: form.token.trim() }) }); }}>
        <label>ntfy server<input value={form.server} placeholder="https://ntfy.sh" onChange={(e) => setForm({ ...form, server: e.target.value })} /></label>
        <label>Access token {s.hasToken ? '(saved; type to replace)' : '(optional)'}<input type="password" value={form.token} placeholder="tk_…" autoComplete="off" onChange={(e) => setForm({ ...form, token: e.target.value })} /></label>
        <div className="row gap span2">
          <button className="btn small primary">Save</button>
          {s.hasToken && <button type="button" className="btn small ghost" onClick={() => void save({ server: s.server, token: null })}>Remove token</button>}
          {s.server && <button type="button" className="btn small ghost" onClick={() => void save({ server: '' })}>Turn off</button>}
        </div>
      </form>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}

/** Who's playing what right now, on which device (reported by each device every minute). */
function ListeningNow() {
  const [list, setList] = useState<HubListening[]>();
  useEffect(() => {
    let alive = true;
    const load = () => hubClient()?.listening().then((r) => alive && setList(r.listening)).catch(() => undefined);
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!list) return null;
  return (
    <section>
      <h2>Listening now</h2>
      {!list.length && <p className="muted">Nobody is playing anything right now.</p>}
      {list.map((p) => (
        <div key={p.deviceId} className="source-row">
          <div className="track-main">
            <div className="track-title">{p.displayName}{p.role === 'kid' ? <small className="muted"> · kid</small> : null}</div>
            <div className="track-sub">{p.title}{p.artist ? ` — ${p.artist}` : ''}{p.album ? ` · ${p.album}` : ''}</div>
          </div>
          <span className="muted small" title={PLAYED_BY_HINT[p.playedBy ?? ''] ?? undefined}>{p.deviceName}{p.playedBy ? ` · ${PLAYED_BY[p.playedBy]}` : p.source ? ` · ${p.source}` : ''}</span>
        </div>
      ))}
    </section>
  );
}

/**
 * Own Navidrome profiles: the Hub keeps the Navidrome admin login, makes an account for each person (or
 * takes the one they have), and their devices get it when they sign in.
 */
function NavidromeAccounts() {
  const c = hubClient();
  const [svc, setSvc] = useState<HubAdminService | null>();
  const [users, setUsers] = useState<HubAdminUser[]>([]);
  const [form, setForm] = useState({ url: '', adminUsername: '', adminPassword: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<number>();
  const load = async () => {
    if (!c) return;
    try {
      const [s, u] = await Promise.all([c.adminServices(), c.users()]);
      const nd = s.services.find((x) => x.kind === 'navidrome') ?? null;
      setSvc(nd);
      setUsers(u.users);
      if (nd) setForm((f) => ({ ...f, url: f.url || nd.url }));
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (svc === undefined) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('…');
    try {
      const secrets: Record<string, string> = {};
      if (form.adminUsername) secrets.adminUsername = form.adminUsername;
      if (form.adminPassword) secrets.adminPassword = form.adminPassword;
      if (svc) await c!.updateService(svc.id, { url: form.url, secrets });
      else await c!.createService({ kind: 'navidrome', name: 'Navidrome', url: form.url, access: 'everyone', secrets });
      setForm((f) => ({ ...f, adminPassword: '' }));
      setMsg('Saved');
      await load();
    } catch (err) {
      setMsg(errText(err));
    }
  };
  const run = async (userId: number, f: () => Promise<unknown>) => {
    setBusy(userId);
    setMsg('');
    try {
      await f();
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(undefined);
    }
  };
  const hasAdmin = !!svc?.secretsSet.includes('adminUsername') && !!svc.secretsSet.includes('adminPassword');

  return (
    <section>
      <h2>Navidrome accounts</h2>
      <p className="muted small">
        Give everyone their own Navidrome account, so their favorites, play counts and playlists are their own. The Hub keeps
        the Navidrome admin login (it never leaves the Hub) and uses it to make accounts and to scan after downloads. Each
        person's devices get their own login when they sign in, in Settings → Sources. Kids' devices never get their Navidrome
        password: they reach Navidrome through the Hub, which also refuses to play them anything explicit or flagged.
      </p>
      <form className="editor" onSubmit={save}>
        <div className="editor-grid">
          <label className="span2">Navidrome address (as the Hub and people's devices reach it)<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://music.example.com" required /></label>
          <label>Admin username<input value={form.adminUsername} onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} placeholder={hasAdmin ? 'saved' : ''} autoComplete="off" /></label>
          <label>Admin password<input type="password" value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder={hasAdmin ? 'saved, leave empty to keep' : ''} autoComplete="new-password" /></label>
        </div>
        <div className="row gap"><button className="btn primary">{svc ? 'Save' : 'Add Navidrome'}</button>{msg && <span className="small">{msg}</span>}</div>
      </form>
      {svc && (
        <label className="check" style={{ margin: '12px 0' }} title="Every device reaches Navidrome through the Hub, so no device holds a Navidrome password">
          <span className="switch"><input type="checkbox" checked={svc.config.relay === 'everyone'} onChange={(e) => run(0, () => c!.updateService(svc.id, { config: { relay: e.target.checked ? 'everyone' : null } }))} /><span /></span>
          <small>Send everyone through the Hub, not just kids</small>
        </label>
      )}
      {svc && users.map((u) => {
        const has = svc.users.find((x) => x.userId === u.id)?.secretsSet.includes('username');
        return (
          <div key={u.id} className="source-row">
            <div className="track-main">
              <div className="track-title">{u.displayName} <span className="muted small">· {u.username}</span></div>
              <div className="track-sub">{has ? 'Has their own Navidrome login' : 'No Navidrome login yet'}</div>
            </div>
            {!has && hasAdmin && <button className="btn small primary" disabled={busy === u.id} onClick={() => run(u.id, () => c!.createNavidromeAccount(svc.id, u.id))}>Make account</button>}
            {!has && (
              <button className="btn small" disabled={busy === u.id} onClick={() => {
                const username = prompt(`${u.displayName}'s Navidrome username`, u.username);
                if (!username) return;
                const password = prompt(`${u.displayName}'s Navidrome password`);
                if (password) run(u.id, () => c!.setServiceUser(svc.id, u.id, { username, password }));
              }}>Use their login</button>
            )}
            {has && <button className="btn small ghost" disabled={busy === u.id} onClick={() => confirm(`Stop handing ${u.displayName} a Navidrome login? (Their Navidrome account stays.)`) && run(u.id, () => c!.removeServiceUser(svc.id, u.id))}>Remove</button>}
          </div>
        );
      })}
    </section>
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
        downloaded and Navidrome picks them up on its own schedule. The login stays on the Hub. With Navidrome added under
        Navidrome accounts, its admin login is used here unless you enter another.
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

/**
 * Music catalog (hub/src/catalog.ts): the Hub reads the music folder itself, the first step of it becoming the
 * music server. Shows how far a scan got and what it found; nothing here changes what devices play. Hidden on a
 * Hub that hasn't got it yet.
 */
/** Listening now: who sent the song (hub/src/playedBy.ts). */
const PLAYED_BY: Record<string, string> = { hub: 'played by the Hub', navidrome: 'Navidrome via the Hub', direct: 'Navidrome directly' };
const PLAYED_BY_HINT: Record<string, string> = {
  hub: 'The Hub sent this song from the music folder itself (Hub plays the songs)',
  navidrome: 'This device goes through the Hub, which fetched the song from Navidrome (Hub plays the songs is off, or the catalog doesn\'t know the song yet)',
  direct: 'This device talks to Navidrome itself, not through the Hub. Turn on “Send everyone through the Hub” under Sources for the Hub to play its songs',
};

function MusicCatalog() {
  const c = hubClient();
  const [st, setSt] = useState<HubCatalogStatus>();
  const [msg, setMsg] = useState('');
  const load = () => c?.catalog().then(setSt).catch(() => undefined);
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!st?.scanning) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [st]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null;
  const n = (x: number) => x.toLocaleString();
  const scan = async () => {
    setMsg('');
    try {
      setSt(await c!.scanCatalog());
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  const serve = async (b: { serve?: boolean; stream?: boolean; userData?: boolean }) => {
    setMsg('');
    try {
      setSt(await c!.setCatalogServe(b));
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  };
  const p = st.progress;
  const sum = st.summary;
  return (
    <section>
      <h2>Music catalog</h2>
      <p className="muted small">
        The Hub reads your music folder itself and keeps its own list of every song, with its tags, on the way to becoming
        your music server. Navidrome still plays everything; this list is matched to Navidrome's songs. Once nearly all of
        them match, Library care, the tag editors, the genre review and Delete album read this list instead of asking
        Navidrome. The Hub looks for changes every hour and after every Navidrome scan.
      </p>
      {st.blocked ? <p className="errors small">{st.blocked}</p> : (
        <>
          <div className="server-grid">
            <div><span className="muted">Songs</span><b>{n(st.files)} files · {n(sum.albums)} albums · {n(sum.artists)} artists · {n(Math.round(sum.hours))} hours</b></div>
            {st.navidromeSongs > 0 && <div><span className="muted">Matched to Navidrome</span><b>{n(st.linked)} of Navidrome's {n(st.navidromeSongs)} songs{sum.unlinked ? ` · ${n(sum.unlinked)} files Navidrome doesn't list` : ''}</b></div>}
            {st.inUse !== undefined && <div><span className="muted">Library care reads</span><b>{st.inUse ? 'This catalog (no sign-ins to Navidrome)' : 'Navidrome, until the catalog matches nearly all of its songs'}</b></div>}
            {sum.formats.length > 0 && <div><span className="muted">Formats</span><b>{sum.formats.map((f) => `${f.codec} ${n(f.files)}`).join(' · ')}</b></div>}
            {sum.untagged > 0 && <div><span className="muted">Missing tags</span><b>{n(sum.untagged)} files have no title, artist or album</b></div>}
            {sum.genres.length > 0 && <div><span className="muted">Top genres</span><b>{sum.genres.slice(0, 8).map((g) => g.genre).join(' · ')}</b></div>}
          </div>
          <div className="row gap wrap">
            <button className="btn" disabled={st.scanning} onClick={scan}>{st.scanning ? 'Scanning…' : 'Scan now'}</button>
            <span className="muted small">
              {p ? (p.step === 'walking' ? `Looking through folders · ${n(p.done)} files found` : `Reading ${n(p.done)} of ${n(p.total)} new or changed files`)
                : st.lastScanAt ? `Last scan ${since(st.lastScanAt)} ago, took ${Math.max(1, Math.round((st.lastScanMs ?? 0) / 1000))} s${st.lastChanges ? ` (${n(st.lastChanges.added)} new, ${n(st.lastChanges.changed)} changed, ${n(st.lastChanges.removed)} removed)` : ''}.`
                : 'No scan since the Hub started.'}
            </span>
            {msg && <span className="errors small">{msg}</span>}
          </div>
          {st.lastError && <p className="kid-blocked small">{st.lastError}</p>}
          {st.serve !== undefined && (
            <>
              <label className="check" style={{ margin: '12px 0 4px' }} title="Albums, artists, genres, search and covers come from the Hub; playing, hearts and playlists still go to Navidrome">
                <span className="switch"><input type="checkbox" checked={st.serve} onChange={(e) => serve({ serve: e.target.checked })} /><span /></span>
                <small>Hub answers browsing, search and covers (beta)</small>
              </label>
              <p className="muted small">
                {st.serve && !st.serving ? 'Waiting until the catalog matches nearly all of Navidrome\'s songs; Navidrome answers until then. '
                  : st.serving ? 'On for devices that reach Navidrome through the Hub. ' : ''}
                Only devices that reach Navidrome through the Hub (kids, or everyone with “Send everyone through the Hub”) are
                affected. Songs still play from Navidrome, by the same ids, and hearts and playlists stay there. A new download shows
                up here after the catalog's next look, a few minutes after Navidrome's scan.
              </p>
            </>
          )}
          {st.stream !== undefined && (
            <>
              <label className="check" style={{ margin: '12px 0 4px' }} title="Songs are read straight from the music folder; hearts, playlists and play counts still go to Navidrome">
                <span className="switch"><input type="checkbox" checked={st.stream} onChange={(e) => serve({ stream: e.target.checked })} /><span /></span>
                <small>Hub plays the songs (beta)</small>
              </label>
              <p className="muted small">
                {st.stream && !st.streaming ? 'Waiting until the catalog matches nearly all of Navidrome\'s songs; Navidrome plays until then. '
                  : st.streaming ? 'On for devices that reach Navidrome through the Hub. ' : ''}
                The Hub sends the music file itself, with seeking, instead of fetching it from Navidrome. When a device asks
                for a lower quality it converts as it plays. Plays still count in Navidrome, and a song the catalog doesn't
                know yet plays from Navidrome.
              </p>
            </>
          )}
          {st.userData !== undefined && (
            <>
              <label className="check" style={{ margin: '12px 0 4px' }} title="Hearts, play counts, ratings and playlists are kept by the Hub; Navidrome gets every change too">
                <span className="switch"><input type="checkbox" checked={st.userData} onChange={(e) => serve({ userData: e.target.checked })} /><span /></span>
                <small>Hub keeps hearts, play counts and playlists (beta)</small>
              </label>
              <p className="muted small">
                {st.userData && st.people ? `Kept for ${n(st.people.people)} ${st.people.people === 1 ? 'person' : 'people'}: ${n(st.people.stars)} hearts, ${n(st.people.plays)} plays. ` : ''}
                Each person's hearts, plays, ratings and playlists are copied from Navidrome the first time they use the app through
                the Hub, then kept here. Smart playlists stay on Navidrome. Every change is sent on to Navidrome as well, so it stays
                complete. Recently played, Most played and Starred lists come from the Hub while the Hub answers browsing.
              </p>
            </>
          )}
          {!!st.missing?.length && (
            <details className="small">
              <summary>{n(Math.max(0, st.navidromeSongs - st.linked))} songs Navidrome lists without a file the Hub found</summary>
              <p className="muted">Usually files that were moved or deleted and are still in Navidrome until it cleans up, or files in a hidden folder or one with a .ndignore, which the Hub skips.</p>
              <ul>{st.missing.map((m) => <li key={m.path || `${m.artist}-${m.title}`}>{m.artist} – {m.title}{m.album ? ` (${m.album})` : ''}{m.path && <> · <code>{m.path}</code></>}</li>)}</ul>
            </details>
          )}
          {sum.failed.length > 0 && (
            <details className="small">
              <summary>{n(st.failed)} files couldn't be read</summary>
              <ul>{sum.failed.map((f) => <li key={f.path}><code>{f.path}</code>: {f.error}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Containers (hub/src/routes/docker.ts): start, stop or restart the household's services and read their
 * logs, when the Hub is set up with a Docker socket proxy. Only the containers named in its settings show.
 */
function Containers() {
  const c = hubClient();
  const [st, setSt] = useState<{ enabled: boolean; containers: HubContainer[] }>();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [logs, setLogs] = useState<{ name: string; text: string }>();
  const load = () => c?.containers().then((r) => { setSt(r); setMsg(''); }).catch((e) => { setSt((x) => x ?? { enabled: true, containers: [] }); setMsg(errText(e)); });
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return null;

  const act = async (name: string, action: 'start' | 'stop' | 'restart') => {
    if (action !== 'start' && !confirm(`${action === 'stop' ? 'Stop' : 'Restart'} ${name}?`)) return;
    setBusy(name);
    setMsg(`${action === 'start' ? 'Starting' : action === 'stop' ? 'Stopping' : 'Restarting'} ${name}…`);
    try {
      await c!.container(name, action);
      setMsg('');
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy('');
      load();
    }
  };
  const showLogs = async (name: string) => {
    if (logs?.name === name) return setLogs(undefined);
    setLogs({ name, text: 'Loading…' });
    try {
      const r = await c!.containerLogs(name);
      setLogs({ name, text: r.logs.trim() || '(no output)' });
    } catch (e) {
      setLogs({ name, text: errText(e) });
    }
  };

  return (
    <section>
      <h2>Containers</h2>
      {!st.enabled ? (
        <p className="muted small">
          The Hub can start, stop and restart the household's other services (Navidrome, slskd, …) and show their logs. To turn this on,
          give it a Docker socket proxy and the names of the containers it may touch. See <code>docs/HUB.md</code>, "Docker control".
        </p>
      ) : (
        <>
          <p className="muted small">Only the containers named in the Hub's settings show here. Everything you do here goes in the activity log.</p>
          {msg && <p className="small">{msg}</p>}
          {st.containers.map((k) => (
            <div key={k.name}>
              <div className="source-row">
                <div className="track-main">
                  <div className="track-title">{k.name} <span className={`small ${k.state === 'running' ? 'muted' : 'kid-blocked'}`}>· {k.state}</span></div>
                  <div className="track-sub">{k.status}{k.image ? ` · ${k.image}` : ''}</div>
                </div>
                {k.state !== 'missing' && (
                  <div className="row gap">
                    {k.state === 'running'
                      ? <>
                          <button className="btn small" disabled={!!busy} onClick={() => act(k.name, 'restart')}>Restart</button>
                          <button className="btn small ghost" disabled={!!busy} onClick={() => act(k.name, 'stop')}>Stop</button>
                        </>
                      : <button className="btn small primary" disabled={!!busy} onClick={() => act(k.name, 'start')}>Start</button>}
                    <button className="btn small ghost" onClick={() => showLogs(k.name)}>{logs?.name === k.name ? 'Hide logs' : 'Logs'}</button>
                  </div>
                )}
              </div>
              {logs?.name === k.name && <pre className="container-logs">{logs.text}</pre>}
            </div>
          ))}
          <div className="row gap" style={{ marginTop: 10 }}><button className="btn small ghost" onClick={load}>Refresh</button></div>
        </>
      )}
    </section>
  );
}

/** Tag editor saves (views/TagEditor.tsx), newest first, each with Undo. */
function TagEdits() {
  const c = hubClient();
  const [edits, setEdits] = useState<HubTagEdit[]>();
  const [msg, setMsg] = useState('');
  const load = () => c?.tagHistory().then((r) => setEdits(r.edits)).catch(() => setEdits([]));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!edits?.length) return null;
  return (
    <section>
      <h2>Tag edits</h2>
      <p className="muted small">Tags changed with <b>Edit tags</b> on an album page, and genres tidied under Genres. Undo puts those files back as they were.</p>
      {msg && <p className="small">{msg}</p>}
      {edits.map((e) => (
        <div key={e.batch} className="source-row">
          <div className="track-main">
            <div className="track-title">{e.label}</div>
            <div className="track-sub">{e.files} file{e.files === 1 ? '' : 's'} · {e.by ?? (e.label === 'Genres of new downloads' ? 'the Hub' : 'someone')} · {new Date(e.at).toLocaleString()}{e.undoneAt ? ' · undone' : ''}</div>
          </div>
          {!e.undoneAt && (
            <button className="btn small ghost" onClick={async () => {
              if (!confirm(`Put the tags of ${e.label} back as they were?`)) return;
              try {
                const r = await c!.undoTags(e.batch);
                setMsg(`Undid ${r.undone} file${r.undone === 1 ? '' : 's'}${r.failed.length ? `; ${r.failed.length} failed` : ''}`);
              } catch (err) {
                setMsg(String((err as Error).message ?? err));
              }
              load();
            }}>Undo</button>
          )}
        </div>
      ))}
    </section>
  );
}

/** Albums deleted from album pages (hub/src/routes/trash.ts): put back, or remove for good before the 30 days are up. */
function DeletedAlbums() {
  const c = hubClient();
  const [list, setList] = useState<HubTrashAlbum[]>();
  const [msg, setMsg] = useState('');
  const load = () => c?.trash().then((r) => setList(r.albums)).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list?.length) return null;
  const act = async (f: () => Promise<unknown>, done: string) => {
    setMsg('…');
    try {
      await f();
      setMsg(done);
    } catch (e) {
      setMsg(errText(e));
    }
    load();
  };
  return (
    <section>
      <h2>Deleted albums</h2>
      <p className="muted small">Albums deleted with <b>Delete album</b> wait in a hidden folder in your music library for 30 days, then they're removed for good.</p>
      {msg && <p className="small">{msg}</p>}
      {list.map((a) => {
        const waiting = !a.restoredAt && !a.purgedAt;
        return (
          <div key={a.batch} className="source-row">
            <div className="track-main">
              <div className="track-title">{a.label}</div>
              <div className="track-sub">
                {a.files} song{a.files === 1 ? '' : 's'} · deleted by {a.by ?? 'someone'} {since(a.at)} ago
                {a.restoredAt ? ' · put back' : a.purgedAt ? ' · removed for good' : ` · removed for good in ${Math.max(1, Math.ceil((a.purgeAt - Date.now()) / 86_400_000))} days`}
              </div>
            </div>
            {waiting && <button className="btn small" onClick={() => act(() => c!.restoreAlbum(a.batch), `Put back ${a.label}. Navidrome shows it again after its rescan`)}>Put back</button>}
            {waiting && <button className="btn small ghost" onClick={() => confirm(`Remove ${a.label} for good? This can't be undone.`) && act(() => c!.purgeAlbum(a.batch), `Removed ${a.label}`)}>Remove now</button>}
          </div>
        );
      })}
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

  const restore = async (file: File) => {
    const c = hubClient()!;
    if (!confirm(`Restore ${file.name}? Everything the Hub keeps goes back to how it was in that backup, and the Hub restarts. The current database is kept next to it on the server.`)) return;
    setBackup('Checking the backup…');
    try {
      let r;
      try {
        r = await c.restore(file);
      } catch (e) {
        if (!(e instanceof HubError && e.status === 409) || !confirm(`${e.message}.\n\nRestore anyway?`)) throw e;
        r = await c.restore(file, true);
      }
      setBackup(`Restoring ${r.users} people… waiting for the Hub to restart`);
      // Docker starts it again; wait until it answers
      for (let i = 0; i < 60; i++) {
        await new Promise((done) => setTimeout(done, 2000));
        if (await c.health().then(() => true, () => false)) break;
      }
      setBackup(r.keyMismatch ? 'Restored. Add the server logins again under Settings → Servers' : 'Restored');
      // this device may not be in the backup: if so it needs signing in again
      await c.me().then(load, () => setBackup('Restored. This device wasn’t in the backup, so sign in again under Settings → Account'));
    } catch (e) {
      setBackup(`Restore failed: ${(e as Error).message ?? e}`);
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
      {s.load && <ServerLoad load={s.load} index={s.index} />}
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
      <PushNotifications />
      <ListeningNow />
      <Containers />
      <NavidromeAccounts />
      <LibraryScan />
      <MusicCatalog />
      <GenreReview />
      <TagEdits />
      <DeletedAlbums />
      <section>
        <h2>Backup</h2>
        <p className="muted small">
          A copy of everything the Hub keeps: people, devices, settings, requests, shares, kid rules and server logins. The logins in it
          stay encrypted with the Hub's secret key (<code>secret.key</code> in its data folder), which isn't in the backup, so keep a
          copy of that file somewhere safe too.
        </p>
        <p className="muted small">
          Restoring puts the Hub back to a backup and restarts it (Docker starts it again). The database it replaces is kept in the
          data folder as <code>hub.db.before-restore-…</code>. Devices signed in after the backup was made need signing in again.
        </p>
        <div className="row gap">
          <button className="btn" onClick={download}>Download backup</button>
          <label className="btn ghost">
            Restore a backup…
            <input type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) restore(f);
            }} />
          </label>
          {backup && <span className="small">{backup}</span>}
        </div>
      </section>
    </>
  );
}
