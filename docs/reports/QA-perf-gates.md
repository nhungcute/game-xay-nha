# QA perf gates: robust FPS measurement

## Problem
FPS gates in `landmark-qa.mjs` and `g4-night-qa.mjs` flipped PASS/FAIL with no code change. Headless Chrome FPS depends on GPU scheduling, GC, shader compilation and warm-up. Measured on identical code: landmark gate 2 baseline 39.9 -> 36.0 (FAIL), 24.5 -> 32.0 (PASS, "after" faster than baseline), 26.5 -> 24.2 (PASS). Baselines swung 24-40 FPS. The old `measureFps` took one 90-frame median with no warm-up.

## Method
- `scripts/lib/perf.mjs`
  - `measureFps(page, {warmupMs=1500, samples=5, framesPerSample=120})`: rAF warm-up, then several samples. Returns `fps` (median of sample medians), `p95Ms`, `min`, `max`, `spread`, `samples`.
  - `compareInterleaved(page, setA, setB, {rounds})`: A/B/B/A... rounds on the same page. It returns medians of A and B plus each side's spread.
- `landmark-qa.mjs` gate 2: snapshots are taken before and after placing the landmarks, then toggled on the same page via `loadSnapshot`, with time of day, quality and camera reset each time. The gate fails only if `drop > max(3, 2 x noise spread)`. The spread, per-round values and tolerance are written to `report.json` (`gates.gate2_fps`). Gate 1 (draw calls) and gate 3 (triangles) remain the deterministic regression checks.
- `g4-night-qa.mjs`: gate measurements (city high, farm high, Pixel 7) use the full robust profile; informational numbers use a lighter profile. Spread and samples go into `metrics.json`.
  - `desktopCityFpsOk` (>= 35) was converted to **info only** (`metrics.fpsInfo.desktopCityFps`, `gating: false`). City high sits right at the floor (samples 25-38 fps in one run; medians 34-47 across runs), so a hard floor is a coin flip. It is replaced by hard `desktopCityTrianglesOk` / `desktopFarmTrianglesOk` (<= 1.5M), next to the existing draw-call gates.
  - `desktopFarmFpsOk` (>= 50) and `mobilePixel7FpsOk` (>= 30) stay hard: they are vsync-capped near 60 fps with spread <= 0.7.

## Stability: 3 runs on identical code (port 5192)
| Run | landmark gates 1-5 | gate 2 baseline / after (median, rounds) | drop vs tol | night budget checks | city high fps (spread) | farm high | Pixel 7 |
|---|---|---|---|---|---|---|---|
| 1 | all PASS | 41.7 [36.2, 41.7, 42.4] / 40.3 [40, 40.3, 41] | 1.4 vs 12.4 | all true | 47.4 (1.3) | 59.9 (0.4) | 59.9 (0.4) |
| 2 | all PASS | 42.2 [42.2, 41.7, 42.9] / 42.0 [42, 41.8, 42.2] | 0.2 vs 3.0 | all true | 46.5 (2.2) | 59.9 (0.7) | 59.9 (0.4) |
| 3 | all PASS | 38.6 [35.1, 38.6, 38.9] / 37.3 [36, 38.3, 37.3] | 1.3 vs 7.6 | all true | 38.6 (3.8) | 59.9 (0) | 59.9 (0.4) |

Verdicts are identical across runs. Before the city-FPS floor was made info-only, one earlier run of the night script failed `desktopCityFpsOk` with city high at 34.4 fps (spread 13), which is the flakiness this change removes.

## Remaining caveats
- Absolute FPS depends on the machine. Landmark noise (spread 1-6 fps between interleaved rounds) means the gate catches a drop larger than about 3-12 fps, not subtle ones. Triangle and draw-call gates are the sensitive checks.
- Snapshot toggling reloads world state, so the first seconds after each toggle are discarded by the warm-up (1.2 s settle + 1.5 s warm-up).
- Other scripts (`g4-full-world.mjs`, `rock-shots.mjs`, `g3-*`, `g4-soak`, `tree-shots`) only record FPS and do not gate on it; they were left unchanged. They still use the old single-sample measurement and should use `lib/perf.mjs` if they ever gain a gate.
