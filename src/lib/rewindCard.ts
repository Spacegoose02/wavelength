import type { HubRewind } from '../sources/hub';

/**
 * Rewind as a picture to share (views/Rewind.tsx): a 1080×1350 card in the current skin's colours, drawn on
 * a canvas so it works the same in the app and in a browser.
 */

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Shorten text with … until it fits `max` pixels. */
function fit(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export function rewindTitle(r: Pick<HubRewind, 'year' | 'month'>) {
  return r.month ? new Date(Date.UTC(r.year, r.month - 1, 15)).toLocaleString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : String(r.year);
}

export async function rewindCard(r: HubRewind, who: string): Promise<Blob> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const accent = css('--accent', '#ff3df2'), accent2 = css('--accent-2', css('--viz-high', '#21e6ff'));
  const bg = css('--bg', '#0d0a1a'), text = css('--text', '#ece8ff'), muted = css('--muted', '#a59fc4');
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.8, 0, 50, W * 0.8, 0, W);
  glow.addColorStop(0, accent);
  glow.addColorStop(1, bg);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  const band = ctx.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, accent);
  band.addColorStop(1, accent2);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = muted;
  ctx.font = `600 34px ${font}`;
  ctx.fillText(fit(ctx, `${who}'s Wavelength Rewind`, W - 160), 80, 120);
  ctx.fillStyle = band;
  ctx.font = `800 96px ${font}`;
  ctx.fillText(rewindTitle(r), 80, 220);

  ctx.fillStyle = text;
  ctx.font = `800 150px ${font}`;
  const mins = r.minutes.toLocaleString();
  ctx.fillText(mins, 80, 400);
  const mw = ctx.measureText(mins).width;
  ctx.fillStyle = muted;
  ctx.font = `600 40px ${font}`;
  ctx.fillText('minutes', 100 + mw, 400);
  ctx.font = `500 32px ${font}`;
  ctx.fillText(`${r.plays.toLocaleString()} plays · ${r.songs.toLocaleString()} songs · ${r.artists.toLocaleString()} artists`, 80, 460);

  const list = (title: string, rows: string[], x: number, y: number, w: number) => {
    ctx.fillStyle = band;
    ctx.font = `700 30px ${font}`;
    ctx.fillText(title.toUpperCase(), x, y);
    rows.slice(0, 5).forEach((row, i) => {
      ctx.fillStyle = muted;
      ctx.font = `700 40px ${font}`;
      ctx.fillText(String(i + 1), x, y + 80 + i * 76);
      ctx.fillStyle = text;
      ctx.font = `600 38px ${font}`;
      ctx.fillText(fit(ctx, row, w - 56), x + 52, y + 80 + i * 76);
    });
  };
  list('Top artists', r.topArtists.map((a) => a.artist), 80, 580, 440);
  list('Top songs', r.topSongs.map((s) => s.title), 560, 580, 440);

  ctx.fillStyle = muted;
  ctx.font = `500 32px ${font}`;
  const facts = [
    r.favourite && `Most played: ${r.favourite.title} (${r.favourite.plays}×)`,
    r.streak > 1 && `Longest streak: ${r.streak} days in a row`,
    r.newArtists.count > 0 && `${r.newArtists.count} new artist${r.newArtists.count === 1 ? '' : 's'} found`,
  ].filter(Boolean) as string[];
  facts.forEach((f, i) => ctx.fillText(fit(ctx, f, W - 160), 80, 1080 + i * 52));

  ctx.fillStyle = band;
  ctx.fillRect(80, H - 90, W - 160, 6);

  return new Promise((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error("Couldn't draw the picture"))), 'image/png'));
}

/** The system share sheet when it takes files (phones), else a download. */
export async function shareImage(blob: Blob, name: string) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name.replace(/\.png$/, '') });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  return 'saved';
}
