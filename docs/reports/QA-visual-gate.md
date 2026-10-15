# QA: source-vs-output visual gate for model importers

Why: in D037 the "Citadel of Kings" landmark shipped as an unreadable mass (two 8192 px textures squeezed into one 1024 px atlas, UVs twisted by a permissive simplify) and every numeric gate (triangles, bytes, draw calls, FPS) passed. This gate renders the owner's source GLB and the importer's output GLB identically and compares them.

## Method

`scripts/lib/visual-compare.mjs` (renderer + metrics) and `scripts/model-visual-qa.mjs` (runner).

- Headless Chrome (SwiftShader), three.js 0.180 from node_modules, transparent background, hemisphere + one headlight, no tone mapping, 256 px orthographic views: **top, front, 3/4 (az 40, el 28)**.
- Normalisation like the importers: apply the importer's Y rotation to the source (180 deg for D029 buildings and D037 landmarks, none otherwise), hide the groups the importer dropped (`droppedGroups`), pick the named mesh for rock packs, then scale so the largest bbox side is 1 with a bottom-centre pivot. Outputs are loaded as shipped. (`KHR_materials_pbrSpecularGlossiness` sources, e.g. fur_tree, are converted to metal-rough because three r180 dropped that extension.)
- Metrics (mean of the 3 views):
  - `iou`: silhouette IoU of the alpha masks, each dilated by 2 px (thin poles differ by a pixel or two).
  - `ratio`: colour-mapping consistency. Importers retone deliberately (darker building palette, brighter rocks, hue-shifted trees), so a plain colour distance cannot be the gate. A retone maps one source colour to one output colour; a collapsed or mis-addressed atlas maps the same source colour to many. Blocks (8x8 px) are binned by source Lab; `ratio` = within-bin variance of the output Lab / total variance (0 = pure function of the source colour, 1 = unrelated).
  - `dE`: CIE76 distance between mean Lab colours (gross shifts only).
  - tone sanity on the output: `L out/src` (mean L* ratio), `out L50` (median L*, "everything dark"), `contrast` (p95 - p5 of L*, "flat blob").
- Per-view `dEGrid`, `dL`, lightness-layout `corr` and gradient energy are also computed (in `lib`, not gated); they did not separate good from bad (shipped castle `corr` 0.29 vs citadel 0.14; retoned buildings have `dL` 20-27).
- Deciduous trees and bushes have regenerated leaf-card canopies (not simplifications of the source), so only `iou` (looser) and the tone checks apply to them.

## Thresholds (chosen from data: 42 shipped models + the D037 citadel)

| check | threshold | worst shipped | citadel |
|---|---|---|---|
| iou | >= 0.45 (rebuilt trees/bushes >= 0.40) | 0.55 cow_barn (rebuilt: 0.54 tree_deciduous_01) | 0.96 |
| ratio (not rebuilt) | <= 0.80 | 0.65 deco_garden | **0.91 FAIL** |
| dE (not rebuilt) | <= 45 | 34.9 deco_flowerbed | 10.5 |
| L out/src | 0.30 .. 3.5 | 0.44 deco_flowerbed; 2.35 bush_03 | 0.76 |
| out median L* | >= 12 | 23 streetlight | 30 |
| out contrast | >= 8 | 18 bush_04 | 36 |

`margin` below = smallest relative headroom over all checks (0 = at a threshold, negative = fails). Smallest shipped margin: 0.19.

## Results: all shipped importer outputs PASS (42/42)

| model | family | iou | ratio | L out/src | out L50 | contrast | margin |
|---|---|---|---|---|---|---|---|
| well | buildings | 0.971 | 0.181 | 0.684 | 47 | 37 | 0.467 |
| house_small | buildings | 0.798 | 0.183 | 0.683 | 41 | 43 | 0.454 |
| shop_grocery | buildings | 0.991 | 0.101 | 0.645 | 41 | 52 | 0.441 |
| house_town | buildings | 0.984 | 0.183 | 0.638 | 44 | 49 | 0.42 |
| shop_cafe | buildings | 0.945 | 0.145 | 0.574 | 34 | 45 | 0.363 |
| shop_restaurant | buildings | 0.951 | 0.072 | 0.688 | 55 | 38 | 0.443 |
| bank | buildings | 0.98 | 0.318 | 0.723 | 62 | 42 | 0.511 |
| house_apartment | buildings | 0.944 | 0.383 | 0.605 | 41 | 20 | 0.374 |
| office_tower | buildings | 0.986 | 0.288 | 0.609 | 39 | 21 | 0.432 |
| hotel | buildings | 0.977 | 0.121 | 0.638 | 47 | 44 | 0.424 |
| shop_supermarket | buildings | 0.991 | 0.111 | 0.638 | 41 | 46 | 0.431 |
| deco_garden | buildings | 0.874 | 0.651 | 0.688 | 53 | 36 | 0.187 |
| deco_park | buildings | 0.904 | 0.236 | 0.652 | 47 | 26 | 0.332 |
| farmhouse | buildings | 0.611 | 0.403 | 0.675 | 41 | 36 | 0.294 |
| market | buildings | 0.969 | 0.066 | 0.719 | 44 | 46 | 0.565 |
| chicken_coop | buildings | 0.714 | 0.051 | 0.661 | 45 | 26 | 0.436 |
| rice_mill | buildings | 0.657 | 0.301 | 0.703 | 53 | 45 | 0.377 |
| cow_barn | buildings | 0.553 | 0.279 | 0.671 | 39 | 43 | 0.187 |
| bakery | buildings | 0.848 | 0.276 | 0.686 | 50 | 49 | 0.449 |
| deco_flowerbed | buildings | 0.739 | 0.343 | 0.436 | 27 | 22 | 0.224 |
| tree_deciduous_01 | trees (rebuilt) | 0.536 | 0.351 | 1.332 | 50 | 49 | 0.248 |
| tree_deciduous_02 | trees (rebuilt) | 0.581 | 0.354 | 1.277 | 48 | 47 | 0.33 |
| tree_deciduous_03 | trees (rebuilt) | 0.629 | 0.414 | 1.27 | 47 | 48 | 0.417 |
| tree_deciduous_04 | trees (rebuilt) | 0.631 | 0.395 | 0.958 | 36 | 38 | 0.419 |
| tree_conifer_01 | trees | 0.847 | 0.267 | 1.148 | 50 | 22 | 0.666 |
| tree_conifer_02 | trees | 0.859 | 0.262 | 1.181 | 51 | 23 | 0.663 |
| tree_conifer_03 | trees | 0.802 | 0.277 | 1.148 | 50 | 22 | 0.64 |
| tree_conifer_04 | trees | 0.875 | 0.248 | 1.22 | 53 | 23 | 0.652 |
| bush_01 | trees (rebuilt) | 0.673 | 0.851 | 2.333 | 56 | 20 | 0.334 |
| bush_02 | trees (rebuilt) | 0.672 | 0.855 | 2.131 | 51 | 19 | 0.391 |
| bush_03 | trees (rebuilt) | 0.664 | 0.854 | 2.349 | 57 | 20 | 0.329 |
| bush_04 | trees (rebuilt) | 0.676 | 0.851 | 2.095 | 51 | 18 | 0.401 |
| rock_01 | rocks | 0.992 | 0.05 | 1.527 | 58 | 67 | 0.545 |
| rock_02 | rocks | 0.997 | 0.04 | 1.491 | 59 | 65 | 0.56 |
| rock_03 | rocks | 0.992 | 0.078 | 1.48 | 60 | 60 | 0.546 |
| rock_04 | rocks | 0.993 | 0.044 | 1.511 | 63 | 63 | 0.525 |
| rock_large_01 | rocks | 0.99 | 0.072 | 1.471 | 53 | 67 | 0.58 |
| rock_large_02 | rocks | 0.99 | 0.05 | 1.485 | 55 | 69 | 0.576 |
| deco_streetlight | streetlight | 0.62 | 0.025 | 1.358 | 23 | 64 | 0.31 |
| landmark_palace | landmarks | 1 | 0.064 | 0.961 | 39 | 45 | 0.725 |
| landmark_castle | landmarks | 0.783 | 0.369 | 1.064 | 55 | 44 | 0.539 |
| landmark_culture | landmarks | 0.999 | 0.156 | 1.154 | 54 | 51 | 0.67 |

Contact sheets (source | output per view, PASS/FAIL header): `docs/evidence/g4/visual-qa/{buildings,trees,rocks,streetlight,landmarks}.png`; numbers in `report.json`.

## The D037 citadel (commit 4e33db4) FAILS

`node scripts/model-visual-qa.mjs --known-bad` extracts `landmark_citadel.glb` from git, compares it with `map/nha2/citadel_of_kings.glb`: `ratio 0.91` against the 0.80 limit (every shipped non-rebuilt model is <= 0.65), exit code 1. Evidence: `docs/evidence/g4/visual-qa/landmarks-known-bad.png`, `report-known-bad.json`. The sheet shows the source's readable plan and facades against scrambled texture noise on the same geometry.

Honest note: in this neutral lighting the citadel is not dark, its silhouette matches (IoU 0.96) and its mean colour is close (dE 10.5), so only the colour-mapping check catches it, with a moderate margin (0.91 vs 0.80; nearest shipped 0.65). The tone-sanity checks would trigger on a truly black atlas.

## Running it

- `node scripts/model-visual-qa.mjs`: all models, about 52 s total (0.2-1.6 s per model, castle 6 s, citadel 12 s). Exit 1 on any failure; exit 0 with a notice when the `map/` sources are absent (CI).
- Options: `--family buildings|trees|rocks|streetlight|landmarks`, `--model id[,id]`, `--output candidate.glb` (one model; check a GLB before installing it), `--known-bad`, `--source-root`, `--out-dir`.
- Importers: after writing outputs run `node scripts/model-visual-qa.mjs --family <family>` and look at the sheet; a failure blocks the importer's QA step. A new family needs an entry in `collectModels()`. Change thresholds only with new data recorded here.

## Limitations

- Needs the git-ignored `map/` sources, so it is an owner/local gate, not CI.
- Importer edits not mirrored in the source render (castle base-plate cut, hue shifts, far-LOD billboards) lower scores slightly; far LODs are not checked.
- Regenerated deciduous trees and bushes only get loose checks. Registration differences (dropped fences) limit how tight `iou` and `ratio` can be.
- SwiftShader pixels may shift across Chrome versions; margins absorb this.
