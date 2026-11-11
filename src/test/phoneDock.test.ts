import { describe, expect, it } from 'vitest';
// a .css ?raw import comes back empty under vitest (it skips CSS), so read the file itself (the app has no Node types,
// hence the loose import)
const fsModule: string = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (url: URL, enc: 'utf8') => string };
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');

describe('phone dock', () => {
  // the desktop mini player window once shared the .mini-player class and its `height: 100vh` blanked the phone
  // layout: the dock's mini player filled the screen and pushed the page and the tab bar out of sight
  it("never gives the dock's mini player a full-screen height", () => {
    const rules = [...css.matchAll(/(?:^|[{}])\s*([^{}]*\.mini-player\b[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) expect(body, selector.trim()).not.toMatch(/\bheight:\s*100(?:vh|dvh|%)/);
  });
});
