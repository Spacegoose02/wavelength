import { useEffect, useRef, useState, type FormEvent } from 'react';
import { artworkOn, readImageFile, resetArtwork, setArtwork, useArtworkList } from '../lib/artwork';
import type { HubArtCandidate, HubArtwork } from '../sources/hub';
import { hubClient, useHub } from '../store/hub';
import { Spinner } from './common';

/**
 * Admin button on album and artist pages: pick a new picture on the Hub for every device. Only shown to Hub
 * admins (`library.edit`); the Hub refuses the change from anyone else.
 */
export function ArtworkButton({ kind, artist, album = '', current }: { kind: HubArtwork['kind']; artist: string; album?: string; current?: string }) {
  const can = useHub((s) => !!s.token && s.permissions.includes('library.edit'));
  const [open, setOpen] = useState(false);
  if (!can || !artist || (kind === 'album' && !album)) return null;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} title="Pick a new picture for everyone on your Hub">
        {kind === 'album' ? 'Change cover' : 'Change picture'}
      </button>
      {open && <ArtworkPicker kind={kind} artist={artist} album={album} current={current} onClose={() => setOpen(false)} />}
    </>
  );
}

function ArtworkPicker({ kind, artist, album, current, onClose }: { kind: HubArtwork['kind']; artist: string; album: string; current?: string; onClose(): void }) {
  useArtworkList();
  const set = artworkOn(kind, artist, album);
  const [qArtist, setQArtist] = useState(artist);
  const [qAlbum, setQAlbum] = useState(album);
  const [found, setFound] = useState<HubArtCandidate[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setFound(null);
    setErr('');
    try {
      const r = await hubClient()!.findArt(kind, qArtist.trim(), qAlbum.trim());
      setFound(r.candidates);
      setFailed(r.failed);
    } catch (x) {
      setFound([]);
      setErr(String((x as Error).message ?? x));
    }
  };
  useEffect(() => {
    search();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  // saved under the name the library uses, whatever was typed into the search
  const save = async (what: string, b: { url: string; source?: string } | { image: string }) => {
    setBusy(what);
    setErr('');
    try {
      await setArtwork({ kind, artist, album: kind === 'album' ? album : undefined, ...b });
      onClose();
    } catch (x) {
      setErr(String((x as Error).message ?? x));
    } finally {
      setBusy(undefined);
    }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return setErr('That image is bigger than 15 MB');
    save('upload', { image: await readImageFile(f) });
  };
  const reset = async () => {
    setBusy('reset');
    try {
      await resetArtwork(kind, artist, album);
      onClose();
    } catch (x) {
      setErr(String((x as Error).message ?? x));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="pin-backdrop" onClick={onClose}>
      <div className="art-dialog" role="dialog" aria-label={kind === 'album' ? 'Change cover' : 'Change picture'} onClick={(e) => e.stopPropagation()}>
        <header className="art-head">
          {current && <img className={`art-now ${kind === 'artist' ? 'round' : ''}`} src={current} alt="" />}
          <div>
            <h3>{kind === 'album' ? `Cover for ${album}` : `Picture for ${artist}`}</h3>
            <p className="muted small">Saved on your Hub. Everyone sees it on every device; your music files aren't changed.</p>
          </div>
        </header>

        <form className="art-search" onSubmit={search}>
          <input value={qArtist} onChange={(e) => setQArtist(e.target.value)} placeholder="Artist" aria-label="Artist" />
          {kind === 'album' && <input value={qAlbum} onChange={(e) => setQAlbum(e.target.value)} placeholder="Album" aria-label="Album" />}
          <button className="btn">Search</button>
        </form>

        <div className="art-results">
          {!found ? <Spinner /> : !found.length ? (
            <p className="muted small">Nothing found. Try a shorter name, paste an image link, or upload a picture.</p>
          ) : found.map((c) => (
            <button key={c.url} className="art-pick" disabled={!!busy} onClick={() => save(c.url, { url: c.url, source: c.source })} title={`Use this picture (${c.source})`}>
              <img src={c.thumb} alt="" loading="lazy" className={kind === 'artist' ? 'round' : ''} onError={(e) => ((e.currentTarget.closest('.art-pick') as HTMLElement).hidden = true)} />
              {busy === c.url && <span className="cover-overlay"><Spinner /></span>}
              <span className="art-source">{c.source}</span>
              <span className="art-title">{c.title}</span>
              {c.subtitle && <span className="art-sub">{c.subtitle}</span>}
            </button>
          ))}
        </div>
        {failed.length > 0 && <p className="muted small">Couldn't reach {failed.join(', ')} just now.</p>}

        <form className="art-search" onSubmit={(e) => { e.preventDefault(); if (link.trim()) save('link', { url: link.trim() }); }}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste an image link" aria-label="Image link" />
          <button className="btn" disabled={!link.trim() || !!busy}>{busy === 'link' ? '…' : 'Use link'}</button>
        </form>
        {err && <div className="card-err small">{err}</div>}

        <div className="row gap art-foot">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}>{busy === 'upload' ? '…' : 'Upload a picture'}</button>
          {set && <button className="btn" disabled={!!busy} onClick={reset} title={`Set by ${set.setBy ?? 'an admin'} (${set.source})`}>{busy === 'reset' ? '…' : "Use the server's picture"}</button>}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
