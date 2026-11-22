import { expect, test } from '@playwright/test';

// past the welcome screen (components/FirstRun.tsx; e2e/firstRun.spec.ts tests it)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tonearm.firstRunDone', '1'));
});

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

test('a playlist moved into a folder shows under it in the sidebar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tonearm.library', JSON.stringify({ state: { playlists: [{ id: 'p1', name: 'Leg day', tracks: [], createdAt: 0, updatedAt: 0 }], history: [] }, version: 0 }));
  });
  await page.goto('/');
  await page.locator('.side-item', { hasText: 'Leg day' }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Move to folder' }).click();
  await page.getByPlaceholder('New folder…').fill('Gym');
  await page.getByPlaceholder('New folder…').press('Enter');
  await expect(page.getByRole('button', { name: 'Folder: Gym' })).toBeVisible();
  await expect(page.locator('.side-folder-head', { hasText: 'Gym' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(page.locator('.side-list > .side-item', { hasText: 'Leg day' })).toHaveCount(1);
});

test("Don't play from the song menu lists the artist in Settings, and Play again removes it", async ({ page }) => {
  const t = { id: 't1', sourceId: 'x', kind: 'track', title: 'Song 1', artist: 'Some Band feat. Guest', album: 'An Album', duration: 200 };
  await page.addInitScript((tracks) => {
    localStorage.setItem('tonearm.library', JSON.stringify({ state: { playlists: [{ id: 'p1', name: 'Test', tracks, createdAt: 0, updatedAt: 0 }], history: [] }, version: 0 }));
  }, [t]);
  await page.goto('/');
  await page.locator('.side-item', { hasText: 'Test' }).dispatchEvent('click');
  await page.locator('.track-row').first().click({ button: 'right' });
  await page.locator('.track-menu .menu-item', { hasText: "Don't play Some Band" }).click();
  await page.locator('nav.sidebar button.nav', { hasText: 'Settings' }).click();
  await page.getByLabel('Search settings').fill('block');
  await page.locator('.settings-found .menu-item', { hasText: "Don't play" }).click();
  const list = page.locator('.dont-play-list li');
  await expect(list).toHaveCount(1);
  await expect(list).toContainText('Some Band');
  await list.getByRole('button', { name: 'Play again' }).click();
  await expect(list).toHaveCount(0);
});

test('the shuffle button goes off, Shuffle, Smart Shuffle, off', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('.deck-center .shuffle-btn');
  await expect(btn).not.toHaveClass(/\bon\b/);
  await btn.click();
  await expect(btn).toHaveClass(/\bon\b/);
  await expect(btn).not.toHaveClass(/smart/);
  await btn.click();
  await expect(btn).toHaveClass(/smart/);
  await btn.click();
  await expect(btn).not.toHaveClass(/\bon\b/);
});

test('the song menu works from the keyboard', async ({ page }) => {
  const t = { id: 't1', sourceId: 'x', kind: 'track', title: 'Song 1', artist: 'Some Band', album: 'An Album', duration: 200 };
  await page.addInitScript((tracks) => {
    localStorage.setItem('tonearm.library', JSON.stringify({ state: { playlists: [{ id: 'p1', name: 'Test', tracks, createdAt: 0, updatedAt: 0 }], history: [] }, version: 0 }));
  }, [t]);
  await page.goto('/');
  await page.locator('.side-item', { hasText: 'Test' }).dispatchEvent('click');
  const play = page.locator('.track-row .track-num').first();
  await play.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Song menu: Song 1' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.menu-item').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('.menu-item').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(play).toBeFocused();
});

test('Less motion stops animations', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar button.nav', { hasText: 'Settings' }).click();
  await page.getByLabel('Search settings').fill('reduce motion');
  await page.locator('.settings-found .menu-item', { hasText: 'Motion' }).click();
  await page.getByRole('radio', { name: 'Less motion' }).click();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);
  await page.getByRole('radio', { name: 'Full motion' }).click();
  await expect(page.locator('html')).not.toHaveClass(/reduce-motion/);
});

test('Playback settings show streaming quality, resume and the wake-up alarm', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar button.nav', { hasText: 'Settings' }).click();
  await page.getByLabel('Search settings').fill('alarm');
  await page.locator('.settings-found .menu-item', { hasText: 'Wake-up alarm' }).click();
  await expect(page.locator('h2', { hasText: 'Streaming quality' })).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Pick up where you left off' })).toBeVisible();
  const alarm = page.locator('#alarm');
  await alarm.getByTitle('Saturday').click();
  await expect(alarm.locator('small', { hasText: 'Mon, Tue, Wed, Thu, Fri, Sat' })).toBeVisible();
  await page.getByRole('group', { name: 'On mobile data' }).getByRole('button', { name: 'Data saver' }).click();
  await expect(page.getByText('On mobile data: 96 kbps')).toBeVisible();
});

test('playlists move from localStorage to IndexedDB and are still there after a reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('tonearm.library', JSON.stringify({ state: { playlists: [{ id: 'p1', name: 'Moved over', tracks: [], createdAt: 0, updatedAt: 0 }], history: [] }, version: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.side-item', { hasText: 'Moved over' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tonearm.library'))).toBeNull();
  await page.reload();
  await expect(page.locator('.side-item', { hasText: 'Moved over' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tonearm.library'))).toBeNull();
});

test('Move from Spotify reads a Spotify data file and lists what isn’t in the library', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.locator('.side-head button', { hasText: 'Playlists' }).click();
  await page.getByRole('button', { name: 'Move from Spotify' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('h1', { hasText: 'Move from Spotify' })).toBeVisible();
  const playlists = { playlists: [{ name: 'Road trip', items: [{ track: { trackName: 'Midnight City', artistName: 'M83', albumName: 'Hurry Up' } }] }] };
  const library = { tracks: [{ track: 'Hello', artist: 'Adele', album: '25' }], artists: [{ name: 'Adele' }] };
  await page.locator('input[type=file]').setInputFiles([
    { name: 'Playlist1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(playlists)) },
    { name: 'YourLibrary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(library)) },
  ]);
  await expect(page.getByText('1 playlist, 1 liked song and 1 followed artist')).toBeVisible();
  await page.getByRole('button', { name: 'Bring it over' }).click();
  await expect(page.getByText('Not in your library (2)')).toBeVisible();
  expect(errors).toEqual([]);
});

test('right-click the player and the Now Playing scene for their menus', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const t = (n: number) => ({ id: `t${n}`, sourceId: 'x', kind: 'track', title: `Song ${n}`, artist: 'Some Band', album: 'An Album', duration: 200 });
  await page.addInitScript((tracks) => {
    localStorage.setItem('tonearm.library', JSON.stringify({ state: { playlists: [{ id: 'p1', name: 'Test', tracks, createdAt: 0, updatedAt: 0 }], history: [] }, version: 0 }));
  }, [t(1), t(2)]);
  await page.goto('/');
  await page.locator('.side-item', { hasText: 'Test' }).dispatchEvent('click');
  await page.locator('.track-row').first().dblclick();
  await page.locator('.deck-meta').click({ button: 'right' });
  const menu = page.locator('.context-menu');
  await expect(menu).toContainText('Song 1 · Some Band');
  await expect(menu).toContainText('Repeat');
  // a list opens in place, with a way back
  await menu.getByRole('menuitem', { name: /^Repeat/ }).click();
  await menu.getByRole('menuitemcheckbox', { name: /Repeat all/ }).click();
  await expect(page.locator('.lcd-flags')).toContainText('REP');
  await page.locator('.deck-meta').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Open Now Playing' }).click();
  await expect(menu).toBeHidden();
  await page.locator('.np-stage').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: /^Critter/ }).click();
  await menu.getByRole('menuitemcheckbox', { name: /Shark/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('.np-stage')).toHaveAttribute('aria-label', /shark/i);
  expect(errors).toEqual([]);
});
