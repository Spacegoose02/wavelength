import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../components/common';
import { FACET_LABELS, useItemTagStore } from '../lib/itemTags';
import type { HubFacet, HubPlexImport } from '../sources/hub';
import { hubClient } from '../store/hub';
import { LibraryServer } from '../lib/serverName';

const errText = (e: unknown) => String((e as Error).message ?? e);
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
const ALL: HubFacet[] = ['style', 'mood', 'collection', 'genre'];

/**
 * Settings → Server → Import from Plex (hub/src/plexImport.ts): read the household's Plex server, see how much of it
 * matches the library and what each album and artist would get, then import styles, moods, collections (Plex's
 * collections and labels) and artist genres onto the Hub. Albums with no genre get Plex's as a suggestion, applied
 * with the genre review's Save, so Tag edits can undo it.
 */
export function PlexImport() {
  const c = hubClient();
  const [s, setS] = useState<HubPlexImport>();
  const [server, setServer] = useState<number>();
  const [want, setWant] = useState<Set<HubFacet>>(new Set(ALL));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [genres, setGenres] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const timer = useRef<number>(undefined);

  const show = (r: HubPlexImport) => {
    setS(r);
    if (r.preview) setGenres((g) => ({ ...Object.fromEntries(r.preview!.genres.map((x) => [x.id, x.genre])), ...g }));
    window.clearTimeout(timer.current);
    // follow a read while it runs
    if (r.state === 'reading' || r.state === 'importing') timer.current = window.setTimeout(() => void c?.plexImport().then(show, () => undefined), 1500);
  };
  useEffect(() => {
    c?.plexImport().then(show, () => undefined);
    return () => window.clearTimeout(timer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c || !s) return null;

  const run = async (what: () => Promise<HubPlexImport>, done?: (r: HubPlexImport) => string) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await what();
      show(r);
      if (done) setMsg(done(r));
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const p = s.preview;
  const changes = p ? p.changes.albums + p.changes.artists + (p.changes.tracks ?? 0) : 0;
  const running = s.state === 'reading' || s.state === 'importing';
  const suggestions = p?.genres ?? [];
  const chosen = suggestions.filter((g) => !skip.has(g.id) && genres[g.id]?.trim());

  const applyGenres = async () => {
    setBusy(true);
    setMsg('Writing genres…');
    try {
      let files = 0;
      for (let i = 0; i < chosen.length; i += 200) {
        const r = await c.applyGenres(chosen.slice(i, i + 200).map((g) => ({ id: g.id, genre: genres[g.id].trim() })));
        files += r.changed.length;
      }
      setSkip(new Set(suggestions.map((g) => g.id)));
      setMsg(`Wrote genres into ${plural(files, 'song')}. Undo is under Tag edits; ${LibraryServer()} shows them after its rescan.`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Import from Plex</h2>
      <p className="muted small">
        Plex fills in styles, moods and genres from its online music metadata. Read your Plex server to see how much
        of it matches your library and what each album and artist would get; nothing changes until you import.
        Styles, moods and collections (Plex’s collections and labels, like Christmas) are kept on your Hub. Anything
        you set by hand in Edit album or Edit artist is never overwritten.
      </p>
      {!s.servers.length ? (
        <p className="muted small">Add your Plex server, with a shared token, under Server logins first.</p>
      ) : (
        <div className="row gap" style={{ flexWrap: 'wrap' }}>
          {s.servers.length > 1 && (
            <select aria-label="Plex server" value={server ?? s.servers[0].id} onChange={(e) => setServer(Number(e.target.value))}>
              {s.servers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <button className="btn" disabled={busy || running} onClick={() => run(() => c.readPlex(server))}>{p ? 'Read Plex again' : 'Read Plex'}</button>
          {running && <><Spinner /> <span className="muted small">{s.step}</span></>}
        </div>
      )}
      {s.state === 'error' && <div className="errors">{s.error}</div>}
      {p && !running && (
        <>
          <p className="small">
            {p.server}: <b>{plural(p.albums.matched, 'album')}</b> of {p.albums.plex.toLocaleString()} and{' '}
            <b>{plural(p.artists.matched, 'artist')}</b> of {p.artists.plex.toLocaleString()} match your library
            {p.tracks ? <>, and <b>{plural(p.tracks.matched, 'song')}</b> of {p.tracks.plex.toLocaleString()} ({p.tracks.tagged.toLocaleString()} with moods or styles of their own)</> : null}.
            {' '}{changes > 0
              ? <>Importing would add to {plural(p.changes.albums, 'album')}, {plural(p.changes.artists, 'artist')}{p.changes.tracks ? <> and {plural(p.changes.tracks, 'song')}</> : null}.</>
              : <>Everything Plex has is already here.</>}
          </p>
          {p.sample.length > 0 && (
            <ul className="plex-sample small">
              {p.sample.map((m) => (
                <li key={`${m.kind}:${m.artist}:${m.title}`}>
                  <b>{m.kind === 'album' ? `${m.artist} – ${m.title}` : m.artist}</b>
                  {m.changes.map((f) => <span key={f} className="muted"> · {FACET_LABELS[f]}: {m.facets[f]?.slice(0, 5).join(', ')}{(m.facets[f]?.length ?? 0) > 5 ? '…' : ''}</span>)}
                </li>
              ))}
            </ul>
          )}
          {changes > 0 && (
            <div className="row gap" style={{ flexWrap: 'wrap' }}>
              {ALL.map((f) => (
                <label key={f} className="check small">
                  <input type="checkbox" checked={want.has(f)} onChange={(e) => setWant((w) => { const n = new Set(w); if (e.target.checked) n.add(f); else n.delete(f); return n; })} />
                  {f === 'genre' ? 'Artist genres' : FACET_LABELS[f]}
                </label>
              ))}
              <button className="btn primary" disabled={busy || !want.size} onClick={() => run(() => c.importPlex([...want]), (r) => {
                void useItemTagStore.getState().load(true);
                if (r.imported?.tracks) void useItemTagStore.getState().loadSongs(true);
                return `Imported onto ${plural(r.imported?.albums ?? 0, 'album')}, ${plural(r.imported?.artists ?? 0, 'artist')} and ${plural(r.imported?.tracks ?? 0, 'song')}.`;
              })}>Import</button>
            </div>
          )}
          {suggestions.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>{plural(suggestions.length, 'album')} with no genre, which Plex has one for</summary>
              <p className="muted small">The genre rules tidied Plex’s genre; change any before writing. This writes into the files like the genre review, so Tag edits can undo it.</p>
              <table className="plex-genres small">
                <tbody>
                  {suggestions.map((g) => (
                    <tr key={g.id}>
                      <td><input type="checkbox" aria-label={`Write a genre for ${g.title}`} checked={!skip.has(g.id)} onChange={(e) => setSkip((x) => { const n = new Set(x); if (e.target.checked) n.delete(g.id); else n.add(g.id); return n; })} /></td>
                      <td>{g.artist} – {g.title}</td>
                      <td><input value={genres[g.id] ?? ''} title={`Plex: ${g.plex}`} onChange={(e) => setGenres((x) => ({ ...x, [g.id]: e.target.value }))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn" disabled={busy || !chosen.length} onClick={applyGenres}>Write {plural(chosen.length, 'genre')}</button>
            </details>
          )}
          {p.unmatched.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted small">Plex albums with no match here ({p.albums.plex - p.albums.matched})</summary>
              <ul className="small muted">{p.unmatched.map((u) => <li key={`${u.artist}:${u.title}`}>{u.artist} – {u.title}</li>)}</ul>
            </details>
          )}
        </>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}
