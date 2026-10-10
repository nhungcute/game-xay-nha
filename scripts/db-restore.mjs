// Restore a backup made by infra/backup.sh into the running Docker stack (docs/DEPLOY_LOCAL.md).
// DESTRUCTIVE: replaces every table. Usage: pnpm db:restore backups/xaynha-YYYYMMDD-HHMMSS.dump --yes
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const [file, confirm] = process.argv.slice(2);
if (!file || !existsSync(file) || !/^xaynha-\d{8}-\d{6}\.dump$/.test(basename(file))) {
  console.error('Usage: pnpm db:restore backups/xaynha-YYYYMMDD-HHMMSS.dump --yes'); process.exit(2);
}
if (resolve(file) !== resolve('backups', basename(file))) { console.error('The dump must be inside ./backups (mounted into the backup container).'); process.exit(2); }
if (confirm !== '--yes') {
  console.error(`This replaces the current database with ${file}. Re-run with --yes to continue.`); process.exit(2);
}
const compose = ['compose', '-f', 'infra/compose.yml'];
const run = (args, input) => {
  const r = spawnSync('docker', [...compose, ...args], { stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'], input });
  if (r.status !== 0) { console.error(`docker ${args.join(' ')} failed (${r.status})`); process.exit(r.status ?? 1); }
};
// Stop the API so no command is written mid-restore, restore inside the backup container, start the API again.
run(['stop', 'api']);
run(['exec', '-T', 'backup', 'pg_restore', '-h', 'postgres', '-U', 'xaynha', '-d', 'xaynha', '--clean', '--if-exists', '--no-owner', `/backups/${basename(file)}`]);
run(['start', 'api']);
// Wait until the API passes its healthcheck again so the stack is usable when this script returns.
for (let i = 0; i < 60; i++) {
  const ps = spawnSync('docker', [...compose, 'ps', 'api', '--format', '{{.Health}}'], { encoding: 'utf8' });
  if (ps.stdout.trim() === 'healthy') { console.log(`Restored ${file}; API healthy.`); process.exit(0); }
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
}
console.error(`Restored ${file}, but the API did not report healthy within 60 s: check pnpm deploy:logs.`); process.exit(1);
