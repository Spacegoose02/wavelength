import { join } from 'node:path';
import { buildApp } from './app.ts';
import { audit } from './audit.ts';
import { loadConfig } from './config.ts';
import { applyPendingRestore, openDb } from './db.ts';
import { ssoSettings } from './sso.ts';
import { countUsers } from './users.ts';

const config = loadConfig();
const dbFile = join(config.dataDir, 'hub.db');
const kept = applyPendingRestore(dbFile);
const db = openDb(dbFile);
if (kept) audit(db, { action: 'hub.restored', detail: { previous: kept } });

async function stop(code: number) {
  await app.close();
  db.close();
  process.exit(code);
}

// 75 (EX_TEMPFAIL), so Docker restarts it with either `unless-stopped` or `on-failure`
const app = buildApp(db, config, { logger: true, restart: () => void stop(75) });

await app.listen({ port: config.port, host: config.host });
if (kept) app.log.info(`Restored a backup. The database it replaced is kept as ${kept}`);
if (countUsers(db) === 0) app.log.info(`No accounts yet. Open ${config.publicUrl}/setup to create the first admin.`);
const sso = ssoSettings(db, config);
if (sso.enabled) app.log.info(`Single sign-on (${sso.name}) through the proxy is on. See docs/HUB.md for the proxy setup.`);
else if (sso.problem) app.log.warn(`Single sign-on is set to on but stays off: ${sso.problem}`);
if (sso.oidc) app.log.info(`OIDC sign-in (${sso.name}) is on with ${sso.oidcIssuer}. Redirect URI: ${config.publicUrl}/auth/oidc/callback`);
else if (sso.oidcProblem) app.log.warn(`OIDC sign-in is set to on but stays off: ${sso.oidcProblem}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void stop(0));
