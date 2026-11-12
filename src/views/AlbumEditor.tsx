import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArtworkPicker } from '../components/ArtworkButton';
import { Spinner } from '../components/common';
import { ChipInput, EditDialog } from '../components/EditDialog';
import { forgetTagValues, HubTagLists, TagLists, useTagValues } from '../components/TagLists';
import { type Facets, useItemTags, useItemTagStore } from '../lib/itemTags';
import { RELEASE_KINDS, kindOfTag, releaseKind } from '../lib/releaseKind';
import { joinGenres, splitGenres } from '../lib/songCredit';
import { saveInParts } from '../lib/tagSave';
import type { HubTagKey, HubTags, HubTagSong } from '../sources/hub';
import type { Album } from '../sources/types';
import { hubClient } from '../store/hub';
import { useUi } from '../store/ui';
import { LibraryServer, libraryServer } from '../lib/serverName';

/**
 * Edit album (docs/USER-GUIDE.md, "Editing an album"): an album's own tags in one dialog, Plex style. **General**
 * has the album, album artist, sort title, release date, release type (Album / EP / Single / Compilation, which
 * puts it on the artist page's Albums or Singles & EPs shelf) and record label; **Tags** the genres, styles, moods
 * and collections as chips; **Poster** the cover picker; **Info** the files. A file tag changed here is written into
 * every song of the album through the Hub's tag editor (PUT /api/admin/tags, in parts: lib/tagSave.ts), so one Save
 * is one entry under Settings → Server → Tag edits. Values that differ from song to song stay as they are unless
 * changed. Styles, moods and collections have no file tag Navidrome reads (an .m4a can't even hold a mood), so they
 * are kept on the Hub (PUT /api/admin/item-tags, hub/src/itemTags.ts) and follow the album when it's renamed; a mood
 * the files already have is the starting value until the Hub has one.
 * Song-by-song changes are on the Edit tags page (views/TagEditor.tsx), a button away.
 */

type Tab = 'general' | 'tags' | 'poster' | 'info';
const TABS = [['general', 'General'], ['tags', 'Tags'], ['poster', 'Poster'], ['info', 'Info']] as const;

/** The album-wide tags this dialog edits. */
const KEYS = ['album', 'albumArtist', 'albumSort', 'year', 'releaseType', 'label', 'genre'] as const satisfies readonly HubTagKey[];
type Key = (typeof KEYS)[number];
const LABELS: Record<Key, string> = {
  album: 'Album', albumArtist: 'Album artist', albumSort: 'Sort album', year: 'Release date', releaseType: 'Release type', label: 'Record label', genre: 'Genres',
};
/** Tags an .m4a can't hold (hub/src/tags.ts canWrite). */
const NOT_IN_M4A: Key[] = ['albumSort', 'releaseType', 'label'];

/** What the Hub keeps for the album (hub/src/itemTags.ts). */
const HUB_FACETS = [['style', 'Styles', 'Add a style, like Southern Rap'], ['mood', 'Moods', 'Add a mood, like Laid-Back/Mellow'], ['collection', 'Collections', 'Add to a collection, like Christmas']] as const;
type HubLists = Record<(typeof HUB_FACETS)[number][0], string[]>;
const sameList = (a: string[], b: string[]) => joinGenres(a) === joinGenres(b);
const hubChanged = (a?: HubLists, b?: HubLists) => !!a && !!b && HUB_FACETS.some(([f]) => !sameList(a[f], b[f]));
const toLists = (f: Facets, fileMood: string): HubLists => ({ style: f.style ?? [], mood: f.mood ?? splitGenres(fileMood), collection: f.collection ?? [] });
const listsBody = (l: HubLists) => ({ styles: l.style, moods: l.mood, collections: l.collection });

const errText = (e: unknown) => String((e as Error).message ?? e);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The album's value for a tag: what every song has, or '' and `mixed` when they differ. */
function common(songs: HubTagSong[], k: HubTagKey): { value: string; mixed: boolean } {
  const vals = new Set(songs.map((s) => (s.tags[k] ?? '').trim()));
  return vals.size === 1 ? { value: [...vals][0], mixed: false } : { value: '', mixed: true };
}

export function AlbumEditor({ album, cover, onClose }: { album: Album; cover?: string; onClose: () => void }) {
  const c = hubClient();
  const ref = album.refs?.[0] ?? album;
  const values = useTagValues();
  const [songs, setSongs] = useState<HubTagSong[]>();
  const [vals, setVals] = useState<Record<Key, string>>();
  const [touched, setTouched] = useState<Set<Key>>(new Set());
  const [tab, setTab] = useState<Tab>('general');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ batches: string[]; files: number; hub?: { from: { artist: string; title: string }; to: { artist: string; title: string }; lists: HubLists; hadAny: boolean } }>();
  const hubReady = useItemTags().ready === true;
  const [hubStart, setHubStart] = useState<HubLists>();
  const [hub, setHub] = useState<HubLists>();
  const [hubHad, setHubHad] = useState(false);

  const load = async () => {
    if (!c) return;
    try {
      const { songs } = await c.tagAlbum(ref.id);
      setSongs(songs);
      const v = Object.fromEntries(KEYS.map((k) => [k, common(songs, k).value])) as Record<Key, string>;
      setVals(v);
      setTouched(new Set());
      await useItemTagStore.getState().load();
      if (useItemTagStore.getState().ready) {
        const t = await c.itemTagsOf('album', v.albumArtist || album.artist, v.album || album.title);
        const l = toLists(t.facets, common(songs, 'mood').value);
        setHubHad(t.updatedAt !== null);
        setHubStart(l);
        setHub(l);
      }
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, [ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mixed = useMemo(() => new Set(KEYS.filter((k) => songs && common(songs, k).mixed)), [songs]);
  const set = (k: Key, v: string) => {
    setVals((x) => (x ? { ...x, [k]: v } : x));
    setTouched((t) => new Set(t).add(k));
  };
  // only what was changed, and only songs whose file says something else
  const changes = useMemo(() => {
    if (!songs || !vals) return [];
    return songs.flatMap((s) => {
      const tags: HubTags = {};
      for (const k of touched) if (vals[k].trim() !== (s.tags[k] ?? '').trim()) tags[k] = vals[k].trim();
      return Object.keys(tags).length ? [{ path: s.path, tags }] : [];
    });
  }, [songs, vals, touched]);
  const changedKeys = KEYS.filter((k) => changes.some((x) => x.tags[k] !== undefined));
  const hubDirty = hubChanged(hub, hubStart);
  const dirty = changes.length > 0 || hubDirty;
  const m4a = (songs ?? []).filter((s) => /\.(m4a|mp4|aac)$/i.test(s.path)).length;

  const save = async () => {
    if (!c || !vals || !songs || !dirty) return;
    setBusy(true);
    setMsg('Saving…');
    try {
      const from = { artist: common(songs, 'albumArtist').value || album.artist, title: common(songs, 'album').value || album.title };
      const to = { artist: vals.albumArtist.trim() || from.artist, title: vals.album.trim() || from.title };
      let r = { batches: [] as string[], changed: [] as string[], failed: [] as { path: string; error: string }[], error: undefined as string | undefined };
      if (changes.length) {
        const label = `Album: ${to.artist} – ${to.title}`;
        r = { error: undefined, ...(await saveInParts(c, label, changes, (done, total) => total > 25 && setMsg(`Saving… ${done} of ${total}`))) };
        if (r.error) throw new Error(r.error);
        forgetTagValues();
      }
      // the Hub's styles, moods and collections follow a rename, then take what changed
      let hubSaved: NonNullable<typeof saved>['hub'];
      const moved = hubReady && hubHad && (from.artist !== to.artist || from.title !== to.title);
      if (moved) await c.renameItemTags('album', from, to);
      if (hubReady && hub && hubStart && (hubDirty || moved)) {
        if (hubDirty) useItemTagStore.getState().put(await c.setItemTags('album', to.artist, to.title, listsBody(hub)));
        hubSaved = { from, to, lists: hubStart, hadAny: hubHad };
        void useItemTagStore.getState().load(true);
      }
      setSaved(r.batches.length || hubSaved ? { batches: r.batches, files: r.changed.length, hub: hubSaved } : undefined);
      setMsg(r.failed.length ? `${plural(r.failed.length, 'song')} failed: ${r.failed[0].error}` : r.batches.length || hubSaved ? undefined : 'Nothing changed in the files');
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
    try {
      for (const b of saved.batches) await c.undoTags(b);
      const h = saved.hub;
      if (h) {
        if (h.from.artist !== h.to.artist || h.from.title !== h.to.title) await c.renameItemTags('album', h.to, h.from);
        await c.setItemTags('album', h.from.artist, h.from.title, h.hadAny ? listsBody(h.lists) : { styles: [], moods: [], collections: [] });
        await useItemTagStore.getState().load(true);
      }
      setSaved(undefined);
      setMsg(saved.batches.length ? `Put the album back as it was. ${LibraryServer()} shows it after its rescan, in a minute or so` : 'Put the album back as it was');
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const songsPage = () => {
    onClose();
    useUi.getState().go({ view: 'tags', album: { ...ref, refs: [ref] } });
  };

  const field = (k: Key, input: ReactNode, span = false) => (
    <label className={span ? 'span2' : undefined}>
      {LABELS[k]}
      {input}
      {mixed.has(k) && !touched.has(k) && <span className="edit-mixed">Differs from song to song; leave empty to keep each as it is</span>}
    </label>
  );
  const text = (k: Key, opts: { list?: string; placeholder?: string } = {}) => (
    <input list={opts.list} value={vals?.[k] ?? ''} placeholder={mixed.has(k) && !touched.has(k) ? 'Differs per song' : opts.placeholder} onChange={(e) => set(k, e.target.value)} />
  );
  const guessed = releaseKind({ ...ref, releaseTypes: undefined, trackCount: songs?.length ?? ref.trackCount });

  return (
    <EditDialog title={`Edit ${album.artist} – ${album.title}`} tabs={TABS} tab={tab} onTab={setTab} busy={busy} onClose={onClose}
      footer={<>
        <span className="small edit-dialog-msg" role="status">
          {saved ? (saved.files ? <>Saved {plural(saved.files, 'song')}. {LibraryServer()} shows it after its rescan, in a minute or so.</> : <>Saved.</>)
            : msg && vals ? msg : dirty ? [changes.length && `${changedKeys.map((k) => LABELS[k]).join(', ')} on ${plural(changes.length, 'song')}`, hubDirty && `${HUB_FACETS.filter(([f]) => hub && hubStart && !sameList(hub[f], hubStart[f])).map(([, l]) => l).join(', ')} on your Hub`].filter(Boolean).join('; ') : ''}
        </span>
        {saved && <button className="btn ghost" onClick={undo} disabled={busy}>Undo</button>}
        <button className="btn ghost" onClick={songsPage} disabled={busy} title="Disc, number, title and artist of each song">Edit each song…</button>
        <button className="btn" onClick={onClose} disabled={busy}>{saved ? 'Close' : 'Cancel'}</button>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>Save changes</button>
      </>}>
      <TagLists values={values} />
      {!vals || !songs ? (msg ? <div className="errors">{msg}</div> : <Spinner />) : tab === 'general' ? (
        <div className="edit-fields">
          {field('album', text('album'), true)}
          {field('albumArtist', text('albumArtist', { list: 'tag-artists' }))}
          {field('albumSort', text('albumSort', { placeholder: vals.album.replace(/^(the|a|an)\s+(.+)$/i, '$2, $1') }))}
          {field('year', text('year', { placeholder: 'YYYY or YYYY-MM-DD' }))}
          {field('releaseType', (
            <select value={kindOfTag(vals.releaseType) ?? ''} onChange={(e) => set('releaseType', e.target.value)}>
              <option value="">{mixed.has('releaseType') && !touched.has('releaseType') ? 'Differs per song' : `Not set (shown as ${RELEASE_KINDS.find((x) => x.kind === guessed)?.label})`}</option>
              {RELEASE_KINDS.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}
            </select>
          ))}
          {field('label', text('label'), true)}
          <p className="span2 muted small">
            The release type decides where the album shows on the artist’s page: Albums, Singles &amp; EPs, or Compilations.
            Without one, up to 3 songs count as a single and 4 to 6 as an EP.
          </p>
        </div>
      ) : tab === 'tags' ? (
        <div className="edit-fields">
          <div className="span2 edit-field">
            <span className="edit-field-label">Genres</span>
            <ChipInput values={splitGenres(vals.genre)} onChange={(v) => set('genre', joinGenres(v))} list="tag-genres" placeholder={mixed.has('genre') && !touched.has('genre') ? 'Differs per song' : 'Add a genre'} split={splitGenres} label="genre" />
          </div>
          <p className="span2 muted small">Genres are written into one tag separated by “; ” on every song of the album, which {libraryServer()} reads as separate genres. They can differ from the artist’s own genres.</p>
          {hub ? HUB_FACETS.map(([f, label, placeholder]) => (
            <div key={f} className="span2 edit-field">
              <span className="edit-field-label">{label}</span>
              <ChipInput values={hub[f]} onChange={(v) => setHub((h) => (h ? { ...h, [f]: v } : h))} list={`tag-${f}s`} placeholder={placeholder} split={splitGenres} label={f} />
            </div>
          )) : <p className="span2 muted small">Styles, moods and collections need a Hub that keeps them (0.38 or newer).</p>}
          {hub && <p className="span2 muted small">Styles, moods and collections are kept on your Hub, for browsing and smart playlists, and follow the album if it’s renamed.</p>}
          <HubTagLists />
        </div>
      ) : tab === 'poster' ? (
        <ArtworkPicker inline kind="album" artist={album.artist} album={album.title} current={cover} onClose={() => undefined} />
      ) : (
        <dl className="edit-info">
          <dt>Songs</dt><dd>{songs.length}</dd>
          <dt>Folder</dt>
          <dd>{[...new Set(songs.map((s) => s.path.replace(/\/[^/]*$/, '')))].join(', ')}</dd>
          <dt>Formats</dt>
          <dd>{Object.entries(songs.reduce<Record<string, number>>((m, s) => {
            const ext = (s.path.match(/\.(\w+)$/)?.[1] ?? '?').toUpperCase();
            m[ext] = (m[ext] ?? 0) + 1;
            return m;
          }, {})).map(([ext, n]) => `${n} ${ext}`).join(', ')}</dd>
          {m4a > 0 && <p className="muted small">{plural(m4a, 'song')} {m4a === 1 ? 'is an' : 'are'} .m4a, which can’t hold {NOT_IN_M4A.map((k) => LABELS[k].toLowerCase()).join(', ')}; those are left out for {m4a === 1 ? 'it' : 'them'}.</p>}
          <p className="muted small">Saves are written into the files by your Hub (the audio isn’t touched) and can be undone under Settings → Server → Tag edits.</p>
        </dl>
      )}
    </EditDialog>
  );
}

/** The album page's Edit album button (admins, Navidrome albums). */
export function EditAlbumButton({ album, cover }: { album: Album; cover?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" title="Fix this album’s title, artist, release type, genres and cover" onClick={() => setOpen(true)}>Edit album</button>
      {open && <AlbumEditor album={album} cover={cover} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * An album with no files to edit here (Plex's copy, with no Navidrome copy of the same album): only what the Hub
 * keeps, its styles, moods and collections, which apply to every copy of the album since they go by album artist and
 * title.
 */
export function EditAlbumTagsButton({ album }: { album: Album }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" title="Styles, moods and collections (the files of this copy are on Plex)" onClick={() => setOpen(true)}>Edit album</button>
      {open && <AlbumHubTags album={album} onClose={() => setOpen(false)} />}
    </>
  );
}

function AlbumHubTags({ album, onClose }: { album: Album; onClose: () => void }) {
  const c = hubClient();
  const [start, setStart] = useState<HubLists>();
  const [hub, setHub] = useState<HubLists>();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    c?.itemTagsOf('album', album.artist, album.title).then((r) => {
      setStart(toLists(r.facets, ''));
      setHub(toLists(r.facets, ''));
    }, (e) => setMsg(errText(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = hubChanged(hub, start);
  const save = async () => {
    if (!c || !hub) return;
    setBusy(true);
    try {
      useItemTagStore.getState().put(await c.setItemTags('album', album.artist, album.title, listsBody(hub)));
      onClose();
    } catch (e) {
      setMsg(errText(e));
      setBusy(false);
    }
  };
  return (
    <EditDialog title={`Edit ${album.artist} – ${album.title}`} tabs={[['tags', 'Tags']] as const} tab="tags" onTab={() => undefined} busy={busy} onClose={onClose}
      footer={<>
        <span className="small edit-dialog-msg" role="status">{msg}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>Save changes</button>
      </>}>
      <HubTagLists />
      {!hub ? (msg ? <div className="errors">{msg}</div> : <Spinner />) : (
        <div className="edit-fields">
          {HUB_FACETS.map(([f, label, placeholder]) => (
            <div key={f} className="span2 edit-field">
              <span className="edit-field-label">{label}</span>
              <ChipInput values={hub[f]} onChange={(v) => setHub((h) => (h ? { ...h, [f]: v } : h))} list={`tag-${f}s`} placeholder={placeholder} split={splitGenres} label={f} />
            </div>
          ))}
          <p className="span2 muted small">This copy of the album is Plex’s, so its title, artist, genres and cover are in Plex and can’t be changed here. Styles, moods and collections are kept on your Hub and apply to every copy.</p>
        </div>
      )}
    </EditDialog>
  );
}
