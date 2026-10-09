import { loadConfig } from './config';
import { createDatabase, migrate } from './db/database';
import { TemplateRegistry } from './templates';
import { buildApp } from './app';

const config = loadConfig();
const { pool, db } = createDatabase(config.databaseUrl);
const applied = await migrate(pool, config.migrationsDir);
const templates = await TemplateRegistry.load(config.worldsDir);
const app = buildApp({ db, templates, tokenPepper: config.tokenPepper, logLevel: config.logLevel, trustProxy: config.trustProxy, limits: { accountsPerHour: config.accountsPerHour } });
app.log.info({ applied, maps: templates.maps() }, 'migrations applied, templates loaded');

const shutdown = async (): Promise<void> => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await app.listen({ port: config.port, host: config.host });
