import { expect, test } from '@playwright/test';

// A fresh install opens on one box for the Hub's address (components/FirstRun.tsx). Skip is for people without a
// Hub, and it stays skipped.
test('the welcome screen asks for the address, and Skip leaves it for good', async ({ page }) => {
  await page.goto('/');
  const welcome = page.locator('.first-run');
  await expect(welcome.locator('h2')).toHaveText('Connect to your server');
  await expect(welcome.getByLabel('Server address')).toBeVisible();

  await welcome.getByLabel('Server address').fill('127.0.0.1:9');
  await welcome.getByRole('button', { name: 'Connect' }).click();
  await expect(welcome.locator('.errors')).toContainText('Couldn’t find a Wavelength Hub at 127.0.0.1:9');

  await welcome.getByRole('button', { name: /Skip/ }).click();
  await expect(welcome).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect to a Hub' })).toBeVisible();
  await page.reload();
  await expect(page.locator('nav.sidebar button.nav').first()).toBeVisible();
  await expect(page.locator('.first-run')).toHaveCount(0);
});
