/**
 * docs/10 §3 integration tests — real Postgres (scripts/test-api.mjs), real HTTP stack via app.inject.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { cellIndex, Surface, type Command, type CommandType, type WorldSnapshot } from '@xay-nha/contracts';
import { catalog } from '@xay-nha/content';
import { createTestTemplate, generateEnvironment } from '@xay-nha/worldgen';
import { execute, netWorth, stateHash, type SimState } from '@xay-nha/sim';
import { createDatabase, migrate } from './db/database';
import { TemplateRegistry } from './templates';
import { buildApp, type AppDeps } from './app';
import { WorldService } from './worlds';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required (run `pnpm test:api`)');
const { pool, db } = createDatabase(DATABASE_URL);
let templates: TemplateRegistry;
let now = Date.UTC(2026, 9, 10, 8, 0, 0);
const clock = () => now;
let app: FastifyInstance;

function makeApp(limits?: AppDeps['limits']): FastifyInstance {
  return buildApp({ db, templates, tokenPepper: 'integration-test-pepper', clock, logLevel: 'silent',
    limits: limits ?? { accountsPerHour: 10_000, recoverPerHour: 10_000, commandsPerSecond: 10_000, commandsPerMinute: 100_000 } });
}
async function call(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, token?: string) {
  const res = await app.inject({ method, url, payload: body as object | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
}
async function newPlayer(mapKind: 'farm' | 'city' = 'farm', displayName = 'Nông Dân') {
  const r = await call('POST', '/api/characters', { mapKind, displayName });
  expect(r.status).toBe(201);
  return { token: r.body.token as string, recoveryCode: r.body.recoveryCode as string, worldId: r.body.character.id as string, accountId: r.body.accountId as string };
}
async function snapshotOf(token: string, worldId: string): Promise<{ snapshot: WorldSnapshot; stateHash: string }> {
  const r = await call('GET', `/api/worlds/${worldId}`, undefined, token);
  expect(r.status).toBe(200);
  return r.body;
}
function command(snapshot: { worldId: string; revision: number }, type: CommandType, payload: unknown, commandId: string = randomUUID()): Command {
  return { commandId, worldId: snapshot.worldId, expectedRevision: snapshot.revision, type, payload, clientTime: now } as Command;
}
const send = (token: string, worldId: string, commands: unknown[]) => call('POST', `/api/worlds/${worldId}/commands`, { commands }, token);

beforeAll(async () => {
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(pool, fileURLToPath(new URL('../migrations', import.meta.url)));
  templates = await TemplateRegistry.load(fileURLToPath(new URL('../../web/public/worlds', import.meta.url)));
  const city = createTestTemplate('city');
  templates.add({ template: city, env: generateEnvironment(city), path: 'test:city' });
});
beforeEach(() => { app = makeApp(); now += 3_600_000; });
afterAll(async () => { await pool.end(); });

describe('accounts and characters', () => {
  it('creates account + character without a token and returns token + recovery code once', async () => {
    const r = await call('POST', '/api/characters', { mapKind: 'farm', displayName: '  Trần   Văn  An ' });
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(r.body.character).toMatchObject({ mapKind: 'farm', displayName: 'Trần Văn An', level: 1, cash: 2000, netWorth: 2500 });
    expect(r.body.character.tag).toMatch(/^\d{4}$/);
    const me = await call('GET', '/api/me', undefined, r.body.token);
    expect(me.body.characters).toHaveLength(1);
  });
  it.each([['ab', 'NAME_LENGTH'], ['x'.repeat(21), 'NAME_LENGTH'], ['tên<script>', 'NAME_CHARACTERS'], ['a  b@', 'NAME_CHARACTERS'], ['admin', 'NAME_BLOCKED'], [42, 'NAME_CHARACTERS']])(
    'rejects invalid name %j with %s', async (displayName, code) => {
      const r = await call('POST', '/api/characters', { mapKind: 'farm', displayName });
      expect(r.status).toBe(400); expect(r.body.error).toBe(code);
    });
  it('rejects unknown maps', async () => {
    expect((await call('POST', '/api/characters', { mapKind: 'eco', displayName: 'Người Chơi' })).body.error).toBe('INVALID_MAP');
  });
  it('same display name gets different tags', async () => {
    const tags = new Set<string>();
    for (let i = 0; i < 5; i++) tags.add((await call('POST', '/api/characters', { mapKind: 'farm', displayName: 'Trùng Tên' })).body.character.tag);
    expect(tags.size).toBe(5);
  });
  it('with a token on a new map creates only a new character (level 1, $2 000, net worth $2 500)', async () => {
    const p = await newPlayer('farm', 'Hai Nhân Vật');
    const r = await call('POST', '/api/characters', { mapKind: 'city', displayName: 'Phố Thị' }, p.token);
    expect(r.status).toBe(201);
    expect(r.body.token).toBeUndefined(); expect(r.body.recoveryCode).toBeUndefined();
    expect(r.body.accountId).toBe(p.accountId);
    expect(r.body.character).toMatchObject({ mapKind: 'city', level: 1, cash: 2000, netWorth: 2500 });
    expect((await call('GET', '/api/me', undefined, p.token)).body.characters).toHaveLength(2);
  });
  it('a second character on the same map is rejected with CHARACTER_EXISTS', async () => {
    const p = await newPlayer();
    const r = await call('POST', '/api/characters', { mapKind: 'farm', displayName: 'Lần Hai' }, p.token);
    expect(r.status).toBe(409); expect(r.body.error).toBe('CHARACTER_EXISTS'); expect(r.body.detail.characterId).toBe(p.worldId);
  });
  it('commands on the city character never change the farm character', async () => {
    const p = await newPlayer('farm', 'Độc Lập');
    const city = (await call('POST', '/api/characters', { mapKind: 'city', displayName: 'Độc Lập' }, p.token)).body.character.id as string;
    const farmBefore = await snapshotOf(p.token, p.worldId);
    const citySnap = (await snapshotOf(p.token, city)).snapshot;
    const r = await send(p.token, city, [command(citySnap, 'BUY_MATERIAL', { wood: 10, stone: 5 })]);
    expect(r.body.results[0].accepted).toBe(true);
    const farmAfter = await snapshotOf(p.token, p.worldId);
    expect(farmAfter.snapshot.wallet).toEqual(farmBefore.snapshot.wallet);
    expect(farmAfter.snapshot.progress).toEqual(farmBefore.snapshot.progress);
    expect(farmAfter.snapshot.character.netWorth).toBe(farmBefore.snapshot.character.netWorth);
    expect((await snapshotOf(p.token, city)).snapshot.wallet.wood).toBe(30);
  });
  it('recovery code issues a new token and revokes the old one', async () => {
    const p = await newPlayer('farm', 'Khôi Phục');
    const r = await call('POST', '/api/auth/recover', { recoveryCode: p.recoveryCode.toLowerCase().replace(/-/g, '') });
    expect(r.status).toBe(200);
    expect(r.body.accountId).toBe(p.accountId);
    expect(r.body.characters.map((c: { id: string }) => c.id)).toEqual([p.worldId]);
    expect((await call('GET', '/api/me', undefined, p.token)).status).toBe(401);
    expect((await call('GET', '/api/me', undefined, r.body.token)).status).toBe(200);
    expect((await call('POST', '/api/auth/recover', { recoveryCode: 'ZZZZ-ZZZZ-ZZZZ' })).status).toBe(404);
  });
});

describe('world access and commands', () => {
  it('another account cannot read or command a world (404)', async () => {
    const a = await newPlayer('farm', 'Chủ Nhà'), b = await newPlayer('farm', 'Người Lạ');
    const snap = (await snapshotOf(a.token, a.worldId)).snapshot;
    expect((await call('GET', `/api/worlds/${a.worldId}`, undefined, b.token)).status).toBe(404);
    expect((await send(b.token, a.worldId, [command(snap, 'BUY_MATERIAL', { wood: 1 })])).status).toBe(404);
    expect((await call('GET', `/api/worlds/${a.worldId}`)).status).toBe(401);
  });
  it('the same commandId sent twice (also in parallel) applies once and returns identical results', async () => {
    const p = await newPlayer();
    const snap = (await snapshotOf(p.token, p.worldId)).snapshot;
    const cmd = command(snap, 'BUY_MATERIAL', { wood: 10 });
    const [r1, r2] = await Promise.all([send(p.token, p.worldId, [cmd]), send(p.token, p.worldId, [cmd])]);
    const r3 = await send(p.token, p.worldId, [cmd]);
    expect(r1.body.results[0]).toEqual(r2.body.results[0]);
    expect(r3.body.results[0]).toEqual(r1.body.results[0]);
    const after = (await snapshotOf(p.token, p.worldId)).snapshot;
    expect(after.wallet.wood).toBe(snap.wallet.wood + 10);
    expect(after.wallet.cash).toBe(snap.wallet.cash - 150);
    expect(after.revision).toBe(snap.revision + 1);
  });
  it('two parallel commands with the same expectedRevision: one accepted, one REVISION_CONFLICT', async () => {
    const p = await newPlayer();
    const snap = (await snapshotOf(p.token, p.worldId)).snapshot;
    const results = await Promise.all([send(p.token, p.worldId, [command(snap, 'BUY_MATERIAL', { wood: 1 })]), send(p.token, p.worldId, [command(snap, 'BUY_MATERIAL', { stone: 1 })])]);
    const codes = results.map(r => r.body.results[0]).map(x => (x.accepted ? 'OK' : x.code)).sort();
    expect(codes).toEqual(['OK', 'REVISION_CONFLICT']);
    expect((await snapshotOf(p.token, p.worldId)).snapshot.revision).toBe(snap.revision + 1);
    // docs/11 §10 metrics see both commands, including the rejection code.
    const report = app.commandMetrics.report();
    expect(report.commands).toBeGreaterThanOrEqual(2);
    expect(report.rejectedByCode.REVISION_CONFLICT).toBeGreaterThanOrEqual(1);
  });
  it('a syntactically valid but illegal command (building on water) is rejected and the wallet is unchanged', async () => {
    const p = await newPlayer();
    const { snapshot } = await snapshotOf(p.token, p.worldId);
    const loaded = templates.get(snapshot.mapId, snapshot.templateVersion)!;
    const surface = Buffer.from(loaded.template.layers.surface, 'base64');
    let water: [number, number] | null = null;
    for (const zone of snapshot.unlockedZones) for (let z = Math.floor(zone / 8) * 16; z < Math.floor(zone / 8) * 16 + 16 && !water; z++)
      for (let x = (zone % 8) * 16; x < (zone % 8) * 16 + 16 && !water; x++) if (surface[cellIndex(x, z)] === Surface.WATER) water = [x, z];
    expect(water).not.toBeNull();
    const r = await send(p.token, p.worldId, [command(snapshot, 'PLACE_BUILDING', { defId: 'market', anchor: water, rotation: 0 })]);
    expect(r.status).toBe(200);
    expect(r.body.results[0].accepted).toBe(false);
    const after = (await snapshotOf(p.token, p.worldId)).snapshot;
    expect(after.wallet).toEqual(snapshot.wallet); expect(after.revision).toBe(snapshot.revision); expect(after.buildings).toHaveLength(0);
  });
  it('rejects malformed batches and oversized bodies', async () => {
    const p = await newPlayer();
    expect((await send(p.token, p.worldId, [])).body.error).toBe('INVALID_BATCH');
    expect((await send(p.token, p.worldId, Array.from({ length: 11 }, () => ({})))).body.error).toBe('INVALID_BATCH');
    const big = await app.inject({ method: 'POST', url: `/api/worlds/${p.worldId}/commands`, headers: { authorization: `Bearer ${p.token}`, 'content-type': 'application/json' }, payload: JSON.stringify({ commands: [{ pad: 'x'.repeat(70_000) }] }) });
    expect(big.statusCode).toBe(413);
  });
  it('rate limits commands with 429', async () => {
    const limited = makeApp({ commandsPerSecond: 3, commandsPerMinute: 1000, accountsPerHour: 1000 });
    app = limited;
    const p = await newPlayer();
    const snap = (await snapshotOf(p.token, p.worldId)).snapshot;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await send(p.token, p.worldId, [command({ ...snap, revision: snap.revision + i }, 'BUY_MATERIAL', { wood: 1 })])).status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
  it('a corrupted stored world returns an error code instead of a broken snapshot', async () => {
    const p = await newPlayer();
    await db.execute(sql`UPDATE worlds SET snapshot = jsonb_set(snapshot, '{wallet,cash}', '-5') WHERE id = ${p.worldId}`);
    const r = await call('GET', `/api/worlds/${p.worldId}`, undefined, p.token);
    expect(r.status).toBe(500); expect(r.body.error).toBe('INVALID_SNAPSHOT');
  });
  it('a stored contentVersion 1 Farm world migrates on read (D025): XP kept, level recomputed, then persists as v2', async () => {
    const p = await newPlayer('farm', 'Bản Cũ');
    await db.execute(sql`UPDATE worlds SET snapshot = jsonb_set(jsonb_set(jsonb_set(snapshot, '{contentVersion}', '1'), '{progress,xp}', '5700'), '{progress,level}', '8') WHERE id = ${p.worldId}`);
    const first = await snapshotOf(p.token, p.worldId);
    expect(first.snapshot.contentVersion).toBe(2);
    expect(first.snapshot.progress).toMatchObject({ xp: 5700, level: 9 });
    const r = await send(p.token, p.worldId, [command(first.snapshot, 'BUY_MATERIAL', { wood: 1 })]);
    expect(r.body.results[0].accepted).toBe(true);
    const [row] = (await db.execute(sql`SELECT snapshot->>'contentVersion' AS v, level FROM worlds WHERE id = ${p.worldId}`)).rows as { v: string; level: number }[];
    expect(row).toMatchObject({ v: '2', level: 9 });
  });
  it('telemetry: valid report 204 without auth, malformed 400, over the per-IP limit dropped with 204', async () => {
    const limited = makeApp({ telemetryPerMinute: 2 });
    const post = (body: unknown) => limited.inject({ method: 'POST', url: '/api/telemetry', payload: body as object });
    expect((await post({ kind: 'error', message: 'TypeError: boom', path: '/' })).statusCode).toBe(204);
    expect((await post({ kind: 'nope', message: 'x' })).statusCode).toBe(400);
    expect((await post({ kind: 'load', message: 'second' })).statusCode).toBe(204);
    expect((await post({ kind: 'load', message: 'third, dropped' })).statusCode).toBe(204);
    expect((await limited.inject({ method: 'POST', url: '/api/telemetry', payload: { kind: 'error', message: 'x'.repeat(9000) } })).statusCode).toBe(413);
    await limited.close();
  });
  it('delete requires the exact character name', async () => {
    const p = await newPlayer('farm', 'Xóa Đi');
    expect((await call('DELETE', `/api/worlds/${p.worldId}`, { confirmName: 'Sai' }, p.token)).body.error).toBe('CONFIRM_NAME_MISMATCH');
    expect((await call('DELETE', `/api/worlds/${p.worldId}`, { confirmName: 'Xóa Đi' }, p.token)).status).toBe(204);
    expect((await call('GET', `/api/worlds/${p.worldId}`, undefined, p.token)).status).toBe(404);
    expect((await call('POST', '/api/characters', { mapKind: 'farm', displayName: 'Làm Lại' }, p.token)).status).toBe(201);
  });
});

describe('server state equals the shared sim (property test)', () => {
  it('100 random commands: every result and the final state hash match a local sim; reload is identical; net worth recomputes', async () => {
    const p = await newPlayer('farm', 'Thuộc Tính');
    const restorer = new WorldService(db, templates, clock);
    let local: SimState = restorer.restore((await snapshotOf(p.token, p.worldId)).snapshot, now);
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const zones = local.snapshot.unlockedZones;
    const randomCell = (): [number, number] => { const zone = zones[rnd(zones.length)]!; return [(zone % 8) * 16 + rnd(16), Math.floor(zone / 8) * 16 + rnd(16)]; };
    let accepted = 0, rejected = 0;
    for (let i = 0; i < 100; i++) {
      now += rnd(10) * 60_000;
      const kind = rnd(9), [x, z] = randomCell();
      const options: [CommandType, unknown][] = [
        ['BUY_MATERIAL', { wood: 1 + rnd(5), stone: rnd(3) }],
        ['CLEAR_ENV', { envIds: local.env.filter(e => !local.snapshot.delta.removedEnvIds.includes(e.id)).slice(rnd(50), rnd(50) + 2).map(e => e.id) }],
        ['TILL', { rect: [x, z, Math.min(127, x + rnd(3)), Math.min(127, z + rnd(2))] }],
        ['BUILD_ROAD', { tier: 1, cells: [[x, z], [Math.min(127, x + 1), z]] }],
        ['TERRAFORM', { rect: [x, z, x, z], mode: rnd(2) ? 'RAISE' : 'LOWER' }],
        ['PLANT', { rect: [x, z, Math.min(127, x + 2), z], cropId: 'veg_greens' }],
        ['HARVEST', { cells: [[x, z]] }],
        ['PLACE_BUILDING', { defId: ['market', 'farmhouse', 'well'][rnd(3)], anchor: [x, z], rotation: rnd(4) }],
        ['CLAIM_QUEST', { questId: catalog.quests.farm[local.snapshot.progress.questIndex]?.id ?? 'none' }],
      ];
      const [type, payload] = options[kind]!;
      const cmd = command(local.snapshot, type, payload);
      const expected = execute(local, cmd, now);
      const r = await send(p.token, p.worldId, [cmd]);
      expect(r.status).toBe(200);
      expect(r.body.results[0].accepted).toBe(expected.result.accepted);
      if (!expected.result.accepted) expect(r.body.results[0].code).toBe(expected.result.code);
      if (expected.result.accepted) { local = expected.state; accepted++; } else rejected++;
      expect(r.body.revision).toBe(local.snapshot.revision);
      expect(r.body.stateHash).toBe(stateHash(local));
    }
    // The authored farm v2 map has more forest/water cells, so ~10% of random commands succeed; enough to
    // exercise state changes (the assertions above check every result and hash against the shared sim).
    expect(accepted).toBeGreaterThanOrEqual(10);
    expect(rejected).toBeGreaterThan(5);
    const first = await snapshotOf(p.token, p.worldId), second = await snapshotOf(p.token, p.worldId);
    expect(second.stateHash).toBe(first.stateHash);
    const reloaded = restorer.restore(first.snapshot, now);
    expect(netWorth(reloaded)).toBe(first.snapshot.character.netWorth);
  });
});
