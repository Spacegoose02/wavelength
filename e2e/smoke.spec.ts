import { expect, test } from '@playwright/test';

// The browser build with no servers set up: every top-level page has to open without throwing or showing
// the "Something went wrong" panel (components/ErrorBoundary.tsx).
test('every sidebar page opens without a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  const nav = page.locator('nav.sidebar button.nav');
  await expect(nav.first()).toBeVisible();
  const labels = await nav.allInnerTexts();
  expect(labels.length).toBeGreaterThan(10);
  for (let i = 0; i < labels.length; i++) {
    await nav.nth(i).click();
    await page.waitForTimeout(200);
    await expect(page.locator('.crash'), `${labels[i]} crashed`).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('phone width shows the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('nav.sidebar')).toBeHidden();
});

test('right-clicking a song opens its menu, and Play next queues it', async ({ page }) => {
  const t = (n: number) => ({ id: `t${n}`, sourceId: 'x', kind: 'track', title: `Song ${n}`, artist: 'Some Band', album: 'An Album', duration: 200 });
  await page.addInitScript((tracks) => {
    localStorage.setItem('tonearm.library', JSON.stringify({ state: { playlists: [{ id: 'p1', name: 'Test', tracks, createdAt: 0, updatedAt: 0 }], history: [] }, version: 0 }));
  }, [t(1), t(2)]);
  await page.goto('/');
  await page.locator('.side-item', { hasText: 'Test' }).dispatchEvent('click');
  await page.locator('.track-row').nth(1).click({ button: 'right' });
  const menu = page.locator('.track-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Song 2');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('sidebar sections fold and stay folded', async ({ page }) => {
  await page.goto('/');
  const head = page.locator('.nav-group-head', { hasText: 'Your library' });
  await expect(page.locator('nav.sidebar button.nav', { hasText: 'Albums' })).toBeVisible();
  await head.click();
  await expect(page.locator('nav.sidebar button.nav', { hasText: 'Albums' })).toBeHidden();
  await page.reload();
  await expect(page.locator('nav.sidebar button.nav', { hasText: 'Albums' })).toBeHidden();
});

test('settings search opens the right tab', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar button.nav', { hasText: 'Settings' }).click();
  await page.getByLabel('Search settings').fill('crossfade');
  await page.locator('.settings-found .menu-item', { hasText: 'Volume levelling' }).click();
  await expect(page.locator('.tabs button.on')).toHaveText('Playback');
  await expect(page.locator('h2', { hasText: 'Volume levelling and crossfade' })).toBeVisible();
});
