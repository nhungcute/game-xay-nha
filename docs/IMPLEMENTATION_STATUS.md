# Implementation status

Updated: 2026-10-10 (Asia/Bangkok).

Mode: auto-continue (approved 2026-10-10)

## Current gate: G3 — IN PROGRESS (G2 complete 2026-10-10, see docs/reports/G2-report.md)

## G3 task plan

- [ ] Authored layouts → templates for CITY (docs/03 §2) and FARM (docs/04 §2) via packages/tooling; validator; 5-angle screenshots per map.
- [ ] Map-aware client polish: city income bubbles/collect-all with bank, farm crops/production UI, catalog limits X/Y, profile + net worth panel.
- [ ] Quests: 24 authored + repeat quests (D017) in sim + UI; tutorial flow (docs/09 §5) incl. tutorial speed-ups.
- [ ] packages/tooling/sim-economy.ts on the real sim; compare pacing with docs/16 §12 (≤ 25%).
- [ ] E2E docs/10 §4 on Chromium + WebKit mobile emulation; visual review per map.
- [ ] Full check, docs/reports/G3-report.md, commit.

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

## Evidence and limitations

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

Commit the approved documentation changes, then implement G1. Q001–Q004 retain the reviewed G0
interpretations; do not change their gameplay/economy rules without a further approval.
