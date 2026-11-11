import { useState } from 'react';
import { advancedRules, describe, MOODS, newSmartPlaylist, smartTracks, type SmartPlaylist } from '../lib/smartPlaylists';
import { SORTS, type SortId } from '../lib/smartRules';
import { RuleBuilder } from '../components/RuleBuilder';
import { useFeature } from '../lib/features';
import { useHub } from '../store/hub';
import { sourceFor } from '../sources/registry';
import { enabledSources, useSettings } from '../store/settings';
import { usePlayer } from '../store/player';
import { useServerPlaylists } from '../store/serverPlaylists';
import { IconPlay, IconX } from '../components/Icons';
import { ChipInput } from '../components/EditDialog';
import { HubTagLists } from '../components/TagLists';
import { splitGenres } from '../lib/genreNames';
import { useItemTags } from '../lib/itemTags';

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
  const sonicOn = useFeature('sonic');
  const hasHub = useHub((st) => !!st.token);
  const sonic = sonicOn && hasHub;
  const [genres, setGenres] = useState(initial.genres.join(', '));
  // the Hub's styles, moods and collections, when it keeps them
  const tags = useItemTags();
  const hubTags = tags.ready === true || !!(p.styles?.length || p.tagMoods?.length || p.collections?.length || p.notCollections?.length);
  const list = (k: 'styles' | 'tagMoods' | 'collections' | 'notCollections', label: string, dl: string, placeholder: string) => (
    <div className="edit-field">
      <span className="small">{label}</span>
      <ChipInput values={p[k] ?? []} onChange={(v) => setP({ ...p, [k]: v.length ? v : undefined })} list={dl} placeholder={placeholder} split={splitGenres} label={label.toLowerCase()} />
    </div>
  );
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const [preview, setPreview] = useState<string>();
  const saved = useSettings((st) => st.smartPlaylists.some((x) => x.id === initial.id));
  const final = (): SmartPlaylist => ({
    ...p,
    name: p.name.trim() || 'Smart playlist',
    genres: genres.split(',').map((g) => g.trim()).filter(Boolean),
    limit: Math.min(1000, Math.max(1, p.limit || 100)),
  });
  const save = (asNew = false) => {
    const out = final();
    useSettings.getState().saveSmartPlaylist(asNew ? { ...out, id: newSmartPlaylist().id, name: `${out.name} (copy)` } : out);
    onDone();
  };
  const tryIt = async () => {
    setPreview('Finding songs…');
    try {
      const tracks = await smartTracks(final());
      setPreview(tracks.length ? `${tracks.length} songs, like ${tracks.slice(0, 3).map((t) => `${t.title} (${t.artist})`).join(', ')}` : 'No songs match right now');
    } catch (e) {
      setPreview(String((e as Error).message ?? e));
    }
  };
  const sound = sonic && (
    <>
      <div className="chips" aria-label="Sound">
        <small className="muted">Sound:</small>
        {MOODS.map((m) => (
          <button type="button" key={m} className={`chip ${p.moods?.includes(m) ? 'on' : ''}`} onClick={() => setP({ ...p, moods: p.moods?.includes(m) ? p.moods.filter((x) => x !== m) : [...(p.moods ?? []), m] })}>{m}</button>
        ))}
      </div>
      <div className="editor-grid">
        <label>Tempo from (BPM)<input type="number" min={0} placeholder="any" value={p.minBpm ?? ''} onChange={(e) => setP({ ...p, minBpm: num(e.target.value) || undefined })} /></label>
        <label>Tempo to (BPM)<input type="number" min={0} placeholder="any" value={p.maxBpm ?? ''} onChange={(e) => setP({ ...p, maxBpm: num(e.target.value) || undefined })} /></label>
      </div>
    </>
  );
  const advanced = !!p.rules;
  const mode = (
    <div className="chips" role="radiogroup" aria-label="Rules">
      <button type="button" role="radio" aria-checked={!advanced} className={`chip ${advanced ? '' : 'on'}`} onClick={() => advanced && confirm('Go back to the simple rules? The advanced rules are dropped.') && setP({ ...p, rules: undefined, sort: undefined })}>Simple</button>
      <button type="button" role="radio" aria-checked={advanced} className={`chip ${advanced ? 'on' : ''}`} onClick={() => !advanced && setP({ ...final(), rules: advancedRules(final()) })}>Advanced</button>
    </div>
  );
  const buttons = (
    <div className="row gap" style={{ flexWrap: 'wrap' }}>
      <button className="btn primary">Save</button>
      {saved && <button type="button" className="btn" onClick={() => save(true)}>Save as new</button>}
      <button type="button" className="btn ghost" onClick={() => void tryIt()}>Try it</button>
      <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      {preview && <span className="muted small">{preview}</span>}
    </div>
  );
  if (p.rules) {
    return (
      <form className="editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {mode}
        <div className="editor-grid">
          <label className="span2">Name<input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        </div>
        <RuleBuilder value={p.rules} onChange={(rules) => setP({ ...p, rules })} />
        <div className="rule-limit">
          <span>Limit to</span>
          <input aria-label="Songs" type="number" min={1} max={1000} value={p.limit} onChange={(e) => setP({ ...p, limit: num(e.target.value) })} />
          <span>songs, picked</span>
          <select aria-label="Picked" value={p.sort ?? 'random'} onChange={(e) => setP({ ...p, sort: e.target.value as SortId })}>
            {SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
        {sound}
        <p className="muted small">Album and artist rules are checked on the whole library; track rules (plays, ratings, format…) on the songs of up to 400 albums that fit the rest, read fresh each time. Styles, moods and collections are your Hub’s; ratings and plays are your own on Navidrome.</p>
        {buttons}
      </form>
    );
  }
  return (
    <form className="editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {mode}
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
      {hubTags && (
        <div className="editor-grid">
          <HubTagLists />
          {list('styles', 'Styles (any of)', 'tag-styles', 'Southern Rap')}
          {list('tagMoods', 'Moods (any of)', 'tag-moods', 'Laid-Back/Mellow')}
          {list('collections', 'In collection', 'tag-collections', 'Christmas')}
          {list('notCollections', 'Leave out collection', 'tag-collections', 'Christmas')}
        </div>
      )}
      {sound}
      <label className="check"><span className="switch"><input type="checkbox" checked={p.starred} onChange={(e) => setP({ ...p, starred: e.target.checked })} /><span /></span> Only songs I ♥</label>
      <p className="muted small">Genres match your tags, so tidy genres (Settings → Server → Genres) make these work best. Styles, moods and collections are your Hub’s (Edit album, or Import from Plex); with any of them, songs come from the albums that fit. Ratings and plays are your own on Navidrome.</p>
      {buttons}
    </form>
  );
}
