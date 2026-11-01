import { describe, expect, it } from 'vitest';

/**
 * React calls whatever an effect callback returns as its cleanup. A concise arrow like
 * `useEffect(() => el.scrollIntoView())` returns the call's value, and some DOM methods now return a Promise
 * (scrollIntoView in current WebView2/Chromium), so React later tried to call the Promise and the page crashed
 * with "l is not a function" (the AI DJ chat, v0.19.0). Effects use a block body, or return a cleanup outright:
 * `() => () => …`, or an `on…(…)` subscription helper, which hands back its unsubscribe.
 */

// every app source file, as text (the tests themselves excluded)
const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../test/**'], { query: '?raw', import: 'default', eager: true });

/** Concise effect bodies that could hand React something other than a cleanup function. */
function riskyEffects(code: string): string[] {
  const found: string[] = [];
  const effect = /\buse(?:Layout|Insertion)?Effect\(\s*(async\s*)?\(\s*\)\s*=>\s*/g;
  for (let m; (m = effect.exec(code)); ) {
    const rest = code.slice(m.index + m[0].length);
    if (!m[1] && rest.startsWith('{')) continue; // block body: returns only what it says
    if (/^\(\s*\)\s*=>/.test(rest)) continue; // returns a cleanup
    if (/^on[A-Z]\w*\(/.test(rest)) continue; // on…(fn) subscription helpers return their unsubscribe
    found.push(code.slice(m.index, m.index + m[0].length + 60).split('\n')[0]);
  }
  return found;
}

describe('effect callbacks', () => {
  it('flags concise bodies that return a value', () => {
    expect(riskyEffects("useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [entries]);")).toHaveLength(1);
    expect(riskyEffects('useEffect(() => setOpen(false), [id]);')).toHaveLength(1);
    expect(riskyEffects('useEffect(async () => { await load(); }, []);')).toHaveLength(1); // always a Promise
    expect(riskyEffects('useEffect(() => {\n  el.scrollIntoView();\n}, []);')).toHaveLength(0);
    expect(riskyEffects('useEffect(() => () => stop(), []);')).toHaveLength(0);
    expect(riskyEffects('useEffect(() => onDiscordProblem(() => bump()), []);')).toHaveLength(0);
  });

  it('never return something React would call as a cleanup', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    const bad = Object.entries(SOURCES).flatMap(([f, code]) => riskyEffects(code).map((e) => `${f.slice(3)}: ${e}`));
    expect(bad).toEqual([]);
  });
});
