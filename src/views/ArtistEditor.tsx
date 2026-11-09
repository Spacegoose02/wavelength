import { useEffect, useMemo, useState } from 'react';
import { ArtworkPicker } from '../components/ArtworkButton';
import { Spinner } from '../components/common';
import { ChipInput, EditDialog } from '../components/EditDialog';
import { forgetTagValues, TagLists, useTagValues } from '../components/TagLists';
import { useArtistMetaStore } from '../lib/artistMeta';
import { type ArtistSong, loadArtistSongs } from '../lib/artistSongs';
import { renameArtist } from '../lib/merge';
import { joinGenres, readCredit, splitGenres } from '../lib/songCredit';
import { saveInParts } from '../lib/tagSave';
import type { HubAlbumSort, HubTags } from '../sources/hub';
import type { Artist } from '../sources/types';
import { hubClient } from '../store/hub';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/**
 * Edit artist (docs/USER-GUIDE.md, "Editing an artist"): an artist in one dialog, Plex style.
 *
 * - **General:** the name (a rename, written into the Artist and Album artist tags of every song on their albums,
 *   credits like "A feat. B" too), the sort name (ARTISTSORT / ALBUMARTISTSORT, so "The Weeknd" can sort under W)
 *   and a biography, which the Hub keeps and the artist page shows instead of Wikipedia's.
 * - **Tags:** the genres of their albums as chips. Changing them writes the new genres into every song of theirs.
 * - **Poster:** the artist picture picker.
 * - **Advanced:** how their page orders their albums (newest or oldest first, or A to Z).
 *
 * Tag changes go through the Hub's tag editor as one Save (Settings → Server → Tag edits undoes it); the biography
 * and album order are saved on the Hub (hub/src/routes/artistMeta.ts). The song-by-song rename page
 * (views/ArtistTagEditor.tsx) is a button away.
 */

type Tab = 'general' | 'tags' | 'poster' | 'advanced';
const TABS = [['general', 'General'], ['tags', 'Tags'], ['poster', 'Poster'], ['advanced', 'Advanced']] as const;
const SORTS: { value: HubAlbumSort; label: string }[] = [
  { value: '', label: 'Library default (newest first)' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'By title, A to Z' },
];

const errText = (e: unknown) => String((e as Error).message ?? e);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const same = (a?: string, b?: string) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** The value most of these songs have (the first on a tie), or ''. */
function usual(values: (string | undefined)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v?.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

interface Draft { name: string; sort: string; bio: string; genres: string[]; albumSort: HubAlbumSort }

export function ArtistEditor({ artist, picture, onClose }: { artist: Artist; picture?: string; onClose: () => void }) {
  const c = hubClient();
  const sources = useSettings((s) => s.sources);
  const values = useTagValues();
  const [songs, setSongs] = useState<ArtistSong[]>();
  const [start, setStart] = useState<Draft>();
  const [draft, setDraft] = useState<Draft>();
  const [tab, setTab] = useState<Tab>('general');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ batches: string[]; files: number; name: string; meta?: Pick<Draft, 'bio' | 'albumSort'> }>();
  const [name, setName] = useState(artist.name);

  const load = async (who = name) => {
    if (!c) return;
    try {
      const [r, meta] = await Promise.all([loadArtistSongs({ ...artist, name: who }, sources, c), c.artistMeta(who)]);
      setSongs(r.songs);
      const mine = theirs(r.songs, who);
      const d: Draft = {
        name: who,
        sort: usual([...mine.map((s) => (same(readCredit(s.tags.artist ?? '').main, who) ? s.tags.artistSort : undefined)), ...mine.map((s) => (same(s.tags.albumArtist, who) ? s.tags.albumArtistSort : undefined))]),
        bio: meta.bio,
        genres: splitGenres(usual(mine.map((s) => s.tags.genre))),
        albumSort: meta.albumSort,
      };
      setStart(d);
      setDraft(d);
      if (r.missing.length) setMsg(`${plural(r.missing.length, 'file')} weren’t found in the Hub’s music folder and are left out`);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const renamed = !!draft && !!start && draft.name.trim() !== start.name && !!draft.name.trim();
  const sortChanged = !!draft && !!start && draft.sort.trim() !== start.sort;
  const genresChanged = !!draft && !!start && joinGenres(draft.genres) !== joinGenres(start.genres);
  const metaChanged = !!draft && !!start && (draft.bio.trim() !== start.bio || draft.albumSort !== start.albumSort);

  /** The tags each song gets: the rename first, then the sort name and genres on the songs that are theirs. */
  const changes = useMemo(() => {
    if (!songs || !draft || !start) return [];
    const to = draft.name.trim() || start.name;
    return songs.flatMap((s) => {
      const tags: HubTags = {};
      const artistNow = renamed ? renameArtist(s.tags.artist, start.name, to, true) : s.tags.artist;
      const albumArtistNow = renamed ? renameArtist(s.tags.albumArtist, start.name, to, true) : s.tags.albumArtist;
      if (artistNow !== s.tags.artist) tags.artist = artistNow;
      if (albumArtistNow !== s.tags.albumArtist) tags.albumArtist = albumArtistNow;
      const main = same(readCredit(artistNow ?? '').main, to);
      const albumMain = same(albumArtistNow, to);
      if (sortChanged) {
        if (main && (s.tags.artistSort ?? '') !== draft.sort.trim()) tags.artistSort = draft.sort.trim();
        if (albumMain && (s.tags.albumArtistSort ?? '') !== draft.sort.trim()) tags.albumArtistSort = draft.sort.trim();
      }
      if (genresChanged && (albumMain || main) && joinGenres(draft.genres) !== (s.tags.genre ?? '')) tags.genre = joinGenres(draft.genres);
      return Object.keys(tags).length ? [{ path: s.path, tags }] : [];
    });
  }, [songs, draft, start, renamed, sortChanged, genresChanged]);
  const dirty = changes.length > 0 || metaChanged;

  const save = async () => {
    if (!c || !draft || !start || !dirty) return;
    setBusy(true);
    setMsg('Saving…');
    try {
      const to = draft.name.trim() || start.name;
      let r = { batches: [] as string[], changed: [] as string[], failed: [] as { path: string; error: string }[], error: undefined as string | undefined };
      if (changes.length) {
        const label = renamed ? `Artist: ${start.name} → ${to}` : `Artist: ${to}`;
        r = { error: undefined, ...(await saveInParts(c, label, changes, (done, total) => total > 25 && setMsg(`Saving… ${done} of ${total}`))) };
        if (r.error) throw new Error(r.error);
      }
      let meta: Pick<Draft, 'bio' | 'albumSort'> | undefined;
      // the biography and album order follow a rename
      if (metaChanged || (renamed && (start.bio || start.albumSort))) {
        const m = await c.setArtistMeta(to, { bio: draft.bio, albumSort: draft.albumSort });
        useArtistMetaStore.getState().put(m);
        meta = { bio: start.bio, albumSort: start.albumSort };
        if (renamed) useArtistMetaStore.getState().put(await c.setArtistMeta(start.name, { bio: '', albumSort: '' }));
      }
      forgetTagValues();
      setSaved({ batches: r.batches, files: r.changed.length, name: start.name, meta });
      setMsg(r.failed.length ? `${plural(r.failed.length, 'song')} failed: ${r.failed[0].error}` : undefined);
      setName(to);
      await load(to);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!c || !saved || !draft) return;
    setBusy(true);
    try {
      for (const b of saved.batches) await c.undoTags(b);
      if (saved.meta) {
        if (!same(draft.name, saved.name)) useArtistMetaStore.getState().put(await c.setArtistMeta(draft.name, { bio: '', albumSort: '' }));
        useArtistMetaStore.getState().put(await c.setArtistMeta(saved.name, saved.meta));
      }
      setName(saved.name);
      setSaved(undefined);
      setMsg('Put the artist back as they were. Navidrome shows it after its rescan, in a minute or so');
      await load(saved.name);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const songsPage = () => {
    onClose();
    useUi.getState().go({ view: 'artistTags', artist });
  };

  const what = [
    renamed && 'name', sortChanged && 'sort name', genresChanged && 'genres', draft && start && draft.bio.trim() !== start.bio && 'biography', draft && start && draft.albumSort !== start.albumSort && 'album order',
  ].filter(Boolean).join(', ');

  return (
    <EditDialog title={`Edit ${artist.name}`} tabs={TABS} tab={tab} onTab={setTab} busy={busy} onClose={onClose}
      footer={<>
        <span className="small edit-dialog-msg" role="status">
          {saved ? <>Saved{saved.files ? ` ${plural(saved.files, 'song')}` : ''}. {saved.files ? 'Navidrome shows it after its rescan, in a minute or so.' : ''}</>
            : msg && draft ? msg : dirty ? `Changes: ${what}${changes.length ? ` (${plural(changes.length, 'song')})` : ''}` : ''}
        </span>
        {saved && <button className="btn ghost" onClick={undo} disabled={busy}>Undo</button>}
        <button className="btn ghost" onClick={songsPage} disabled={busy} title="See every song a rename changes, album by album">Review songs…</button>
        <button className="btn" onClick={onClose} disabled={busy}>{saved ? 'Close' : 'Cancel'}</button>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>Save changes</button>
      </>}>
      <TagLists values={values} />
      {!draft || !songs ? (msg ? <div className="errors">{msg}</div> : <Spinner />) : tab === 'general' ? (
        <div className="edit-fields">
          <label className="span2">Artist
            <input list="tag-artists" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          {renamed && (
            <p className="span2 edit-hint"><span>Renames {start?.name} to {draft.name.trim()} in {plural(changes.filter((x) => x.tags.artist !== undefined || x.tags.albumArtist !== undefined).length, 'song')}, credits like “{start?.name} feat. …” too. Picking a name your library already has merges the two.</span></p>
          )}
          <label className="span2">Sort artist
            <input value={draft.sort} placeholder={draft.name.replace(/^(the|a|an)\s+(.+)$/i, '$2, $1')} onChange={(e) => set('sort', e.target.value)} />
          </label>
          <label className="span2">Biography
            <textarea rows={7} value={draft.bio} onChange={(e) => set('bio', e.target.value)} placeholder="Leave empty to show Wikipedia’s" />
          </label>
        </div>
      ) : tab === 'tags' ? (
        <div className="edit-fields">
          <div className="span2 edit-field">
            <span className="edit-field-label">Genres</span>
            <ChipInput values={draft.genres} onChange={(v) => set('genres', v)} list="tag-genres" placeholder="Add a genre" split={splitGenres} label="genre" />
          </div>
          <p className="span2 muted small">
            {genresChanged
              ? `Saving writes these genres into ${plural(changes.filter((x) => x.tags.genre !== undefined).length, 'song')} of theirs.`
              : `The genres most of their ${plural(theirs(songs, draft.name).length, 'song')} have. Changing them writes the new ones into every song of theirs.`}
          </p>
        </div>
      ) : tab === 'poster' ? (
        <ArtworkPicker inline kind="artist" artist={artist.name} album="" current={picture} onClose={() => undefined} />
      ) : (
        <div className="edit-fields">
          <label className="span2">Album sorting
            <select value={draft.albumSort} onChange={(e) => set('albumSort', e.target.value as HubAlbumSort)}>
              {SORTS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </label>
          <p className="span2 muted small">How to order the albums, singles and EPs on {draft.name}’s page, for everyone on your Hub.</p>
        </div>
      )}
    </EditDialog>
  );
}

/** Their songs: where they're the album artist or the main artist. */
function theirs(songs: ArtistSong[], name: string) {
  return songs.filter((s) => same(s.tags.albumArtist, name) || same(readCredit(s.tags.artist ?? '').main, name));
}

/** The artist page's Edit artist button (admins, artists on a Navidrome server). */
export function EditArtistButton({ artist, picture }: { artist: Artist; picture?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" title="Rename, sort name, biography, genres, picture and album order" onClick={() => setOpen(true)}>Edit artist</button>
      {open && <ArtistEditor artist={artist} picture={picture} onClose={() => setOpen(false)} />}
    </>
  );
}
