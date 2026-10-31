import { describe, expect, test } from 'vitest';
import { activeSkin, dailySkin, seasonFor, thanksgiving } from '../lib/seasons';
import { cleanIcyTitle, parseIcyMetadata } from '../lib/icy';
import { assetFor, compareVersions, parseVersion, pickUpdate } from '../lib/updates';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('seasonal skins', () => {
  test('Thanksgiving is the fourth Thursday of November', () => {
    expect(thanksgiving(2026)).toBe(26);
    expect(thanksgiving(2027)).toBe(25);
    expect(new Date(2026, 10, thanksgiving(2026)).getDay()).toBe(4);
  });

  test('holiday windows', () => {
    expect(seasonFor(new Date(2026, 9, 30))?.skin).toBe('halloween');
    expect(seasonFor(new Date(2026, 11, 25))?.skin).toBe('christmas');
    expect(seasonFor(new Date(2026, 2, 3))).toBeUndefined();
  });

  test('Seasonal beats Random daily, which beats the chosen skin', () => {
    const halloween = new Date(2026, 9, 31);
    const march = new Date(2026, 2, 3);
    expect(activeSkin({ skin: 'neon', seasonal: true, randomDaily: true }, halloween)).toBe('halloween');
    expect(activeSkin({ skin: 'neon', seasonal: true, randomDaily: true }, march)).toBe(dailySkin(march));
    expect(activeSkin({ skin: 'neon', seasonal: false, randomDaily: false }, halloween)).toBe('neon');
  });

  test('the daily skin is stable for a day', () => {
    expect(dailySkin(new Date(2026, 2, 3, 8))).toBe(dailySkin(new Date(2026, 2, 3, 23)));
  });
});

describe('radio titles from inside the stream', () => {
  test('reads StreamTitle, including apostrophes', () => {
    expect(parseIcyMetadata(bytes("StreamTitle='Artist - Don't Stop';StreamUrl='';\0\0"))).toBe("Artist - Don't Stop");
    expect(parseIcyMetadata(bytes('nothing here'))).toBeUndefined();
  });

  test('placeholders between songs count as no title', () => {
    expect(cleanIcyTitle(' - ')).toBe('');
    expect(cleanIcyTitle('Unknown')).toBe('');
    expect(cleanIcyTitle('  Real   Song ')).toBe('Real Song');
  });
});

describe('in-app updates', () => {
  const release = (tag: string, assets: string[], extra: object = {}) => ({
    tag_name: tag, name: tag, body: '', html_url: '', draft: false, prerelease: false, published_at: '',
    assets: assets.map((name) => ({ name, browser_download_url: `https://x/${name}`, size: 1 })), ...extra,
  });

  test('versions compare numerically', () => {
    expect(parseVersion('v0.10.2')).toEqual([0, 10, 2]);
    expect(parseVersion('v1.0')).toBeUndefined();
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
  });

  test('each kind of install gets its own file', () => {
    const r = release('v1.0.0', ['Wavelength_1.0.0_x64-setup.exe', 'Wavelength.exe', 'Wavelength-1.0.0-android.apk']);
    expect(assetFor(r, 'installer')?.name).toBe('Wavelength_1.0.0_x64-setup.exe');
    expect(assetFor(r, 'portable')?.name).toBe('Wavelength.exe');
    expect(assetFor(r, 'android')?.name).toBe('Wavelength-1.0.0-android.apk');
  });

  test('the newest release with a file wins; pre-releases only when asked', () => {
    const list = [
      release('v0.17.0', []), // still building
      release('v0.16.2', ['Wavelength.exe'], { prerelease: true }),
      release('v0.16.1', ['Wavelength.exe']),
    ];
    expect(pickUpdate(list, '0.16.0', 'portable', false)?.version).toBe('0.16.1');
    expect(pickUpdate(list, '0.16.0', 'portable', true)?.version).toBe('0.16.2');
    expect(pickUpdate(list, '0.16.1', 'portable', false)).toBeUndefined();
  });
});
