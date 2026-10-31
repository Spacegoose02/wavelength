import { useEffect, useMemo, useRef, useState } from 'react';
import { trackArt } from '../lib/artwork';
import { imageFromLink, mosaicOf, resetPlaylistCover, setPlaylistCover, squareImage, usePlaylistCover } from '../lib/playlistCovers';
import type { Track } from '../sources/types';
import { useHub } from '../store/hub';
import { Cover, Spinner } from './common';

/**
 * A playlist's picture: the one someone picked, else (with `tracks`) a mosaic of its first four albums, else
 * the server's own cover (`fallback`).
 */
export function PlaylistArt({ coverKey, name, tracks, fallback, className }: { coverKey?: string; name: string; tracks?: Track[]; fallback?: string; className?: string }) {
  const picked = usePlaylistCover(coverKey);
  const mosaic = useMemo(() => (tracks ? mosaicOf(tracks) : []), [tracks]);
  if (picked) return <Cover src={picked} alt={name} className={className} />;
  if (mosaic.length === 4) {
    return (
      <div className={`cover mosaic ${className ?? ''}`}>
        {mosaic.map((c) => <img key={c} src={c} alt="" loading="lazy" />)}
      </div>
    );
  }
  return <Cover src={mosaic[0] ?? fallback} alt={name} className={className} />;
}

/** "Change cover" on a playlist page. `auto` says what shows with no picture: the mosaic or the server's cover. */
export function PlaylistCoverButton({ coverKey, name, tracks, auto }: { coverKey?: string; name: string; tracks?: Track[]; auto: 'mosaic' | 'server' }) {
  const [open, setOpen] = useState(false);
  if (!coverKey) return null;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} title="Pick a picture for this playlist">Change cover</button>
      {open && <CoverPicker coverKey={coverKey} name={name} tracks={tracks ?? []} auto={auto} onClose={() => setOpen(false)} />}
    </>
  );
}

function CoverPicker({ coverKey, name, tracks, auto, onClose }: { coverKey: string; name: string; tracks: Track[]; auto: 'mosaic' | 'server'; onClose(): void }) {
  const picked = usePlaylistCover(coverKey);
  const onHub = useHub((s) => !!s.token);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);

  // one picture per album in the playlist, in playlist order
  const albums = useMemo(() => {
    const seen = new Set<string>();
    const out: { art: string; title: string; artist: string }[] = [];
    for (const t of tracks) {
      const art = trackArt(t);
      const id = `${t.artist}|${t.album ?? t.title}`.toLowerCase();
      if (!art || seen.has(id) || out.some((a) => a.art === art)) continue;
      seen.add(id);
      out.push({ art, title: t.album || t.title, artist: t.artist });
      if (out.length === 24) break;
    }
    return out;
  }, [tracks]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setErr('');
    try {
      await fn();
      onClose();
    } catch (x) {
      setErr(String((x as Error).message ?? x));
    } finally {
      setBusy(undefined);
    }
  };
  const fromLink = (what: string, url: string) => run(what, async () => setPlaylistCover(coverKey, await imageFromLink(url)));
  const upload = (f?: File) => {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return setErr('That image is bigger than 15 MB');
    run('upload', async () => setPlaylistCover(coverKey, await squareImage(f)));
  };

  return (
    <div className="pin-backdrop" onClick={onClose}>
      <div className="art-dialog" role="dialog" aria-label="Change cover" onClick={(e) => e.stopPropagation()}>
        <header className="art-head">
          <PlaylistArt coverKey={coverKey} name={name} tracks={tracks} className="art-now" />
          <div>
            <h3>Cover for {name}</h3>
            <p className="muted small">
              {onHub ? 'Saved on your Hub, so it shows on all your devices.' : 'Saved on this device. Sign in to a Hub to see it everywhere.'}
              {auto === 'server' && ' Other apps on the server keep their own cover.'}
            </p>
          </div>
        </header>

        {albums.length > 0 && (
          <>
            <div className="small muted">From this playlist</div>
            <div className="art-results">
              {albums.map((a) => (
                <button key={a.art} className="art-pick" disabled={!!busy} onClick={() => fromLink(a.art, a.art)} title="Use this picture">
                  <img src={a.art} alt="" loading="lazy" onError={(e) => ((e.currentTarget.closest('.art-pick') as HTMLElement).hidden = true)} />
                  {busy === a.art && <span className="cover-overlay"><Spinner /></span>}
                  <span className="art-title">{a.title}</span>
                  <span className="art-sub">{a.artist}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <form className="art-search" onSubmit={(e) => { e.preventDefault(); if (link.trim()) fromLink('link', link.trim()); }}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste an image link" aria-label="Image link" />
          <button className="btn" disabled={!link.trim() || !!busy}>{busy === 'link' ? '…' : 'Use link'}</button>
        </form>
        {err && <div className="card-err small">{err}</div>}

        <div className="row gap art-foot">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn primary" disabled={!!busy} onClick={() => file.current?.click()}>{busy === 'upload' ? '…' : 'Upload a picture'}</button>
          {picked && (
            <button className="btn" disabled={!!busy} onClick={() => run('reset', () => resetPlaylistCover(coverKey))}>
              {busy === 'reset' ? '…' : auto === 'mosaic' ? 'Use the automatic cover' : "Use the server's cover"}
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
