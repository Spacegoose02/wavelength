import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../components/common';
import { forgetTagValues, TagLists } from '../components/TagLists';
import { renameArtist } from '../lib/merge';
import { sourceFor } from '../sources/registry';
import type { HubTags, HubTagSong } from '../sources/hub';
import type { Artist } from '../sources/types';
import { hubClient } from '../store/hub';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';

/**
 * Edit an artist across all their albums (hub/src/routes/tags.ts): rename them, or merge two spellings by
 * renaming one to the other, in every song's Artist and Album artist tags, and optionally set a genre. Shows
 * each change before saving; a Save can be undone like any tag edit.
 */

type Song = HubTagSong & { albumId: string };

const errText = (e: unknown) => String((e as Error).message ?? e);

export function ArtistTagEditor({ artist }: { artist: Artist }) {
  const c = hubClient();
  const sources = useSettings((s) => s.sources);
  const [songs, setSongs] = useState<Song[]>();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(artist.name);
  const [to, setTo] = useState(artist.name);
  const [genre, setGenre] = useState('');
  const [credits, setCredits] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  const load = async () => {
    try {
      const refs = (artist.refs ?? [artist]).filter((r) => sources.find((s) => s.id === r.sourceId)?.kind === 'navidrome');
      const albums = (await Promise.all(refs.map(async (r) => {
        const cfg = sources.find((s) => s.id === r.sourceId)!;
        return (await sourceFor(cfg).getArtistAlbums?.(r.id)) ?? [];
      }))).flat();
      if (!albums.length) throw new Error('Navidrome has no albums for this artist');
      setTitles(Object.fromEntries(albums.map((a) => [a.id, a.title])));
      const r = await c!.tagAlbums(albums.map((a) => a.id).slice(0, 200));
      setSongs(r.songs);
      if (r.missing.length) setMsg(`${r.missing.length} file${r.missing.length === 1 ? '' : 's'} weren't found in the Hub's music folder and are left out`);
    } catch (e) {
      setMsg(errText(e));
      setSongs([]);
    }
  };
  useEffect(() => {
    load();
  }, [artist.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = useMemo(() => {
    if (!songs || !from.trim()) return [];
    return songs.flatMap((s) => {
      const name = to.trim() || from.trim();
      const tags: HubTags = {};
      const artistTo = renameArtist(s.tags.artist, from, name, credits);
      const albumArtistTo = renameArtist(s.tags.albumArtist, from, name, credits);
      if (artistTo !== s.tags.artist) tags.artist = artistTo;
      if (albumArtistTo !== s.tags.albumArtist) tags.albumArtist = albumArtistTo;
      // the genre only for songs that are theirs
      const theirs = tags.artist !== undefined || tags.albumArtist !== undefined || [s.tags.artist, s.tags.albumArtist].some((v) => renameArtist(v, from, '\u0000', credits)?.includes('\u0000'));
      if (genre.trim() && theirs && genre.trim() !== (s.tags.genre ?? '')) tags.genre = genre.trim();
      return Object.keys(tags).length ? [{ song: s, tags }] : [];
    });
  }, [songs, from, to, genre, credits]);
  const included = changes.filter((x) => !skip.has(x.song.albumId));
  const byAlbum = useMemo(() => {
    const m = new Map<string, typeof changes>();
    for (const x of changes) m.set(x.song.albumId, [...(m.get(x.song.albumId) ?? []), x]);
    return [...m];
  }, [changes]);

  if (!c) return <div className="page"><p className="muted">Sign in to your Hub to edit tags.</p></div>;

  const save = async () => {
    setBusy(true);
    setMsg('Saving…');
    try {
      const label = to.trim() && to.trim() !== from.trim() ? `Artist: ${from.trim()} → ${to.trim()}` : `Artist: ${from.trim()}`;
      const r = await c.saveTags(label, included.map((x) => ({ path: x.song.path, tags: x.tags })));
      setLastBatch(r.batch);
      forgetTagValues();
      setMsg(`Saved ${r.changed.length} file${r.changed.length === 1 ? '' : 's'}${r.failed.length ? `; ${r.failed.length} failed: ${r.failed[0].error}` : ''}. Navidrome rescans in a minute to show them`);
      if (to.trim()) setFrom(to.trim());
      setGenre('');
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
      setFrom(artist.name);
      setTo(artist.name);
      setMsg(`Put ${r.undone} file${r.undone === 1 ? '' : 's'} back as they were`);
      await load();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const show = (a?: string, b?: string) => (a === undefined ? null : <><s className="muted">{b || '(empty)'}</s> → <b>{a}</b></>);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Edit artist</h1>
        <button className="btn small ghost" onClick={() => useUi.getState().go({ view: 'artist', artist })}>Back to artist</button>
      </header>
      <p className="muted small">
        Rename {artist.name} in every song on their albums, or merge two spellings: rename one to the other (pick it from the
        list). The Hub writes the files; the audio isn’t touched, and the Save can be undone here or under Settings → Server →
        Tag edits.
      </p>
      <TagLists />
      {!songs ? <Spinner /> : (
        <>
          <section className="editor">
            <div className="editor-grid">
              <label>Credited as<input list="tag-artists" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>Change to<input list="tag-artists" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Leave as is" /></label>
              <label>Genre for their songs<input list="tag-genres" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Leave as is" /></label>
            </div>
            <label className="check">
              <input type="checkbox" checked={credits} onChange={(e) => setCredits(e.target.checked)} />
              <small>Also where they’re credited with others (“{from || 'Artist'} feat. …”, “… & {from || 'Artist'}”)</small>
            </label>
            <div className="row gap">
              <button className="btn primary" onClick={save} disabled={busy || !included.length}>Save {included.length ? `(${included.length} song${included.length === 1 ? '' : 's'})` : ''}</button>
              {lastBatch && <button className="btn ghost" onClick={undo} disabled={busy}>Undo</button>}
              {msg && <span className="small">{msg}</span>}
            </div>
          </section>
          {songs.length > 0 && !changes.length && <p className="muted">Nothing to change yet: {songs.length} songs on {Object.keys(titles).length} albums.</p>}
          {byAlbum.map(([albumId, list]) => (
            <section key={albumId} className="artist-edit-album">
              <label className="check">
                <input type="checkbox" checked={!skip.has(albumId)} onChange={(e) => setSkip((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.delete(albumId);
                  else n.add(albumId);
                  return n;
                })} />
                <b>{titles[albumId] ?? 'Album'}</b> <span className="muted small">· {list.length} song{list.length === 1 ? '' : 's'}</span>
              </label>
              {!skip.has(albumId) && list.map(({ song, tags }) => (
                <div key={song.path} className="track-sub artist-edit-row" title={song.path}>
                  <span>{song.tags.title || song.path}</span>
                  {tags.artist !== undefined && <span>Artist: {show(tags.artist, song.tags.artist)}</span>}
                  {tags.albumArtist !== undefined && <span>Album artist: {show(tags.albumArtist, song.tags.albumArtist)}</span>}
                  {tags.genre !== undefined && <span>Genre: {show(tags.genre, song.tags.genre)}</span>}
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
