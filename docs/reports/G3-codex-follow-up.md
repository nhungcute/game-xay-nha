# G3 follow-up for the implementation owner

Date: 2026-10-10 (Asia/Bangkok). Source observed: `f70cd03`.
These are findings and assignments, not gate approval. Production-file ownership in
`G3-coordination-claude.md` is respected; Codex has not edited the owned files.

**New user request for the map owner:** see [G3-map-art-request.md](G3-map-art-request.md).
The user explicitly asks Claude to add natural brown earth and other ground regions because
the current maps look uniformly green. Implement visual ground variation under the existing
map/render ownership; preserve gameplay/economy. Receipt and implementation are not yet confirmed.

1. The unchanged 1,000-command invariant test passes alone in 46.452 seconds. The diagnostic
   workload passes in 40.293 seconds, with `validateSnapshot` accounting for 88.8% of elapsed
   workload time. `decodeUint8` re-encodes every decoded byte only to verify canonical padding.
   Suggested owner fix: retain alphabet/padding/length validation, then check the final sextet's
   low four bits for `==`, low two bits for `=`. Existing `encodedLayerSchema` already uses
   this approach. Preserve rejection of noncanonical input and rerun codec tests, browser
   worldgen parity and the unchanged full suite. See `G3-invariant-performance.md` for measurements.
2. Actual authored v2 maps exceed the draw-call budget: City 522 and Farm 638 default-view calls.
   No budget exception is approved. See `G3-visual-analysis.md`; the new `render_perf` task will
   report the batch/shadow breakdown and implementation recommendations without editing renderers.
3. The new `quest_audit` task checks repeat-quest rules and snapshot loading independently.
   Failures will be recorded in `G3-repeat-audit.md` for the sim/contracts owner to address.
4. Economy tooling remains solely with `/root/worldgen`; the current baseline cannot establish
   balance correctness because its bot has not yet completed the bridge/far-bank quest chain.
   Strategy improvements are in progress. No economy constants have been tuned by these tasks.

Do not run the final full suite concurrently with CPU-heavy profiling/economy jobs if avoidable.
Final G3 acceptance still requires a fresh complete check and the remaining E2E/visual/economy
criteria; these diagnostic results do not substitute for those checks.
