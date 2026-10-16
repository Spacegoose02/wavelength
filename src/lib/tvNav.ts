/**
 * TV remote (D-pad) navigation for Android TV / Google TV / Fire TV.
 * WebView has no built-in spatial navigation, so arrow keys move focus to the nearest focusable
 * element in that direction; OK/Enter activates it (native for buttons). Media keys drive the
 * player. Only enabled on non-touch Android devices, so desktop keyboards behave as usual.
 */
import { usePlayer } from '../store/player';
import { isAndroid } from './platform';

export const isTV = isAndroid && typeof navigator !== 'undefined' && navigator.maxTouchPoints === 0;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
type Dir = 'up' | 'down' | 'left' | 'right';

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

/** Nearest focusable in a direction: favours elements in line with the current one. */
function nearest(from: Element, dir: Dir): HTMLElement | undefined {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  // stay inside an open overlay (Now Playing, menus) if focus is in one
  const scope = from.closest('.np, .menu, .queue') ?? document;
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const el of scope.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el === from || !visible(el)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const main = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
    if (main <= 4) continue; // not in that direction
    const cross = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    // overlapping on the cross axis = same row/column: strongly preferred
    const overlap = dir === 'up' || dir === 'down' ? b.right > a.left && b.left < a.right : b.bottom > a.top && b.top < a.bottom;
    const score = main + cross * (overlap ? 0.3 : 2.5);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function firstFocusable() {
  return [...document.querySelectorAll<HTMLElement>('.main ' + FOCUSABLE.split(', ').join(', .main '))].find(visible);
}

export function enableTvNavigation(force = false) {
  if (!isTV && !force) return;
  document.documentElement.classList.add('tv');
  window.addEventListener(
    'keydown',
    (e) => {
      const p = usePlayer.getState();
      // with the native media session (MediaBridge.kt) the system delivers media keys there —
      // handling them here too would toggle twice
      if (!window.WavelengthNative) switch (e.key) {
        case 'MediaPlayPause':
        case 'MediaPlay':
        case 'MediaPause':
          e.preventDefault();
          return p.toggle();
        case 'MediaTrackNext':
        case 'MediaFastForward':
          e.preventDefault();
          return p.next();
        case 'MediaTrackPrevious':
        case 'MediaRewind':
          e.preventDefault();
          return p.prev();
      }
      const dirs: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir: Dir | undefined = dirs[e.key];
      if (!dir) return;
      const cur = document.activeElement as HTMLElement | null;
      // let text fields and sliders use left/right themselves
      if (cur && (dir === 'left' || dir === 'right')) {
        if (cur.matches('input[type=range]')) return;
        if (cur.matches('input:not([type=checkbox]):not([type=radio]), textarea')) {
          const el = cur as HTMLInputElement;
          const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
          const atEnd = el.selectionStart === el.value.length;
          if ((dir === 'left' && !atStart) || (dir === 'right' && !atEnd)) return;
        }
      }
      const target = !cur || cur === document.body ? firstFocusable() : nearest(cur, dir);
      if (target) {
        e.preventDefault();
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    },
    true,
  );
  // start with something focused so the first press does something
  window.setTimeout(() => (document.activeElement === document.body ? firstFocusable()?.focus() : undefined), 800);
}
