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
