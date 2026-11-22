import { useRef } from 'react';

/** One row of a right-click menu (components/ContextMenu.tsx). */
export interface MenuEntry {
  label: string;
  /** what picking it does; left out on a row that opens `items` */
  onSelect?: () => void;
  /** a list that opens in place of this one, with a Back row */
  items?: MenuEntry[];
  /** a tick beside it; `false` still makes it a checkbox row */
  checked?: boolean;
  disabled?: boolean;
  /** a line above it */
  sep?: boolean;
  /** a small grey heading, not a button */
  heading?: boolean;
  /** greyed text on the right, like the current pick */
  note?: string;
  /** tooltip */
  hint?: string;
  /** leave the menu open after picking it */
  keepOpen?: boolean;
}

/**
 * Right-clicks that keep the system's own menu (copy and paste in a text box) or belong to something else that
 * sits inside the element (an open panel or dialog), not to the element's menu.
 */
export const keepsOwnMenu = (target: EventTarget | null) =>
  !!(target as Element | null)?.closest?.('input:not([type=range]), textarea, [contenteditable=true], [role=dialog], .menu, .dj-station');

/** How long a finger has to stay down for a long-press. */
export const LONG_PRESS_MS = 500;
/** How far it can drift (px) before it counts as a scroll instead. */
export const LONG_PRESS_SLOP = 10;

/**
 * On Android a long-press is followed by the system's own contextmenu event, and both would open the menu: while a
 * menu that opened a moment ago is still up, don't open it again. Once it's closed, the next right-click opens.
 */
export function menuGuard(gap = 700) {
  let last = -Infinity;
  return (now: number, isOpen: boolean) => {
    if (isOpen && now - last < gap) return false;
    last = now;
    return true;
  };
}

/** True when the finger moved far enough from where it went down that this is a scroll, not a press. */
export const movedTooFar = (from: { x: number; y: number }, to: { x: number; y: number }, slop = LONG_PRESS_SLOP) =>
  Math.hypot(to.x - from.x, to.y - from.y) > slop;

interface Point {
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

/**
 * Long-press for touch screens (iPhone and iPad have no contextmenu event for it). Spread the handlers on the element;
 * `open` gets the spot that was pressed. Once it has fired, lifting the finger doesn't also count as a tap.
 * Mouse right-clicks keep going through onContextMenu.
 */
export function useLongPress(open: (at: Point) => void) {
  const s = useRef<{ timer?: number; from?: { x: number; y: number }; fired?: boolean }>({});
  const cancel = () => {
    window.clearTimeout(s.current.timer);
    s.current.timer = undefined;
  };
  return {
    onTouchStart: (e: React.TouchEvent) => {
      cancel();
      s.current.fired = false;
      // sliders and text boxes keep their own press-and-hold
      if (e.touches.length !== 1 || (e.target as Element).closest?.('input, textarea') || keepsOwnMenu(e.target)) return;
      const { clientX, clientY } = e.touches[0];
      s.current.from = { x: clientX, y: clientY };
      s.current.timer = window.setTimeout(() => {
        s.current.timer = undefined;
        s.current.fired = true;
        navigator.vibrate?.(10);
        open({ clientX, clientY, preventDefault: () => undefined });
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (t && s.current.from && movedTooFar(s.current.from, { x: t.clientX, y: t.clientY })) cancel();
    },
    onTouchEnd: (e: React.TouchEvent) => {
      cancel();
      // the press opened the menu: no tap (and no click landing on the menu's backdrop, which would close it)
      if (s.current.fired && e.cancelable) e.preventDefault();
    },
    onTouchCancel: cancel,
  };
}
