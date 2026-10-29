import { join } from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { countUsers } from './users.ts';

const config = loadConfig();
const db = openDb(join(config.dataDir, 'hub.db'));
const app = buildApp(db, config, { logger: true });

await app.listen({ port: config.port, host: config.host });
if (countUsers(db) === 0) app.log.info(`No accounts yet. Open ${config.publicUrl}/setup to create the first admin.`);
if (config.sso.enabled) app.log.info(`Single sign-on is on. Only ${config.publicUrl}/auth/sso/ should sit behind tinyauth.`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
