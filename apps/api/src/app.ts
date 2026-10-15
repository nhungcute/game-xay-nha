import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { MapKindSchema } from '@xay-nha/contracts';
import * as schema from './db/schema';
import { hashSecret, newToken, tokenHash, usernameKey, validPin, validateDisplayName, verifyNothing, verifySecret } from './auth';
import { CommandMetrics } from './metrics';
import { RateLimiter } from './rateLimit';
import { parseTelemetry } from './telemetry';
import type { TemplateRegistry } from './templates';
import { ApiError, MAX_BATCH, WorldService } from './worlds';

export interface AppDeps {
  db: NodePgDatabase<typeof schema>; templates: TemplateRegistry; tokenPepper: string;
  clock?: () => number; logLevel?: string; trustProxy?: boolean;
  /** D039 (RANDOM_MAPS=1): new worlds get a random server-generated map. Default off. */
  randomMaps?: boolean;
  /** Interval for the periodic `metrics` log line (docs/11 §10); 0 disables it. Default 60 s. */
  metricsIntervalMs?: number;
  limits?: { accountsPerHour?: number; loginsPerHour?: number; commandsPerSecond?: number; commandsPerMinute?: number; telemetryPerMinute?: number };
}

declare module 'fastify' { interface FastifyInstance { commandMetrics: CommandMetrics } }

export function buildApp(deps: AppDeps): FastifyInstance {
  const clock = deps.clock ?? Date.now;
  const app = Fastify({ logger: { level: deps.logLevel ?? 'info' }, bodyLimit: 64 * 1024, trustProxy: deps.trustProxy ?? true, genReqId: () => randomUUID() });
  const worlds = new WorldService(deps.db, deps.templates, clock, deps.randomMaps ?? false);
  const accountsLimit = new RateLimiter(deps.limits?.accountsPerHour ?? 5, 3_600_000, clock);
  const loginLimit = new RateLimiter(deps.limits?.loginsPerHour ?? 30, 3_600_000, clock);
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

  const bearer = (request: FastifyRequest): Buffer | null => {
    const header = request.headers.authorization;
    return header?.startsWith('Bearer ') ? tokenHash(header.slice(7).trim(), deps.tokenPepper) : null;
  };
  async function account(request: FastifyRequest): Promise<string> {
    const hash = bearer(request);
    if (!hash) throw new ApiError(401, 'UNAUTHORIZED');
    const [row] = await deps.db.select({ id: schema.sessions.accountId }).from(schema.sessions).where(eq(schema.sessions.tokenHash, hash));
    if (!row) throw new ApiError(401, 'UNAUTHORIZED');
    const now = clock();
    if ((lastSeen.get(row.id) ?? 0) < now - 60_000) {
      lastSeen.set(row.id, now);
      await deps.db.update(schema.accounts).set({ lastSeenAt: sql`now()` }).where(eq(schema.accounts.id, row.id));
      await deps.db.update(schema.sessions).set({ lastSeenAt: sql`now()` }).where(eq(schema.sessions.tokenHash, hash));
    }
    return row.id;
  }
  /** A new device session for the account; the raw token is returned once and only its hash is stored. */
  async function openSession(accountId: string): Promise<string> {
    const token = newToken();
    await deps.db.insert(schema.sessions).values({ tokenHash: tokenHash(token, deps.tokenPepper), accountId });
    return token;
  }
  const usernameOf = async (accountId: string): Promise<string | null> =>
    (await deps.db.select({ username: schema.accounts.username }).from(schema.accounts).where(eq(schema.accounts.id, accountId)))[0]?.username ?? null;
  const isUniqueViolation = (error: unknown): boolean => {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code === '23505' || e.cause?.code === '23505';
  };

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

  // D027 — new player: unique username + PIN + first map. Creates the account, a session and the first character.
  app.post('/api/auth/register', async (request, reply) => {
    const body = (request.body ?? {}) as { username?: unknown; pin?: unknown; mapKind?: unknown };
    const kind = MapKindSchema.safeParse(body.mapKind);
    if (!kind.success) throw new ApiError(400, 'INVALID_MAP');
    const name = validateDisplayName(body.username);
    if (!name.ok) throw new ApiError(400, `NAME_${name.reason}`);
    if (!validPin(body.pin)) throw new ApiError(400, 'INVALID_PIN');
    const key = usernameKey(name.name);
    const [taken] = await deps.db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.usernameKey, key));
    if (taken) throw new ApiError(409, 'USERNAME_TAKEN');
    if (!accountsLimit.take(request.ip)) throw new ApiError(429, 'RATE_LIMITED');
    const accountId = randomUUID();
    try {
      await deps.db.insert(schema.accounts).values({ id: accountId, username: name.name, usernameKey: key, pinHash: await hashSecret(body.pin) });
    } catch (error) { if (isUniqueViolation(error)) throw new ApiError(409, 'USERNAME_TAKEN'); throw error; }
    try {
      const character = await worlds.createCharacter(accountId, kind.data, name.name);
      const token = await openSession(accountId);
      return reply.status(201).send({ accountId, username: name.name, character, token, serverTime: clock() });
    } catch (error) {
      await deps.db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)); // never leave orphan accounts
      throw error;
    }
  });

  // D027 — returning player on any device: username + PIN. 5 wrong PINs lock that username for 15 minutes.
  const MAX_FAILURES = 5, LOCK_MS = 15 * 60_000;
  app.post('/api/auth/login', async request => {
    if (!loginLimit.take(request.ip)) throw new ApiError(429, 'RATE_LIMITED');
    const body = (request.body ?? {}) as { username?: unknown; pin?: unknown };
    if (typeof body.username !== 'string' || !validPin(body.pin)) throw new ApiError(401, 'INVALID_LOGIN');
    const [row] = await deps.db.select().from(schema.accounts).where(eq(schema.accounts.usernameKey, usernameKey(body.username)));
    if (!row?.pinHash) { await verifyNothing(body.pin); throw new ApiError(401, 'INVALID_LOGIN'); }
    const now = clock();
    if (row.lockedUntil && row.lockedUntil.getTime() > now) throw new ApiError(429, 'LOGIN_LOCKED', 'Too many wrong PINs', { retryAfterSeconds: Math.ceil((row.lockedUntil.getTime() - now) / 1000) });
    if (!(await verifySecret(body.pin, row.pinHash))) {
      const failures = row.failedLogins + 1, lock = failures >= MAX_FAILURES;
      await deps.db.update(schema.accounts).set({ failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(now + LOCK_MS) : null }).where(eq(schema.accounts.id, row.id));
      if (lock) throw new ApiError(429, 'LOGIN_LOCKED', 'Too many wrong PINs', { retryAfterSeconds: LOCK_MS / 1000 });
      throw new ApiError(401, 'INVALID_LOGIN', 'Wrong username or PIN', { attemptsLeft: MAX_FAILURES - failures });
    }
    await deps.db.update(schema.accounts).set({ failedLogins: 0, lockedUntil: null, lastSeenAt: sql`now()` }).where(eq(schema.accounts.id, row.id));
    const token = await openSession(row.id);
    return { accountId: row.id, username: row.username, token, characters: await worlds.list(row.id), serverTime: clock() };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const hash = bearer(request);
    if (hash) await deps.db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hash));
    return reply.status(204).send();
  });

  // A signed-in player opens a character on another map; the character name is the account's username.
  app.post('/api/characters', async (request, reply) => {
    const accountId = await account(request);
    const body = (request.body ?? {}) as { mapKind?: unknown; displayName?: unknown };
    const kind = MapKindSchema.safeParse(body.mapKind);
    if (!kind.success) throw new ApiError(400, 'INVALID_MAP');
    const name = validateDisplayName((await usernameOf(accountId)) ?? body.displayName);
    if (!name.ok) throw new ApiError(400, `NAME_${name.reason}`);
    const character = await worlds.createCharacter(accountId, kind.data, name.name);
    return reply.status(201).send({ accountId, character, serverTime: clock() });
  });

  app.get('/api/me', async request => {
    const accountId = await account(request);
    return { accountId, username: await usernameOf(accountId), characters: await worlds.list(accountId), serverTime: clock() };
  });

  app.get<{ Params: { id: string } }>('/api/worlds/:id', async request => {
    const accountId = await account(request);
    return worlds.snapshot(accountId, request.params.id);
  });

  // D039: the world's template (random maps: stored per world). Immutable, so clients may cache it forever.
  app.get<{ Params: { id: string } }>('/api/worlds/:id/template', async (request, reply) => {
    const accountId = await account(request);
    const { json, etag } = await worlds.template(accountId, request.params.id);
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=31536000, immutable');
    if (request.headers['if-none-match']?.split(',').some(tag => tag.trim() === etag)) return reply.status(304).send();
    return reply.type('application/json; charset=utf-8').send(json);
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
