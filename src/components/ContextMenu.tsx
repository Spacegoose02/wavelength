import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useIsPhone } from '../lib/platform';
import { type MenuEntry, menuGuard } from '../lib/contextMenu';

/**
 * A right-click menu for anything that isn't a song (songs have `TrackMenu`): the player bars (components/PlayerMenu.ts)
 * and the Now Playing scene (components/SceneMenu.ts). Right-click, long-press on a phone, or the remote's Menu key
 * on a TV (lib/tvNav.ts) opens it. Lists inside it (Critter, Act, Theme…) open in place with a Back row at the top,
 * so the same menu works with a mouse, a finger and a D-pad. On a phone-sized screen it's a sheet along the bottom.
 * Opened with `openContextMenu`, drawn once by `<ContextMenuHost/>` in App.tsx.
 */
interface MenuState {
  open?: { x: number; y: number; title?: string; items: MenuEntry[]; at: number };
  show(x: number, y: number, items: MenuEntry[], title?: string): void;
  close(): void;
}

export const useContextMenu = create<MenuState>()((set) => ({
  show: (x, y, items, title) => set({ open: { x, y, items, title, at: Date.now() } }),
  close: () => set({ open: undefined }),
}));

const guard = menuGuard();

export const openContextMenu = (e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuEntry[], title?: string) => {
  e.preventDefault();
  // a long-press on Android also sends a contextmenu event while the menu it opened is up: open once
  if (!guard(Date.now(), !!useContextMenu.getState().open)) return;
  useContextMenu.getState().show(e.clientX, e.clientY, items, title);
};

export function ContextMenuHost() {
  const open = useContextMenu((s) => s.open);
  const close = useContextMenu((s) => s.close);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);
  if (!open) return null;
  return (
    <div className="track-menu-scrim" onMouseDown={close} onContextMenu={(e) => {
      e.preventDefault();
      // Android's own contextmenu event for the long-press that just opened this lands here: keep it open
      if (Date.now() - open.at > 700) close();
    }}>
      <Panel key={`${open.x}:${open.y}`} {...open} onClose={close} />
    </div>
  );
}

function Panel({ x, y, title, items, onClose }: NonNullable<MenuState['open']> & { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();
  const [pos, setPos] = useState({ left: x, top: y });
  // the lists opened so far: the last one is on screen
  const [stack, setStack] = useState<{ title?: string; items: MenuEntry[] }[]>([{ title, items }]);
  const level = stack[stack.length - 1];
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  // keyboard: the first item takes focus (on every list), and focus goes back where it was when the menu closes
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    return () => was?.focus?.();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    const on = el.querySelector<HTMLElement>('.menu-item.on');
    (on ?? el.querySelector<HTMLElement>('.menu-item'))?.focus({ preventScroll: true });
    // a long list (Critter, Act) opens with the current pick in view; otherwise the title stays at the top
    on?.scrollIntoView({ block: 'nearest' });
  }, [stack.length]);

  // keep it on screen: open up or left when there's no room below or to the right
  useLayoutEffect(() => {
    if (phone) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, Math.min(y, window.innerHeight - 8) - r.height) : y;
    setPos({ left, top });
  }, [x, y, phone, stack.length]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && stack.length > 1) {
      e.preventDefault();
      e.stopPropagation();
      return back();
    }
    if (e.key === 'ArrowRight') {
      const it = level.items[Number((document.activeElement as HTMLElement | null)?.dataset.i)];
      if (it?.items) {
        e.preventDefault();
        e.stopPropagation();
        setStack((s) => [...s, { title: it.label, items: it.items! }]);
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  };

  const pick = (it: MenuEntry) => {
    if (it.items) return setStack((s) => [...s, { title: it.label, items: it.items! }]);
    it.onSelect?.();
    if (!it.keepOpen) onClose();
  };

  return (
    <div ref={ref} className={`menu track-menu context-menu ${phone ? 'sheet' : ''}`} role="menu" aria-label={level.title ?? 'Menu'} style={phone ? undefined : pos}
      onKeyDown={onKeyDown} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {stack.length > 1 ? (
        <button type="button" className="menu-item menu-back" onClick={back} aria-label={`Back to ${stack[stack.length - 2].title ?? 'the menu'}`}>‹ {level.title}</button>
      ) : level.title ? <div className="menu-hint track-menu-title">{level.title}</div> : null}
      {level.items.map((it, i) => it.heading ? (
        <div key={`h${i}`} className="menu-group">{it.label}</div>
      ) : (
        <div key={`${i}:${it.label}`} className="menu-row">
          {it.sep && i > 0 && <div className="menu-sep" />}
          <button type="button" data-i={i} className={`menu-item ${it.checked ? 'on' : ''}`} role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked} aria-haspopup={it.items ? 'menu' : undefined} disabled={it.disabled} title={it.hint} onClick={() => pick(it)}>
            <span className="menu-check" aria-hidden>{it.checked ? '✓' : ''}</span>
            <span className="menu-label">{it.label}</span>
            {it.note && <small>{it.note}</small>}
            {it.items && <span className="menu-more" aria-hidden>›</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
