// Runs the API integration tests (docs/10 §3) against a throwaway Postgres 16 container.
// Usage: pnpm test:api   (requires Docker). Set KEEP_DB=1 to leave the container running.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = process.env.TEST_PG_PORT ?? '55432', NAME = process.env.TEST_PG_NAME ?? 'xay-nha-test-pg';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try { docker('rm', '-f', NAME); } catch { /* not running */ }
docker('run', '-d', '--rm', '--name', NAME, '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_USER=test', '-e', 'POSTGRES_DB=test',
  '-p', `127.0.0.1:${PORT}:5432`, 'postgres:16.10-alpine');
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = spawnSync('docker', ['exec', NAME, 'pg_isready', '-U', 'test', '-d', 'test'], { stdio: 'ignore' }).status === 0;
  if (!ready) await new Promise(r => setTimeout(r, 1000));
}
// pg_isready can succeed during the init restart; give the final server a moment.
await new Promise(r => setTimeout(r, 2000));
const env = { ...process.env, DATABASE_URL: `postgres://test:test@127.0.0.1:${PORT}/test` };
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const run = spawnSync(process.execPath, [vitest, 'run', '-c', 'vitest.int.config.ts'], { stdio: 'inherit', env });
if (!process.env.KEEP_DB) { try { docker('rm', '-f', NAME); } catch { /* ignore */ } }
process.exitCode = ready ? run.status ?? 1 : 1;
if (!ready) console.error('Postgres did not become ready');
