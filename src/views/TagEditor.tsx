import { useEffect, useState } from 'react';
import { cleanTitle } from '../lib/match';
import type { HubTagMatch, HubTags, HubTagSong } from '../sources/hub';
import type { Album } from '../sources/types';
import { hubClient } from '../store/hub';
import { useUi } from '../store/ui';
import { Cover, Spinner } from '../components/common';
import { forgetTagValues, TagLists, tagList } from '../components/TagLists';

/**
 * The tag editor (hub/src/routes/tags.ts): an album's tags as they are in its files, a lookup on Deezer and
 * MusicBrainz to fill them in, and Save / Undo. The Hub writes the files and asks Navidrome to rescan.
 */

type Row = HubTagSong & { edit: HubTags };
const ALBUM_KEYS = [['album', 'Album'], ['albumArtist', 'Album artist'], ['year', 'Year'], ['genre', 'Genre']] as const;
const SONG_KEYS = [['disc', 'Disc'], ['track', '#'], ['title', 'Title'], ['artist', 'Artist']] as const;

const num = (v?: string) => parseInt(v ?? '', 10) || 0;
const errText = (e: unknown) => String((e as Error).message ?? e);

/** Line a looked-up album's songs up with ours: by disc and number, then by title, then by order. */
function pair(rows: Row[], m: HubTagMatch): (HubTagMatch['tracks'][number] | undefined)[] {
  const used = new Set<number>();
  const take = (i: number) => (i >= 0 && !used.has(i) ? (used.add(i), m.tracks[i]) : undefined);
  const out = rows.map((r) => {
    const t = num(r.tags.track), d = num(r.tags.disc) || 1;
    const byTitle = m.tracks.findIndex((x, i) => !used.has(i) && cleanTitle(x.title) === cleanTitle(r.tags.title ?? ''));
    if (byTitle >= 0) return take(byTitle);
    return t ? take(m.tracks.findIndex((x, i) => !used.has(i) && x.track === t && x.disc === d)) : undefined;
  });
  return out.map((x, i) => x ?? (m.tracks.length === rows.length ? take(i) : undefined));
}

export function TagEditor({ album }: { album: Album }) {
  const c = hubClient();
  const ref = album.refs?.[0] ?? album;
  const [rows, setRows] = useState<Row[]>();
  const [matches, setMatches] = useState<HubTagMatch[]>();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  const load = async () => {
    try {
      const { songs } = await c!.tagAlbum(ref.id);
      setRows(songs.map((s) => ({ ...s, edit: { ...s.tags } })));
    } catch (e) {
      setMsg(errText(e));
      setRows([]);
    }
  };
  useEffect(() => {
    load();
  }, [ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return <div className="page"><p className="muted">Sign in to your Hub to edit tags.</p></div>;

  const setAll = (k: keyof HubTags, v: string) => setRows((rs) => rs?.map((r) => ({ ...r, edit: { ...r.edit, [k]: v } })));
  const setOne = (i: number, k: keyof HubTags, v: string) => setRows((rs) => rs?.map((r, j) => (j === i ? { ...r, edit: { ...r.edit, [k]: v } } : r)));
  const albumValue = (k: keyof HubTags) => {
    const vals = new Set((rows ?? []).map((r) => r.edit[k] ?? ''));
    return vals.size === 1 ? [...vals][0] : '';
  };
  const changed = (rows ?? []).filter((r) => Object.keys(r.edit).some((k) => (r.edit[k as keyof HubTags] ?? '') !== (r.tags[k as keyof HubTags] ?? '')));

  const find = async () => {
    setMsg('Looking it up…');
    try {
      const { candidates } = await c.tagMatches(albumValue('albumArtist') || albumValue('artist') || album.artist, albumValue('album') || album.title);
      setMatches(candidates);
      setMsg(candidates.length ? '' : 'Deezer and MusicBrainz have nothing that looks like this album');
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const use = (m: HubTagMatch) => {
    if (!rows) return;
    const paired = pair(rows, m);
    setRows(rows.map((r, i) => {
      const t = paired[i];
      const edit: HubTags = { ...r.edit, album: m.title, albumArtist: m.artist, ...(m.year && { year: m.year }), ...(m.genre && { genre: m.genre }) };
      if (t) Object.assign(edit, { title: t.title, artist: t.artist, track: String(t.track), disc: String(t.disc) });
      return { ...r, edit };
    }));
    const missed = paired.filter((t) => !t).length;
    setMsg(missed ? `${missed} song${missed === 1 ? '' : 's'} didn't line up with ${m.source}'s list; check those by hand` : `Filled in from ${m.source}. Check it, then Save`);
  };

  const save = async () => {
    setBusy(true);
    setMsg('Saving…');
    try {
      const label = `${albumValue('albumArtist') || album.artist} – ${albumValue('album') || album.title}`;
      const r = await c.saveTags(label, changed.map((x) => {
        const tags: HubTags = {};
        for (const k of Object.keys(x.edit) as (keyof HubTags)[]) if ((x.edit[k] ?? '') !== (x.tags[k] ?? '')) tags[k] = x.edit[k] ?? '';
        return { path: x.path, tags };
      }));
      setLastBatch(r.batch);
      forgetTagValues();
      setMsg(`Saved ${r.changed.length} file${r.changed.length === 1 ? '' : 's'}${r.failed.length ? `; ${r.failed.length} failed: ${r.failed[0].error}` : ''}. Navidrome rescans in a minute to show them`);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!lastBatch) return;
    setBusy(true);
    try {
      const r = await c.undoTags(lastBatch);
      setLastBatch(null);
      setMsg(`Put ${r.undone} file${r.undone === 1 ? '' : 's'} back as they were`);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Edit tags</h1>
        <button className="btn small ghost" onClick={() => useUi.getState().go({ view: 'album', album })}>Back to album</button>
      </header>
      <p className="muted small">
        Changes are written into the music files on your server by the Hub. The audio isn’t touched, and each Save can be
        undone here or under Settings → Server → Tag edits.
      </p>
      <TagLists />
      {!rows ? <Spinner /> : !rows.length ? <div className="errors">{msg}</div> : (
        <>
          <section className="editor">
            <div className="editor-grid">
              {ALBUM_KEYS.map(([k, label]) => (
                <label key={k}>{label}<input list={tagList(k)} value={albumValue(k)} placeholder={rows.some((r) => r.edit[k]) && !albumValue(k) ? 'differs per song' : ''} onChange={(e) => setAll(k, e.target.value)} /></label>
              ))}
            </div>
            <div className="row gap">
              <button className="btn" onClick={find} disabled={busy}>Find on Deezer and MusicBrainz</button>
              <button className="btn primary" onClick={save} disabled={busy || !changed.length}>Save {changed.length ? `(${changed.length})` : ''}</button>
              {lastBatch && <button className="btn ghost" onClick={undo} disabled={busy}>Undo</button>}
              {msg && <span className="small">{msg}</span>}
            </div>
          </section>

          {matches && matches.length > 0 && (
            <section>
              <h2>Matches</h2>
              {matches.map((m) => (
                <div key={`${m.source}:${m.id}`} className="source-row">
                  <Cover src={m.cover} alt={m.title} className="tiny" />
                  <div className="track-main">
                    <div className="track-title">{m.title} <span className="muted small">· {m.source}</span></div>
                    <div className="track-sub">{m.artist}{m.year ? ` · ${m.year}` : ''}{m.genre ? ` · ${m.genre}` : ''} · {m.tracks.length} songs</div>
                  </div>
                  <button className="btn small" onClick={() => use(m)}>Use this</button>
                </div>
              ))}
            </section>
          )}

          <div className="tag-table" role="table" aria-label="Songs">
            <div className="tag-row head" role="row">
              {SONG_KEYS.map(([k, label]) => <span key={k} role="columnheader">{label}</span>)}
            </div>
            {rows.map((r, i) => (
              <div key={r.path} className={`tag-row ${changed.includes(r) ? 'changed' : ''}`} role="row" title={r.path}>
                {SONG_KEYS.map(([k, label]) => (
                  <input key={k} list={tagList(k)} aria-label={`${label}, ${r.tags.title ?? r.path}`} value={r.edit[k] ?? ''} onChange={(e) => setOne(i, k, e.target.value)} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
