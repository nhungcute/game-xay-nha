# Implementation status

Updated: 2026-10-10 (Asia/Bangkok).

Mode: auto-continue (approved 2026-10-10)

## Current gate: G1 — IN PROGRESS

Read all design documents 00–16, both economy scripts, and all three reference images.
G0 approved 2026-10-10; product owner independently re-ran pnpm check: 604/604 passed.
Continuation protocol updated by explicit user instruction: full test/report/commit at every gate,
then continue only when exit criteria pass. G2–G4 have not started. No public deploy authorized.

## G1 task plan

- [ ] Apply/commit approved docs Q005–Q008 and mode; maintain reports under docs/reports/.
- [ ] Implement approved bankRegions contracts/validator and actual-paid road valuation regressions.
- [ ] Bootstrap pinned Vite + React 18 + Three.js + zustand app, VITE_OFFLINE=1.
- [ ] GLB assets/manifest with verified CC0 sources or explicitly marked permitted placeholders.
- [ ] Terrain per zone, reused buffers/normals/dirty zones; water/waterfall, deterministic env, roads/kè/cầu.
- [ ] All tools through shared sim with green/yellow/red previews, cost/reason/confirmation; timers.
- [ ] Desktop/touch camera, Vietnamese UI, validated offline cache and debug instrumentation.
- [ ] Browser evidence for required tool sequence, orbit180, performance, leaks and lighting/contrast.
- [ ] Full tests, docs/reports/G1-report.md, commit; advance only if all G1 exit criteria pass.

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
