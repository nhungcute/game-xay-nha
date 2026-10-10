# G3 natural ground colours (user request `docs/reports/G3-map-art-request.md`)

Display-only change by Claude, 2026-10-10: `apps/web/src/game/render/groundPalette.ts` tints GRASS cells per
vertex from existing data only (surface, biome, heights, water distance, template seed). No rule, surface,
biome or template data changed; validator and worldgen untouched.

- Broad low-frequency patches of several greens (deep / lush / dry-yellow); forest biome darker.
- Warm dry-earth patches on open ground away from water, slightly more on higher ground.
- Light alluvial soil within 4 cells of water, sandy tint right at the edge.
- Warm grey on the rocky-hill biome and on steep slopes.
- Soft transitions (value noise + per-vertex averaging); tilled fields, roads and foundations keep their colours.

| Check (docs/10) | City | Farm | Threshold |
|---|---|---|---|
| Natural road vs grass luminance difference | 33.62 % | 27.26 % | ≥ 15 % |
| Blown pixels (all RGB ≥ 250), 5 angles | 0.00 % | 0.00 % | ≤ 5 % |
| Console/page errors | 0 | 0 | 0 |

- `before/` — shots from the committed G3 evidence (same cameras), `after/` — `scripts/map-shots.mjs` with `OUT=docs/evidence/g3/ground/after`.
- `visual-check/` — Codex's `scripts/g3-visual-check.mjs` run unchanged except output dir and loading the live
  `WorldStore` module URL (Vite HMR-versioned). Canvas PNGs were removed to keep the repo small; JPEGs and JSON kept.
