import { useEffect, useState } from 'react';
import type { HubGenreReview, HubGenreRule, HubGenreSettings } from '../sources/hub';
import { hubClient } from '../store/hub';

const errText = (e: unknown) => String((e as Error).message ?? e);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Settings → Server → Genres (hub/src/routes/genres.ts): one genre per kind of music. The Hub tidies new
 * downloads with the rules; the review here lists albums already in the library whose genre isn't tidy, to
 * apply one by one or all at once (undo under Tag edits), and genres no rule knows, to map.
 */
export function GenreReview() {
  const c = hubClient();
  const [s, setS] = useState<HubGenreSettings>();
  const [review, setReview] = useState<HubGenreReview>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [undo, setUndo] = useState<string[]>([]);
  // genre per album, as edited here (starts as the proposed one)
  const [pick, setPick] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mapTo, setMapTo] = useState<Record<string, string>>({});
  const [rule, setRule] = useState<HubGenreRule>({ from: '', to: '' });

  useEffect(() => {
    c?.genreSettings().then(setS).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    setLoading(true);
    try {
      const r = await c!.genreReview();
      setReview(r);
      setPick(Object.fromEntries(r.albums.map((a) => [a.id, a.proposed])));
      setPicked(new Set());
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setLoading(false);
    }
  };

  const saveRules = async (rules: HubGenreRule[] | null, done: string) => {
    setBusy(true);
    try {
      setS(await c!.saveGenreSettings({ rules }));
      setMsg(done);
      if (review) await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    setMsg(`Changing ${plural(ids.length, 'album')}…`);
    const batches: string[] = [];
    let songs = 0, failed = 0;
    try {
      // the Hub takes up to 500 albums at a time
      for (let i = 0; i < ids.length; i += 200) {
        const r = await c!.applyGenres(ids.slice(i, i + 200).map((id) => ({ id, genre: pick[id] })));
        if (r.batch) batches.push(r.batch);
        songs += r.changed.length;
        failed += r.failed.length + r.missing.length;
      }
      setMsg(`Changed the genre of ${plural(songs, 'song')} in ${plural(ids.length, 'album')}${failed ? `; ${failed} couldn’t be changed` : ''}. Navidrome shows it after its rescan.`);
    } catch (e) {
      setMsg(errText(e));
    }
    setUndo(batches);
    setReview((r) => r && { ...r, albums: r.albums.filter((a) => !ids.includes(a.id)) });
    setPicked(new Set());
    setBusy(false);
  };

  const undoLast = async () => {
    setBusy(true);
    try {
      let n = 0;
      for (const b of undo) n += (await c!.undoTags(b)).undone;
      setMsg(`Put ${plural(n, 'song')} back as they were`);
      setUndo([]);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const keep = async (id: string) => {
    try {
      setS(await c!.keepGenres([id]));
      setReview((r) => r && { ...r, albums: r.albums.filter((a) => a.id !== id), kept: r.kept + 1 });
    } catch (e) {
      setMsg(errText(e));
    }
  };

  if (!s) return null;
  const genres = review?.genres ?? s.genres;
  const albums = review?.albums ?? [];
  const allPicked = albums.length > 0 && albums.every((a) => picked.has(a.id));
  const byGenre = new Map<string, string[]>();
  for (const r of s.rules) if (r.from !== r.to) byGenre.set(r.to, [...(byGenre.get(r.to) ?? []), r.from]);
  for (const g of s.genres) if (!byGenre.has(g)) byGenre.set(g, []);

  return (
    <section>
      <h2>Genres</h2>
      <p className="muted small">
        One genre for each kind of music: “Hip Hop”, “Trap” and “Rap/Hip Hop” all become <b>Rap; Hip-Hop</b>, “Dance Pop” becomes <b>Pop</b>,
        “EDM” and “House” become <b>Electronic</b>. The rules below say what becomes what. Every change can be undone under Tag edits.
      </p>
      <datalist id="genre-targets">{genres.map((g) => <option key={g} value={g} />)}</datalist>
      <label className="check">
        <input type="checkbox" checked={s.auto} onChange={async (e) => {
          try {
            setS(await c!.saveGenreSettings({ auto: e.target.checked }));
          } catch (err) {
            setMsg(errText(err));
          }
        }} />
        Tidy the genre of new downloads (deemix, Soulseek and YouTube) before Navidrome adds them
      </label>
      <div className="row gap wrap" style={{ margin: '10px 0' }}>
        <button className="btn primary" disabled={loading || busy} onClick={load}>{loading ? 'Looking through the library…' : review ? 'Look again' : 'Review library genres'}</button>
        {undo.length > 0 && <button className="btn ghost" disabled={busy} onClick={undoLast}>Undo</button>}
        {msg && <span className="small">{msg}</span>}
      </div>

      {review && (
        <>
          <h3>To change <small className="muted">{albums.length} of {review.total} albums{review.kept ? ` · ${review.kept} kept as they are` : ''}</small></h3>
          {!albums.length ? <p className="muted small">Every album’s genre is tidy.</p> : (
            <>
              <div className="row clean-bar">
                <label className="check">
                  <input type="checkbox" checked={allPicked} disabled={busy} onChange={(e) => setPicked(e.target.checked ? new Set(albums.map((a) => a.id)) : new Set())} />
                  Select all
                </label>
                <span className="grow" />
                <button className="btn" disabled={busy || !picked.size} onClick={() => apply([...picked])}>Apply selected{picked.size ? ` (${picked.size})` : ''}</button>
                <button className="btn primary" disabled={busy} onClick={() => confirm(`Change the genre of all ${albums.length} albums?`) && apply(albums.map((a) => a.id))}>Apply all</button>
              </div>
              <div className="tracklist">
                {albums.map((a) => (
                  <div key={a.id} className="station-row genre-row">
                    <input type="checkbox" aria-label={`Select ${a.name}`} checked={picked.has(a.id)} disabled={busy} onChange={(e) => setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(a.id);
                      else n.delete(a.id);
                      return n;
                    })} />
                    <div className="track-main">
                      <div className="track-title">{a.name}</div>
                      <div className="track-sub">{a.artist} · {plural(a.songs, 'song')} · now <s>{a.current}</s></div>
                    </div>
                    <input className="genre-input" list="genre-targets" value={pick[a.id] ?? ''} aria-label={`New genre for ${a.name}`}
                      onChange={(e) => setPick({ ...pick, [a.id]: e.target.value })} />
                    <div className="share-actions">
                      <button className="btn small" disabled={busy || !pick[a.id]?.trim()} onClick={() => apply([a.id])}>Apply</button>
                      <button className="btn small ghost" disabled={busy} title="Leave this album’s genre as it is and stop suggesting a change" onClick={() => keep(a.id)}>Keep</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {review.unknown.length > 0 && (
            <>
              <h3>Genres without a rule <small className="muted">{review.unknown.length}</small></h3>
              <p className="muted small">Pick what each becomes (or keep it as a genre of its own). Albums with them then show above, and new downloads follow the rule.</p>
              <div className="tracklist">
                {review.unknown.map((u) => (
                  <div key={u.genre} className="station-row genre-row">
                    <div className="track-main">
                      <div className="track-title">{u.genre}</div>
                      <div className="track-sub">{plural(u.albums, 'album')} · {u.examples.join(', ')}</div>
                    </div>
                    <input className="genre-input" list="genre-targets" placeholder="Becomes…" value={mapTo[u.genre] ?? ''} aria-label={`What ${u.genre} becomes`}
                      onChange={(e) => setMapTo({ ...mapTo, [u.genre]: e.target.value })} />
                    <div className="share-actions">
                      <button className="btn small" disabled={busy || !mapTo[u.genre]?.trim()}
                        onClick={() => saveRules([...s.rules, { from: u.genre, to: mapTo[u.genre].trim() }], `${u.genre} now becomes ${mapTo[u.genre].trim()}`)}>Save rule</button>
                      <button className="btn small ghost" disabled={busy} title="Keep it as a genre of its own"
                        onClick={() => saveRules([...s.rules, { from: u.genre, to: u.genre }], `${u.genre} stays a genre of its own`)}>Keep</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Rules {s.defaults ? <small className="muted">(the defaults)</small> : <small className="muted">({s.rules.length})</small>}</summary>
        <div className="genre-rules">
          {[...byGenre].sort(([a], [b]) => a.localeCompare(b)).map(([to, from]) => (
            <div key={to} className="genre-rule">
              <b>{to}</b>
              <span className="muted small">
                {from.length ? from.map((f) => (
                  <span key={f} className="genre-chip">{f}
                    <button className="link" title={`Stop changing ${f}`} disabled={busy}
                      onClick={() => saveRules(s.rules.filter((r) => !(r.from === f && r.to === to)), `${f} is left as it is now`)}>×</button>
                  </span>
                )) : 'kept as it is'}
              </span>
            </div>
          ))}
        </div>
        <form className="row gap wrap" style={{ marginTop: 10 }} onSubmit={(e) => {
          e.preventDefault();
          if (rule.from.trim() && rule.to.trim()) saveRules([...s.rules, { from: rule.from.trim(), to: rule.to.trim() }], `${rule.from.trim()} now becomes ${rule.to.trim()}`).then(() => setRule({ from: '', to: '' }));
        }}>
          <input placeholder="Genre, e.g. Afrobeats" value={rule.from} onChange={(e) => setRule({ ...rule, from: e.target.value })} />
          <span className="muted">becomes</span>
          <input list="genre-targets" placeholder="e.g. Pop" value={rule.to} onChange={(e) => setRule({ ...rule, to: e.target.value })} />
          <button className="btn small" disabled={busy || !rule.from.trim() || !rule.to.trim()}>Add rule</button>
          {!s.defaults && <button type="button" className="btn small ghost" disabled={busy}
            onClick={() => confirm('Go back to the default rules? Rules you added are removed.') && saveRules(null, 'Back to the default rules')}>Reset to defaults</button>}
        </form>
      </details>
    </section>
  );
}
