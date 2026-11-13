import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { PlayedButton } from './PlayedButton';
import { EpisodeVideoChip } from './VideoButton';
import { useSettings } from '../store/settings';
import { SOURCE_COLORS, type Album, type Artist, type Track } from '../sources/types';
import { explicitOfAlbum, explicitOfTrack, trackVersion, useHidden, useRatings } from '../lib/kids';
import { albumArt, artistArt, trackArt, useArtworkList } from '../lib/artwork';
import { cleanSide, useVersionHidden } from '../lib/versions';
import { KidFlagButton } from './KidFlag';
import { usePlayer } from '../store/player';
import { IconMore, IconPlay } from './Icons';
import { useIsPhone } from '../lib/platform';
import { AddToPlaylist } from './AddToPlaylist';
import { FavButton, QueueOnSubwave } from './TrackButtons';
import { ShareButton } from './ShareButton';
import { shareOfTracks } from '../lib/inbox';
import { albumOfTrack, artistOfTrack, creditLinks, focusIndex, isLibraryTrack } from '../lib/trackLinks';
import { useCatalog } from '../store/catalog';
import { openTrackMenu } from './TrackMenu';
import { discHeading, hasDiscs } from '../lib/discs';
import { EditSongButton } from './EditSong';
import { useUi } from '../store/ui';
import { tidyCredit } from '../lib/songIssues';

export function fmtTime(s?: number) {
  if (!s || !Number.isFinite(s)) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function Cover({ src, alt, round, className }: { src?: string; alt: string; round?: boolean; className?: string }) {
  // the picture that failed to load: a new picture for the same card gets its own try
  const [failed, setFailed] = useState<string>();
  const initials = String(alt ?? '').replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className={`cover ${round ? 'round' : ''} ${className ?? ''}`}>
      {src && failed !== src ? <img src={src} alt={alt} loading="lazy" onError={() => setFailed(src)} /> : <span>{initials || '♪'}</span>}
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

/** A card's selection state (components/Selection.tsx). `selected` undefined = not selecting, so a tap opens it. */
interface Pickable<T> {
  onOpen(x: T, e?: MouseEvent): void;
  selected?: boolean;
  /** "Merge target" on the first card ticked. */
  badge?: string;
  /** Shows a round tick on hover that starts selecting with this card (Plex-style). */
  onPick?(x: T, e?: MouseEvent): void;
}

function PickMarks<T>({ x, selected, badge, onPick }: Omit<Pickable<T>, 'onOpen'> & { x: T }) {
  return (
    <>
      {selected !== undefined
        ? <input type="checkbox" className="card-check" checked={selected} readOnly tabIndex={-1} aria-hidden />
        : onPick && <span className="card-pick" role="checkbox" aria-checked={false} aria-label="Select" title="Select"
          onClick={(e) => { e.stopPropagation(); onPick(x, e); }} />}
      {badge && <span className="card-badge">{badge}</span>}
    </>
  );
}

const cardClass = (selected?: boolean, pickable?: boolean) =>
  `card ${selected !== undefined || pickable ? 'selectable' : ''} ${selected ? 'selected' : ''}`;

/** `selected`: the card is in a list being picked from (Albums → Select); tapping it ticks it instead of opening it. */
export function AlbumCard({ album, onOpen, selected, badge, onPick }: { album: Album } & Pickable<Album>) {
  const hidden = useHidden();
  const otherVersion = useVersionHidden();
  useRatings((s) => s.ratings);
  useArtworkList();
  if (hidden.album(cleanSide(album)) || otherVersion(album)) return null;
  return (
    <button className={cardClass(selected, !!onPick)} onClick={(e) => onOpen(album, e)} aria-pressed={selected}>
      <PickMarks x={album} selected={selected} badge={badge} onPick={onPick} />
      <Cover src={albumArt(album)} alt={album.title} />
      <div className="card-title" title={album.title}><Rating explicit={explicitOfAlbum(album)} />{album.title}</div>
      <div className="card-sub">
        <SourceDots sourceIds={(album.refs ?? [album]).map((r) => r.sourceId)} />
        <span>{album.artist}{album.year ? ` · ${album.year}` : ''}</span>
      </div>
    </button>
  );
}

export function ArtistCard({ artist, onOpen, selected, badge, onPick }: { artist: Artist } & Pickable<Artist>) {
  const hidden = useHidden();
  useArtworkList();
  if (hidden.artist(artist)) return null;
  return (
    <button className={cardClass(selected, !!onPick)} onClick={(e) => onOpen(artist, e)} aria-pressed={selected}>
      <PickMarks x={artist} selected={selected} badge={badge} onPick={onPick} />
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
  /** A song to scroll to and flash once (Now Playing's song title link); matched by id, else by title. */
  focus?: { id: string; sourceId: string; title?: string };
  /**
   * For long lists (Favorites): draw the first rows, and more as the list is scrolled to its end, instead of every
   * row at once. Playing a row still plays from the whole list.
   */
  grow?: boolean;
  /** An album's songs: head each disc with "Disc N" when the album has more than one (lib/discs.ts). */
  discs?: boolean;
}

/** Rows a growing TrackList draws at first, and adds each time its end comes into view. */
export const GROW_ROWS = 100;

export function TrackList({ tracks, showAlbum, showCover, meta, sub, onRemove, onMove, focus, grow, discs }: TrackListProps) {
  const phone = useIsPhone();
  const byDisc = !!discs && hasDiscs(tracks);
  const focusIdx = focusIndex(tracks, focus);
  const [rows, setRows] = useState(GROW_ROWS);
  const shown = grow ? Math.max(rows, focusIdx + 1) : tracks.length;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) setRows((n) => n + GROW_ROWS);
    }, { rootMargin: '600px' });
    seen.observe(end);
    return () => seen.disconnect();
  }, [shown, tracks.length]);
  const focusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // braces, not an expression body: newer Chromium (WebView2, so the Windows app) has scrollIntoView return a
    // Promise, and React calls whatever an effect returns as its cleanup, which threw and blanked the app on Back
    focusRef.current?.scrollIntoView({ block: 'center' });
  }, [focusIdx]);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const playTracks = usePlayer((s) => s.playTracks);
  const playNext = usePlayer((s) => s.playNext);
  const enqueue = usePlayer((s) => s.enqueue);
  const current = usePlayer((s) => s.queue[s.index]);
  const hidden = useHidden();
  useRatings((s) => s.ratings);
  useArtworkList();
  let lastShown: Track | undefined;
  return (
    <div className="tracklist">
      {(shown < tracks.length ? tracks.slice(0, shown) : tracks).map((t, i) => {
        if (hidden.track(t)) return null;
        // the disc heading goes over the first song shown from each disc (a hidden song can start one)
        const disc = byDisc ? discHeading(t, lastShown) : undefined;
        lastShown = t;
        return (
          <Fragment key={`${i}:${t.sourceId}:${t.id}`}>
            {disc !== undefined && <h3 className="disc-heading">Disc {disc}</h3>}
            <div ref={i === focusIdx ? focusRef : undefined}
              className={`track-row ${current?.id === t.id && current.sourceId === t.sourceId ? 'active' : ''} ${openRow === i ? 'open' : ''} ${i === focusIdx ? 'focus' : ''}`}
              onDoubleClick={() => playTracks(tracks, i)}
              onContextMenu={(e) => openTrackMenu(e, t, tracks, i)}
              // phones: tap the row to play; the ⋯ button reveals the actions
              onClick={phone ? (e) => !(e.target as HTMLElement).closest('button, .menu') && playTracks(tracks, i) : undefined}>
              <button className="track-num" onClick={() => playTracks(tracks, i)} title="Play">
                <span>{showCover ? '' : t.trackNumber ?? i + 1}</span>
                {showCover && <Cover src={trackArt(t)} alt={t.title} className="tiny" />}
                <IconPlay className="hover-play" />
              </button>
              <div className="track-main">
                <div className="track-title"><Rating explicit={explicitOfTrack(t)} />{t.title}</div>
                <div className="track-sub">{sub ? sub(t) : <TrackSub track={t} showAlbum={showAlbum} />}</div>
                {t.progress && t.progress < 1 ? <div className="progress thin"><i style={{ width: `${Math.round(t.progress * 100)}%` }} /></div> : null}
              </div>
              <SourceDots sourceIds={[t.sourceId]} />
              <div className="track-actions">
                {onMove && <button className="chip" disabled={i === 0} onClick={() => onMove(i, i - 1)} title="Move up">▲</button>}
                {onMove && <button className="chip" disabled={i === tracks.length - 1} onClick={() => onMove(i, i + 1)} title="Move down">▼</button>}
                <button className="chip" onClick={() => playNext([t])}>Next</button>
                <button className="chip" onClick={() => enqueue([t])}>+ Queue</button>
                {t.kind !== 'book' && <AddToPlaylist tracks={[t]} />}
                {t.kind === 'episode' && <PlayedButton track={t} />}
                {t.kind === 'episode' && <EpisodeVideoChip track={t} />}
                <QueueOnSubwave track={t} />
                {t.kind === 'track' && <KidFlagButton kind="track" artist={t.artist} title={t.title} version={trackVersion(t)} explicit={explicitOfTrack(t) === 'explicit'} className="chip" />}
                {t.kind === 'track' && <ShareButton what={() => shareOfTracks('track', t.title, [t], [t.artist, t.album].filter(Boolean).join(' — '))} className="chip" />}
                <EditSongButton track={t} />
                {onRemove && <button className="chip" onClick={() => onRemove(i)} title="Remove from playlist">✕</button>}
              </div>
              <FavButton key={`${t.sourceId}:${t.id}:${t.starred}`} track={t} />
              {meta && <div className="track-meta">{meta(t, i)}</div>}
              <button className="icon-btn more-btn" title="More" onClick={(e) => { e.stopPropagation(); setOpenRow(openRow === i ? null : i); }}><IconMore /></button>
              <div className="track-time">{t.kind === 'radio' ? 'LIVE' : fmtTime(t.duration)}</div>
            </div>
          </Fragment>
        );
      })}
      {shown < tracks.length && (
        <div ref={endRef} className="row center muted small" style={{ padding: 12 }}>
          <button className="btn" onClick={() => setRows((n) => n + GROW_ROWS)}>Show more ({tracks.length - shown} left)</button>
        </div>
      )}
    </div>
  );
}

/**
 * A song row's "Artist — Album" line, each a link to its library page when the library has it. The album link
 * opens the album scrolled to the song.
 */
function TrackSub({ track: t, showAlbum }: { track: Track; showAlbum?: boolean }) {
  const albums = useCatalog((s) => s.albums);
  const artists = useCatalog((s) => s.artists);
  const album = showAlbum && t.album ? albumOfTrack(t, albums) : undefined;
  const artist = artistOfTrack(t, artists, album);
  const go = useUi.getState().go;
  return (
    <>
      <ArtistCredit credit={t.artist} fallback={artist} linkClass="sub-link" links={isLibraryTrack(t)} discography="several" />
      {showAlbum && t.album ? <>{' — '}{album
        ? <button className="sub-link" title="Go to album" onClick={() => go({ view: 'album', album, track: { id: t.id, sourceId: t.sourceId, title: t.title } })}>{t.album}</button>
        : t.album}</> : null}
    </>
  );
}

/**
 * An artist credit with each artist its own link: "Future feat. Drake; Travis Scott" is three links, to Future's,
 * Drake's and Travis Scott's library pages (lib/trackLinks.ts creditLinks). An artist the library doesn't have opens
 * their Deezer releases when `discography` says so: "all" always, "several" only in a credit naming more than one
 * artist (a featured artist with no album of their own). When no name is a library artist, `fallback` (the
 * song's or album's artist, found another way) links the whole credit. `links` false shows plain text.
 */
export function ArtistCredit({ credit: raw, fallback, linkClass, links = true, discography, stop }: {
  credit: string;
  fallback?: Artist;
  linkClass: string;
  links?: boolean;
  discography?: 'all' | 'several';
  /** Keep the click from reaching the row around the link. */
  stop?: boolean;
}) {
  const artists = useCatalog((s) => s.artists);
  // a raw "A;B" tag (a song saved before its server tidied it, or one from elsewhere) shows as "A feat. B"
  const credit = raw && /[;；]/.test(raw) ? tidyCredit(raw) : raw;
  if (!links || !credit) return <>{credit}</>;
  const parts = creditLinks(credit, artists);
  const go = (e: MouseEvent, artist: Artist, deezer?: boolean) => {
    if (stop) e.stopPropagation();
    useUi.getState().go(deezer ? { view: 'artistReleases', artist } : { view: 'artist', artist });
  };
  const named = parts.filter((p) => p.name).length;
  if (fallback && !parts.some((p) => p.artist)) {
    return <button className={linkClass} title="Go to artist" onClick={(e) => go(e, fallback)}>{credit}</button>;
  }
  const deezer = discography === 'all' || (discography === 'several' && named > 1);
  return (
    <>
      {parts.map((p, i) => p.artist
        ? <button key={i} className={linkClass} title={`Go to ${p.name}`} onClick={(e) => go(e, p.artist!)}>{p.text.trim()}</button>
        : p.name && deezer
          ? <button key={i} className={linkClass} title={`${p.name}'s releases`} onClick={(e) => go(e, { id: '', sourceId: '', name: p.name! }, true)}>{p.text.trim()}</button>
          : <Fragment key={i}>{p.text}</Fragment>)}
    </>
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
