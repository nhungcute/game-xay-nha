import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MapKindSchema } from '@xay-nha/contracts';
import * as schema from './db/schema';
import { hashRecovery, newRecoveryCode, newToken, normalizeRecoveryCode, recoveryPrefixHash, tokenHash, validateDisplayName, verifyRecovery } from './auth';
import { CommandMetrics } from './metrics';
import { RateLimiter } from './rateLimit';
import { parseTelemetry } from './telemetry';
import type { TemplateRegistry } from './templates';
import { ApiError, MAX_BATCH, WorldService } from './worlds';

export interface AppDeps {
  db: NodePgDatabase<typeof schema>; templates: TemplateRegistry; tokenPepper: string;
  clock?: () => number; logLevel?: string; trustProxy?: boolean;
  /** Interval for the periodic `metrics` log line (docs/11 §10); 0 disables it. Default 60 s. */
  metricsIntervalMs?: number;
  limits?: { accountsPerHour?: number; recoverPerHour?: number; commandsPerSecond?: number; commandsPerMinute?: number; telemetryPerMinute?: number };
}

declare module 'fastify' { interface FastifyInstance { commandMetrics: CommandMetrics } }

export function buildApp(deps: AppDeps): FastifyInstance {
  const clock = deps.clock ?? Date.now;
  const app = Fastify({ logger: { level: deps.logLevel ?? 'info' }, bodyLimit: 64 * 1024, trustProxy: deps.trustProxy ?? true, genReqId: () => randomUUID() });
  const worlds = new WorldService(deps.db, deps.templates, clock);
  const accountsLimit = new RateLimiter(deps.limits?.accountsPerHour ?? 5, 3_600_000, clock);
  const recoverLimit = new RateLimiter(deps.limits?.recoverPerHour ?? 10, 3_600_000, clock);
  const perSecond = new RateLimiter(deps.limits?.commandsPerSecond ?? 20, 1000, clock);
  const perMinute = new RateLimiter(deps.limits?.commandsPerMinute ?? 300, 60_000, clock);
  const lastSeen = new Map<string, number>();
  const telemetryLimit = new RateLimiter(deps.limits?.telemetryPerMinute ?? 30, 60_000, clock);
  const metrics = new CommandMetrics(300_000, clock);
  app.decorate('commandMetrics', metrics);
  const interval = deps.metricsIntervalMs ?? 60_000;
  if (interval > 0) {
    const timer = setInterval(() => { const report = metrics.report(); if (report.commands) app.log.info({ metrics: report }, 'metrics'); }, interval);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.status(error.status).send({ error: error.code, message: error.message, detail: error.detail, serverTime: clock() });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.status(413).send({ error: 'PAYLOAD_TOO_LARGE' });
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: 'BAD_REQUEST', message: (error as Error).message });
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: 'INTERNAL', requestId: request.id });
  });

  async function account(request: FastifyRequest): Promise<string> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED');
    const [row] = await deps.db.select({ id: schema.accounts.id }).from(schema.accounts)
      .where(eq(schema.accounts.tokenHash, tokenHash(header.slice(7).trim(), deps.tokenPepper)));
    if (!row) throw new ApiError(401, 'UNAUTHORIZED');
    const now = clock();
    if ((lastSeen.get(row.id) ?? 0) < now - 60_000) {
      lastSeen.set(row.id, now);
      await deps.db.update(schema.accounts).set({ lastSeenAt: sql`now()` }).where(eq(schema.accounts.id, row.id));
    }
    return row.id;
  }

  app.get('/health', async () => { await deps.db.execute(sql`SELECT 1`); return { ok: true, serverTime: clock() }; });
  // docs/11 §10: browser error reports (no auth; per-IP limit; small body; log only). Over-limit reports are dropped silently.
  app.post('/api/telemetry', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    if (!telemetryLimit.take(request.ip)) return reply.status(204).send();
    const report = parseTelemetry(request.body);
    if (!report) throw new ApiError(400, 'INVALID_TELEMETRY');
    request.log.warn({ telemetry: report, userAgent: String(request.headers['user-agent'] ?? '').slice(0, 200) }, 'client-error');
    return reply.status(204).send();
  });
  app.get('/api/maps', async () => ({ maps: deps.templates.maps(), serverTime: clock() }));

  // Creates a character for a map; also creates the (invisible) account when no token is sent.
  app.post('/api/characters', async (request, reply) => {
    const body = (request.body ?? {}) as { mapKind?: unknown; displayName?: unknown };
    const kind = MapKindSchema.safeParse(body.mapKind);
    if (!kind.success) throw new ApiError(400, 'INVALID_MAP');
    const name = validateDisplayName(body.displayName);
    if (!name.ok) throw new ApiError(400, `NAME_${name.reason}`);
    let accountId = request.headers.authorization ? await account(request) : null;
    let token: string | undefined, recoveryCode: string | undefined;
    if (!accountId) {
      if (!accountsLimit.take(request.ip)) throw new ApiError(429, 'RATE_LIMITED');
      token = newToken(); recoveryCode = newRecoveryCode(); accountId = randomUUID();
      await deps.db.insert(schema.accounts).values({ id: accountId, tokenHash: tokenHash(token, deps.tokenPepper),
        recoveryHash: await hashRecovery(recoveryCode), recoveryPrefixHash: recoveryPrefixHash(recoveryCode, deps.tokenPepper) });
    }
    try {
      const character = await worlds.createCharacter(accountId, kind.data, name.name);
      return reply.status(201).send({ accountId, character, ...(token ? { token, recoveryCode } : {}), serverTime: clock() });
    } catch (error) {
      if (token) await deps.db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)); // never leave orphan accounts
      throw error;
    }
  });

  app.post('/api/auth/recover', async request => {
    if (!recoverLimit.take(request.ip)) throw new ApiError(429, 'RATE_LIMITED');
    const code = normalizeRecoveryCode(String((request.body as { recoveryCode?: unknown } | null)?.recoveryCode ?? ''));
    if (!code) throw new ApiError(400, 'INVALID_RECOVERY_CODE');
    const candidates = await deps.db.select().from(schema.accounts).where(eq(schema.accounts.recoveryPrefixHash, recoveryPrefixHash(code, deps.tokenPepper)));
    for (const candidate of candidates) {
      if (!(await verifyRecovery(code, candidate.recoveryHash))) continue;
      const token = newToken(); // replacing the hash revokes every previous token (one token per account in MVP)
      await deps.db.update(schema.accounts).set({ tokenHash: tokenHash(token, deps.tokenPepper), lastSeenAt: sql`now()` }).where(eq(schema.accounts.id, candidate.id));
      return { accountId: candidate.id, token, characters: await worlds.list(candidate.id), serverTime: clock() };
    }
    throw new ApiError(404, 'INVALID_RECOVERY_CODE');
  });

  app.get('/api/me', async request => {
    const accountId = await account(request);
    return { accountId, characters: await worlds.list(accountId), serverTime: clock() };
  });

  app.get<{ Params: { id: string } }>('/api/worlds/:id', async request => {
    const accountId = await account(request);
    return worlds.snapshot(accountId, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/worlds/:id/commands', async request => {
    const accountId = await account(request);
    const commands = (request.body as { commands?: unknown } | null)?.commands;
    const count = Array.isArray(commands) ? Math.min(commands.length, MAX_BATCH) : 1;
    if (!perSecond.take(`w:${request.params.id}`, count) || !perMinute.take(`a:${accountId}`, count)) throw new ApiError(429, 'RATE_LIMITED');
    const started = performance.now();
    const response = await worlds.commands(accountId, request.params.id, commands);
    const durationMs = Math.round((performance.now() - started) * 100) / 100, worldId = request.params.id;
    // docs/11 §10: one JSON log line per command (requestId is attached by the request logger).
    response.results.forEach((result, i) => {
      const code = result.accepted ? undefined : result.code;
      const commandType = (Array.isArray(commands) ? (commands[i] as { type?: unknown } | undefined)?.type : undefined);
      metrics.record(worldId, result.accepted, code, durationMs / response.results.length);
      request.log.info({ accountId, worldId, commandId: result.commandId, commandType: typeof commandType === 'string' ? commandType : 'INVALID',
        accepted: result.accepted, code, durationMs, revision: result.revision }, 'command');
    });
    return response;
  });

  app.delete<{ Params: { id: string } }>('/api/worlds/:id', async (request, reply) => {
    const accountId = await account(request);
    await worlds.remove(accountId, request.params.id, (request.body as { confirmName?: unknown } | null)?.confirmName);
    return reply.status(204).send();
  });

  return app;
}
