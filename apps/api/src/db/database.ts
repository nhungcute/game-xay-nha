import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}

/** Applies migrations/*.sql in order under a Postgres advisory lock (safe with several API instances). */
export async function migrate(pool: pg.Pool, dir: string): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map(r => r.id));
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => undefined);
    client.release();
  }
  return applied;
}
