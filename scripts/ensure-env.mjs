// Creates infra/.env with random secrets on first run; never overwrites an existing file.
import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = new URL('../infra/.env', import.meta.url);
if (existsSync(path)) { console.log('infra/.env exists'); }
else {
  const secret = () => randomBytes(24).toString('base64url');
  writeFileSync(path, `POSTGRES_PASSWORD=${secret()}\nTOKEN_PEPPER=${secret()}\nWEB_PORT=8090\nLOG_LEVEL=info\n`, { mode: 0o600 });
  console.log('created infra/.env with random secrets');
}
