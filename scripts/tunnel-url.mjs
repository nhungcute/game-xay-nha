// Prints the public https://*.trycloudflare.com URL from the tunnel container logs.
import { execFileSync } from 'node:child_process';
const logs = execFileSync('docker', ['compose', '-f', 'infra/compose.yml', '--profile', 'tunnel', 'logs', 'tunnel'], { encoding: 'utf8' });
const urls = [...logs.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)].map(m => m[0]);
if (!urls.length) { console.error('No tunnel URL yet. Is the tunnel running? Try: pnpm tunnel:up, wait ~10 s, then retry.'); process.exitCode = 1; }
else console.log(urls.at(-1));
