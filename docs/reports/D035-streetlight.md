# D035 — Street Light decoration and nighttime illumination

Date: 2026-10-12

## 1. Summary

PASS for `deco_streetlight` ("Cột đèn"). The building is added to the **Trang trí** (Decorations) section on both `city` and `farm` maps. It costs $150 + 0 wood + 2 stone, unlocks at level 2, builds in 15 seconds, and has no economic bonus (like `deco_flowerbed`). At night, the lamp head emits warm light through vertex shader emissive radiance, and an instanced terrain patch projects a soft golden light pool over the exact cell of the post (2×2 m). By day, the light pool is disabled (`uNight = 0`).

All 9 automated QA gates pass (`scripts/streetlight-qa.mjs`), all 10 night QA gates pass (`scripts/g4-night-qa.mjs`), and all unit and regression tests pass (`pnpm check`).

## 2. Source and Specifications

- **Source:** `map/street_light.glb` ("Street_Light" by dodotcreatives, **CC-BY-4.0**, https://sketchfab.com/3d-models/street-light-16fc20d9d6564adb84ea27e35778da06). Untracked, not committed.
- **Source measurements:** 152,992 triangles, 16 meshes, 5 materials (`material` / God, `Grey`, `Bulb`, `lambert1`, `Elephant`). Raw height 8.58 m.
- **Scale and Alignment:** Uniformly scaled to 4.5 m height (`scale = 0.524390`). The column axis is centered at `(0, 0)` with the base aligned to `y = 0` (the pivot is at the bottom-center of the post, directly matching the grid cell center).
- **Column Thickening:** The column meshes (`pCylinder1_*`, base `pCube13`, collars `pCube7` and `pCube11`) are scaled XZ around the column center to achieve a diameter of 0.185 m (satisfying the ≥ 0.18 m requirement).
- **Vertex Palette Colors:**
  - `God` (accents, finial): antique gold `#c8962e` (linear `[194, 98, 26]`).
  - `Grey` and `lambert1` (post and shades): charcoal grey `#2b3038` (linear `[23, 29, 41]`).
  - `Bulb`: warm white `#fff3d6` (linear `[255, 226, 170]`), opaque.
  - `Elephant`: ivory cream average `#fcecc5` (linear `[249, 212, 143]`).
- **`_LAMP` Vertex Attribute:** Custom float attribute (1.0 on bulb vertices, 0.0 elsewhere). 168 bulb vertices are preserved in the final model.
- **Simplification (Meshoptimizer):** Reduced from 152,992 triangles to **601 triangles** (well under the ≤ 800 triangle cap). The column retains its round 8-sided profile, and the two lamp arms, shades, bulbs, and top finial remain distinct.
- **Geometry & File Size:** Exactly 1 mesh, 1 primitive, 1 material, flat normals, output file size **55.7 KB** (meeting the < 60 KB budget). Output path: `apps/web/public/assets/models/authored/deco_streetlight.glb`.
- **Floating Parts QC Gate:** 0 floating components detected (18 connected structural components firmly connected).
- **Footprint Bounds:** Bounding box span 1.12 × 4.47 × 0.40 m, cleanly fitting inside the 2 × 2 m × 0.92 (1.84 m) cell margin.

## 3. Economy & Content

- **Documentation:**
  - Added to `docs/16_ECONOMY_AND_BALANCE.md` §6.1 (City buildings), §6.2 (Building level limits: base 6, step 3/level, cap 80), and §7.3 (Farm other buildings).
- **Generation:**
  - Generated into `packages/content/catalog.v1.json` and `economy.v1.json` via `scripts/generate-content.mjs`.
  - Map kinds: `["city", "farm"]`.
  - Name key: `building.deco_streetlight` -> "Cột đèn" in `packages/content/i18n/vi.json`.
  - Verified with `pnpm content:check`.
- **Manifest & Attribution:**
  - Added D035 entry block in `scripts/generate-placeholder-assets.mjs` reading `scripts/streetlight.config.json`.
  - Carries CC-BY-4.0 provenance, author dodotcreatives, and `modified: true`.
  - Content-versioned SHA-256 hash `hash: "683eb286eb5e"` included in `apps/web/public/assets/manifest.json`.
  - Added to `docs/ASSET_CREDITS.md`; displayed in settings panel "Ghi công" section.
- **CategoryBar:** Automatically categorized into **Trang trí** (`categoryOf` maps `deco_*` to decorations).

## 4. Rendering & Night Lighting

1. **Lamp Head Glow:**
   - Shaders patched via `applyStreetLampLight` using `patchMaterial(material, 'd035-lamp-light', ...)` in `StreetLightRenderer.ts`.
   - Adds warm emissive radiance `vec3(1.0, 0.82, 0.48) * uNight * 0.95` when `_lamp > 0.0001`.
   - Emissive radiance 0.95 stays safely below UnrealBloomPass threshold 1.15 to prevent scenes drowning in orange bloom.
2. **Terrain Light Pool (`StreetLightRenderer`):**
   - Single `InstancedMesh` with 1 draw call for all active streetlights.
   - Each active streetlight projects a 2×2 m mesh grid (4×4 quads) conforming to terrain height via `roadCorners` vertex attribute and bilinear interpolation.
   - Radial gradient texture with smooth falloff to zero at the cell edge.
   - `AdditiveBlending`, `depthWrite: false`, `polygonOffset: true` (factor -2, units -2), `side: THREE.FrontSide`.
   - Multiplies `uNight` in the fragment shader: 0 by day, smoothly blends during dusk/dawn.
   - Culling: `castShadow: false`, `receiveShadow: false`, active only for `status === 'ACTIVE'`.
3. **Draw Call Optimization:**
   - In `BuildingRenderer`, `deco_streetlight` does not cast shadow (`handle.id !== 'deco_streetlight'`), preventing redundant shadow map draw calls.
   - `StreetLightRenderer` uses `FrontSide` instead of `DoubleSide`, ensuring transparent passes execute in exactly 1 draw call.
   - Total draw call increase across the scene is ≤ 2 (1 for building batch + 1 for ground light batch).

## 5. Automated QA Evidence & Gates

**D036 review update.** The first pool was a ~1 m near-white hot spot (texture without a colour space, values added as
linear, fast cubic falloff) and the bulbs read as unlit (emissive 0.95 on bulbs a few pixels under their hoods). Now:
the pool texture is sRGB warm amber `#ffc46e` at `POOL_LIGHT = 0.65`, full strength over ~45% of the half-cell then a
smooth fade to the cell edge, so it covers the lamp's cell; bulbs glow at `LAMP_LIGHT = 1.8`, deliberately above the
1.15 bloom threshold so a small halo marks a lit lamp. Night captures moved to 23:00 (full night since D036).

Run via `node scripts/streetlight-qa.mjs` against offline full-world snapshots in headless Chrome:

| Gate | Requirement | Farm | City | Verdict |
|---|---|---:|---:|:---:|
| 23:00 lit vs adjacent brightness | ≥ 2.0× | **13.97×** | **101.40×** | **PASS** |
| 13:00 lit vs adjacent difference | ≤ 5.0% | **2.33%** | **0.61%** | **PASS** |
| Cell 2 away unlit at 23:00 | No increase | **+0.0** | **+0.4** | **PASS** |
| Draw calls increase | ≤ 2 | **+2** (142 → 144) | **+1** (108 → 109) | **PASS** |
| Console errors | 0 | **0** | **0** | **PASS** |

### Captured Screenshots (`docs/evidence/g4/streetlight/`)
- `farm-close-13h-high.jpg`, `farm-close-13h-low.jpg`
- `farm-close-23h-high.jpg`, `farm-close-23h-low.jpg`
- `farm-mid-13h-high.jpg`, `farm-mid-13h-low.jpg`
- `farm-mid-23h-high.jpg`, `farm-mid-23h-low.jpg`
- `farm-pixel7-23h.jpg`
- `city-close-13h-high.jpg`, `city-close-13h-low.jpg`
- `city-close-23h-high.jpg`, `city-close-23h-low.jpg`
- `city-mid-13h-high.jpg`, `city-mid-13h-low.jpg`
- `city-mid-23h-high.jpg`, `city-mid-23h-low.jpg`
- `city-pixel7-23h.jpg`
- `report.json`

## 6. Regression Testing

- `node scripts/g4-night-qa.mjs`: All 10 baseline checks pass (desktop draw calls, FPS, mobile Pixel 7 FPS, rice mill windows lit, foliage darkens, bloom active at night high, bloom disabled at low, no console errors).
- `pnpm test`: 37 test files, 760 tests pass.
- `pnpm check`: Lint, TypeScript, Vitest, Content Check, and Web Build all pass.
