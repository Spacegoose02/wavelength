import { useEffect, useState } from 'react';
import { Spinner } from '../components/common';
import { ChipInput, EditDialog } from '../components/EditDialog';
import { forgetTagValues, TagLists, useTagValues } from '../components/TagLists';
import { addFeatured, writeCredit, joinGenres, readCredit, splitGenres, splitNames, titleFeatures } from '../lib/songCredit';
import type { HubTags, HubTagSong } from '../sources/hub';
import type { Track } from '../sources/types';
import { hubClient } from '../store/hub';
import { HubTagLists } from '../components/TagLists';
import { type TrackFacets, useItemTagStore } from '../lib/itemTags';
import { useSongEditor } from '../components/EditSong';
import { LibraryServer, libraryServer } from '../lib/serverName';

/**
 * Edit song (docs/USER-GUIDE.md, "Editing a song"): one song's tags, Plex style, from a song's menu or its row's
 * Edit button. The main thing it's for is the credit: a main artist and a list of featured artists, written as
 * "Lil Durk feat. Drake; Future" (lib/songCredit.ts, the same shape Library care's Split joined artists writes), so
 * Navidrome files the song under Lil Durk with Drake and Future featured. Title, album, album artist, track, disc,
 * year and genres are there too, and the file's path under Info.
 *
 * The Hub reads the tags from the file (GET /api/admin/tags/song/:id) and writes them with the album tag editor's
 * Save (PUT /api/admin/tags), so each Save is one entry under Settings → Server → Tag edits that Undo puts back, and
 * Navidrome is asked to rescan.
 *
 * The Tags tab also has the song's own **styles** and **moods** (like Plex's track moods), which have no tag in the
 * file: they're kept on the Hub (hub/src/trackTags.ts) by album artist, album and title, and follow the song when
 * those change here.
 */

/** Drawn once in App.tsx. */
export function SongEditorHost() {
  const track = useSongEditor((s) => s.track);
  const close = useSongEditor((s) => s.close);
  if (!track) return null;
  return <SongEditor key={`${track.sourceId}:${track.id}`} track={track} onClose={close} />;
}

type Tab = 'general' | 'tags' | 'info';
const TABS: readonly (readonly [Tab, string])[] = [['general', 'General'], ['tags', 'Tags'], ['info', 'Info']];

interface Draft {
  title: string;
  main: string;
  featured: string[];
  album: string;
  albumArtist: string;
  track: string;
  disc: string;
  year: string;
  genres: string[];
}

const draftOf = (t: HubTags): Draft => {
  const credit = readCredit(t.artist ?? '');
  return {
    title: t.title ?? '',
    main: credit.main,
    featured: credit.featured,
    album: t.album ?? '',
    albumArtist: t.albumArtist ?? '',
    track: t.track ?? '',
    disc: t.disc ?? '',
    year: t.year ?? '',
    genres: splitGenres(t.genre ?? ''),
  };
};

/** The tags a draft writes. */
const tagsOf = (d: Draft): HubTags => ({
  title: d.title.trim(),
  artist: writeCredit(d.main, d.featured),
  album: d.album.trim(),
  albumArtist: d.albumArtist.trim(),
  track: d.track.trim(),
  disc: d.disc.trim(),
  year: d.year.trim(),
  genre: joinGenres(d.genres),
});

/**
 * The tags the person changed: the ones whose written value differs from what the dialog opened with. A credit
 * read as "Lil Durk;Drake" opens as Lil Durk + Drake; it's only rewritten when the person changes it or asks to
 * (`tidy`), so opening and saving a title fix doesn't quietly touch the Artist tag too.
 */
function changesOf(start: Draft, d: Draft, tidy: boolean): HubTags {
  const was = tagsOf(start), now = tagsOf(d);
  const out: HubTags = {};
  for (const k of Object.keys(now) as (keyof HubTags)[]) if (now[k] !== was[k] || (k === 'artist' && tidy)) out[k] = now[k];
  return out;
}

const LABELS: Partial<Record<keyof HubTags, string>> = { title: 'Title', artist: 'Artist', album: 'Album', albumArtist: 'Album artist', track: 'Track', disc: 'Disc', year: 'Year', genre: 'Genres' };
const errText = (e: unknown) => String((e as Error).message ?? e);

/** Who files the album: the album artist, else the song's main artist. */
const keyOf = (d: Draft) => ({ artist: d.albumArtist.trim() || d.main.trim(), album: d.album.trim(), title: d.title.trim() });
const sameList = (a: string[] = [], b: string[] = []) => a.join('\u0000') === b.join('\u0000');

function SongEditor({ track: t, onClose }: { track: Track; onClose: () => void }) {
  const c = hubClient();
  const values = useTagValues();
  const known = values?.artists ?? [];
  const [song, setSong] = useState<HubTagSong>();
  const [draft, setDraft] = useState<Draft>();
  const [start, setStart] = useState<Draft>();
  const [tidy, setTidy] = useState(false);
  const [tab, setTab] = useState<Tab>('general');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ batch: string; what: string }>();
  // the song's styles and moods on the Hub (undefined: an older Hub without them)
  const [hubStart, setHubStart] = useState<TrackFacets>();
  const [hub, setHub] = useState<TrackFacets>();

  const load = async () => {
    if (!c) return;
    try {
      const s = await c.tagSong(t.id, t.albumId);
      setSong(s);
      setDraft(draftOf(s.tags));
      setStart(draftOf(s.tags));
      setTidy(false);
      const k = keyOf(draftOf(s.tags));
      c.trackTagsOf(k.artist, k.album, k.title).then((r) => {
        setHubStart(r.facets);
        setHub(r.facets);
      }, () => undefined);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const changes = start && draft ? changesOf(start, draft, tidy) : {};
  const changed = Object.keys(changes) as (keyof HubTags)[];
  const hubChanged = (['style', 'mood'] as const).filter((f) => hub && !sameList(hub[f], hubStart?.[f]));
  const fromTitle = draft ? titleFeatures(draft.title, known) : null;
  const credit = draft ? writeCredit(draft.main, draft.featured) : '';
  // the file's credit isn't written the way Navidrome splits it ("Lil Durk;Drake", "Lil Durk (feat. Drake)")
  const untidy = !!song?.tags.artist && !!start && writeCredit(start.main, start.featured) !== song.tags.artist;

  const moveFromTitle = () => {
    if (!draft || !fromTitle) return;
    const next = addFeatured({ main: draft.main, featured: draft.featured }, fromTitle.featured);
    setDraft({ ...draft, title: fromTitle.title, featured: next.featured });
  };

  const save = async () => {
    if (!c || !song || !draft || !start || (!changed.length && !hubChanged.length)) return;
    if (!draft.main.trim()) {
      setTab('general');
      return setMsg('The song needs a main artist');
    }
    setBusy(true);
    setMsg('Saving…');
    try {
      const from = keyOf(start);
      const to = keyOf(draft);
      if (changed.length) {
        const label = `${credit} – ${draft.title.trim() || t.title}`;
        const r = await c.saveTags(label, [{ path: song.path, tags: changes }]);
        if (r.failed.length) throw new Error(r.failed[0].error);
        forgetTagValues();
        setSaved(r.batch ? { batch: r.batch, what: changed.map((k) => LABELS[k]).join(', ') } : undefined);
        setMsg(r.batch ? undefined : hubChanged.length ? 'Saved the styles and moods' : 'Nothing changed in the file');
        // the song's styles and moods follow a new title, album or album artist
        if (hubStart && (hubStart.style?.length || hubStart.mood?.length) && JSON.stringify(from) !== JSON.stringify(to)) await c.renameTrackTags(from, to).catch(() => undefined);
      } else setMsg('Saved the styles and moods');
      if (hub && hubChanged.length) {
        const r = await c.setTrackTags(to.artist, to.album, to.title, Object.fromEntries(hubChanged.map((f) => [f === 'style' ? 'styles' : 'moods', hub[f] ?? []])));
        useItemTagStore.getState().putSong(r);
      }
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
      await c.undoTags(saved.batch);
      setSaved(undefined);
      setMsg(`Put the song back as it was. ${LibraryServer()} shows it after its rescan, in a minute or so`);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditDialog title={`Edit ${t.artist} – ${t.title}`} tabs={TABS} tab={tab} onTab={setTab} busy={busy} onClose={onClose}
      footer={<>
          <span className="small edit-dialog-msg" role="status">
            {saved ? <>Saved {saved.what}. {LibraryServer()} shows it after its rescan, in a minute or so.</> : msg && draft ? msg : changed.length || hubChanged.length ? `Changes: ${[...changed.map((k) => LABELS[k]), ...hubChanged.map((f) => (f === 'style' ? 'Styles' : 'Moods'))].join(', ')}` : ''}
          </span>
          {saved && <button className="btn ghost" onClick={undo} disabled={busy}>Undo</button>}
          <button className="btn" onClick={onClose} disabled={busy}>{saved ? 'Close' : 'Cancel'}</button>
          <button className="btn primary" onClick={save} disabled={busy || (!changed.length && !hubChanged.length)}>Save changes</button>
      </>}>
        <TagLists values={values} />
        {!draft ? (msg ? <div className="errors">{msg}</div> : <Spinner />) : tab === 'general' ? (
          <div className="edit-fields">
            <label className="span2">Title
              <input value={draft.title} onChange={(e) => set('title', e.target.value)} autoFocus />
            </label>
            {fromTitle && (
              <div className="edit-hint span2">
                <span>The title names {fromTitle.featured.join(', ')} as featured.</span>
                <button className="btn small" onClick={moveFromTitle}>Move to featured artists</button>
              </div>
            )}
            <label className="span2">Artist
              <input list="tag-artists" value={draft.main} onChange={(e) => set('main', e.target.value)} placeholder="The main artist" />
            </label>
            <div className="span2 edit-field">
              <span className="edit-field-label">Featured artists</span>
              <ChipInput values={draft.featured} onChange={(v) => set('featured', v)} list="tag-artists" placeholder="Add an artist"
                split={(s) => splitNames(s, known)} label="featured artist" />
            </div>
            {untidy && !tidy && (
              <div className="edit-hint span2">
                <span>The file says “{song?.tags.artist}”, which {libraryServer()} may not split into these artists.</span>
                <button className="btn small" onClick={() => setTidy(true)}>Write it as “{credit}”</button>
              </div>
            )}
            <p className="span2 muted small edit-preview">
              Written as <b>{credit || '—'}</b>. The song is filed under {draft.main.trim() || 'its main artist'}
              {draft.featured.length ? `, with ${draft.featured.join(', ')} featured` : ''}.
            </p>
            <label>Album
              <input value={draft.album} onChange={(e) => set('album', e.target.value)} />
            </label>
            <label>Album artist
              <input list="tag-artists" value={draft.albumArtist} onChange={(e) => set('albumArtist', e.target.value)} />
            </label>
            {draft.main.trim() && draft.albumArtist.trim() && /[;；]/.test(draft.albumArtist) && (
              <div className="edit-hint span2">
                <span>An album artist with several names files the album under all of them.</span>
                <button className="btn small" onClick={() => set('albumArtist', readCredit(draft.albumArtist).main)}>Use {readCredit(draft.albumArtist).main}</button>
              </div>
            )}
            <div className="span2 edit-numbers">
              <label>Track<input inputMode="numeric" value={draft.track} onChange={(e) => set('track', e.target.value)} /></label>
              <label>Disc<input inputMode="numeric" value={draft.disc} onChange={(e) => set('disc', e.target.value)} /></label>
              <label>Year<input inputMode="numeric" value={draft.year} onChange={(e) => set('year', e.target.value)} /></label>
            </div>
          </div>
        ) : tab === 'tags' ? (
          <div className="edit-fields">
            <div className="span2 edit-field">
              <span className="edit-field-label">Genres</span>
              <ChipInput values={draft.genres} onChange={(v) => set('genres', v)} list="tag-genres" placeholder="Add a genre" split={splitGenres} label="genre" />
            </div>
            <p className="span2 muted small">Genres are written into one tag separated by “; ”, which {libraryServer()} reads as separate genres.</p>
            {hub && (
              <>
                <HubTagLists />
                <div className="span2 edit-field">
                  <span className="edit-field-label">Moods</span>
                  <ChipInput values={hub.mood ?? []} onChange={(v) => setHub({ ...hub, mood: v })} list="tag-moods" placeholder="Add a mood" split={splitGenres} label="mood" />
                </div>
                <div className="span2 edit-field">
                  <span className="edit-field-label">Styles</span>
                  <ChipInput values={hub.style ?? []} onChange={(v) => setHub({ ...hub, style: v })} list="tag-styles" placeholder="Add a style" split={splitGenres} label="style" />
                </div>
                <p className="span2 muted small">This song’s own moods and styles, apart from its album’s (like Plex’s track moods). They’re kept on your Hub, not in the file, so Undo doesn’t touch them.</p>
              </>
            )}
          </div>
        ) : (
          <dl className="edit-info">
            <dt>File</dt><dd>{song?.path}</dd>
            {(Object.keys(LABELS) as (keyof HubTags)[]).map((k) => (
              <div key={k} className="edit-info-row"><dt>{LABELS[k]} tag</dt><dd>{song?.tags[k] || <span className="muted">empty</span>}</dd></div>
            ))}
            <p className="muted small">Saves are written into the file by your Hub (the audio isn’t touched) and can be undone under Settings → Server → Tag edits.</p>
          </dl>
        )}
    </EditDialog>
  );
}
