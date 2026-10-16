import { useEffect, useRef, useState } from 'react';
import { matchAll } from '../lib/match';
import { sourceFor } from '../sources/registry';
import { SOURCE_COLORS, type ServerPlaylist, type Track } from '../sources/types';
import { canSave, useLibrary } from '../store/library';
import { useServerPlaylists } from '../store/serverPlaylists';
import { useSettings } from '../store/settings';
import { IconPlus } from './Icons';

/**
 * "+ Playlist" button. Lists Wavelength playlists (any source mixed) and the playlists on
 * Navidrome / Plex — adding to a server playlist matches tracks onto that server.
 */
export function AddToPlaylist({ tracks, label = 'Playlist', className = 'chip' }: { tracks: Track[] | (() => Track[]); label?: string; className?: string }) {
  const { playlists, addToPlaylist, createPlaylist } = useLibrary();
  const server = useServerPlaylists();
  const sources = useSettings((s) => s.sources);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [flash, setFlash] = useState<string>();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!Object.keys(server.bySource).length && !server.loading) server.load();
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const resolve = () => (typeof tracks === 'function' ? tracks() : tracks).filter(canSave);
  const done = (msg: string, ms = 1600) => {
    setOpen(false);
    setName('');
    setFlash(msg);
    window.setTimeout(() => setFlash(undefined), ms);
  };

  const addToServer = async (p: ServerPlaylist) => {
    const cfg = sources.find((s) => s.id === p.sourceId);
    if (!cfg) return;
    const src = sourceFor(cfg);
    setOpen(false);
    setFlash('Matching…');
    try {
      const { ids, missing } = await matchAll(src, resolve());
      if (ids.length) await src.addToPlaylist!(p.id, ids);
      done(missing.length ? `Added ${ids.length}, ${missing.length} not on ${cfg.name}` : `Added ${ids.length}`, 2800);
      server.load();
    } catch (e) {
      done(`Failed: ${(e as Error).message ?? e}`, 4000);
    }
  };

  const serverGroups = sources
    .filter((s) => s.enabled && server.bySource[s.id]?.some((p) => !p.readOnly))
    .map((s) => ({ cfg: s, lists: server.bySource[s.id].filter((p) => !p.readOnly) }));

  return (
    <div className={`menu-wrap ${open ? 'open' : ''}`} ref={ref} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={className} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} title="Add to playlist">
        <IconPlus /> {flash ?? label}
      </button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const t = resolve();
            if (!t.length) return;
            createPlaylist(name || 'New playlist', t);
            done('Added');
          }}>
            <input autoFocus placeholder="New Wavelength playlist…" value={name} onChange={(e) => setName(e.target.value)} />
          </form>
          {playlists.length > 0 && <div className="menu-group">Wavelength · any source</div>}
          {playlists.map((p) => (
            <button key={p.id} className="menu-item" onClick={() => {
              addToPlaylist(p.id, resolve());
              done('Added');
            }}>
              {p.name} <small>{p.tracks.length}</small>
            </button>
          ))}
          {serverGroups.map(({ cfg, lists }) => (
            <div key={cfg.id}>
              <div className="menu-group"><i className="dot" style={{ background: SOURCE_COLORS[cfg.kind] }} /> {cfg.name}</div>
              {lists.map((p) => (
                <button key={p.id} className="menu-item" onClick={() => addToServer(p)}>
                  {p.name} <small>{p.trackCount ?? ''}</small>
                </button>
              ))}
            </div>
          ))}
          {server.loading && <div className="menu-hint">Loading server playlists…</div>}
          {!playlists.length && !serverGroups.length && !server.loading && <div className="menu-hint">Type a name and press Enter</div>}
        </div>
      )}
    </div>
  );
}
