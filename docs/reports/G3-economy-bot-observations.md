# Economy run performance observation and fix

2026-10-10 (Asia/Bangkok), source baseline `47fe17d`.

The original background run was incomplete. A fresh exact six-scenario command started at 08:16;
its City/careful scenario finished in 326.882 seconds with L20 at 46.375 elapsed days.
The incomplete output is preserved as `G3-economy-pre-topology-cache.json`.

Two passive local inspector observations of City/ordinary were 76.869 seconds apart:

| Observation (local) | Simulated day | Level | Commands | Quest index | Zones |
|---|---:|---:|---:|---:|---:|
| 08:28:05 | 11.875 | 10 | 2562 | 11 | 16 |
| 08:29:22 | 11.88125 | 10 | 2663 | 11 | 17 |

Only nine simulated minutes elapsed. Both samples were in `isFarBank` → `build` → `infrastructure`.
The bot scans candidate footprints to complete the far-bank authored quest; the previous sim helper
flood-filled up to 16,384 cells twice for each candidate. This could make the requested run take hours.
Wall-clock slowness is not itself a change in simulated pacing.

The run was stopped by its verified task-owned process ID before any heavy checks.
No economy-bot file was modified. Instead, the sim's far-bank helper was factored into `banks.ts`:

- Dry connected-component labels are memoized by the runtime surface-array identity.
- Legal commands cannot change water cells, and snapshot validation rejects `WATER_CHANGED`.
  Road, foundation and field edits therefore preserve those labels. Clones/reloads allocate new arrays.
- Authored bank indexes use weak references to immutable region lists.
- Bridge status is read on every call; no bridge, completion or removal is cached.
- Multi-source far-component unions and synthetic water-input behavior match the previous flood helper.
- Weak maps allow discarded states and templates to be garbage-collected. No snapshot/content field is added.

Validation: baseline `pnpm check` exit 0, 676 tests; focused bank/worldgen/farm suites **84/84**,
including six new parity/lifecycle cases. Post-change `pnpm check` exit 0, **682/682** in 24 files.
Committed as `f5ab34a`; six-scenario rerun completed, CLI exit 0, 876.329 s total. All final invariant sets PASS,
source fingerprint unchanged across 55 files; pacing still FAIL and Q010 remains open.
City/careful completed at 327.259 seconds; all 60-day result fields and pacing rows match the pre-fix result exactly,
including commands, daily summaries, final wallet/progress and invariants (`topology-parity.json`).
City/ordinary completed at 266.93 seconds (CLI rounding); its snapshot is valid. Before the fix, two samples required 76.869 seconds
for nine simulated minutes at the far-bank search. There is no full pre-fix ordinary run for a total-runtime comparison.

The early City/ordinary L8 reading was 6.5 days (+85.7% versus 3.5); Q010 remains open regardless
of faster computation. No economic parameter or gameplay rule was changed.

Raw progress observations: `../evidence/mvp-final/economy-progress.jsonl`.
Checks: `../evidence/mvp-final/baseline-check.log`, `bank-tests.log`, `topology-check.log`.

The first PowerShell wrapper used `2>&1 | Tee-Object` with `$ErrorActionPreference='Stop'`.
Its buffered progress diagnostics surfaced as `NativeCommandError` when the process was stopped;
that wrapper returned 1. This is not recorded as a successful full CLI run. Subsequent long commands
use `cmd /d /c` native redirection so progress on stderr is preserved without becoming a PowerShell exception.
