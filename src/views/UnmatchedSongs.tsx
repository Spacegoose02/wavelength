import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../components/common';
import { forgetTagValues, TagLists, tagList } from '../components/TagLists';
import { pool } from '../lib/match';
import { navidromeRefs } from '../lib/merge';
import { creditFix, filterUnmatched, ISSUE_LABELS, ISSUES, issueCounts, songIssues, unmatchedSongs, type SongIssue, type UnmatchedSong } from '../lib/songIssues';
import { PART, saveInParts } from '../lib/tagSave';
import type { HubTagKey, HubTags } from '../sources/hub';
import type { Album } from '../sources/types';
import { useCatalog } from '../store/catalog';
import { hubClient } from '../store/hub';
import { useUi } from '../store/ui';

/**
 * Library care → Unmatched songs (lib/songIssues.ts), for Hub admins: every song whose tags stop Navidrome
 * filing it under the right artist or album. Filter by what's wrong and search; split joined credits
 * ("Lil Wayne;Drake" → "Lil Wayne; Drake") in one go; set a tag on the ticked songs at once; or edit one song's
 * tags in place. Every Save goes through the Hub's tag editor, so Settings → Server → Tag edits can undo it.
 */

/**
 * Albums read per request, and requests at once. The Hub opens every file to read its tags, so small requests
 * (each well inside a proxy's time limit) a few at a time, not 100 albums in one long request.
 */
const SCAN_BATCH = 25;
const SCAN_AT_ONCE = 3;
/** Rows shown before "Show more". */
const PAGE = 200;

const errText = (e: unknown) => String((e as Error).message ?? e);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The tags that can be set on many songs at once, and edited per song. */
const BULK: { key: HubTagKey; label: string }[] = [
  { key: 'artist', label: 'Artist' },
  { key: 'albumArtist', label: 'Album artist' },
  { key: 'album', label: 'Album' },
  { key: 'genre', label: 'Genre' },
  { key: 'year', label: 'Year' },
];
const FIELDS: { key: HubTagKey; label: string }[] = [{ key: 'title', label: 'Title' }, ...BULK, { key: 'track', label: 'Track' }, { key: 'disc', label: 'Disc' }];

export function UnmatchedSongs() {
  const albums = useCatalog((s) => s.albums);
  const loaded = useCatalog((s) => s.loaded);
  const c = hubClient();
  const [songs, setSongs] = useState<UnmatchedSong[]>();
  const [scanned, setScanned] = useState(0);
  const [progress, setProgress] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Set<SongIssue>>(new Set());
  const [text, setText] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bulkKey, setBulkKey] = useState<HubTagKey>('albumArtist');
  const [bulkValue, setBulkValue] = useState('');
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<HubTags>({});
  const [undo, setUndo] = useState<string[]>([]);
  const [auto, setAuto] = useState<boolean>();

  useEffect(() => {
    c?.creditSettings().then((s) => setAuto(s.auto), () => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => {
    const m = new Map<string, Album>();
    for (const a of albums) for (const r of navidromeRefs(a)) m.set(r.id, r);
    return m;
  }, [albums]);

  const scan = async () => {
    if (!c) return;
    const ids = [...byId.keys()];
    setSongs(undefined);
    setMsg(undefined);
    setTicked(new Set());
    const found: UnmatchedSong[] = [];
    const errors: string[] = [];
    let total = 0;
    const parts: string[][] = [];
    for (let i = 0; i < ids.length; i += SCAN_BATCH) parts.push(ids.slice(i, i + SCAN_BATCH));
    let read = 0;
    setProgress(`Read 0 of ${ids.length} albums…`);
    await pool(parts, SCAN_AT_ONCE, async (part) => {
      try {
        const r = await c.tagAlbums(part);
        total += r.songs.length;
        found.push(...unmatchedSongs(r.songs));
      } catch (e) {
        errors.push(errText(e));
      }
      read += part.length;
      setProgress(`Read ${read} of ${ids.length} albums…`);
    });
    setProgress(undefined);
    setScanned(total);
    setSongs(found);
    // start on the one Navidrome gets wrong the most, when there is any
    setFilter(new Set(found.some((s) => s.issues.includes('joined')) ? ['joined'] : []));
    setShown(PAGE);
    if (errors.length) setMsg(`Some albums couldn't be read: ${errors[0]}`);
  };

  const counts = useMemo(() => issueCounts(songs ?? []), [songs]);
  const list = useMemo(() => filterUnmatched(songs ?? [], filter, text), [songs, filter, text]);
  const joined = useMemo(() => (songs ?? []).flatMap((s) => {
    const tags = creditFix(s.tags);
    return tags ? [{ path: s.path, tags }] : [];
  }), [songs]);

  /** Write the changes, then show the songs with their new tags (and drop the ones with nothing left wrong). */
  const save = async (label: string, changes: { path: string; tags: HubTags }[]) => {
    if (!c || !changes.length) return;
    setBusy(true);
    try {
      const r = await saveInParts(c, label, changes, (d, t) => t > PART && setMsg(`Saving ${d} of ${t}…`));
      const batches = r.batches;
      const done = new Set(r.changed);
      const failed = r.failed.map((x) => x.error);
      const byPath = new Map(changes.map((x) => [x.path, x.tags]));
      setSongs((cur) => cur?.flatMap((s) => {
        const t = byPath.get(s.path);
        if (!t || !done.has(s.path)) return [s];
        const tags = { ...s.tags, ...t };
        const issues = songIssues(tags);
        return issues.length ? [{ ...s, tags, issues }] : [];
      }));
      setTicked(new Set());
      setUndo(batches);
      forgetTagValues();
      setMsg(`Saved ${plural(done.size, 'song')}${failed.length ? `; ${failed.length} failed: ${failed[0]}` : ''}${r.error ? `, then the Hub stopped answering (${r.error}); save again to carry on` : ''}. Navidrome rescans in a minute to show them.`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    if (!c) return;
    setBusy(true);
    try {
      let n = 0;
      for (const b of undo) n += (await c.undoTags(b)).undone;
      setUndo([]);
      setMsg(`Put ${plural(n, 'song')} back as they were. Find them again with Check again.`);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = async (on: boolean) => {
    try {
      setAuto((await c!.saveCreditSettings(on)).auto);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  if (!c) return <p className="muted">Sign in to your Hub to fix song tags.</p>;
  if (!loaded) return <Spinner />;

  const autoBox = auto !== undefined && (
    <label className="check">
      <input type="checkbox" checked={auto} onChange={(e) => void toggleAuto(e.target.checked)} />
      <small>Split joined artists in new downloads by themselves (“Lil Wayne;Drake” becomes “Lil Wayne; Drake” before Navidrome scans them)</small>
    </label>
  );

  if (!songs) {
    return (
      <>
        <p className="muted">
          Finds songs whose tags keep Navidrome from filing them under the right artist or album: several artists joined
          with a semicolon and no space (“Lil Wayne;Drake”, which Navidrome takes for one artist), and songs with no
          artist, album, title, genre, year or track number. Filter them by what’s wrong, then fix them here.
        </p>
        {autoBox}
        {progress ? <div className="row gap muted small"><Spinner /> {progress}</div>
          : <button className="btn primary" disabled={!byId.size} onClick={() => void scan()}>Find unmatched songs ({byId.size} albums)</button>}
      </>
    );
  }

  const page = list.slice(0, shown);
  const allTicked = page.length > 0 && page.every((s) => ticked.has(s.path));
  const tick = (path: string, on: boolean) => setTicked((t) => {
    const n = new Set(t);
    if (on) n.add(path);
    else n.delete(path);
    return n;
  });
  const startEdit = (s: UnmatchedSong) => {
    setEditing(s.path);
    setDraft({ ...s.tags, ...creditFix(s.tags) });
  };
  const saveOne = (s: UnmatchedSong) => {
    const tags: HubTags = {};
    for (const { key } of FIELDS) if ((draft[key] ?? '').trim() !== (s.tags[key] ?? '')) tags[key] = (draft[key] ?? '').trim();
    setEditing(undefined);
    void save(`Song: ${s.tags.title || s.path}`.slice(0, 200), Object.keys(tags).length ? [{ path: s.path, tags }] : []);
  };
  const applyBulk = () => {
    const v = bulkValue.trim();
    const label = BULK.find((b) => b.key === bulkKey)!.label;
    if (!v || !ticked.size) return;
    if (!confirm(`Set ${label} to “${v}” on ${plural(ticked.size, 'song')}?`)) return;
    void save(`${label}: ${v} (${plural(ticked.size, 'song')})`.slice(0, 200), [...ticked].map((path) => ({ path, tags: { [bulkKey]: v } })));
  };

  return (
    <>
      <TagLists />
      {msg && (
        <p className="small">
          {msg} {undo.length > 0 && !busy && <button className="link" onClick={() => void undoLast()}>Undo</button>}
        </p>
      )}
      {autoBox}
      {!songs.length ? (
        <p className="muted">Every one of your {scanned} songs is tagged well enough for Navidrome. <button className="link" onClick={() => void scan()}>Check again</button></p>
      ) : (
        <>
          <div className="row gap wrap">
            <span className="muted small">{plural(songs.length, 'song')} of {scanned} need a look</span>
            {joined.length > 0 && (
              <button className="btn primary small" disabled={busy} onClick={() => void save('Joined artists split', joined)}>
                Split joined artists ({plural(joined.length, 'song')})
              </button>
            )}
            <button className="link small" disabled={busy} onClick={() => void scan()}>Check again</button>
          </div>
          <div className="chips" role="group" aria-label="Filter by what's wrong">
            <button className={`chip ${!filter.size ? 'on' : ''}`} onClick={() => setFilter(new Set())}>All ({songs.length})</button>
            {ISSUES.filter((i) => counts[i]).map((i) => (
              <button key={i} className={`chip ${filter.has(i) ? 'on' : ''}`} aria-pressed={filter.has(i)} onClick={() => setFilter((f) => {
                const n = new Set(f);
                if (n.has(i)) n.delete(i);
                else n.add(i);
                return n;
              })}>{ISSUE_LABELS[i]} ({counts[i]})</button>
            ))}
          </div>
          <div className="row gap wrap">
            <input type="search" placeholder="Search title, artist, album, genre or file" aria-label="Search unmatched songs" value={text} onChange={(e) => { setText(e.target.value); setShown(PAGE); }} />
            <label className="check"><input type="checkbox" checked={allTicked} onChange={(e) => setTicked((t) => {
              const n = new Set(t);
              for (const s of page) if (e.target.checked) n.add(s.path);
              else n.delete(s.path);
              return n;
            })} /><small>Tick all shown</small></label>
          </div>
          {ticked.size > 0 && (
            <div className="row gap wrap">
              <small>For the {plural(ticked.size, 'ticked song')}, set</small>
              <select value={bulkKey} onChange={(e) => setBulkKey(e.target.value as HubTagKey)} aria-label="Tag to set">
                {BULK.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <input list={tagList(bulkKey)} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder="to…" aria-label="New value" />
              <button className="btn small primary" disabled={busy || !bulkValue.trim()} onClick={applyBulk}>Set</button>
              <button className="btn small ghost" onClick={() => setTicked(new Set())}>Clear</button>
            </div>
          )}
          {!list.length && <p className="muted">No songs match that filter.</p>}
          {page.map((s) => {
            const album = byId.get(s.albumId);
            const fix = creditFix(s.tags);
            return (
              <section key={s.path} className="source-row unmatched-row">
                <label className="check">
                  <input type="checkbox" checked={ticked.has(s.path)} onChange={(e) => tick(s.path, e.target.checked)} aria-label={`Tick ${s.tags.title || s.path}`} />
                  <b>{s.tags.title || <span className="muted">(no title)</span>}</b>
                </label>
                <div className="track-sub" title={s.path}>
                  {s.tags.artist || <span className="muted">no artist</span>}
                  {' · '}
                  {album ? <button className="link" onClick={() => useUi.getState().go({ view: 'album', album })}>{s.tags.album || album.title}</button> : s.tags.album || 'no album'}
                  {s.tags.albumArtist && s.tags.albumArtist !== s.tags.artist ? ` · album artist ${s.tags.albumArtist}` : ''}
                  {s.tags.genre ? ` · ${s.tags.genre}` : ''}
                  {s.tags.year ? ` · ${s.tags.year}` : ''}
                </div>
                <div className="chips inline">
                  {s.issues.map((i) => <span key={i} className="chip">{ISSUE_LABELS[i]}</span>)}
                </div>
                {fix && (
                  <div className="small">
                    {fix.artist && <><s className="muted">{s.tags.artist}</s> → <b>{fix.artist}</b> </>}
                    {fix.albumArtist && <>Album artist: <s className="muted">{s.tags.albumArtist}</s> → <b>{fix.albumArtist}</b></>}
                  </div>
                )}
                {editing === s.path ? (
                  <div className="editor">
                    <div className="editor-grid">
                      {FIELDS.map(({ key, label }) => (
                        <label key={key}>{label}<input list={tagList(key)} value={draft[key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} /></label>
                      ))}
                    </div>
                    <div className="row gap">
                      <button className="btn small primary" disabled={busy} onClick={() => saveOne(s)}>Save</button>
                      <button className="btn small ghost" onClick={() => setEditing(undefined)}>Cancel</button>
                      <span className="muted small">{s.path}</span>
                    </div>
                  </div>
                ) : (
                  <div className="row gap">
                    <button className="btn small ghost" onClick={() => startEdit(s)}>Edit tags</button>
                    {fix && <button className="btn small ghost" disabled={busy} onClick={() => void save('Joined artists split', [{ path: s.path, tags: fix }])}>Split artists</button>}
                  </div>
                )}
              </section>
            );
          })}
          {list.length > shown && <button className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>Show more ({list.length - shown} left)</button>}
        </>
      )}
    </>
  );
}
