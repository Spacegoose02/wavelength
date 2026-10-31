import { useState } from 'react';
import { describe, newSmartPlaylist, smartTracks, type SmartPlaylist } from '../lib/smartPlaylists';
import { sourceFor } from '../sources/registry';
import { enabledSources, useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useServerPlaylists } from '../store/serverPlaylists';
import { IconPlay, IconX } from '../components/Icons';

/** Playlists → Smart playlists: rules that pick songs from your Navidrome library each time (lib/smartPlaylists.ts). */
export function SmartPlaylists() {
  const list = useSettings((s) => s.smartPlaylists);
  const hasNavidrome = useSettings((s) => s.sources.some((x) => x.enabled && x.kind === 'navidrome'));
  const [editing, setEditing] = useState<SmartPlaylist>();
  const [msg, setMsg] = useState<Record<string, string>>({});
  if (!hasNavidrome && !list.length) return null;

  const say = (id: string, m: string) => setMsg((s) => ({ ...s, [id]: m }));
  const play = async (p: SmartPlaylist) => {
    say(p.id, 'Finding songs…');
    try {
      const tracks = await smartTracks(p);
      if (!tracks.length) return say(p.id, 'No songs match right now');
      usePlayer.getState().playTracks(tracks);
      say(p.id, `Playing ${tracks.length} songs`);
    } catch (e) {
      say(p.id, String((e as Error).message ?? e));
    }
  };
  // a copy of today's songs as an ordinary Navidrome playlist, for other apps (Symfonium, the web player…)
  const saveToServer = async (p: SmartPlaylist) => {
    const cfg = enabledSources().find((s) => s.kind === 'navidrome');
    const src = cfg && sourceFor(cfg);
    if (!src?.createPlaylist) return;
    say(p.id, 'Saving…');
    try {
      const tracks = (await smartTracks(p)).filter((t) => t.sourceId === cfg!.id);
      await src.createPlaylist(`${p.name} (${new Date().toLocaleDateString()})`, tracks.map((t) => t.id));
      void useServerPlaylists.getState().load();
      say(p.id, `Saved ${tracks.length} songs to ${cfg!.name}`);
    } catch (e) {
      say(p.id, String((e as Error).message ?? e));
    }
  };

  return (
    <section>
      <h2>Smart playlists <small className="muted">songs picked by rules from your Navidrome library, fresh each time</small></h2>
      <div className="smart-list">
        {list.map((p) => (
          <div key={p.id} className="source-row">
            <button className="icon-btn" title="Play" onClick={() => void play(p)}><IconPlay /></button>
            <div className="track-main">
              <div className="track-title">{p.name}</div>
              <div className="track-sub">{msg[p.id] ?? describe(p)}</div>
            </div>
            <button className="btn small" onClick={() => setEditing(p)}>Edit</button>
            <button className="btn small ghost" title="Save today's songs as a playlist on your server" onClick={() => void saveToServer(p)}>Save copy</button>
            <button className="icon-btn" title="Delete" onClick={() => confirm(`Delete the smart playlist “${p.name}”?`) && useSettings.getState().removeSmartPlaylist(p.id)}><IconX /></button>
          </div>
        ))}
        {!editing && <button className="btn small" onClick={() => setEditing(newSmartPlaylist())}>+ Smart playlist</button>}
      </div>
      {editing && <SmartEditor key={editing.id} initial={editing} onDone={() => setEditing(undefined)} />}
    </section>
  );
}

function SmartEditor({ initial, onDone }: { initial: SmartPlaylist; onDone: () => void }) {
  const [p, setP] = useState(initial);
  const [genres, setGenres] = useState(initial.genres.join(', '));
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const save = () => {
    useSettings.getState().saveSmartPlaylist({
      ...p,
      name: p.name.trim() || 'Smart playlist',
      genres: genres.split(',').map((g) => g.trim()).filter(Boolean),
      limit: Math.min(1000, Math.max(1, p.limit || 100)),
    });
    onDone();
  };
  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="editor-grid">
        <label>Name<input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <label>Genres (comma between, empty = any)<input placeholder="Rap; Hip-Hop, R&B" value={genres} onChange={(e) => setGenres(e.target.value)} /></label>
        <label>Rated at least
          <select value={p.minRating} onChange={(e) => setP({ ...p, minRating: num(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r ? `${'★'.repeat(r)}` : 'Any'}</option>)}
          </select>
        </label>
        <label>Not played in (days, 0 = any)<input type="number" min={0} value={p.notPlayedDays} onChange={(e) => setP({ ...p, notPlayedDays: num(e.target.value) })} /></label>
        <label>Added in the last (days, 0 = any)<input type="number" min={0} value={p.addedDays} onChange={(e) => setP({ ...p, addedDays: num(e.target.value) })} /></label>
        <label>From year<input type="number" placeholder="any" value={p.fromYear ?? ''} onChange={(e) => setP({ ...p, fromYear: num(e.target.value) || undefined })} /></label>
        <label>To year<input type="number" placeholder="any" value={p.toYear ?? ''} onChange={(e) => setP({ ...p, toYear: num(e.target.value) || undefined })} /></label>
        <label>At most (songs)<input type="number" min={1} max={1000} value={p.limit} onChange={(e) => setP({ ...p, limit: num(e.target.value) })} /></label>
      </div>
      <label className="check"><span className="switch"><input type="checkbox" checked={p.starred} onChange={(e) => setP({ ...p, starred: e.target.checked })} /><span /></span> Only songs I ♥</label>
      <p className="muted small">Genres match your tags, so tidy genres (Settings → Server → Genres) make these work best. Ratings and plays are your own on Navidrome.</p>
      <div className="row gap">
        <button className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
