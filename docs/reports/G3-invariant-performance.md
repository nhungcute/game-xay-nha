# G3 invariant test performance investigation

Date: 2026-10-10. Source revision: `98115d50f7887f56e65f205422b296255f916dcc`.
Host: Windows x64, Node v24.19.0, Intel i7-11700 @ 2.50 GHz, 16 logical processors.

## Finding

The unchanged invariant test passes alone within its existing 60-second limit. The previous full-suite timeout is consistent with resource contention; this investigation does not establish a gameplay regression or prove contention as the sole cause. A confirmed algorithmic hotspot is repeated base64 layer decoding during snapshot validation.

| Measurement | Result |
| --- | --- |
| Targeted Vitest test | PASS, 46.452 seconds |
| Targeted Vitest total | 47.65 seconds, 1 file / 1 test passed |
| Profiled standalone equivalent workload | PASS, 40.293 seconds |
| Seeded commands | 1,000 random + 19 fixture setup commands |
| Random outcomes | 217 accepted / 783 rejected, all 23 command types |
| Original timeout | Unchanged, 60,000 ms |

The parent task reported the preceding full-suite failure at about 60.85 seconds. That full-suite failure was not re-run here. The G0 report's approximately 45-second run used Node 22, so it is only a rough historical comparison with this Node 24 run.

## Evidence

Commands actually executed:

```powershell
pnpm exec vitest run packages/sim/src/invariants.test.ts --reporter=verbose
pnpm exec tsx scripts/profile-invariants.ts
pnpm exec eslint scripts/profile-invariants.ts --max-warnings 0
```

All three commands exited successfully. The profiling script reads the actual invariant test source, preserves its seeded fixture setup, random commands, loop bounds, state reloads, and assertions, and wraps five public calls with timers. It replaces Vitest assertions with equivalent `node:assert` checks and runs an esbuild bundle in one Node process under `--cpu-prof`. This isolates simulation cost from Vitest worker scheduling; it is diagnostic evidence, not a replacement for the required full test run.

- [Targeted Vitest output](../evidence/g3/invariant-performance/targeted-vitest.log)
- [Profile run output](../evidence/g3/invariant-performance/profile-run.log)
- [Public-call timings and source SHA-256](../evidence/g3/invariant-performance/profile-summary.json)
- [CPU sample summary](../evidence/g3/invariant-performance/cpu-hotspots.json)
- [Chrome DevTools CPU profile](../evidence/g3/invariant-performance/invariants.cpuprofile)
- [Reproducible profiling script](../../scripts/profile-invariants.ts)

## Cost breakdown

| Public call | Calls | Elapsed time | Workload share |
| --- | ---: | ---: | ---: |
| validateSnapshot | 1,019 | 35.763 s | 88.8% |
| execute | 1,019 | 3.491 s | 8.7% |
| stateHash | 1,802 | 0.527 s | 1.3% |
| cloneState, explicit test calls | 1,019 | 0.193 s | 0.5% |
| rebuildOccupancy, explicit test calls | 1,019 | 0.024 s | 0.1% |

These public-call timers include nested work. CPU sample self-times identify where that work runs: `encodeUint8` 13.313 s, `decodeUint8` 7.141 s, `validateSnapshot` 4.565 s, `decodeInt16` 4.008 s, garbage collection 2.627 s, and the base64 format regex 1.700 s. Sampling totals include startup and have different accounting from the public-call timers.

`validateSnapshot` creates a state from the immutable template, restores deltas, decodes template layers again for semantic checks, and scans every cell. `decodeUint8` currently encodes every decoded byte again solely to verify canonical padding. Thus repeated reload verification amplifies allocation and codec cost even when the input template does not change.

## Recommended follow-up, not applied

1. Preserve the codec's strict alphabet/padding regex and expected-length checks, but verify the final unused base64 bits directly. For `==`, the final data sextet's low four bits must be zero; for `=`, its low two bits must be zero. This can remove the complete `encodeUint8(bytes)` canonicality round trip while preserving strict rejection behavior and browser/Node portability. The contracts owner should implement this with existing codec cases plus explicit noncanonical padding cases, then re-run worldgen browser parity and the full suite.
2. If still necessary, reuse decoded immutable template layers within snapshot validation. Keep cached arrays private and invalidate the cache if a template's source layer strings change; sharing mutable arrays with simulation state would be unsafe.
3. Re-run the unchanged full check after the worktree is stable and parallel CPU-heavy browser/profile jobs have finished. A targeted pass does not satisfy the gate's full-suite requirement.

No production code, existing test, timeout, gameplay value, or economy threshold was changed. Only this report, the new diagnostic script, and its evidence files were added. No commit was created by this task.
