# G2 gate report — Server, name login, persistence, server-side economy

Date: 2026-10-10 (Asia/Bangkok). Mode: auto-continue.

## 1. What was built

| Area | Result |
|---|---|
| `apps/api` | Fastify 5.12.5 + pg 8.23.1 + drizzle-orm 0.44.7; routes `POST /api/characters`, `POST /api/auth/recover`, `GET /api/me`, `GET /api/maps`, `GET/DELETE /api/worlds/:id`, `POST /api/worlds/:id/commands`, `GET /health` |
| Auth | Invisible account per device; 32-byte token stored as peppered SHA-256; recovery code `XXXX-XXXX-XXXX` (Crockford) hashed with scrypt, indexed by a peppered prefix hash; recovery revokes old tokens; name rules 3–20 chars, Unicode letters/digits/single spaces, small blocklist; `#tag` unique per name |
| Characters | One per map per account (`CHARACTER_EXISTS` 409); independent wallets, XP, levels, net worth |
| Commands | ≤ 10 per request, one transaction, `SELECT … FOR UPDATE`, per-command idempotency (`world_commands`), `expectedRevision`, shared `sim` execute at server time, construction completions processed in time order, every result stored; response carries `stateHash` |
| Persistence | `worlds.snapshot` JSONB re-validated with `validateSnapshot` on every read (D022); migrations under an advisory lock |
| Abuse limits | 5 new accounts/hour/IP, 10 recoveries/hour/IP, 20 commands/s/world, 300 commands/min/account, 64 KB body |
| Client | Start screens (map choice, character creation, one-time recovery code with copy, recovery form); online `WorldStore` transport: optimistic apply, batched sends, server-hash verification, rebase on rejection, resync on mismatch, offline queue (≤ 20) with backoff; HUD connection status; map switch; city-aware HUD (income/collect, people/jobs) |
| Docker | `postgres:16.10-alpine` (volume, no published port), `api` image (bundled `dist/server.js`), `web` nginx proxying `/api` with Docker-DNS re-resolution; `infra/.env` generated with random secrets; tunnel profile unchanged |

## 2. Commands and real results

| Command | Result |
|---|---|
| `pnpm check` | exit 0 — 641/641 unit tests, lint, typecheck, build |
| `pnpm test:api` (Postgres 16.10 container) | **22/22** integration tests |
| `node scripts/g2-e2e.mjs` (dev: vite online + API + Postgres) | **13/13** |
| `pnpm deploy:up` then `BASE_URL=http://127.0.0.1:8090 node scripts/g2-e2e.mjs` | **13/13** on the production Docker stack |
| Restart `api` + `postgres` containers, `GET /api/me` with the same token | character still present (`Kiem Tra Luu`, level 1, $2 500) |
| `nc` from the host to 5432 | refused; reachable only inside the compose network |

## 3. Exit criteria

| Criterion | Evidence | Status |
|---|---|---|
| docs/10 §3 integration tests | 22 tests: account/character creation, invalid names, tags, new-map character, `CHARACTER_EXISTS`, city/farm independence, recovery + token revocation, cross-account 404, duplicate `commandId` (parallel), revision conflict, illegal command, batch/body limits, 429, corrupted row → `INVALID_SNAPSHOT`, delete, 100-command property test with per-command `stateHash` equality and net-worth recomputation | PASS |
| curl-crafted invalid command rejected | E2E step 5: market on the river → `CELL_BLOCKED`, wallet unchanged | PASS |
| State identical after reload | E2E step 3 (canonical comparison of revision, wallet, progress, buildings, terrain deltas) | PASS |
| Two characters on one account independent | integration test "commands on the city character never change the farm character" | PASS |
| Full Docker stack up | postgres/api/web healthy; E2E 13/13 through nginx | PASS |

Evidence: `docs/evidence/g2/` (dev run) and `docs/evidence/g2/docker/` (production stack): screenshots of map choice, character creation, recovery code, game start, built market, offline queue, recovered device; `g2-e2e.json`.

## 4. Fixes made during the gate

- Reconnection never cleared the "offline" status after a successful retry → fixed in `WorldStore.flush`.
- nginx kept a stale API IP after the API container restarted (permanent 502) → Docker DNS resolver with a variable upstream; re-verified with container restarts.
- `advanceForTest` is refused in online mode (would desynchronise the clock); the camera debug hook is available with `?debug=1` (view-only).

## 5. Deviations

- D022: JSONB snapshot persistence instead of normalized tables; scrypt instead of argon2id.
- D023: local ports (8090 web, 3217 API dev, 55432 test DB) because 3000/3100/8080 are taken on the host.

## 6. Known issues and NOT verified

- **Not verified:** the Cloudflare tunnel (product owner starts it), real phones, WebKit, more than a few concurrent players.
- Rate limiting is in-memory (single API instance) and keys on `X-Forwarded-For`; behind cloudflared + nginx a client could spoof the left-most address to evade the per-IP account limit. Acceptable for a trusted-tester tunnel; revisit before public launch.
- City map: no template yet (G3) — the city card shows "Sắp mở".
- The IndexedDB cache is written in online mode but not yet used to show the world before the server answers.

## 7. Next gate (G3)

City + farm templates per docs/03 and docs/04 (layout tooling), full catalog and limits UI, 24 authored quests + repeat quests (D017), tutorial flow (docs/09 §5), profile/net worth, `sim-economy` port, 5-angle screenshots per map, E2E docs/10 §4 on Chromium + WebKit emulation.
