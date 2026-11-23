import { expect, test } from '@playwright/test';

// Signing in on a TV (components/FirstRun.tsx, views/HubSettings.tsx SignedOut): the code to scan with a phone is
// the way in, not a password typed with the remote, and the remote's arrows stay on the sign-in screen.
test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT1.211025.001.Z4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', hasTouch: false });

const HUB = 'http://192.168.1.20:7780';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

test('a TV signs in with a code from a phone, with a link the phone can open', async ({ page }) => {
  let codes = 0;
  await page.route(`${HUB}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (path === '/api/health') return route.fulfill({ headers: cors, json: { ok: true, version: '9.9.9', setupNeeded: false, sso: false } });
    if (path === '/auth/device') {
      codes++;
      // a Hub without WAVELENGTH_PUBLIC_URL hands out localhost links
      return route.fulfill({ headers: cors, json: { deviceCode: `dev${codes}`, userCode: codes === 1 ? 'ABCD-EFGH' : 'JKLM-NPQR', verificationUrl: 'http://localhost:7780/link', verificationUrlComplete: `http://localhost:7780/link?code=${codes === 1 ? 'ABCD-EFGH' : 'JKLM-NPQR'}`, expiresIn: 600, interval: 1 } });
    }
    // the first code runs out; the TV gets a new one by itself
    if (path === '/auth/device/token') return route.fulfill({ status: codes === 1 ? 410 : 202, headers: cors, json: { status: codes === 1 ? 'expired' : 'pending', error: 'The code expired. Start again' } });
    return route.fulfill({ status: 404, headers: cors, json: {} });
  });
  await page.goto('/');
  const welcome = page.locator('.first-run');
  await expect(welcome.locator('h2')).toHaveText('Connect to your server');
  await expect(page.locator('html')).toHaveClass(/tv/);

  // nothing is focused yet: the first press of the remote lands on the sign-in screen, not the app behind it
  await page.keyboard.press('ArrowDown');
  await expect(welcome.locator(':focus')).toHaveCount(1);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowDown');
    await expect(welcome.locator(':focus')).toHaveCount(1);
  }

  await welcome.getByLabel('Server address').fill('192.168.1.20:7780');
  await welcome.getByRole('button', { name: 'Connect' }).click();
  await expect(welcome.locator('.ok')).toContainText('Wavelength Hub 9.9.9');

  // the code up front, no password boxes
  await expect(welcome.getByLabel('Password')).toHaveCount(0);
  await expect(welcome.locator('.hub-code')).toHaveText('JKLM-NPQR');
  await expect(welcome.locator('.hub-pair')).toContainText(`${HUB}/link`);
  await expect(welcome.locator('.hub-pair')).not.toContainText('localhost');
  expect(codes).toBe(2);

  // a password is still there for anyone who wants it
  await welcome.getByRole('button', { name: 'Other ways to sign in' }).click();
  await expect(welcome.getByRole('button', { name: 'Sign in with a password' })).toBeVisible();
});
