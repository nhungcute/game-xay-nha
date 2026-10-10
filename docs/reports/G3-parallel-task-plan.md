# G3 parallel task ownership

Assigned 2026-10-10 after the product owner asked for additional parallel work.
Base commit: `ee648ec`; G3 sim/content/UI changes are still in progress in the shared workspace.

| Owner | Task | Exclusive output paths | Dependencies |
|---|---|---|---|
| `/root/worldgen` | Run the real sim for economy pacing; compare with docs/16 without tuning balance | `packages/tooling/sim-economy.ts`, new `packages/tooling/src/economy-bot*.ts`, `docs/reports/G3-economy-analysis.md` | Read-only sim, contracts, content and authored templates; final rerun after these stabilize |
| `/root/content` | Five browser angles per map, scene audit and measured visual evidence | `scripts/g3-visual-check.mjs`, `docs/evidence/g3/parallel-visual/`, `docs/reports/G3-visual-analysis.md` | Current dev client and templates; final screenshots after UI/rendering stabilize |
| `/root/invariant_perf` | Diagnose the 1,000-command test timeout with isolated runs and profiling | `scripts/profile-invariants.ts`, `docs/evidence/g3/invariant-performance/`, `docs/reports/G3-invariant-performance.md` | Read-only current sim and invariant test |
| `/root/render_perf` | Diagnose the authored maps' draw-call budget failures; provide a measured handoff to the renderer owner | `scripts/g3-render-profile.mjs`, `docs/evidence/g3/render-performance/`, `docs/reports/G3-render-performance.md` | Read-only web source and local browser; no render changes |
| `/root/quest_audit` | Exercise approved repeat-quest rules and snapshot validation independently | `scripts/g3-repeat-audit.ts`, `docs/evidence/g3/repeat-audit/`, `docs/reports/G3-repeat-audit.md` | Read-only sim/contracts/content; no balance or schema changes |

These assignments are in progress, not acceptance evidence. No gate advancement is implied.
Agents must check that an output path is still unowned before creating it. If another process creates it,
the agent switches to read-only review and reports the conflict. Existing sim, contracts, content, UI,
renderers, test thresholds and root configuration remain with their current owner. Only the integrator
runs the final full suite, writes the gate report and commits after exit criteria pass.

No public deployment, economy tuning or changes to design docs 00–16 are included in these tasks.

Follow-up: invariant profiling and the first visual analysis are complete as independent reports;
their agents are no longer active. The current parallel jobs are economy simulation, rendering
diagnostics and repeat-quest audit. See `G3-coordination-claude.md` for the production-file owner.
