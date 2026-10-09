# Verdant Valley — Real 3D Empty Farm Starter Map

A playable **Vite + Three.js** farming starter environment. This project **does not use the supplied reference image as a background, billboard, skybox, plane, or texture**. The terrain, water, parcel surfaces, rocks, trees, and paths are genuine 3D geometry; the starter world contains **zero buildings**.

**Current scope:** the farm map is implemented. The shared engine is JSON-driven and prepared for later *city* and *eco-settlement* map configurations, but those two maps have not been created.

## Run locally

Requires Node.js 22.12+ (or supported Node 20.19+) and npm access to install dependencies.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. The app loads `/worlds/farm-valley.json` by default. Switch to a separate future world with `?map=world-name` when its `public/worlds/world-name.json` exists.

Production build:

```bash
npm run test
npm run build
npm run preview
```

## Run in Docker

```bash
docker compose up -d --build
```

Visit **http://localhost:8080**. This runs Vite production assets on Nginx and serves `/health` as a lightweight health check. The first image build must have internet access to obtain npm dependencies. You can publish port 8080 through a Cloudflare tunnel if desired.

## What you get

- **True elevated terrain:** configurable world extent, tessellated mesh, vertex-color grass/sand/rock, slopes, bank carving and parcel grading; 3D mesh picking.
- **Real water:** two winding river meshes, three irregular natural lakes/ponds, animated shader highlights, shoreline foam, waterfall curtain geometry with a rocky escarpment.
- **Empty plots:** 16 uniquely identified, tessellated farm-ready parcels; meadow and prepared brown soil with rows, a few wooden fence fragments, **no existing buildings**.
- **Procedural nature:** six **original GLB assets** (pine, oak, shrub, rock, warmer rock, flower), deterministic seed, random rotation/scale, GPU instancing, chunk loading/unloading around the camera target.
- **Rural tracks only:** winding terrain-following dirt ribbons and pebbles, without asphalt, bridges, buildings, tractors, machines or urban props.
- **Interactive controls:** orbit, pan, zoom, topographic picking, parcel selection, construction-preview validity, collision checking, rotating buildings, deletion, local saves and JSON export/import.
- **Responsive UI:** desktop mouse, tablet and mobile gesture support, zoom/reset controls and compact construction tools.

### Camera controls

| Action | Desktop | Touch |
|---|---|---|
| Orbit camera | Drag left mouse | Drag one finger |
| Pan camera | Drag right mouse | Drag two fingers |
| Zoom | Mousewheel or ＋/－ buttons | Pinch or ＋/－ buttons |
| Pick parcel | Short click | Tap |
| Build | Choose item → click valid parcel | Choose item → tap |
| Rotate proposed building | `Q` or `E` (90° increments) | Tap the ⟳ rotate tool button |
| Delete selected building | `Delete` / `Backspace` or Tháo dỡ | Tháo dỡ |
| Exit building mode | `Esc` / Khám phá | Khám phá |

**Placement:** select `Đất trồng`, `Vườn cây`, `Nhà ở` or `Chuồng trại`, then click inside an editable parcel. Green preview means valid; red means blocked. The collision validator checks all four rotated footprint corners, parcel borders, paths, water and existing objects.

**Saves:** initial world always starts empty. Saved structures are stored in the browser only when you press **Lưu**, restored with **Tải**; or exported/imported as versioned JSON. Import rejects wrong worlds, invalid objects, duplicated IDs and colliding placement.

## Project structure

```
index.html                           Minimal game HUD + WebGL canvas
src/main.js                          Bootstrap, camera, picking, UI, animation
src/core/math.js                     Deterministic RNG, geometry, validation, saves
src/systems/Terrain.js               Elevation and true 3D ground mesh
src/systems/Water.js                 Rivers, ponds, animated shader, waterfall
src/systems/Paths.js                 Natural dirt-road mesh and stones
src/systems/Parcels.js               Selectable buildable mesh, soils, fences
src/systems/Vegetation.js            GLTFLoader, GPU InstancedMesh, lazy chunks
src/systems/Buildings.js             Edit/place/remove 3D structures, persistence
src/style.css                        Desktop/mobile interface
public/worlds/farm-valley.json       World layout and configurable seed
public/assets/models/*.glb          Six original procedural nature meshes
public/assets/models/LICENSE.md     Source and license documentation
scripts/generate_assets.py          Regenerate GLB files using trimesh
Dockerfile / docker-compose.yml      Production container
nginx.conf                           SPA/static configuration and /health
scripts/ & tests/                   Source verification, browser QA
```

## Tests

```bash
npm run test
```

Run the **real browser test** after npm dependencies are installed and the Vite dev server is running:

```bash
python tests/browser_smoke.py --url http://127.0.0.1:5173
```

It checks the scene's vertex count, empty initial world, GLB chunks, rivers/lakes, then rotates the actual Three.js camera **90°** and checks that the rendered screenshot differs. It also tests placing, serializing, clearing and restoring a valid structure. Screenshots are saved to `tests/screenshots/` and can be opened for visual confirmation. Use `pip install playwright pillow` if needed; install Chromium if `/usr/bin/chromium` is unavailable, passing `--chromium`.

**Verification status in the generation environment:** node logic tests and asset geometry checks were run, but this environment cannot reach the npm package registry. Therefore a Vite production build and actual browser render/rotation **could not be completed here**. Please run the browser test on a machine with dependencies installed before considering the result release-ready. No browser screenshot is being claimed as validated.

## Future maps

1. Copy `public/worlds/farm-valley.json` to `city-starter.json` or `eco-settlement.json` and change the dimensions, environment, waterways, paths and parcel geometry.
2. Replace `/assets/models/` with biome-appropriate licensed GLB sets, and extend `assetFiles` in `Vegetation.js` or supply a per-world asset manifest.
3. Introduce dedicated building catalogs and zoning policies in `Buildings.js`; reuse the terrain, water, camera, picking, chunk streaming and persistence systems.
4. Keep empty starter configurations at **zero** structures. Do not add buildings until a player triggers construction.

Further engine interfaces, performance notes and map design are documented in `docs/`.
