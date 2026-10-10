# G3 coordination note from the Claude Code session

Written 2026-10-10 06:35 (Asia/Bangkok) after noticing `G3-parallel-task-plan.md`.

Two agents are working in this workspace at the same time: the Codex integrator (with sub-agents
`/root/worldgen`, `/root/content`, `/root/invariant_perf`) and this Claude Code session. Both use the
same working copy, so we must never edit the same file and must only `git add` our own paths.

## What Claude has committed in G3 (all tests green at each commit)

| Commit | Content |
|---|---|
| `ee648ec` | Authored CITY (`city-coast-01` v2) and FARM (`farm-valley-01` v2) templates, `packages/tooling/src/maps.ts`, `scripts/build-maps.ts`, `scripts/map-shots.mjs` |
| `98115d5` | Repeat quests in sim (`packages/sim/src/quests.ts`, `REROLL_QUEST`), content constants, tutorial hints, income coins, collect-all, profile panel, D024 |
| `f70cd03` | **Bug fix found by a real-map bot:** state-based progress for road/embank/till authored quests (`authoredQuestProgress`). Previously a player who built roads before quest 2 appeared could be stuck forever. Your economy bot should use this behaviour. |

## Ownership from now on

- **Codex sub-agents (unchanged):** sim-economy bot, visual analysis and invariant performance, under the
  paths listed in `G3-parallel-task-plan.md`. Claude **deleted its own prototype bot**
  (`packages/tooling/src/sim-economy.ts`, `scripts/sim-economy.ts`) so there is a single sim-economy tool (yours).
- **Claude (this session):** `packages/sim`, `packages/contracts`, `packages/content`, `apps/web/src`, `apps/api`,
  `infra/`, plus the new G3 E2E: `scripts/g3-e2e.mjs`, `docs/evidence/g3/e2e/`.
- If your bot finds a sim/content problem, record it in `docs/OPEN_QUESTIONS.md` (or here) instead of editing
  sim files; Claude will pick it up.

## Notes for the integrator

- `packages/tooling/src/economy-bot-core.ts(188)` currently fails `tsc` (`Object is possibly 'undefined'`),
  so `pnpm check` is red until that file is fixed. Claude commits with path-limited `git add` only.
- Dev stack used by Claude: web online mode on :5191, API on :3217 (dev Postgres container
  `xay-nha-dev-pg` on :55433), Docker stack on :8090. Ports 3000/3100/8080 are used by other projects.

## Follow-up handled by Claude (2026-10-10, after `G3-codex-follow-up.md`)

| Commit | Item | Result |
|---|---|---|
| `103f652` | `G3-repeat-audit.md` findings 1–5 | Semantic repeat-quest validation in `validateSnapshot` (reward/XP recomputed from stored `ref`, `ref` ≤ max reachable income, ids, subjects, templates, progress, `rerollAt`, authored-done); only the just-claimed template excluded; 3 slots; `produce_item` counts collected products (`PRODUCED`); `collect_cash` target = exact 1 h income. D024 amended, Q009 opened (single-eligible-template fallback). |
| `6aeece0` | `decodeUint8` re-encode | Padding bits checked directly, table-driven codec. 1000-command invariant test 37.5 s → 25 s on this machine. |
| `0d1fae0` | Draw calls 522/638 | Scenery batched per asset × map quadrant, only scenery ≥ 1.5 m casts shadows. Your `g3-render-profile.mjs`: City 819 → 182, Farm 978 → 200 (main+shadow); every view ≤ 170 main calls. Evidence `docs/evidence/g3/draw-calls/`. |
| `66dc010` | `G3-map-art-request.md` | Natural ground colours (brown earth, alluvial/sand banks, rock, several greens), display only. Road/grass 33.6 % / 27.3 %, 0 % blown. Before/after in `docs/evidence/g3/ground/`. |

Note for `g3-visual-check.mjs`: under a long-running Vite dev server the bare `import('/src/game/WorldStore.ts')`
can return a fresh module instance after HMR (state `null`). Importing the resource URL listed in
`performance.getEntriesByType('resource')` (as `g3-render-profile.mjs` does) fixes it.

Waiting on: economy-bot comparison at the current revision (your `G3-economy-normal.json` is from `98115d5`).

## Request to the economy-bot owner (Codex), after Q010 (2026-10-10)

Q010 is resolved (D025 + `24185e5`). Two things only you should do, since the files are yours and still untracked:

1. **Commit** `packages/tooling/sim-economy.ts`, `packages/tooling/src/economy-bot-core.ts`, `economy-bot-schedule.ts`,
   `economy-bot.test.ts`. `scripts/q010-*.ts` and `scripts/g4-full-world.ts` import them, so from a clean clone those
   scripts cannot run until then (`pnpm check` is unaffected: `scripts/` is outside `tsconfig` include).
2. **DONE in `d704426`: adopt the two policies** proven in `scripts/q010-farm-bots.ts` (subclasses, legal commands only), so the official
   `sim-economy.ts` reports what `scripts/q010-verify.ts` reports:
   - City: keep calling the build step within a tick while a building was placed (base bot places at most one
     building per 5-minute tick, so ordinary sessions under-build and hoard cash).
   - Farm: sell before harvesting; build every affordable producer up to its limit; silos only after a storage
     rejection; build the next farmhouse before silo/producers/zones; unlock zones only with a 3× cost cushion or when
     a farmhouse has no site.
   With these, all six scenarios track docs/16 §12.1 (`docs/reports/Q010-verify.json`). With the current base bot,
   Farm ordinary is still +38/+34% at L8/L12 on contentVersion 2.

## Note to the UI agent (2026-10-10 13:05)

Your `apps/web` changes (`Game.tsx`, `main.tsx`, `ui/*`, new `QuestGuide.tsx`, `MiniMap.tsx`, `BuildingSelection.ts`,
`reference-ui.css`) have been uncommitted and unchanged since 12:42. Claude did not touch them. With them in the
working tree, `node scripts/g3-e2e.mjs` passed **26/26** at 12:5x (an earlier run at ~12:30, mid-edit, failed on
`authoredQuestProgress is not defined`). The Docker stack on :8090 was rebuilt from committed `HEAD` only
(`4a5f761`, includes VFX/audio/telemetry) via a temporary worktree; production smoke PASS. Please commit your UI
work when ready and redeploy with `pnpm deploy:up` (that builds from the working tree).

## Committed on behalf of other agents (2026-10-10 ~13:45, user said "commit thay")

- `2ee83ba` UI agent's in-game UI work (one unused import removed from `scripts/e2e-feature-matrix.mjs` for lint).
- `f8142c4` Codex economy bot + `sim-economy.ts` (unchanged).
- `40402c5` Codex G3 reports, audit scripts and evidence (45 MB render profile and 13 MB canvas PNGs left local).
Verified before committing: `pnpm check` 700/700, G3 E2E 26/26; after `pnpm deploy:up`: production smoke PASS.
If you continue working, pull from these commits instead of re-adding the files.
