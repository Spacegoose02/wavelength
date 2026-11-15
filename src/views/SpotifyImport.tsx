import { useEffect, useRef, useState } from 'react';
import { getSong, NotOnDeezer } from '../lib/getSong';
import { loadRadar, useFollows } from '../lib/follows';
import { useMustRequest } from '../lib/inbox';
import { useHidden } from '../lib/kids';
import { findInLibrary, pool } from '../lib/match';
import { readSpotifyFiles, type SpotifyBundle, type SpotifySong } from '../lib/spotifyExport';
import { HubError, type HubSpotifyStatus } from '../sources/hub';
import { norm, sourceFor } from '../sources/registry';
import type { Track } from '../sources/types';
import { hubClient, useHub } from '../store/hub';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Spinner } from '../components/common';
import { IconDownload } from '../components/Icons';

/**
 * Move from Spotify (docs/USER-GUIDE.md "Move from Spotify"): bring someone's Spotify playlists, liked songs and
 * followed artists over in one go, from Spotify sign-in (hub/src/spotify.ts) or Spotify's data export /
 * Exportify (lib/spotifyExport.ts). Songs are matched to the library like Import a playlist; playlists become
 * Wavelength playlists, liked songs Favorites, followed artists Release Radar follows, and what's missing can be
 * got or requested.
 */

const errText = (e: unknown) => String((e as Error)?.message ?? e);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const songKey = (s: SpotifySong) => `${norm(s.title)}|${norm(s.artist)}`;
const PRIVACY_PAGE = 'https://www.spotify.com/account/privacy/';
const DASHBOARD = 'https://developer.spotify.com/dashboard';

interface Missing extends SpotifySong {
  dl?: { state: 'sending' | 'queued' | 'error'; via?: string; msg?: string };
}

interface Result {
  made: number;
  updated: number;
  songs: number;
  faved: number;
  followed: number;
  notFound: string[];
  missing: Missing[];
}

export function SpotifyImport() {
  const [bundle, setBundle] = useState<SpotifyBundle>();
  const [from, setFrom] = useState<'connect' | 'file'>();
  const [error, setError] = useState<string>();
  const [reading, setReading] = useState(false);

  const load = (b: SpotifyBundle, how: 'connect' | 'file') => {
    if (!b.playlists.length && !b.liked.length && !b.artists.length)
      throw new Error('No playlists, liked songs or artists in that. Choose the zip from Spotify’s email (or Playlist1.json and YourLibrary.json from inside it), or Exportify’s CSVs');
    setBundle(b);
    setFrom(how);
  };

  const chooseFiles = async (files: File[]) => {
    setError(undefined);
    setReading(true);
    try {
      load(await readSpotifyFiles(files.map((f) => ({ name: f.name, blob: f }))), 'file');
    } catch (e) {
      setError(errText(e));
    } finally {
      setReading(false);
    }
  };

  const startOver = () => {
    if (from === 'connect') void hubClient()?.spotifyForget().catch(() => undefined);
    setBundle(undefined);
    setFrom(undefined);
    setError(undefined);
  };

  return (
    <div className="page spotify-move">
      <header className="page-head">
        <h1>Move from Spotify</h1>
      </header>
      {!bundle ? (
        <>
          <p className="muted small">
            Bring your Spotify playlists, liked songs and the artists you follow over to Wavelength. Songs you have
            are matched up; the rest you can get or request. Nothing on Spotify changes.
          </p>
          <ConnectPanel onData={(b) => {
            try {
              setError(undefined);
              load(b, 'connect');
            } catch (e) {
              setError(errText(e));
            }
          }} />
          <section className="panel">
            <h2>Use your Spotify data file</h2>
            <p className="muted small">Works for everyone, and gets every playlist you made, however long.</p>
            <ol className="steps small">
              <li>
                Open <a href={PRIVACY_PAGE} target="_blank" rel="noreferrer">Spotify’s privacy page</a> (sign in if it asks),
                tick <b>Account data</b> and press <b>Request data</b>. Confirm in the email Spotify sends.
              </li>
              <li>A few days later Spotify emails you a link. Open it on this phone or computer and download the zip.</li>
              <li>Come back here and choose that zip. You don’t need to unzip it.</li>
            </ol>
            <label className="btn primary big-choice">
              {reading ? 'Reading…' : 'Choose the zip'}
              <input type="file" accept=".zip,.json,.csv,.tsv,application/zip" multiple hidden disabled={reading} onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) void chooseFiles(files);
              }} />
            </label>
            <p className="muted small">
              Already have <a href="https://exportify.app" target="_blank" rel="noreferrer">Exportify</a>’s CSVs or its
              “Export all” zip? Choose those instead; <i>liked_songs.csv</i> becomes your favorites.
            </p>
          </section>
          {error && <div className="errors">{error}</div>}
        </>
      ) : (
        <Review bundle={bundle} onStartOver={startOver} onDone={() => from === 'connect' && void hubClient()?.spotifyForget().catch(() => undefined)} />
      )}
    </div>
  );
}

/** Connect Spotify: one tap to Spotify's sign-in page, then pick up what the Hub read when it's ready. */
function ConnectPanel({ onData }: { onData(b: SpotifyBundle): void }) {
  const signedIn = useHub((s) => !!s.token);
  const [status, setStatus] = useState<HubSpotifyStatus | null>();
  const [link, setLink] = useState<{ url: string; at: number }>();
  const [waiting, setWaiting] = useState<{ read?: number }>();
  const [error, setError] = useState<string>();
  const [setUpOpen, setSetUpOpen] = useState(false);
  const polling = useRef(false);

  const refresh = () => {
    const c = hubClient();
    if (!c) return setStatus(null);
    c.spotifyStatus().then(setStatus, (e) => setStatus(e instanceof HubError && e.status === 404 ? null : (setError(errText(e)), null)));
  };
  useEffect(refresh, [signedIn]);

  // the sign-in link, ready before the tap so the tap itself opens Spotify (a link's state lasts 15 minutes)
  const fresh = () => {
    const c = hubClient();
    if (!c || !status?.configured || !status.redirectOk) return;
    c.spotifyConnect().then((r) => setLink({ url: r.url, at: Date.now() }), (e) => setError(errText(e)));
  };
  useEffect(fresh, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ask the Hub how reading is going: nothing asked for, still working, or finished (either way). */
  const check = async (): Promise<'none' | 'working' | 'done'> => {
    const c = hubClient();
    if (!c) return 'done';
    const { job } = await c.spotifyImport();
    if (!job) return 'none';
    if (job.state === 'working') {
      setWaiting({ read: job.read });
      return 'working';
    }
    setWaiting(undefined);
    if (job.state === 'error') {
      setError(job.error);
      void c.spotifyForget().catch(() => undefined);
      fresh();
    } else onData(job.data);
    return 'done';
  };

  const poll = async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      for (let i = 0; i < 450 && polling.current; i++) {
        if ((await check().catch(() => 'none')) === 'done') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    } finally {
      polling.current = false;
    }
  };

  // something read earlier (this page was left while Spotify was open)
  useEffect(() => {
    if (status?.configured) void check().then((st) => { if (st === 'working') void poll(); }, () => undefined);
    return () => {
      polling.current = false;
    };
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // coming back from the Spotify tab or the browser: look straight away
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== 'visible') return;
      if (link && Date.now() - link.at > 10 * 60_000) fresh();
      if (waiting) void check().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  });

  if (status === undefined) return signedIn ? <Spinner /> : null;
  if (!status) {
    return (
      <section className="panel">
        <h2>Connect Spotify</h2>
        <p className="muted small">Signing in to Spotify needs a Wavelength Hub. Use your Spotify data file below instead.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Connect Spotify</h2>
      {status.configured && status.redirectOk ? (
        <>
          <p className="muted small">
            The quickest way: sign in to Spotify and pick up your playlists you made, liked songs and followed artists.
            Playlists other people made (like Discover Weekly) can be imported by link afterwards.
          </p>
          {waiting ? (
            <div className="row gap">
              <Spinner />
              <span className="small">{waiting.read ? `Reading your Spotify… ${plural(waiting.read, 'item')} so far` : 'Waiting for you to sign in on Spotify…'}</span>
              <button className="btn small ghost" onClick={() => { polling.current = false; setWaiting(undefined); }}>Cancel</button>
            </div>
          ) : link ? (
            <a className="btn primary big-choice" href={link.url} target="_blank" rel="noreferrer" onClick={() => {
              setError(undefined);
              setWaiting({});
              void poll();
            }}>Connect Spotify</a>
          ) : <Spinner />}
          <p className="muted small">
            If Spotify says something went wrong after you sign in, your Spotify email isn’t on your family’s list yet: ask whoever set it up to add it.
          </p>
        </>
      ) : status.configured ? (
        <p className="muted small">
          Spotify only sends people back to a Hub on an https:// address, and this Hub’s is <code>{status.redirectUri.replace(/\/auth\/spotify\/callback$/, '')}</code>.
          {status.setUp ? ' Give the Hub an https address (WAVELENGTH_PUBLIC_URL, see HUB.md) to use it. ' : ' '}
          Use your Spotify data file below for now.
        </p>
      ) : (
        <p className="muted small">
          {status.setUp
            ? 'Not set up yet. It takes about five minutes, once, by whoever pays for Spotify Premium (on a Family plan, the plan’s manager).'
            : 'Not set up on your Hub yet. Ask your Hub admin (or your family’s manager) to set up Spotify sign-in, or use your Spotify data file below.'}
        </p>
      )}
      {error && <div className="errors">{error}</div>}
      {status.setUp && (
        <details open={setUpOpen || (!status.configured && status.redirectOk)} onToggle={(e) => setSetUpOpen((e.target as HTMLDetailsElement).open)}>
          <summary>{status.configured ? 'Spotify sign-in settings' : 'Set up Spotify for your family'}</summary>
          <SpotifySetup status={status} onSaved={refresh} />
        </details>
      )}
    </section>
  );
}

/** The one-off setup: a Spotify app of the household's own, since Spotify allows 5 people per app that isn't a business. */
function SpotifySetup({ status, onSaved }: { status: HubSpotifyStatus; onSaved(): void }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState<string>();
  const [copied, setCopied] = useState(false);
  const save = async (values: { spotifyClientId: string | null; spotifyClientSecret: string | null }) => {
    const c = hubClient();
    if (!c) return;
    try {
      if (status.setUp === 'hub') await c.saveSharedKeys(0, values);
      else await c.saveFamilyKeys(values);
      setId('');
      setSecret('');
      setMsg(values.spotifyClientId ? 'Saved. Everyone you added on Spotify can now press Connect Spotify.' : 'Removed.');
      onSaved();
    } catch (e) {
      setMsg(errText(e));
    }
  };
  return (
    <div className="spotify-setup small">
      <ol className="steps">
        <li>
          Open the <a href={DASHBOARD} target="_blank" rel="noreferrer">Spotify developer dashboard</a> and sign in with the
          Spotify account that has Premium (on a Family plan, the plan manager’s). Accept the terms if asked, then press <b>Create app</b>.
        </li>
        <li>
          Call it <i>Wavelength</i> and write anything as the description. Under <b>Redirect URIs</b> paste this and press <b>Add</b>:
          <div className="row gap copy-row">
            <code>{status.redirectUri}</code>
            <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(status.redirectUri).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          Tick <b>Web API</b>, agree, and <b>Save</b>.
        </li>
        <li>
          In the app’s <b>Settings</b>, open <b>User Management</b> and add each person who’ll connect: their name and the
          email of <i>their</i> Spotify account (on a Family plan, each member’s own login). Add yourself too if you’re
          bringing your own over. Spotify allows 5 people per app.
        </li>
        <li>
          Back in <b>Basic information</b>, copy the <b>Client ID</b> and the <b>Client secret</b> (press “View client secret”) here:
        </li>
      </ol>
      {!status.redirectOk && (
        <p className="errors">Spotify needs this Hub on an https:// address first: set WAVELENGTH_PUBLIC_URL to it (HUB.md, “Public URL”).</p>
      )}
      <form className="spotify-keys" onSubmit={(e) => { e.preventDefault(); void save({ spotifyClientId: id.trim(), spotifyClientSecret: secret.trim() }); }}>
        <input aria-label="Client ID" placeholder={status.configured ? 'Client ID (saved; type to replace)' : 'Client ID'} value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" />
        <input aria-label="Client secret" type="password" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
        <div className="row gap">
          <button className="btn primary small" disabled={!id.trim() || !secret.trim()}>Save</button>
          {status.configured && <button type="button" className="btn small ghost" onClick={() => void save({ spotifyClientId: null, spotifyClientSecret: null })}>Turn off</button>}
        </div>
      </form>
      <p className="muted small">
        {status.setUp === 'hub'
          ? 'This is saved for the whole Hub. A family with its own Spotify app can have its own under Settings → Users → Shared keys.'
          : 'This is saved for your family only.'}{' '}
        Wavelength only reads (playlists, liked songs, followed artists), once, when someone connects; it keeps no Spotify login.
      </p>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}

/** What came from Spotify: tick what to bring over, then match, save, favorite and follow. */
function Review({ bundle, onStartOver, onDone }: { bundle: SpotifyBundle; onStartOver(): void; onDone(): void }) {
  const [lists, setLists] = useState(() => new Set(bundle.playlists.map((_, i) => i).filter((i) => bundle.playlists[i].songs.length)));
  const hub = useHub((s) => !!s.token);
  const favSource = useSettings((s) => s.sources.some((x) => x.enabled && x.kind === 'navidrome'));
  const followSupported = useFollows((s) => s.supported);
  const [fav, setFav] = useState(favSource);
  const [likedList, setLikedList] = useState(!favSource);
  const [follow, setFollow] = useState(true);
  const [progress, setProgress] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const hidden = useHidden();
  const canFollow = hub && followSupported !== false;
  useEffect(() => {
    if (hub && followSupported === undefined) void loadRadar();
  }, [hub, followSupported]);

  const go = async () => {
    setError(undefined);
    try {
      const chosen = bundle.playlists.filter((_, i) => lists.has(i));
      const wantLiked = bundle.liked.length > 0 && (fav || likedList);
      // every song once, however many playlists it's in
      const unique = new Map<string, SpotifySong>();
      for (const s of [...chosen.flatMap((p) => p.songs), ...(wantLiked ? bundle.liked : [])]) if (!unique.has(songKey(s))) unique.set(songKey(s), s);
      const found = new Map<string, Track | null>();
      const find = findInLibrary();
      const all = [...unique.entries()];
      let done = 0;
      setProgress(`Finding songs in your library… 0 of ${all.length.toLocaleString()}`);
      await pool(all, 4, async ([k, s]) => {
        found.set(k, (await find(s).catch(() => undefined)) ?? null);
        if (++done % 10 === 0 || done === all.length) setProgress(`Finding songs in your library… ${done.toLocaleString()} of ${all.length.toLocaleString()}`);
      });
      const ok = (t: Track | null | undefined): t is Track => !!t && !hidden.track(t);
      const tracksOf = (songs: SpotifySong[]) => {
        const seen = new Set<string>();
        return songs.map((s) => found.get(songKey(s))).filter(ok).filter((t) => !seen.has(`${t.sourceId}:${t.id}`) && !!seen.add(`${t.sourceId}:${t.id}`));
      };

      // playlists: a new one, or the songs it's missing added to one of the same name (so doing it twice is safe)
      const r: Result = { made: 0, updated: 0, songs: 0, faved: 0, followed: 0, notFound: [], missing: [] };
      const lib = useLibrary.getState();
      const save = (name: string, tracks: Track[]) => {
        if (!tracks.length) return;
        const same = useLibrary.getState().playlists.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (!same) {
          lib.createPlaylist(name, tracks);
          r.made++;
          r.songs += tracks.length;
          return;
        }
        const have = new Set(same.tracks.map((t) => `${t.sourceId}:${t.id}`));
        const add = tracks.filter((t) => !have.has(`${t.sourceId}:${t.id}`));
        if (add.length) {
          lib.addToPlaylist(same.id, add);
          r.updated++;
          r.songs += add.length;
        }
      };
      setProgress('Saving playlists…');
      for (const p of chosen) save(p.name, tracksOf(p.songs));
      if (wantLiked && likedList) save('Liked Songs', tracksOf(bundle.liked));

      if (wantLiked && fav) {
        const sources = useSettings.getState().sources;
        const toFav = tracksOf(bundle.liked).filter((t) => !t.starred);
        let n = 0;
        await pool(toFav, 4, async (t) => {
          const cfg = sources.find((x) => x.id === t.sourceId);
          const src = cfg && sourceFor(cfg);
          if (!src?.setFavorite) return;
          await src.setFavorite(t, true).then(() => {
            t.starred = true;
            r.faved++;
          }, () => undefined);
          if (++n % 10 === 0) setProgress(`Adding to Favorites… ${n.toLocaleString()} of ${toFav.length.toLocaleString()}`);
        });
      }

      const c = hubClient();
      if (follow && canFollow && c && bundle.artists.length) {
        const already = new Set(useFollows.getState().follows.map((f) => norm(f.name)));
        const todo = bundle.artists.filter((a) => !already.has(norm(a)));
        let n = 0;
        for (const name of todo) {
          setProgress(`Following artists… ${++n} of ${todo.length}`);
          try {
            await c.follow({ name });
            r.followed++;
          } catch {
            r.notFound.push(name);
          }
        }
        if (todo.length) void loadRadar();
      }

      r.missing = all.filter(([k, s]) => found.get(k) === null && !hidden.track({ kind: 'track', id: '', sourceId: '', title: s.title, artist: s.artist })).map(([, s]) => ({ ...s }));
      setResult(r);
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setProgress(undefined);
    }
  };

  if (result) return <Done result={result} onStartOver={onStartOver} />;
  const songCount = bundle.playlists.reduce((n, p) => n + (lists.has(bundle.playlists.indexOf(p)) ? p.songs.length : 0), 0);

  return (
    <>
      <p className="small">
        {bundle.account ? <>From <b>{bundle.account}</b>’s Spotify: </> : 'From Spotify: '}
        {plural(bundle.playlists.length, 'playlist')}, {plural(bundle.liked.length, 'liked song')} and {plural(bundle.artists.length, 'followed artist')}.
        {' '}<button className="btn small ghost" onClick={onStartOver} disabled={!!progress}>Start over</button>
      </p>

      {bundle.playlists.length > 0 && (
        <section className="panel">
          <h2>Playlists</h2>
          <div className="row gap">
            <button className="btn small ghost" onClick={() => setLists(new Set(bundle.playlists.map((_, i) => i)))}>All</button>
            <button className="btn small ghost" onClick={() => setLists(new Set())}>None</button>
            <span className="muted small">{plural(lists.size, 'playlist')}, {plural(songCount, 'song')}</span>
          </div>
          <div className="spotify-lists">
            {bundle.playlists.map((p, i) => (
              <label key={i} className="check">
                <input type="checkbox" checked={lists.has(i)} disabled={!p.songs.length} onChange={(e) => setLists((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(i);
                  else n.delete(i);
                  return n;
                })} />
                <span>{p.name} <span className="muted small">· {plural(p.songs.length, 'song')}</span></span>
              </label>
            ))}
          </div>
          <p className="muted small">Each becomes a Wavelength playlist of the songs you have. If you already have one with the same name, only its missing songs are added.</p>
        </section>
      )}

      {bundle.liked.length > 0 && (
        <section className="panel">
          <h2>Liked songs</h2>
          <label className="check">
            <input type="checkbox" checked={fav && favSource} disabled={!favSource} onChange={(e) => setFav(e.target.checked)} />
            <span>Add the {plural(bundle.liked.length, 'song')} you have to Favorites {!favSource && <span className="muted small">(needs Navidrome)</span>}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={likedList} onChange={(e) => setLikedList(e.target.checked)} />
            <span>Also save them as a playlist called “Liked Songs”</span>
          </label>
        </section>
      )}

      {bundle.artists.length > 0 && (
        <section className="panel">
          <h2>Artists you follow</h2>
          <label className="check">
            <input type="checkbox" checked={follow && canFollow} disabled={!canFollow} onChange={(e) => setFollow(e.target.checked)} />
            <span>
              Follow {plural(bundle.artists.length, 'artist')} on Release Radar, to hear about their new music
              {!canFollow && <span className="muted small"> (needs a Hub)</span>}
            </span>
          </label>
          <p className="muted small">{bundle.artists.slice(0, 12).join(', ')}{bundle.artists.length > 12 ? ` and ${bundle.artists.length - 12} more` : ''}</p>
        </section>
      )}

      {bundle.skipped.length > 0 && (
        <section className="panel">
          <h2>Playlists by other people</h2>
          <p className="muted small">Spotify sign-in doesn’t hand these over. Import one by its link (up to about 100 songs), or use your Spotify data file.</p>
          {bundle.skipped.map((p, i) => (
            <div key={i} className="row gap spotify-skipped">
              <span className="small">{p.name}</span>
              {p.url && <button className="btn small" onClick={() => useUi.getState().go({ view: 'import', link: p.url })}>Import link</button>}
            </div>
          ))}
        </section>
      )}

      {error && <div className="errors">{error}</div>}
      <div className="row gap spotify-go">
        <button className="btn primary big-choice" disabled={!!progress || (!lists.size && !(bundle.liked.length && (fav || likedList)) && !(bundle.artists.length && follow && canFollow))} onClick={() => void go()}>
          Bring it over
        </button>
        {progress && <><Spinner /> <span className="muted small">{progress}</span></>}
      </div>
    </>
  );
}

function Done({ result, onStartOver }: { result: Result; onStartOver(): void }) {
  const [missing, setMissing] = useState(result.missing);
  const ask = useMustRequest();
  const canGet = useHub((s) => !s.token || s.permissions.includes('downloads.run') || s.permissions.includes('requests.create'));
  const patch = (i: number, p: Partial<Missing>) => setMissing((ms) => ms.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const get = async (i: number) => {
    patch(i, { dl: { state: 'sending' } });
    try {
      patch(i, { dl: { state: 'queued', via: await getSong(missing[i]) } });
    } catch (e) {
      patch(i, { dl: { state: 'error', msg: e instanceof NotOnDeezer ? 'Not on Deezer' : errText(e) } });
    }
  };
  const left = missing.map((m, i) => ({ m, i })).filter(({ m }) => !m.dl);
  const lines = [
    (result.made || result.updated) && `${result.made ? `Made ${plural(result.made, 'playlist')}` : ''}${result.made && result.updated ? ' and ' : ''}${result.updated ? `${result.made ? 'added to' : 'Added to'} ${plural(result.updated, 'playlist')} you had` : ''} (${plural(result.songs, 'song')}).`,
    result.faved > 0 && `Added ${plural(result.faved, 'song')} to Favorites.`,
    result.followed > 0 && `Following ${plural(result.followed, 'more artist', 'more artists')} on Release Radar.`,
    result.notFound.length > 0 && `Couldn’t find ${plural(result.notFound.length, 'artist')} on Deezer to follow: ${result.notFound.slice(0, 8).join(', ')}${result.notFound.length > 8 ? '…' : ''}.`,
  ].filter(Boolean);

  return (
    <>
      <section className="panel">
        <h2>Done</h2>
        {lines.length ? lines.map((l, i) => <p key={i} className="small">{l}</p>) : <p className="small">Everything was already here.</p>}
        <div className="row gap">
          <button className="btn small" onClick={() => useUi.getState().go({ view: 'playlists' })}>Open Playlists</button>
          <button className="btn small ghost" onClick={onStartOver}>Bring more over</button>
        </div>
      </section>
      {missing.length > 0 && (
        <section className="panel">
          <h2>Not in your library ({missing.length.toLocaleString()})</h2>
          {canGet ? (
            <button className="btn small" disabled={!left.length} onClick={async () => {
              if (!confirm(ask ? `Request ${left.length} songs from your Hub admin?` : `Get ${left.length} songs?`)) return;
              for (const { i } of left) await get(i);
            }}><IconDownload /> {ask ? 'Request' : 'Get'} all ({left.length})</button>
          ) : <p className="muted small">Ask whoever looks after your music to add these.</p>}
          <p className="muted small">Once they’re in your library, do this again: it only adds what’s missing.</p>
          <div className="tracklist">
            {missing.map((m, i) => (
              <div key={i} className="track-row chart-row">
                <div className="track-main">
                  <div className="track-title">{m.title}</div>
                  <div className="track-sub">{m.artist}{m.album ? ` · ${m.album}` : ''}</div>
                </div>
                <div className="chart-action">
                  {m.dl?.state === 'queued' ? <span className="ok small">{m.dl.via === 'request' ? 'Requested' : `Queued via ${m.dl.via}`}</span>
                    : m.dl?.state === 'error' ? <span className="card-err" title={m.dl.msg}>{m.dl.msg}</span>
                    : canGet ? <button className="btn small" disabled={m.dl?.state === 'sending'} onClick={() => get(i)}><IconDownload /> {m.dl?.state === 'sending' ? '…' : ask ? 'Request' : 'Get'}</button>
                    : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
