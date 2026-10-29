import { useState, type ReactNode } from 'react';
import { useSettings } from '../store/settings';
import { SOURCE_COLORS, type Album, type Artist, type Track } from '../sources/types';
import { explicitOfAlbum, explicitOfTrack, useHidden, useRatings } from '../lib/kids';
import { albumArt, artistArt, trackArt, useArtworkList } from '../lib/artwork';
import { KidFlagButton } from './KidFlag';
import { usePlayer } from '../store/player';
import { IconMore, IconPlay } from './Icons';
import { useIsPhone } from '../lib/platform';
import { AddToPlaylist } from './AddToPlaylist';
import { FavButton, QueueOnSubwave } from './TrackButtons';
import { ShareButton } from './ShareButton';
import { shareOfTracks } from '../lib/inbox';

export function fmtTime(s?: number) {
  if (!s || !Number.isFinite(s)) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function Cover({ src, alt, round, className }: { src?: string; alt: string; round?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = String(alt ?? '').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={`cover ${round ? 'round' : ''} ${className ?? ''}`}>
      {src && !failed ? <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} /> : <span>{initials || '♪'}</span>}
    </div>
  );
}

export function SourceDots({ sourceIds }: { sourceIds: string[] }) {
  const sources = useSettings((s) => s.sources);
  return (
    <span className="source-dots">
      {[...new Set(sourceIds)].map((id) => {
        const cfg = sources.find((s) => s.id === id);
        const kind = cfg?.kind ?? 'radio';
        return <i key={id} title={cfg?.name ?? 'Radio'} style={{ background: SOURCE_COLORS[kind] }} />;
      })}
    </span>
  );
}

/** "E" for explicit, "C" for a clean version, from the server's tags or Deezer. */
export function Rating({ explicit }: { explicit?: 'explicit' | 'clean' | boolean }) {
  if (explicit === 'explicit' || explicit === true) return <span className="rating" title="Explicit">E</span>;
  if (explicit === 'clean') return <span className="rating clean" title="Clean version">C</span>;
  return null;
}

export function AlbumCard({ album, onOpen }: { album: Album; onOpen(a: Album): void }) {
  const hidden = useHidden();
  useRatings((s) => s.ratings);
  useArtworkList();
  if (hidden.album(album)) return null;
  return (
    <button className="card" onClick={() => onOpen(album)}>
      <Cover src={albumArt(album)} alt={album.title} />
      <div className="card-title" title={album.title}><Rating explicit={explicitOfAlbum(album)} />{album.title}</div>
      <div className="card-sub">
        <SourceDots sourceIds={(album.refs ?? [album]).map((r) => r.sourceId)} />
        <span>{album.artist}{album.year ? ` · ${album.year}` : ''}</span>
      </div>
    </button>
  );
}

export function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen(a: Artist): void }) {
  const hidden = useHidden();
  useArtworkList();
  if (hidden.artist(artist)) return null;
  return (
    <button className="card" onClick={() => onOpen(artist)}>
      <Cover src={artistArt(artist)} alt={artist.name} round />
      <div className="card-title center">{artist.name}</div>
      <div className="card-sub center"><SourceDots sourceIds={(artist.refs ?? [artist]).map((r) => r.sourceId)} /></div>
    </button>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid">{children}</div>;
}

interface TrackListProps {
  tracks: Track[];
  showAlbum?: boolean;
  showCover?: boolean;
  /** Extra right-hand column (e.g. "played 2h ago", episode date). */
  meta?: (t: Track, i: number) => ReactNode;
  /** Second line override (e.g. episode description). */
  sub?: (t: Track) => ReactNode;
  onRemove?: (i: number) => void;
  onMove?: (i: number, to: number) => void;
}

export function TrackList({ tracks, showAlbum, showCover, meta, sub, onRemove, onMove }: TrackListProps) {
  const phone = useIsPhone();
  const [openRow, setOpenRow] = useState<number | null>(null);
  const playTracks = usePlayer((s) => s.playTracks);
  const playNext = usePlayer((s) => s.playNext);
  const enqueue = usePlayer((s) => s.enqueue);
  const current = usePlayer((s) => s.queue[s.index]);
  const hidden = useHidden();
  useRatings((s) => s.ratings);
  useArtworkList();
  return (
    <div className="tracklist">
      {tracks.map((t, i) => hidden.track(t) ? null : (
        <div key={`${i}:${t.sourceId}:${t.id}`} className={`track-row ${current?.id === t.id && current.sourceId === t.sourceId ? 'active' : ''} ${openRow === i ? 'open' : ''}`}
          onDoubleClick={() => playTracks(tracks, i)}
          // phones: tap the row to play; the ⋯ button reveals the actions
          onClick={phone ? (e) => !(e.target as HTMLElement).closest('button, .menu') && playTracks(tracks, i) : undefined}>
          <button className="track-num" onClick={() => playTracks(tracks, i)} title="Play">
            <span>{showCover ? '' : t.trackNumber ?? i + 1}</span>
            {showCover && <Cover src={trackArt(t)} alt={t.title} className="tiny" />}
            <IconPlay className="hover-play" />
          </button>
          <div className="track-main">
            <div className="track-title"><Rating explicit={explicitOfTrack(t)} />{t.title}</div>
            <div className="track-sub">{sub ? sub(t) : <>{t.artist}{showAlbum && t.album ? ` — ${t.album}` : ''}</>}</div>
            {t.progress ? <div className="progress thin"><i style={{ width: `${Math.round(t.progress * 100)}%` }} /></div> : null}
          </div>
          <SourceDots sourceIds={[t.sourceId]} />
          <div className="track-actions">
            {onMove && <button className="chip" disabled={i === 0} onClick={() => onMove(i, i - 1)} title="Move up">▲</button>}
            {onMove && <button className="chip" disabled={i === tracks.length - 1} onClick={() => onMove(i, i + 1)} title="Move down">▼</button>}
            <button className="chip" onClick={() => playNext([t])}>Next</button>
            <button className="chip" onClick={() => enqueue([t])}>+ Queue</button>
            {t.kind !== 'book' && <AddToPlaylist tracks={[t]} />}
            <QueueOnSubwave track={t} />
            {t.kind === 'track' && <KidFlagButton kind="track" artist={t.artist} title={t.title} explicit={explicitOfTrack(t) === 'explicit'} className="chip" />}
            {t.kind === 'track' && <ShareButton what={() => shareOfTracks('track', t.title, [t], [t.artist, t.album].filter(Boolean).join(' — '))} className="chip" />}
            {onRemove && <button className="chip" onClick={() => onRemove(i)} title="Remove from playlist">✕</button>}
          </div>
          <FavButton key={`${t.sourceId}:${t.id}:${t.starred}`} track={t} />
          {meta && <div className="track-meta">{meta(t, i)}</div>}
          <button className="icon-btn more-btn" title="More" onClick={(e) => { e.stopPropagation(); setOpenRow(openRow === i ? null : i); }}><IconMore /></button>
          <div className="track-time">{t.kind === 'radio' ? 'LIVE' : fmtTime(t.duration)}</div>
        </div>
      ))}
    </div>
  );
}

export function timeAgo(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}
