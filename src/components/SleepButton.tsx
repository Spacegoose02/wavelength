import { useEffect, useRef, useState } from 'react';
import { SLEEP_CHOICES, sleepLeft, useSleep } from '../lib/sleep';
import { usePlayer } from '../store/player';
import { isSpoken } from '../lib/spoken';

/** Now Playing: set or cancel the sleep timer (lib/sleep.ts). Shows the time left while it runs. */
export function SleepButton({ className = 'chip' }: { className?: string }) {
  const { endsAt, endOfTrack, chapterEnd, start, cancel } = useSleep();
  const cur = usePlayer((s) => s.queue[s.index]);
  const spoken = isSpoken(cur);
  // the chapter choice only where there are chapters; the end of a file is "this episode" for a podcast
  const choices = [
    ...SLEEP_CHOICES.map((c) => (c.value === 'track' && spoken ? { ...c, label: cur?.kind === 'episode' ? 'End of this episode' : 'End of this part' } : c)),
    ...(spoken && cur?.chapters?.length ? [{ value: 'chapter' as const, label: 'End of this chapter' }] : []),
  ];
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const on = !!endsAt || endOfTrack || chapterEnd !== undefined;

  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);

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

  const label = endsAt ? `Sleep ${sleepLeft(endsAt)}` : chapterEnd !== undefined ? 'Sleep after this chapter' : endOfTrack ? (spoken ? 'Sleep after this part' : 'Sleep after this song') : 'Sleep';
  return (
    <div className="eq-anchor" ref={ref}>
      <button className={`${className} ${on ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Sleep timer">{label}</button>
      {open && (
        <div className="eq-pop sleep-pop" role="dialog" aria-label="Sleep timer">
          <div className="np-kicker">Stop playing after</div>
          <div className="chips">
            {choices.map((c) => (
              <button key={c.label} className="chip" onClick={() => { start(c.value); setOpen(false); }}>{c.label}</button>
            ))}
          </div>
          {on && <button className="chip" onClick={() => { cancel(); setOpen(false); }}>Turn off</button>}
        </div>
      )}
    </div>
  );
}
