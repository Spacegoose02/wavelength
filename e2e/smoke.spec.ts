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
