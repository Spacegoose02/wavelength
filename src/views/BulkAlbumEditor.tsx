import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../components/common';
import { ChipInput, EditDialog } from '../components/EditDialog';
import { forgetTagValues, TagLists, useTagValues } from '../components/TagLists';
import { type BulkAlbumEdit, type BulkSong, isM4a, planBulkAlbumEdit } from '../lib/bulkAlbumEdit';
import { useItemTags, useItemTagStore } from '../lib/itemTags';
import { navidromeRefs } from '../lib/merge';
import { RELEASE_KINDS } from '../lib/releaseKind';
import { LibraryServer } from '../lib/serverName';
import { splitGenres } from '../lib/songCredit';
import { saveInParts } from '../lib/tagSave';
import type { Album } from '../sources/types';
import { hubClient, useCan } from '../store/hub';

/**
 * Edit several albums at once (docs/USER-GUIDE.md, "Editing several albums at once"): the album select bar's
 * **Edit** on Albums and an artist's page. One value for the album artist, release date, release type, label or
 * genres goes into every song of every ticked album, and a field left empty keeps each album's own value. A tickbox
 * takes a leading "Artist - " off the titles, with the renames shown before saving. It writes through the Hub's tag
 * editor like Edit album (views/AlbumEditor.tsx), in parts that share one batch, so the whole Save is one entry under
 * Settings → Server → Tag edits and one Undo. Plan in lib/bulkAlbumEdit.ts.
 */

/** Albums read per request, for progress on a big selection (the Hub takes up to 200). */
const READ_PART = 10;

const errText = (e: unknown) => String((e as Error).message ?? e);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
type GenreMode = 'keep' | 'replace' | 'add';
type Moved = { from: { artist: string; title: string }; to: { artist: string; title: string } };

export function BulkAlbumEditor({ albums, onClose, onSaved }: { albums: Album[]; onClose: () => void; onSaved?: () => void }) {
  const c = hubClient();
  const values = useTagValues();
  const hubReady = useItemTags().ready === true;
  // every Navidrome copy of each ticked album; Plex-only albums have no files here
  const refs = useMemo(() => albums.flatMap((a) => navidromeRefs(a).map((r) => ({ id: r.id, artist: a.artist }))), [albums]);
  const skipped = albums.filter((a) => !navidromeRefs(a).length).length;
  const artistOf = useMemo(() => new Map(refs.map((r) => [r.id, r.artist])), [refs]);

  const [songs, setSongs] = useState<BulkSong[]>();
  const [missing, setMissing] = useState(0);
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [albumArtist, setAlbumArtist] = useState('');
  const [year, setYear] = useState('');
  const [releaseType, setReleaseType] = useState('');
  const [label, setLabel] = useState('');
  const [genreMode, setGenreMode] = useState<GenreMode>('keep');
  const [genres, setGenres] = useState<string[]>([]);
  const [strip, setStrip] = useState(false);
  const [saved, setSaved] = useState<{ batches: string[]; files: number; moved: Moved[] }>();

  const load = async () => {
    if (!c) return;
    const ids = refs.map((r) => r.id);
    const out: BulkSong[] = [];
    let gone = 0;
    try {
      for (let i = 0; i < ids.length; i += READ_PART) {
        if (ids.length > READ_PART) setMsg(`Reading tags… ${i} of ${plural(ids.length, 'album')}`);
        const r = await c.tagAlbums(ids.slice(i, i + READ_PART));
        out.push(...r.songs.map((s) => ({ path: s.path, albumId: s.albumId, tags: s.tags })));
        gone += r.missing.length;
      }
      setSongs(out);
      setMissing(gone);
      setMsg(undefined);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => {
    const edit: BulkAlbumEdit = {
      albumArtist, year, releaseType, label, stripArtistPrefix: strip,
      genres: genreMode === 'keep' ? undefined : { mode: genreMode, values: genres },
    };
    return planBulkAlbumEdit(songs ?? [], edit, (id) => artistOf.get(id));
  }, [songs, albumArtist, year, releaseType, label, strip, genreMode, genres, artistOf]);
  const dirty = plan.changes.length > 0;
  const m4a = (songs ?? []).filter((s) => isM4a(s.path)).length;
  const what = [albumArtist.trim() && 'Album artist', year.trim() && 'Release date', releaseType && 'Release type', label.trim() && 'Record label', genreMode !== 'keep' && 'Genres', plan.renames.length && 'Titles'].filter(Boolean);

  /** Each album's artist and title before and after, for the Hub's styles, moods and collections to follow. */
  const moves = (): Moved[] => {
    if (!songs || (!albumArtist.trim() && !plan.renames.length)) return [];
    const out: Moved[] = [];
    for (const r of refs) {
      const first = songs.find((s) => s.albumId === r.id);
      if (!first) continue;
      const from = { artist: (first.tags.albumArtist ?? '').trim() || r.artist, title: (first.tags.album ?? '').trim() };
      const to = { artist: albumArtist.trim() || from.artist, title: plan.renames.find((x) => x.albumId === r.id)?.to ?? from.title };
      if (from.title && (from.artist !== to.artist || from.title !== to.title)) out.push({ from, to });
    }
    return out;
  };

  const save = async () => {
    if (!c || !dirty) return;
    setBusy(true);
    setMsg('Saving…');
    try {
      const moved = moves();
      const r = await saveInParts(c, `Albums: ${plural(plan.albums, 'album')}${what.length ? ` (${what.join(', ')})` : ''}`, plan.changes,
        (done, total) => setMsg(`Saving… ${done} of ${plural(total, 'song')}`));
      if (r.error && !r.changed.length) throw new Error(r.error);
      forgetTagValues();
      // styles, moods and collections on the Hub go by artist and title, so they follow a rename
      const followed: Moved[] = [];
      if (hubReady) {
        for (const m of moved) {
          try {
            await c.renameItemTags('album', m.from, m.to);
            followed.push(m);
          } catch {
            // nothing kept for that album
          }
        }
        if (followed.length) void useItemTagStore.getState().load(true);
      }
      setSaved({ batches: r.batches, files: r.changed.length, moved: followed });
      setMsg(r.error ? `Stopped after ${plural(r.changed.length, 'song')}: ${r.error}` : r.failed.length ? `${plural(r.failed.length, 'song')} failed: ${r.failed[0].error}` : undefined);
      onSaved?.();
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!c || !saved) return;
    setBusy(true);
    setMsg('Undoing…');
    try {
      for (const b of saved.batches) await c.undoTags(b);
      for (const m of saved.moved) await c.renameItemTags('album', m.to, m.from).catch(() => undefined);
      if (saved.moved.length) void useItemTagStore.getState().load(true);
      forgetTagValues();
      setSaved(undefined);
      setMsg(`Put the albums back as they were. ${LibraryServer()} shows it after its rescan, in a minute or so`);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const status = saved
    ? (msg ?? (saved.files ? `Saved ${plural(saved.files, 'song')}. ${LibraryServer()} shows it after its rescan, in a minute or so.` : 'Saved.'))
    : msg && songs ? msg : dirty ? `${what.join(', ')} on ${plural(plan.changes.length, 'song')} of ${plural(plan.albums, 'album')}` : songs && what.length ? 'Nothing to change: the albums already have that' : '';

  return (
    <EditDialog title={`Edit ${plural(albums.length, 'album')}`} tabs={[['general', 'General']] as const} tab="general" onTab={() => undefined} busy={busy} onClose={onClose}
      footer={<>
        <span className="small edit-dialog-msg" role="status">{status}</span>
        {saved && saved.batches.length > 0 && <button className="btn ghost" onClick={undo} disabled={busy}>Undo</button>}
        <button className="btn" onClick={onClose} disabled={busy}>{saved ? 'Close' : 'Cancel'}</button>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>Save changes</button>
      </>}>
      <TagLists values={values} />
      {!songs ? (msg && !msg.startsWith('Reading') ? <div className="errors">{msg}</div> : <><Spinner />{msg && <p className="muted small">{msg}</p>}</>) : (
        <div className="edit-fields">
          <p className="span2 muted small">
            What you fill in goes on all {plural(albums.length, 'album')} ({plural(songs.length, 'song')}). Anything left empty stays as each album has it.
            {skipped > 0 && ` ${plural(skipped, 'album')} ${skipped === 1 ? 'is' : 'are'} only on Plex and can’t be edited here.`}
            {missing > 0 && ` ${plural(missing, 'file')} couldn’t be found by your Hub.`}
          </p>
          <label>
            Release type
            <select value={releaseType} onChange={(e) => setReleaseType(e.target.value)}>
              <option value="">Keep each as it is</option>
              {RELEASE_KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
            </select>
          </label>
          <label>
            Release date
            <input value={year} placeholder="Keep each as it is" onChange={(e) => setYear(e.target.value)} />
          </label>
          <label>
            Album artist
            <input list="tag-artists" value={albumArtist} placeholder="Keep each as it is" onChange={(e) => setAlbumArtist(e.target.value)} />
          </label>
          <label>
            Record label
            <input value={label} placeholder="Keep each as it is" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <div className="span2 edit-field">
            <span className="edit-field-label">Genres</span>
            <select value={genreMode} onChange={(e) => setGenreMode(e.target.value as GenreMode)} aria-label="What to do with genres">
              <option value="keep">Keep each album’s genres</option>
              <option value="add">Add these to each album’s genres</option>
              <option value="replace">Replace each album’s genres with these</option>
            </select>
            {genreMode !== 'keep' && <ChipInput values={genres} onChange={setGenres} list="tag-genres" placeholder="Add a genre" split={splitGenres} label="genre" />}
            {genreMode === 'replace' && !genres.length && <span className="edit-mixed">With no genres here, Save takes every genre off these albums</span>}
          </div>
          <label className="span2 edit-check">
            <span><input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} /> Take the artist’s name off the start of titles (“Lil Wayne - Tha Carter III” becomes “Tha Carter III”)</span>
          </label>
          {strip && (
            <div className="span2 small">
              {plan.renames.length ? (
                <>
                  <p className="muted">{plural(plan.renames.length, 'title')} will change:</p>
                  <ul className="bulk-renames">
                    {plan.renames.slice(0, 12).map((r) => <li key={r.albumId}><s>{r.from}</s> → {r.to}</li>)}
                    {plan.renames.length > 12 && <li className="muted">…and {plan.renames.length - 12} more</li>}
                  </ul>
                </>
              ) : <p className="muted">None of these titles start with the artist’s name.</p>}
            </div>
          )}
          {m4a > 0 && <p className="span2 muted small">{plural(m4a, 'song')} {m4a === 1 ? 'is an' : 'are'} .m4a, which can’t hold a release type or record label; those are left out for {m4a === 1 ? 'it' : 'them'}.</p>}
          <p className="span2 muted small">Saves are written into the files by your Hub (the audio isn’t touched) and can be undone in one go under Settings → Server → Tag edits.</p>
        </div>
      )}
    </EditDialog>
  );
}

/** The album select bar's Edit (admins). */
export function BulkEditAlbumsButton({ albums, disabled, onSaved }: { albums: Album[]; disabled?: boolean; onSaved?: () => void }) {
  const canEdit = useCan('library.edit');
  const [open, setOpen] = useState(false);
  const editable = albums.some((a) => navidromeRefs(a).length);
  if (!canEdit || !hubClient()) return null;
  return (
    <>
      <button className="btn" disabled={disabled || !editable} title="Set the release type, date, artist, label or genres of every ticked album" onClick={() => setOpen(true)}>
        Edit{albums.length ? ` (${albums.length})` : ''}
      </button>
      {open && <BulkAlbumEditor albums={albums} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}
