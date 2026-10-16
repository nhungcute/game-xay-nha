import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { WorldTemplateSchema, type CommandResult, type MapKind, type WorldSnapshot } from '@xay-nha/contracts';
import { RANDOM_GENERATOR_VERSION, generateEnvironment, generateWorldTemplate, validateTemplate } from '@xay-nha/worldgen';
import { advanceTime, createState, execute, recompute, stateHash, validateSnapshot, type SimState } from '@xay-nha/sim';
import * as schema from './db/schema';
import { randomTag } from './auth';
import { TemplateRegistry, type LoadedTemplate } from './templates';

type Db = NodePgDatabase<typeof schema>;
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = code, readonly detail?: unknown) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_BATCH = 10;

export interface CharacterSummary {
  id: string; mapKind: MapKind; mapId: string; templateVersion: number; displayName: string; tag: string;
  level: number; xp: number; cash: number; netWorth: number; updatedAt: string;
}
export interface CommandBatchResponse { results: CommandResult[]; revision: number; serverTime: number; stateHash: string }

export class WorldService {
  /** `randomMaps` (RANDOM_MAPS=1): new worlds get a server-generated random map stored in `world_templates` (D039). */
  constructor(private readonly db: Db, private readonly templates: TemplateRegistry, private readonly clock: () => number = Date.now,
    private readonly randomMaps = false) {
    templates.setRandomLoader(async worldId => {
      const [row] = await this.db.select({ template: schema.worldTemplates.template }).from(schema.worldTemplates).where(eq(schema.worldTemplates.worldId, worldId));
      return row ? WorldTemplateSchema.parse(row.template) : undefined;
    });
  }

  /** Rebuilds a SimState from stored JSON through validate-everything-then-swap (docs/08 §6.1). */
  async restore(stored: unknown, now: number): Promise<SimState> {
    const snapshot = stored as WorldSnapshot;
    const loaded = await this.templates.forWorld(snapshot.worldId, snapshot.mapId, snapshot.templateVersion);
    if (!loaded) throw new ApiError(500, 'TEMPLATE_MISSING', `Template ${snapshot.mapId}@${snapshot.templateVersion} is not available`);
    const base = createState(loaded.template, Math.min(now, snapshot.serverTime), loaded.env, {
      worldId: snapshot.worldId, accountId: snapshot.accountId, displayName: snapshot.character.displayName, tag: snapshot.character.tag });
    const checked = validateSnapshot(base, stored, now);
    if (!checked.ok) throw new ApiError(500, 'INVALID_SNAPSHOT', 'Stored world failed validation', checked.errors.slice(0, 10));
    recompute(checked.state);
    return checked.state;
  }

  async createCharacter(accountId: string, mapKind: MapKind, displayName: string): Promise<CharacterSummary> {
    // Town has no authored template: it is always generated (even with RANDOM_MAPS off).
    const randomMaps = this.randomMaps || mapKind === 'town', staticMap = this.templates.latestFor(mapKind);
    if (!staticMap && !randomMaps) throw new ApiError(400, 'MAP_UNAVAILABLE', `Map ${mapKind} is not available yet`);
    const existing = await this.db.select({ id: schema.worlds.id }).from(schema.worlds)
      .where(and(eq(schema.worlds.accountId, accountId), eq(schema.worlds.mapKind, mapKind)));
    if (existing.length) throw new ApiError(409, 'CHARACTER_EXISTS', 'This account already has a character on that map', { characterId: existing[0]!.id });
    // D039: generate once per registration; the same template is stored with every retry of the unique-tag loop.
    let random: { loaded: LoadedTemplate; seed: number; attempt: number } | undefined;
    if (randomMaps) {
      const seed = randomInt(0, 2 ** 32);
      const generated = generateWorldTemplate(mapKind, seed);
      const errors = validateTemplate(generated.template);
      if (errors.length) throw new ApiError(500, 'MAP_GENERATION_FAILED', `Generated template is invalid: ${errors.slice(0, 3).join('; ')}`);
      random = { loaded: { template: generated.template, env: generateEnvironment(generated.template), path: 'db:new' }, seed, attempt: generated.attempt };
    }
    const loaded = (random?.loaded ?? staticMap)!;
    for (let attempt = 0; attempt < 25; attempt++) {
      const now = this.clock(), id = randomUUID(), tag = randomTag();
      const state = createState(loaded.template, now, loaded.env, { worldId: id, accountId, displayName, tag });
      recompute(state);
      try {
        await this.db.transaction(async tx => {
          await tx.insert(schema.worlds).values({
            id, accountId, mapId: loaded.template.mapId, mapKind, templateVersion: loaded.template.templateVersion,
            displayName, tag, level: state.snapshot.progress.level, netWorth: state.snapshot.character.netWorth,
            revision: state.snapshot.revision, snapshot: state.snapshot,
          });
          if (random) {
            await tx.insert(schema.worldTemplates).values({
              worldId: id, mapId: loaded.template.mapId, generatorVersion: RANDOM_GENERATOR_VERSION, seed: random.seed, attempt: random.attempt, template: loaded.template,
            });
          }
        });
        if (random) this.templates.cacheRandom(id, loaded.template, loaded.env);
        return summary(state.snapshot, new Date(now));
      } catch (error) {
        if (isUniqueViolation(error, 'worlds_display_name_tag_key')) continue;
        if (isUniqueViolation(error, 'worlds_account_id_map_kind_key')) throw new ApiError(409, 'CHARACTER_EXISTS');
        throw error;
      }
    }
    throw new ApiError(409, 'NAME_TAKEN', 'Too many characters already use this name');
  }

  async list(accountId: string): Promise<CharacterSummary[]> {
    const rows = await this.db.select().from(schema.worlds).where(eq(schema.worlds.accountId, accountId));
    return rows.map(r => summary(r.snapshot as WorldSnapshot, r.updatedAt));
  }

  /** GET snapshot: completions and income are processed up to now (not persisted; commands persist). */
  async snapshot(accountId: string, worldId: string): Promise<{ snapshot: WorldSnapshot; stateHash: string; serverTime: number }> {
    const row = await this.row(accountId, worldId);
    const now = this.clock(), state = await this.restore(row.snapshot, now);
    advanceTime(state, now);
    return { snapshot: state.snapshot, stateHash: stateHash(state), serverTime: now };
  }

  /** D039: the world's own template (random maps: the stored JSON; static maps: the shared file) with a strong ETag. */
  async template(accountId: string, worldId: string): Promise<{ json: string; etag: string }> {
    const row = await this.row(accountId, worldId);
    const loaded = await this.templates.forWorld(worldId, row.mapId, row.templateVersion);
    if (!loaded) throw new ApiError(500, 'TEMPLATE_MISSING', `Template ${row.mapId}@${row.templateVersion} is not available`);
    return TemplateRegistry.payload(loaded);
  }

  async remove(accountId: string, worldId: string, confirmName: unknown): Promise<void> {
    const row = await this.row(accountId, worldId);
    if (typeof confirmName !== 'string' || confirmName.normalize('NFC').trim() !== row.displayName) throw new ApiError(400, 'CONFIRM_NAME_MISMATCH');
    await this.db.delete(schema.worlds).where(eq(schema.worlds.id, worldId));
  }

  /**
   * docs/08 §5 — one transaction per batch: row lock, per-command idempotency, revision check,
   * sim validate/apply at server time, persist accepted state, store every result.
   */
  async commands(accountId: string, worldId: string, batch: unknown): Promise<CommandBatchResponse> {
    if (!Array.isArray(batch) || batch.length === 0 || batch.length > MAX_BATCH) throw new ApiError(400, 'INVALID_BATCH', `Send 1–${MAX_BATCH} commands`);
    return this.db.transaction(async tx => {
      const [row] = await tx.select().from(schema.worlds)
        .where(and(eq(schema.worlds.id, worldId), eq(schema.worlds.accountId, accountId))).for('update');
      if (!row) throw new ApiError(404, 'NOT_FOUND');
      const now = this.clock();
      let state = await this.restore(row.snapshot, now), changed = false;
      const results: CommandResult[] = [];
      for (const command of batch) {
        const commandId = (command as { commandId?: unknown })?.commandId;
        const storable = typeof commandId === 'string' && UUID.test(commandId);
        if (storable) {
          const [prior] = await tx.select().from(schema.worldCommands).where(eq(schema.worldCommands.commandId, commandId));
          if (prior) {
            if (prior.worldId !== worldId) { results.push(reject(commandId, 'INVALID_COMMAND', state, now)); continue; }
            results.push(prior.result as CommandResult); continue;
          }
        }
        const execution = execute(state, command, now);
        results.push(execution.result);
        if (execution.result.accepted) { state = execution.state; changed = true; }
        if (storable) {
          await tx.insert(schema.worldCommands).values({ commandId, worldId, accepted: execution.result.accepted,
            revisionAfter: state.snapshot.revision, result: execution.result }).onConflictDoNothing();
        }
      }
      if (changed) {
        await tx.update(schema.worlds).set({
          snapshot: state.snapshot, revision: state.snapshot.revision, level: state.snapshot.progress.level,
          netWorth: state.snapshot.character.netWorth, updatedAt: sql`now()`,
        }).where(eq(schema.worlds.id, worldId));
      }
      return { results, revision: state.snapshot.revision, serverTime: now, stateHash: stateHash(state) };
    });
  }

  private async row(accountId: string, worldId: string) {
    if (!UUID.test(worldId)) throw new ApiError(404, 'NOT_FOUND');
    const [row] = await this.db.select().from(schema.worlds).where(and(eq(schema.worlds.id, worldId), eq(schema.worlds.accountId, accountId)));
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return row;
  }
}

function summary(s: WorldSnapshot, updatedAt: Date): CharacterSummary {
  return { id: s.worldId, mapKind: s.mapKind, mapId: s.mapId, templateVersion: s.templateVersion, displayName: s.character.displayName,
    tag: s.character.tag, level: s.progress.level, xp: s.progress.xp, cash: s.wallet.cash, netWorth: s.character.netWorth, updatedAt: updatedAt.toISOString() };
}
function reject(commandId: string, code: 'INVALID_COMMAND', state: SimState, now: number): CommandResult {
  return { commandId, accepted: false, code, revision: state.snapshot.revision, serverTime: now };
}
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const e = (error as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string });
  const inner = e?.cause ?? e;
  return inner?.code === '23505' && inner.constraint === constraint;
}
