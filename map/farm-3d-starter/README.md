# Wildlands — Interactive 3D Farm Starter World

**A real geometry-based Three.js + Vite world builder.** The reference image is **not** rendered, loaded, projected or used as a skybox. Every landscape element in the runtime is a mesh, and all asset trees and stones are real `.glb` geometry with legally documented provenance. Camera rotation reveals true depth and surfaces.

## Start locally

Requires Node.js **20.19+ or 22.12+** (Node 22 recommended) and npm. Internet access is required only once for installing npm dependencies.

```bash
npm install
npm run dev
```

Visit `http://localhost:5173/`. Or create an optimized build using `npm run build` then `npm run preview`.

### Docker

```bash
docker compose up --build -d
```

Visit `http://localhost:8080/` (change `8080:80` if occupied). This can also be served by an existing Cloudflare Tunnel to `http://localhost:8080`.

## Map variants

- Farm (default): `http://localhost:5173/?world=farm`
- City: `http://localhost:5173/?world=city`
- Eco settlement: `http://localhost:5173/?world=eco`

The farm is the fully designed main world; city and eco are **example config variants**, sharing the initial map geometry and build tools with distinct seed/palette/density/parcel IDs. They are not finished bespoke landscapes. Replace the JSON waterways, terrain settings, assets and parcels to build visually different worlds. All presets start empty with no buildings, paved roads, bridges, signs or modern props.

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Orbit camera | Left mouse drag | One finger drag |
| Pan | Right mouse drag | Two fingers drag |
| Zoom | Scroll | Pinch |
| Inspect lot | Inspect tool, click grass lot | Inspect tool, tap lot |
| Place building/crop | Pick tool and click a valid lot | Pick tool and tap valid lot |
| Rotate construction | `R` key or Rotate button | Rotate button |
| Select mode | Escape or Inspect | Inspect |
| Show parcel boundaries | LOTS | LOTS |
| Orthographic top/isometric | TOP / ISO | TOP / ISO |
| Save/load constructions | Save / Load | Save / Load |
| Portable save | Export / Import JSON | Export / Import JSON |

The map starts with **zero structures**, regardless of previously saved data. Load explicitly to restore. Buildings are sample procedural models that you can replace with a proper asset catalog. All 14 parcels have stable IDs and real polygon coordinates.

## File structure

```
public/worlds/{farm,city,eco}.json      world config and parcel polygons
public/assets/*.glb                    original sample 3D vegetation models
public/assets/LICENSE.md               GLB license information (CC0)
scripts/generate_assets.py              reproducible procedural GLB generation
src/core/WorldField.js                  deterministic height/water/parcel field
src/core/math.js                        seeded RNG, noise, geometric helpers
src/systems/TerrainSystem.js            vertex-colored chunk terrain mesh
src/systems/WaterSystem.js              separate water shaders and meshes
src/systems/PathsSystem.js              dirt strips following terrain height
src/systems/VegetationSystem.js         GLTFLoader and chunked InstancedMesh
src/systems/ParcelsSystem.js            IDs, selection, parcel geometry
src/systems/ConstructionSystem.js       placement, collision, serialization
src/ui/ui.js                            responsive HUD and controls
src/main.js                             scene orchestration and raycast input
tests/world.test.mjs                    map invariants + deterministic tests
Dockerfile, docker-compose.yml          multistage static-site deployment
```

## How it works

1. Fetch world JSON and construct a deterministic height function driven by seeded multi-frequency noise.
2. Carve sea, river and lake beds **into the terrain itself**; terrain is tiled into 40m chunks, tessellated using a real triangle mesh with per-vertex terrain color.
3. Build water as independent, slightly animated mesh geometry. The river is a continuous ribbon, the sea is a polygonal surface, ponds are tessellated disks and the waterfall is a vertical 3D surface.
4. Construct dirt roads as genuine 3D strips, draped to terrain elevations. No asphalt, road sprites, elevated modern bridges or image planes.
5. Load four original sample GLB models, seed their placement reproducibly, cull trees from parcels, roads and water, and render with per-chunk `THREE.InstancedMesh` groups. Only nearby terrain and vegetation chunks remain in the scene; cached chunks are reused.
6. Raycast against terrain chunks for picking, then resolve world-space parcel polygons and preview/validate object footprints. Placement requires all four corners inside the same lot, safe distance from water and paths, gentle slope, no rock/tree obstruction and no overlap with existing constructions.
7. Save world ID, seed, version and player construction transforms as JSON; restore with validation (not by storing an image of the world).

## World file edits

The world axes are `X` east/west and `Z` north/south with **Y as elevation**. The map center is `(0, 0)`, world width 320 and depth 240. Negative Z is the far/northern edge.

- `seed`: deterministically changes terrain noise and placement of trees/rocks.
- `coastline`: polyline `[x,z]` control points at the edge of the foreground sea.
- `river.points`: river centerline control points; `river.width`: physical ribbon width.
- `lakes`: centers and radii, all carved and rendered separately.
- `paths`: path centerlines plus physical strip widths; keep paths on land.
- `parcels`: unique IDs, names, types and polygon vertices, ideally inside road loops.
- `vegetation.density`: scales the candidate count per terrain chunk.
- `palette`: grass, meadow, dirt, sand, water colors.

## License

Source code produced for this sample: MIT (see `LICENSE`). Original GLB mesh assets: CC0 1.0 (`public/assets/LICENSE.md`). Three.js and Vite: MIT, installed from their official npm packages. No reference artwork shipped inside this project.

## Testing and 3D validation

```bash
npm test
npm run build
```

For actual visual validation, open in Chromium, inspect from a steep isometric angle, select a buildable lot, **orbit 180 degrees** and check the depth of tree crowns, rocks, cliffs and water surfaces. Pan, zoom, use both desktop mouse and mobile touch simulation; try placing two barns on top of each other (second must be rejected), build outside a parcel (rejected), save, reload and import JSON. In a development browser console, optional automated diagnostics:

```js
window.__FARM_WORLD_DEBUG__.getStatus();
window.__FARM_WORLD_DEBUG__.rotateTest();
window.__FARM_WORLD_DEBUG__.validateAt(-30, 38, 'crop');
```

**Limitations:** Environmental detail is stylized and procedural, so it approximates the reference's layout and palette rather than reproducing each unique tree and rock exactly. Water uses lightweight procedural waves, not a physical fluid solver. City and eco worlds are config demonstrations. Larger multiplayer deployments should replace browser-only storage with an API and server-side collision validation.

### Automated Chromium visual check (optional)

With Vite running at port 5173, install the Python Playwright browser once (only necessary for this optional test), then run:

```bash
python -m pip install playwright
python -m playwright install chromium
python tests/e2e_browser.py
```

The test asserts all GLB assets are loaded, thousands of actual triangles and many GLB instances exist, the water system uses meshes, the camera changes coordinates on rotation, parcel construction and collision behave correctly, and save/load round trips. It saves `screenshots/farm_isometric.png` and `screenshots/farm_rotated_real_3d.png` for visual inspection. These are **screenshots produced by the actual browser scene**, not reference backdrops.

To regenerate the original GLB assets after modifying their generator:

```bash
python -m pip install trimesh numpy
python scripts/generate_assets.py
```
