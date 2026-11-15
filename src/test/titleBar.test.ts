import { describe, expect, test } from 'vitest';
import { luminance, parseHex } from '../lib/titleBar';

// same loose node:fs import as phoneDock.test.ts (vitest skips CSS, and the app has no Node types)
const fsModule: string = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (url: URL, enc: 'utf8') => string };

describe('title bar colours', () => {
  test('parses short, long and alpha hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex(' #141418 ')).toEqual([0x14, 0x14, 0x18]);
    expect(parseHex('#11223380')).toEqual([0x11, 0x22, 0x33]);
    expect(parseHex('rgb(1, 2, 3)')).toBeNull();
  });

  test('dark and light', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1);
    expect(luminance([0x14, 0x14, 0x18])).toBeLessThan(0.18);
    expect(luminance([0xf2, 0xf2, 0xf4])).toBeGreaterThan(0.18);
  });

  // every theme's sidebar and text colours are plain hex, so the title bar can use them directly
  test('every theme gives the title bar usable colours', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const blocks = [...css.matchAll(/:root\[data-skin='([\w-]+)'\]\s*\{([^}]*)\}/g)];
    expect(blocks.length).toBeGreaterThan(10);
    for (const [, skin, body] of blocks) {
      for (const name of ['--bg-2', '--text']) {
        const m = body.match(new RegExp(`${name}:\\s*([^;]+);`));
        if (m) expect(parseHex(m[1]), `${skin} ${name}`).not.toBeNull();
      }
    }
  });
});
