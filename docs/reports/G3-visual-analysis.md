# G3 parallel visual analysis

Date: 2026-10-10, Asia/Bangkok. This is independent visual evidence, not a gate approval or gate report.

The actual City and Farm v2 templates render as 3D scenes without console errors. Ten required-angle captures and ten canvas-only PNGs are retained. Both maps exceed the desktop draw-call budget in their default views. The current camera API cannot produce a true orthographic top-down capture.

## Reproduction and scope

```powershell
# Uses the already-running offline Vite server; starts/stops no server.
node scripts/g3-visual-check.mjs
pnpm exec eslint scripts/g3-visual-check.mjs --max-warnings 0
```

Both commands completed with exit code 0. Browser capture ran from `2026-10-09T23:27:35.832Z` to `2026-10-09T23:28:01.875Z` (2026-10-10 06:27–06:28 Bangkok). Raw results: [visual-check.json](../evidence/g3/parallel-visual/visual-check.json).

The existing server at `http://127.0.0.1:5190` runs the current checkout in offline mode. Offline Root hardcodes the older `farm-g1` URL, so Playwright fulfilled only that template request with the unchanged bytes of each actual authored v2 file. Each map used a fresh browser context and the normal WorldStore/validator/rendering flow. Snapshot identity confirmed `city-coast-01` / `farm-valley-01`, templateVersion 2. No auth, API, database, Docker, deployment or existing browser storage was changed.

Template fingerprints:

| Template | SHA-256 |
|---|---|
| `apps/web/public/worlds/city-coast-01/template.v2.json` | `7544f569054e0a443725b98c47b4c944fb1621b18b694e68651f789cbeab52f6` |
| `apps/web/public/worlds/farm-valley-01/template.v2.json` | `5cd00d31ef6408ab84df2480ee87fcfd9e399a301d1afbd179baca6b0b1e4768` |

The script fingerprints Game, Root, GameLoop, TerrainRenderer and EnvRenderer before/after capture. None of those five files changed during this run. Other implementation files were being worked on independently; this report does not certify a frozen release build.

## Five angles per map

| Angle | City | Farm |
|---|---|---|
| Default | [City](../evidence/g3/parallel-visual/city-default.jpg) | [Farm](../evidence/g3/parallel-visual/farm-default.jpg) |
| Near top-down | [City](../evidence/g3/parallel-visual/city-topdown.jpg) | [Farm](../evidence/g3/parallel-visual/farm-topdown.jpg) |
| Default +180° orbit | [City](../evidence/g3/parallel-visual/city-rotate180.jpg) | [Farm](../evidence/g3/parallel-visual/farm-rotate180.jpg) |
| Shore close-up | [City](../evidence/g3/parallel-visual/city-shore.jpg) | [Farm](../evidence/g3/parallel-visual/farm-shore.jpg) |
| Road and trees | [City](../evidence/g3/parallel-visual/city-road-trees.jpg) | [Farm](../evidence/g3/parallel-visual/farm-road-trees.jpg) |

Every JPG has a matching `*-canvas.png` with the rendered scene without HUD overlays. Exact camera targets/yaw/pitch/distance are in the JSON. The top-down request passes 90° to the existing debug hook, but CameraRig clamps it to 75° perspective. Distance is also capped at 220 m. These images must not be described as an orthographic full-map layout check; some outer landmarks remain outside the frame.

## Measured observations

Hardware reported by WebGL: Intel UHD Graphics 750, ANGLE D3D11. Browser: Chrome 154.0.8037.98, headless, 1440×900, deviceScaleFactor 1. Other local tasks were running, so FPS is a short observation with uncontrolled host load, not a reference-device benchmark.

Sixteen default-camera samples were collected at 200 ms intervals after warm-up:

| Observation | City | Farm |
|---|---:|---:|
| Mean displayed FPS | 48.85 | 54.24 |
| Lowest sampled FPS | 33.95 | 52.86 |
| Default draw calls | 522 | 638 |
| Default triangles | 106,788 | 130,642 |
| Default GPU geometry objects | 82 | 93 |
| GPU texture objects | 1 | 1 |
| Shader programs | 14 | 14 |
| Scene mesh objects, after all angles | 889 | 941 |
| Scene InstancedMesh objects | 814 | 864 |
| Textured PlaneGeometry / sprites | 0 / 0 | 0 / 0 |
| Generated env instances | 2,378 | 2,561 |
| Tree/env footprint cells intersecting WATER | 0 / 0 | 0 / 0 |
| Natural road cells intersecting WATER | 0 | 0 |
| Buildings / bridges / crops | 0 / 0 / 0 | 0 / 0 / 0 |
| TILLED / EMBANKED / paved-road cells | 0 / 0 / 0 | 0 / 0 / 0 |
| Console/page errors / HTTP failures | 0 / 0 | 0 / 0 |

Against docs/11 §8, default draw calls **FAIL** the desktop ≤300 budget, and this run does not reach the 60 FPS desktop target. All captured angles stay below 1.5 million triangles. The 75° overview uses 667 City and 729 Farm draw calls. Close-ups use 194–260 calls. Asset×zone batching and rendering distant environment are candidates for the implementation owner to profile; no renderer changes were made in this task.

Geometry object counts increase while previously unseen assets enter the camera frustum: City 82→103, Farm 93→109 across the five angles. This is not a repeated warm-loop measurement and is not proof of a leak. The docs/10 §4.1 repeated-tool/construction/map-switch leak scenarios were **NOT RUN** by this script. The terrain counters only record initial world loading; no claim about edit rebuild latency is made.

## Lighting and visual checklist

All ten canvas histograms contain **0%** pixels with every RGB channel ≥250; the docs/10 ≤5% clipping check passes for these captures.

Road close-ups measure displayed-sRGB luminance over 3×3 pixel patches at projected natural-road cell centers and empty grass three cells away. City: 46 road / 90 grass patches, **33.62%** relative median luminance difference. Farm: 25 road / 51 grass patches, **32.59%**. Both exceed 15%. These measurements include scene shadows/perspective and are a screen-readability check, not a colorimeter or material-isolation measurement. Coordinates and every patch luminance are retained in JSON.

| docs/10 §5 item | Result and evidence |
|---|---|
| Real relief and a correct opposite view | PASS for captured views: bank slopes, trees and their shadows change under +180° orbit; scene audit finds zero textured image planes/sprites. |
| Untouched world, no player objects | PASS for captured snapshots/layers: zero buildings, bridges, crops, tilled/kè/paved-road cells. No fence mesh is visible in reviewed frames; a semantic fence classifier is not present in the audit. |
| No trees in water | PASS for every generated environment footprint against WATER cells. Actual foliage can overhang the shore; this test concerns placement cells. |
| Roads do not touch water | PASS for natural-road cells against WATER. Road elevation correctness is visually plausible in the road close-ups; a per-rendered-vertex floating-road test was not run. |
| No chunk cracks | No obvious open cracks in the reviewed frames. Thin pale lines align with the locked-zone overlay. Exhaustive numerical rendered-edge comparison was NOT RUN. |
| Post-terraform/kè/cầu alignment and z-fighting | NOT RUN: worlds remained untouched throughout this read-only capture. |
| Full topology/composition against concepts | PARTIAL: City river/coast and Farm curved stream/ponds are distinguishable. True orthographic whole-map coverage and art-owner approval are outstanding. |
| Grass/earth/water readability | PASS for measured clipping/contrast in these frames; the simplified placeholder style remains visibly below the concepts' art detail. |

Reference images `map/map_1.png` and `map/map_2.png` were inspected for this review. The concepts have layered rocky shorelines, varied ground tones, richer vegetation clusters and stronger landform silhouettes. Current banks visibly follow coarse grid steps, grass is comparatively uniform, and repeated tree silhouettes read as placeholders. The production-style concept roads/fences/tilled fields must not be copied into initial templates; their absence is intentional under docs/03–04 and does not count as a missing visual feature.

The default Farm shot shows the stream, central meadow and ponds; the northeastern waterfall is not clearly readable in that frame. The camera framing limit reduces confidence in the docs/04 default-composition requirement. A separate authored full-map/landmark review is still needed.

## Limits and ownership

The manifest contains 74 assets and all 74 are explicitly marked `placeholder: true`. These captures do not approve final asset quality, LOD, meshopt/KTX2, animation, mobile hardware, WebKit, server-backed character switching, 15-minute console stability, full-world load, G3 gameplay/tutorial completeness or G4 release readiness.

This task changed only `scripts/g3-visual-check.mjs`, `docs/evidence/g3/parallel-visual/**` and this report. No core/render/UI/content files were edited, no existing server was restarted, and no commit was created.
