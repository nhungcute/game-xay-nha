import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface Config {
  databaseUrl: string; port: number; host: string; tokenPepper: string; logLevel: string;
  worldsDir: string; migrationsDir: string; trustProxy: boolean; accountsPerHour: number; loginsPerHour: number;
  /** D039: RANDOM_MAPS=1 gives every new world a random map (default off). */
  randomMaps: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const pepper = env.TOKEN_PEPPER ?? '';
  if (env.NODE_ENV === 'production' && pepper.length < 16) throw new Error('TOKEN_PEPPER must be set (>= 16 chars) in production');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://xaynha:xaynha@127.0.0.1:5432/xaynha',
    port: Number(env.PORT ?? 3217), host: env.HOST ?? '0.0.0.0',
    tokenPepper: pepper || 'dev-only-pepper', logLevel: env.LOG_LEVEL ?? 'info',
    worldsDir: env.WORLDS_DIR ?? resolve(here, '../../web/public/worlds'),
    migrationsDir: env.MIGRATIONS_DIR ?? resolve(here, '../migrations'),
    trustProxy: env.TRUST_PROXY !== '0',
    // docs/11 §4.2: 5 new accounts per hour per IP; raise only for local testing (ACCOUNTS_PER_HOUR).
    accountsPerHour: Number(env.ACCOUNTS_PER_HOUR ?? 5),
    // D027: username + PIN login attempts per hour per IP (per-username lockout is separate).
    loginsPerHour: Number(env.LOGINS_PER_HOUR ?? 30),
    randomMaps: env.RANDOM_MAPS === '1',
  };
}
