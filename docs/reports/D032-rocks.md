# D032 - Stone Pack rock replacement

Date: 2026-10-12

## Result

PASS for the six existing environment ids. The world templates, scatter density, footprints, occupancy rules and
clear-rock gameplay remain unchanged; only the GLB bytes, manifest provenance and deterministic import metadata were
updated.

## Source and mapping

Source: `map/hon_da/stone_pack.glb` (owner-supplied and intentionally untracked).

| Game id | Source node | Family | Triangles | Texture | File bytes |
| --- | --- | --- | ---: | ---: | ---: |
| `rock_01` | `Small_1` | rock | 300 | 256x256, 256 colours | 52,268 |
| `rock_02` | `Small_2` | rock | 300 | 256x256, 256 colours | 51,600 |
| `rock_03` | `Small_3` | rock | 300 | 256x256, 256 colours | 52,080 |
| `rock_04` | `Small_4` | rock | 300 | 256x256, 256 colours | 52,304 |
| `rock_large_01` | `Mid_1` | rock_large | 1,000 | 512x512, 64 colours | 139,344 |
| `rock_large_02` | `Mid_2` | rock_large | 1,000 | 512x512, 64 colours | 140,532 |

`rock_04` stayed on `Small_4`; its silhouette is distinct enough from `Small_2` in the imported close-up.

## Import pipeline

`scripts/import-rocks.mjs` performs a deterministic, source-only build:

1. Selects the exact parent node (important because `Mid_4_MID_0` is duplicated in the source), then bakes the full
   world transform into positions and correctly laid-out inverse-transpose normals.
2. Welds equivalent position/normal/UV vertices and simplifies with meshoptimizer while preserving UVs. Caps are 300
   triangles for small rocks and 1,000 for large rocks.
3. Recenters XZ at the bounds center, moves the bottom to zero, scales the largest horizontal dimension to 1.4 m or
   3.5 m, and sinks by 5% of height (capped at 0.08 m) for stable placement on slopes.
4. Multiplies ORM AO into base color, then tones it (parameters in `PARAMETERS.tone`): the source chroma is pulled
   toward the `GROUND.rock` tint `#8e877a` (`chroma` 0.35 keeps that share of the source's own colour, which removes
   the pink cast of the small-rock highlights), a gain lifts the AO-darkened paint (1.6 small, 1.75 large) and a soft
   shoulder rolls highlights off toward a ceiling (0.95 / 0.9 of white) instead of clipping. The texture is downsized
   and a deterministic median-cut palette is derived from it: 256 colours for small rocks, 64 for large rocks (the
   512 px large texture needs 64 to stay under 150 KB; the toned texture is near-monochrome, so 64 levels do not band).
   Normal and ORM textures are not shipped; the old fixed 6x6x4 RGB palette is not used.
5. Writes one indexed primitive, one `MeshStandardMaterial` and one base-color texture per GLB.

The complete source measurements, bounds, scales, sink values, tone and byte sizes are in `scripts/rocks.config.json`.
Every output is below the 150 KB limit (largest: `rock_large_02`, 140,532 bytes).

## Runtime and budget checks

The six ids remain one part each, so the rock batch/draw-call counts do not increase. In the captured overview runs:

| Map | Quality | Placeholder calls / tris | Imported calls / tris |
| --- | --- | ---: | ---: |
| Farm | high | 251 / 271,914 | 251 / 345,750 |
| Farm | low | 104 / 137,478 | 104 / 216,074 |
| City | high | 241 / 538,058 | 241 / 574,626 |
| City | low | 108 / 413,708 | 108 / 450,276 |

The imported totals remain below the desktop 1.5M budget. Farm low (216,074), city low (450,276), and farm high
(345,750) are within the documented 500k mobile budget. City high is 574,626 and exceeds 500k; its placeholder
baseline was already 538,058, so this is a pre-existing high-quality city-budget overage rather than a new mobile
mode regression. `CLEAR_ENV` was accepted for one small and one large rock. The small-rock shot kept its visible
batch count stable because other instances shared that batch; the large-rock shot reduced the visible batch count by one.

Shadow policy is unchanged: the renderer's 1.5 m caster threshold excludes all four small rocks (about 0.90-0.97 m
tall) and includes both large rocks (about 2.42-3.07 m tall). The large-rock close-ups show the resulting cast shadows.

## Evidence

All image evidence and compact metrics are under `docs/evidence/g4/rocks/`:

- `variant-rock_01.jpg` through `variant-rock_04.jpg` and `variant-rock_large_01.jpg` / `variant-rock_large_02.jpg`
- `before-*` and `after-*` farm/city high/low overviews
- `clear-rock-*` and `clear-rock_large-*` before/after shots
- `mobile/pixel7-rock.jpg` and `mobile/iphone13-rock.jpg`
- `metrics.json` (20 shots, zero browser/console errors)

`metrics.json` also records a clear-difference, warm-neutral mask for each close-up. The measured mean display RGB is
`#65665a`, `#67685c`, `#7a796c`, `#7a796d`, `#70736d`, and `#65655c` for `rock_01..04`, `rock_large_01`, and
`rock_large_02`, respectively (aggregate `#6e6f64`). The mask includes the shaded sides, so the lit display mean is
darker than the `GROUND.rock` reference `#8e877a`; the texture itself has no clipped texel and no blue or pink bias.

### Review fix (tone)

The first tone pass compensated for inverted normals with plain multipliers; once the normal matrix was fixed, the
large-rock ×2.6/2.55/2.3 lift clipped about 26% of the used texels at 255 (49 distinct colours left, white tops), and
the small-rock highlights read pink (`#e0d5d3`). Measured on the UV-covered source texels, no plain multiplier reaches
the target mean with ≤ 2% clipping on the large rocks (×1.5 already clips 4.4%), hence the chroma blend + soft
shoulder above. The rebuilt textures have 0% texels at 255.

Close-up QA uses six temporary `A-*` anchors in an in-memory farm template. The committed templates are never edited;
the anchors only ensure all six variants can be framed in a reproducible run.

## Validation and known limitation

- `node scripts/import-rocks.mjs --check`: PASS (byte-identical rebuild).
- `pnpm typecheck`: PASS.
- D032 asset checks: PASS, including the winding test: at least 90% of each rock's indexed triangles have their
  averaged vertex normal aligned with the face normal.
- `pnpm check`: the existing D031 authored-building `_WINDOW` assertion remains the known failure; no D032 code relies
  on or changes that behavior.
- `map/hon_da/stone_pack.glb` remains untracked by design; a source-free checkout skips the importer cleanly.
