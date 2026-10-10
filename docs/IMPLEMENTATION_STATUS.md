# Implementation status

Updated: 2026-10-10 (Asia/Bangkok).

Mode: auto-continue (approved 2026-10-10)

## Current gate: MVP local closeout — G3 economy FAIL, final validation pending

Six-scenario economy comparison completed: CLI exit 0, 876.329 s, all invariants PASS; pacing FAIL.
G3 balance approval waits on Q010; the first-time human tutorial and G4 reference-device performance are NOT RUN.
MVP closeout is authorized in auto-continue mode; balance changes still need the product owner's decision.
The incomplete prior background run was preserved in its original scratch file and stopped by its verified
process ID. The 08:16 run exposed repeated far-bank flood fills; its partial result was preserved in
`docs/reports/G3-economy-pre-topology-cache.json`. `f5ab34a` caches immutable water topology in the sim,
with six parity/lifecycle tests and no economy or bot changes. Baseline check: 676/676; post-fix check: 682/682,
both exit 0. The fresh six-scenario rerun uses `f5ab34a`, with output at `docs/reports/G3-economy-current.json`
and log at `docs/evidence/mvp-final/economy.log`. All 55 fingerprinted files stayed unchanged during the run.

## G3 task plan

- [x] Authored layouts → templates for CITY (`city-coast-01` v2) and FARM (`farm-valley-01` v2); validator; 5-angle screenshots per map (`ee648ec`).
- [x] Map-aware client polish: income coins, collect-all with bank, farm crops/production UI, catalog limits X/Y, profile + net worth panel (`98115d5`).
- [x] Quests: 24 authored + repeat quests (D017/D024) in sim + UI; tutorial + Bác Tư hints; state-based authored progress (`f70cd03`); repeat-quest audit fixes (`103f652`).
- [x] Codex follow-ups: codec perf (`6aeece0`), draw calls 819/978 → 182/200 (`0d1fae0`), natural ground colours requested by the user (`66dc010`).
- [x] Real-sim economy: six 60-day scenarios at `f5ab34a`; compared docs/16 §12. Five milestone FAIL, two PASS, Farm L20 UNREACHED. Q010 recorded; no numbers changed. Farm careful speed 2.266× / 1.689× / 1.562× at L8/12/15; L20 comparison unobservable.
- [x] Supplemental economy audit: `npx tsx scripts/mvp-economy-audit.ts` exit 0; ten build/cancel and ten build/demolish reversals, buy/sell-material rejection, duplicate-clear rejection. `docs/reports/G3-economy-audit.json`; full exploit absence is not proved. Best-case Tạp hóa payback bound 0.901 h; buildings unlocked after L5 all ≥ 1 h.
- [x] Far-bank topology performance fix (`f5ab34a`): repeated placement scans use cached component labels; bridge status stays live; no snapshot/content fields added. Focused suites 84/84, full check 682/682. `docs/reports/G3-economy-bot-observations.md`.
- [x] E2E smoke on Chromium + WebKit mobile emulation: closeout rerun 26/26, 0 errors, automated tutorial 16 s; tracked visual evidence in `docs/evidence/g3/ground/` and map shots. Exact long-loop QA combinations are not all certified.
- [x] Full check 682/682 exit 0; `docs/reports/G3-report.md` complete (economy FAIL is explicit), documentation ready for path-limited commit.
- [ ] First-time human tutorial ≤ 6 minutes — NOT RUN.

## G4 task plan

- [x] Low-graphics mode (shadows off, lower DPR, thinner scenery; default on touch) + debug panel fields (`ccfd992`).
- [x] API observability: per-command JSON log, periodic metrics (`f8c8d1c`).
- [x] Postgres backup service (daily, keep 7) + `pnpm db:backup` / `pnpm db:restore`, round trip verified (`c5f0245`).
- [x] Clean `git clone` → ensure-env → compose up → production smoke PASS on Chromium + WebKit (`e67307a`).
- [x] 15-minute automated UI soak: retained `docs/evidence/g4/soak/soak.json`, 904 actions, 0 console/page/HTTP errors, GPU growth +0 (`3ebefea`). Human normal-play session: NOT RUN.
- [ ] Performance on the 3 reference devices (docs/10 §6) — needs real hardware; report as NOT RUN unless measured.
- [x] G4 retained-evidence report and complete 74-placeholder inventory prepared (`docs/reports/MVP-placeholder-assets.md`).
- [ ] Final `pnpm check`, `pnpm test:api`, local deploy + production smoke, final MVP summary and documentation commit.

## G2 task plan — DONE

- [x] apps/api (Fastify, Postgres 16, Drizzle), auth + recovery, worlds/commands with idempotency + revision + settle.
- [x] Online client: start screens, optimistic command queue with hash verification, rebase/resync, offline queue.
- [x] Docker: postgres + api + web (nginx /api proxy), generated secrets, tunnel profile.
- [x] Integration 22/22 (real Postgres), online E2E 13/13 (dev and Docker), persistence across restarts.
- [x] docs/reports/G2-report.md.

## G1 task plan — DONE

- [x] Q001–Q004 applied (D020); Q005–Q008 recorded (D017–D019).
- [x] Vite + React + Three.js client, VITE_OFFLINE=1, all tools through sim, previews with cost/reason, timers.
- [x] Placeholder GLBs + manifest (all marked placeholder).
- [x] Browser evidence 27/27 (tool sequence, orbit 180°, perf, leaks, contrast), mobile 8/8, Docker web smoke.
- [x] docs/reports/G1-report.md.

## G0 task plan

- [x] G0.1: git, pinned pnpm workspace, strict TypeScript, ESLint, Vitest, build and CI configuration.
- [x] G0.2: contracts/types and strict Zod schemas for templates, snapshots and every command.
- [x] G0.3: generated contentVersion 1 economy/catalog/24 authored quests/Vietnamese catalog strings from docs/16.
- [x] G0.4: deterministic worldgen, template validator and small provisional test template.
- [x] G0.5: pure sim state, footprint, occupancy, roads, terrain and infrastructure commands.
- [x] G0.6: construction events, builders, refunds, speed-up, rates, integer wallet, farming/queues/authored quests.
- [x] G0.7: atomic snapshot validation/load, delta boundaries, preview/command results.
- [x] G0.8: 604 passing unit cases, 1000-command invariant test, full check and gate report.

## Historical G0 evidence and limitations

The following records G0 only; current G1–G4 results and limitations are above and in the gate reports.

- Existing prototype tests and screenshots from earlier reviews are NOT G0 evidence.
- Host Node: v24.19.0; actual full check also run with Node v22.20.0.
- Final full run: Node 22.20.0 `pnpm check` — 604/604 tests in 13 files, 45.84 seconds;
  lint, typecheck, content check and build passed. Exit code 0.
- Retained terminal log: docs/evidence/g0/node22-check.log.
- Retained real-browser parity report: docs/evidence/g0/browser-worldgen.json.
- Seeded property test: 1000 random commands, 217 accepted / 783 rejected, all 23 command types;
  wallet/occupancy/unique IDs/shared deltas/reload validity checked after every command.
- Browser parity: Node 22.20.0 / Chrome 154.0.8037.98; 16 matching fixtures and 2 matching zone-order cases.
- `pnpm install --frozen-lockfile` passed; fixture CLI validator returned VALID.
- No rendering, server, DB, browser acceptance or Docker deployment claimed.
- Layout: provisional. Art review required at G3.
- CI is configured; remote CI execution was not verified.
- Read G0_GATE_REPORT.md for docs/10 coverage, evidence, prototype regressions and limitations.
- Read DECISIONS.md D001–D015 and OPEN_QUESTIONS.md Q001–Q008 before gate approval.
- Source commits: 0359f37 (reference baseline), 90bf119 (workspace/contracts/content),
  8e9c7c4 (worldgen/tooling/CI), 005cd38 (sim and rule/property tests).

## Next steps

Commit completed G3/G4 documentation and explicitly authorized G3 E2E evidence with owned paths only.
Finalize the MVP summary, then run `pnpm check`, `pnpm test:api`, local `pnpm deploy:up` and production G4 smoke.
Never start the tunnel or a public deployment. Q009 and Q010 remain open; Q010 contains all eight comparisons,
model/bot differences and two approval options. Do not change economy numbers without approval.
