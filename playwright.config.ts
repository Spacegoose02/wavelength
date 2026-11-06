import { defineConfig } from '@playwright/test';

// End-to-end smoke tests against the browser build (`vite build` + `vite preview`), no servers needed.
// Run with `npm run e2e`. See docs/DEVELOPMENT.md "Tests".
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173', trace: 'off' },
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true },
});
