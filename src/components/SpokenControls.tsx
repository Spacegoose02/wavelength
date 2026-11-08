import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePlayer, seekBook } from '../store/player';
import { SKIP_BACK, SKIP_FORWARD, SPEEDS, bookPosition, chapterAt, speedFor, speedLabel, useSpoken } from '../lib/spoken';
import type { Track } from '../sources/types';
import { fmtTime } from './common';

/** A chip that opens a small panel under it, closing on a click outside or Escape (like the sleep timer). */
function Pop({ label, title, on, children }: { label: string; title: string; on?: boolean; children(close: () => void): ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="eq-anchor" ref={ref}>
      <button className={`chip ${on ? 'on' : ''}`} onClick={() => setOpen(!open)} title={title} aria-expanded={open}>{label}</button>
      {open && <div className="eq-pop sleep-pop" role="dialog" aria-label={title}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** Now Playing: playback speed for this book or show (lib/spoken.ts). */
export function SpeedButton({ track }: { track: Track }) {
  useSpoken((s) => s.speeds); // re-render when it changes
  const speed = speedFor(track);
  return (
    <Pop label={speedLabel(speed)} title="Playback speed" on={speed !== 1}>
      {(close) => (
        <>
          <div className="np-kicker">Speed for {track.kind === 'episode' ? 'this show' : 'this book'}</div>
          <div className="chips">
            {SPEEDS.map((s) => (
              <button key={s} className={`chip ${s === speed ? 'on' : ''}`} onClick={() => { useSpoken.getState().setSpeed(track, s); close(); }}>{speedLabel(s)}</button>
            ))}
          </div>
        </>
      )}
    </Pop>
  );
}

/** Now Playing: the book's or episode's chapters; the one playing is marked, a tap goes to one. */
export function ChaptersButton({ track }: { track: Track }) {
  const position = usePlayer((s) => s.position);
  const chapters = track.chapters;
  if (!chapters?.length) return null;
  const now = chapterAt(chapters, bookPosition(track, position));
  return (
    <Pop label={now ? `Chapter ${now.index + 1}/${chapters.length}` : 'Chapters'} title="Chapters">
      {(close) => (
        <div className="chapter-list">
          {chapters.map((c, i) => (
            <button key={`${i}:${c.start}`} className={`chapter-row ${now?.index === i ? 'on' : ''}`} onClick={() => { seekBook(c.start); close(); }}>
              <span>{c.title}</span>
              <small className="muted">{fmtTime(c.start)}</small>
            </button>
          ))}
        </div>
      )}
    </Pop>
  );
}

/** Transport buttons for spoken word: 15 s back, 30 s on. */
export function SkipButton({ back }: { back?: boolean }) {
  const s = back ? SKIP_BACK : SKIP_FORWARD;
  return (
    <button className="tbtn small skip-btn" onClick={() => usePlayer.getState().skipBy(back ? -s : s)} aria-label={back ? `Back ${s} seconds` : `Forward ${s} seconds`} title={back ? `Back ${s} s` : `Forward ${s} s`}>
      {back ? `−${s}` : `+${s}`}
    </button>
  );
}
