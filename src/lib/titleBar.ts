/**
 * Paints the desktop window's title bar in the active theme's colours (src-tauri/src/titlebar.rs). The bar keeps
 * the real Windows title bar (drag, Snap layouts, double-click to maximise and the window buttons all still work);
 * it just takes the theme's sidebar colour (--bg-2) with the theme's text colour, and the window buttons turn dark
 * or light to match. Windows 10, macOS and Linux only get the dark / light part. App.tsx calls this whenever the
 * shown theme changes (picking one, previewing one, Seasonal and Random daily rolling over).
 */
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './http';
import { isMobileApp } from './platform';

export type Rgb = [number, number, number];

/** '#abc', '#aabbcc' or '#aabbccdd' (alpha ignored) → [r, g, b]; anything else → null. */
export function parseHex(value: string): Rgb | null {
  const m = value.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Any CSS colour → [r, g, b], by letting the browser resolve it (the build's CSS minifier turns some hex into names, e.g. Win95's
 * #c0c0c0 into `silver`). */
function resolve(value: string): Rgb | null {
  const hex = parseHex(value);
  if (hex) return hex;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillStyle = value;
  return parseHex(String(ctx.fillStyle));
}

/** The title bar colours for the theme that's on the page now. */
export function titleBarColors(): { caption: Rgb; text: Rgb; dark: boolean } | null {
  const css = getComputedStyle(document.documentElement);
  const caption = resolve(css.getPropertyValue('--bg-2'));
  const text = resolve(css.getPropertyValue('--text'));
  if (!caption || !text) return null;
  return { caption, text, dark: luminance(caption) < 0.18 };
}

let last = '';

export function paintTitleBar() {
  if (!isTauri || isMobileApp) return;
  const colors = titleBarColors();
  if (!colors) return;
  const key = JSON.stringify(colors);
  if (key === last) return;
  last = key;
  void invoke('titlebar_paint', colors).catch(() => (last = ''));
}
