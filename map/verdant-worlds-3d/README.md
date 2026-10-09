# Verdant Worlds — Genuine Three.js 3D Starter Maps

**Farm map first.** A Vite + Three.js project that starts as a *completely empty, natural* farm world. All visible land, water, trees, bushes, rocks, flowers, paths, and parcel outlines are actual rendered 3D primitives/meshes. No reference photo, skybox photo, texture-plane reconstruction, or image-facade technique is used.

The design is an **original playable interpretation** of the supplied image, not a pixel-for-pixel 3D scan. Reconstructing exact photographic topology automatically would require manually modeled geometry, authored elevation masks, and art direction. The included GLB nature assets are deliberately lightweight demonstration models, not a photorealistic asset pack.

## Run locally

Requires Node.js 20.19+ (Node 22 recommended).

```bash
npm install
npm run dev
```

Open http://localhost:5173/ . The farm loads first.

Production build:

```bash
npm run build
npm run preview
```

### Docker

```bash
docker compose up --build -d
```

Open http://localhost:8080/ . The image is built with Node 22, served by Nginx. No backend is required: changes are stored in your browser's localStorage; JSON import/export provides portable saves.

Optional temporary public access when using Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:8080
```

**Note:** Quick tunnels are temporary and the URL is not stable across restarts. For a stable host name, use a named Cloudflare Tunnel and your own hostname.

## Controls

| Action | Desktop | Mobile / tablet |
| --- | --- | --- |
| Orbit | Left mouse drag | One-finger drag |
| Pan | Right mouse drag | Two-finger pan |
| Zoom | Mouse wheel | Pinch |
| Select lot | Click a green/tan plot | Tap a plot |
| Build | Select Cabin/Barn/Garden, then click chosen plot | Select tool and tap plot |
| Rotate structure | `R` or Rotate button | Rotate button |
| Cancel build | `Esc` or Explore | Explore tool |
| Plant an oak | Choose Plant an oak; click natural terrain | Choose tool, tap |
| Clear an existing tree | Choose Remove tree and click near it | Choose tool, tap |
| Demolish user-built item | Choose Demolish and click inside its footprint | Choose tool, tap |
| Save | `Ctrl/Cmd + S` or Save | Save |
| Export / import | JSON export and import buttons | Same buttons |
| Switch maps | Header map selector | Header map selector |

A construction preview is **green if placement is valid** and **red if invalid**. Buildings may only be placed within the selected lot; the structure footprint must fit, not touch water, pass terrain slope restrictions, and avoid other placed structures. Parcel IDs (`FARM-001`, etc.) remain stable across reloads and imports. All three maps initially contain **zero** buildings. Placement is player-driven.

## What is actually 3D?

- **Terrain:** Indexed Three.js `BufferGeometry`, elevation samples, procedural noise, vertex colors, normal generation and ridge formation; lake beds and river channels are physically lowered.
- **Water:** Distinct polygonal lake meshes with shallow/deep vertex-color bands, river ribbon meshes, specular reflections and world-space glints. Small islands rise *through* the lake surface. No water photographs.
- **Paths:** Curved dirt ribbon meshes and soft, organic plot-perimeter tracks. No asphalt, bridges, vehicles or modern infrastructure.
- **Vegetation:** Seven original GLB 2.0 files (`pine`, `oak`, `birch`, `shrub`, `rock`, `reeds`, `flowers`). `GLTFLoader` reads the asset primitives and `InstancedMesh` repeats them efficiently in deterministic world chunks.
- **Building zones:** Uniquely identified polygons; parcel picking happens after a real mesh-raycast against the heightfield. Highlights follow the 3D land surface.
- **Construction:** Actual volumetric buildings with roof geometry, materials and collision-aware placement. These appear **only** after the player creates them.
- **Camera:** Genuine movable `PerspectiveCamera` with Three.js `OrbitControls`. Orbit to the opposite side to inspect correct 3D depth.

## Maps, seeds and data

Configurations are in `public/worlds/`:

- `farm.json`: **22** natural farm lots, **3 lakes**, **3 winding rivers**, and 3 tiny raised islets. Full starter experience.
- `city.json`: **29** open lots, a river corridor, lower nature density, still **no modern roads or buildings**.
- `eco.json`: **16** eco parcels, 2 lakes, connected rivers, a planted islet and denser vegetation.

They use the **same engine code**; only JSON world definitions differ. Each JSON specifies `schemaVersion`, `mapId`, `seed`, size, terrain, polygonal lakes, river centerlines, optional islet polygons, paths, parcel IDs, nature density, chunk size, palette and camera.

Coordinates use meters in a right-handed world: `x` east–west, `y` up, `z` north–south. Polygon vertices and river/path control points are `[x,z]` pairs. GLB asset roots should be Y-up, one Three.js world unit per meter, with ground-level origin. World generation helper scripts are supplied. To change an authored map, edit the JSON itself (regeneration scripts overwrite that config) and reload.

The landscape is procedural **but deterministically reproducible** using `seed`. Tree removals, newly planted trees and structures are stored as player changes rather than mutating the source map. Nearby vegetation chunks are rebuilt lazily as camera target position changes.

## Modules

```text
src/
  main.js                    app, camera, picking, UI controls, app lifecycle
  core/
    math.js                  polygon math, collisions, hashing, noise, RNG
    storage.js               save/load/export/import
    world.js                 JSON world validation/load
  systems/
    terrain.js               elevation mesh, water carve, parcel flattening
    surfaces.js              separate lake, river and dirt-trail meshes
    nature.js                GLTFLoader, instancing, deterministic chunks
    parcels.js               parcel selection/highlight
    buildings.js             procedural building meshes and placement
public/
  worlds/{farm,city,eco}.json
  assets/models/*.glb        original geometry, CC0 license + manifest
scripts/
  generate_assets.py         optional GLB recreation (Python trimesh)
  make_worlds.py             optional JSON recreation (Python standard library)
  browser-smoke.mjs          real Chromium WebGL interaction validation
tests/
  geometry.test.js           pure mathematical/config unit tests
Dockerfile, docker-compose.yml, nginx.conf
```

### Tests / browser 3D validation

Unit tests (no browser needed):

```bash
npm test
```

Browser smoke test (requires an installed Playwright Chromium):

```bash
npx playwright install chromium
npm run dev
# in another terminal:
npm run test:browser
```

The browser script verifies that the terrain has tens of thousands of actual vertices, lakes and rivers are separate meshes, GLB instances exist, no structures are initially present in a fresh browser context, a mouse drag rotates the camera (and changes the screenshot), a parcel can be selected, a garden can be constructed, and the building survives a save/reload. It saves screenshots to `screenshots/farm-isometric.png` and `screenshots/farm-rotated.png`. These screenshots are **not** used as backgrounds in the app.

You can also inspect `window.__mapDebug()` in Chrome DevTools: it exposes counts of rendered geometry, GLB instances, parcel IDs and current camera position; it includes a camera orbit helper to verify the landscape from an alternate perspective.

To inspect any of the GLBs, drop the `.glb` into Blender or a glTF 2.0 viewer and rotate the 3D model.

## Current implementation scope / production notes

- **Implemented:** Actual geometry, Three.js camera controls, real geometry raycasting, parcel selection, basic green/red construction validity, 3 user-built structure types, vegetation plant/clear, save to localStorage, import/export JSON, deterministic instancing and proximity chunk loading, mobile layout, Docker image.
- **Not included:** Server-side collaborative saves, multiplayer, economy/quests, complex building blueprints, advanced biome generation, navmesh walking agents, sculpting the heightfield in-app, advanced GPU water simulation, LOD generation for art-quality GLBs, parcel ownership permissions, authenticated APIs, or a pixel-perfect reproduction of the reference.
- For large-scale production worlds, use hierarchical LOD, terrain quadtree chunks and pooled worker computations; this demo chunks *vegetation*, while its ~34k-vertex terrain is a single mesh.
- The supplied glTF files and generator are original and CC0 (see `public/assets/models/LICENSE.md`). Do **not** assume the user-provided reference image or third-party art has this license.
- Runtime internet is needed only to install npm packages; the app itself does not fetch remote image textures or 3D models. Optional Google Fonts may require network, with local system-font fallback.

## Troubleshooting

- **Black frame / WebGL failed:** Turn on hardware acceleration or use another Chromium/Firefox build; check browser console.
- **Models 404:** Run the Vite dev server or Nginx; opening `index.html` via `file://` does not work because ES modules and `fetch` require HTTP.
- **Starter map contains old buildings:** Clear the `terrain-builder-v1-farm` localStorage key or use a fresh browser profile. Builds persist intentionally.
- **Slow on mobile:** Decrease `public/worlds/farm.json` `terrain.resolution` or the nature density values; lower renderer pixel ratio and reduce shadow map resolution in `src/main.js`.
- **Changes do not persist across different devices:** Import/export the JSON save. There is currently no remote data store.
