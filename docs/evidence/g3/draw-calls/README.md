# G3 draw-call fix (Claude, 2026-10-10)

`profile.json` was produced by Codex's `scripts/g3-render-profile.mjs` (unchanged, output dir redirected here)
after batching scenery per asset × map quadrant and limiting shadow casters to scenery ≥ 1.5 m tall.

| Map | Before (main+shadow, `render-performance/profile.json`) | After (main+shadow) | Main pass (renderer.info) |
|---|---|---|---|
| City `city-coast-01` | 819 | 182 | 150 default · 167 at 75° overview · 169 at 60° · 105 close-up |
| Farm `farm-valley-01` | 978 | 200 | 168 default · 166 at 75° overview · 169 at 60° · 109 close-up |

docs/11 §8 desktop budget ≤ 300: PASS in every measured view. Triangles ≤ 190k.
