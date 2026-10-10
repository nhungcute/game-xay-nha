# G4 gate report — Release readiness (local Docker + tunnel)

Date: 2026-10-10 (Asia/Bangkok). Mode: auto-continue. Implementation: Claude Code session; closeout: Codex.
G3 is reported separately in `G3-report.md` (its economy comparison is produced by Codex's bot).
**Closeout validation PASS at `2303cb5`: 682 unit cases, 22 API cases, local deploy and production smoke.**
G3 economy remains FAIL awaiting Q010; real-device performance and human tutorial timing are NOT RUN.
Earlier measurements in the first table below are retained evidence, not new executions.

## 1. What was built

| Area | Result | Commit |
|---|---|---|
| Low-graphics mode (docs/11 §8) | `apps/web/src/game/quality.ts`: "Thấp" disables shadows, lowers the pixel ratio (desktop 1.5 / phone 1.25), drops flowers/reeds, keeps ~half the bushes, merges scenery into one batch per asset. Touch devices start on "Thấp"; toggle in the profile panel; remembered per browser (storage failures tolerated) | `ccfd992` |
| Debug panel (docs/11 §10) | `?debug=1`: FPS, draw calls, triangles, GPU geometries/textures/programs, zone rebuild ms + count, revision, command queue, clock skew, graphics level | `ccfd992` |
| Mobile polish | Panels placed under the measured HUD height (`--hud-bottom`), compact two-row HUD ≤ 480 px (iPhone SE HUD 224 → 137 px), tool labels never clipped | `15ea869` |
| API observability (docs/11 §10) | One JSON log line per command (`reqId`, `accountId`, `worldId`, `commandType`, `accepted`, `code`, `durationMs`); a `metrics` line every 60 s: commands/s, rejection rate by code, p95, active worlds (5-min window) | `f8c8d1c` |
| Backups (docs/11 §9) | Compose service `backup`: `pg_dump -Fc` at start and every 24 h into `./backups` (gitignored, not in images), newest 7 kept; `pnpm db:backup`; `pnpm db:restore <file> --yes` (stops api, `pg_restore --clean`, restarts, waits for health) | `c5f0245` |
| Deploy docs | `docs/DEPLOY_LOCAL.md`: commands, tunnel flow, backups/restore, observability, graphics setting, warnings | `c5f0245`, `e67307a` |
| Release scripts | `scripts/g4-smoke.mjs` (production UI smoke, Chromium + WebKit), `scripts/g4-soak.mjs` (15-minute UI soak) | `e67307a`, `3ebefea` |

## 2. Commands and real results

| Command | Result |
|---|---|
| `pnpm check` (Node 24.19, 2026-10-10 ~08:05) | exit 0 — **676/676** unit tests in 23 files, lint, typecheck, content check, build |
| `pnpm test:api` (Postgres 16.10 container) | **22/22** (property test threshold relaxed to ≥ 10 accepted on the authored v2 farm; every result and hash still compared with the shared sim) |
| `node scripts/g3-e2e.mjs` (dev online) | **26/26**, incl. Chromium Pixel 7 + WebKit iPhone 13 emulation |
| Clean `git clone` (`c5f0245`) → `node scripts/ensure-env.mjs` → `docker compose -p xay-nha-clean up -d --build` (port 8091) → `/health` 200 → `g4-smoke.mjs` | **PASS** — `docs/evidence/g4/clean-clone/` |
| `node scripts/g4-soak.mjs` on the Docker stack, 15 min | **904 recorded steps (12 skipped, 892 action entries), 0 console/page/HTTP errors, GPU geometries/textures/programs +0** — `docs/evidence/g4/soak/soak.json` |
| Backup round trip on the Docker stack | create A → `db:backup` → create B → `db:restore --yes` ⇒ A 200, B 401; 9 dumps ⇒ 7 kept |
| Mobile emulation (Pixel 7, low graphics) | City 56 / Farm 55 draw calls, ≤ 150k triangles, 0 errors |

### Final validation at the closeout revision

| Command | Result |
|---|---|
| `pnpm check` | exit 0; **682/682** in 24 files; lint/typecheck/content/build PASS; unit-suite duration 56.34 s |
| `pnpm test:api` | exit 0; **22/22**, real temporary Postgres 16; suite duration 15.41 s |
| `pnpm deploy:up` | exit 0; API/web rebuilt, healthy; web localhost:8090, Postgres no published port; no tunnel |
| PowerShell: `$env:BASE_URL='http://127.0.0.1:8090'; node scripts/g4-smoke.mjs` | exit 0; **four cases, 24 checks PASS, zero console/page/HTTP errors**, `/health` ok |

Final logs are retained under `docs/evidence/mvp-final/`; production smoke evidence under
`docs/evidence/g4/smoke/`. Clean-clone results remain the previous `c5f0245` run on port 8091.

| Final production smoke | Quality | FPS | Draw calls | Triangles | Maximum terrain rebuild ms |
|---|---|---:|---:|---:|---:|
| Chromium desktop / City | high | 58.88 | 150 | 173,370 | 1.20 |
| Chromium desktop / Farm | high | 58.74 | 168 | 186,062 | 3.80 |
| WebKit iPhone 13 emulation / City | low | 22.59 | 57 | 139,052 | 2.00 |
| WebKit iPhone 13 emulation / Farm | low | 22.79 | 62 | 150,284 | 1.00 |

Measurements are browser/host-specific; emulation FPS is not real-phone performance.

## 3. docs/10 §8 MVP release criteria

| Criterion | Status | Evidence / note |
|---|---|---|
| All unit + integration green | PASS | Final 682/682 + 22/22 (704 cases across the two suites) |
| E2E smoke green on Chromium and WebKit | PASS | `g3-e2e` 26/26; `g4-smoke` on the production build (Chromium desktop + WebKit iPhone 13) |
| 0 console errors in 15 minutes of normal play | PASS (automated) | Scripted UI play, not a human session; see soak actions in `soak.json` |
| Performance budget on 3 reference devices | **NOT RUN** | No Intel Iris Xe laptop, Snapdragon 7 phone or iPhone 12 available. Desktop dev GPU: ≤ 170 draw calls, ≤ 190k triangles, ~57–59 FPS. Phone budgets were checked only in emulation (headless WebKit FPS ~25 is software rendering, not a device figure) |
| Visual review with real browser screenshots for both maps | PASS | Tracked `docs/evidence/g3/` (5 angles × 2 maps), `docs/evidence/g3/ground/`, final `docs/evidence/g4/smoke/` |
| Test report lists what was not tested | PASS | §4 below |

## 4. Not verified / limitations

- Real-device performance (docs/10 §6, three reference devices) and the "full world" stress scenario (400 buildings, 2 000 road cells, 20 bridges, 1 000 fields): **not run**.
- Human playtest: tutorial time for a real first-time player is NOT RUN (historical bot 15 s, closeout 16 s); the 15-minute session was automated only.
- Tunnel: never started by the agent (rule). `pnpm tunnel:up` / `tunnel:url` are unchanged from G2 and untested in G4.
- Audio: optional, not implemented.
- Client telemetry `/api/telemetry` (docs/11 §10): implemented after the gate (`apps/api/src/telemetry.ts`, `apps/web/src/net/telemetry.ts`); verified end to end on the Docker stack (JS error + unhandled rejection appear as `client-error` log lines). Log only, no dashboard.
- Metrics are in-process and log-only (single API instance); no dashboard.
- Backups stay on the same machine unless copied elsewhere.
- G3 economy pacing FAIL: all six scenarios finished; five milestones fail, two pass and Farm L20 is UNREACHED. The valid L8 grocery fixture also confirms 0.901 h single-building payback under the broad after-L5 interpretation. See `G3-report.md` and Q010 in `OPEN_QUESTIONS.md`. Runnable local release readiness does not certify the economy gate.
- The economy bot remains untracked work owned by another agent; it is deliberately not staged by this closeout. The latest full shared-workspace check has 682 cases (six topology regressions over the 676 baseline), including its six cases; a clean-clone test total at the final revision has not been measured.
- The earlier 15-minute soak and backup restore are not repeated during closeout. Restore would overwrite the current database; retained round-trip evidence is used instead.

## 5. Placeholder assets (all of them)

All **74** GLB assets in `apps/web/public/assets/manifest.json` are procedural low-poly placeholders generated in
this repository (`placeholder: true`, project-owned): trees ×8, bushes ×4, rocks ×6, reeds ×3, flowers ×4,
grass tufts ×3, City buildings ×12 (houses, shops, bank, hotel, office tower, garden and park decor), Farm buildings ×8
(market, farmhouse, well, silo, chicken coop, rice mill, cow barn, bakery) + flowerbed decor, 8 crops × 3 growth
stages, construction scaffold. Replacing them follows docs/07 and docs/13; no gameplay change is needed.

Every individual ID and file is listed in [MVP-placeholder-assets.md](MVP-placeholder-assets.md),
generated from the current manifest (74/74 placeholder). This inventory does not claim final-art approval.
