# Engine architecture and extensibility

## Scene graph

```
Three.Scene
  ├── TerrainSystem       → subdivided terrain, real elevation, bank carving
  ├── WaterSystem         → two river meshes, three lake meshes, cascade 3D forms
  ├── PathSystem          → curved dirt ribbons + instanced small stones
  ├── ParcelSystem        → selected/graded parcel meshes + borders + rural fences
  ├── VegetationSystem    → GLB source geometry → lazily loaded instanced chunks
  └── BuildingSystem      → zero on startup, procedural editable placed structures
```

The systems are independent. Scene camera, interaction, UI, and persistence live in `src/main.js`; deterministic geometry, polygon checks and save validation live in `src/core/math.js` and do not import Three.js.

## Coordinate contract

- Right-handed Three.js coordinates; **Y is up**; horizontal map coordinates are `[x,z]` in world JSON.
- World dimensions: width=260 (x from -130 to +130); depth=220 (z from -110 to +110).
- Water polygons and rural paths are horizontal world-space meshes, not textures projected onto a flat photograph.
- Rivers are generated as Catmull–Rom centerline ribbons. Water uses an animated custom shader. Lakes use concentric radial mesh rings.
- Terrain vertices are sampled from procedural elevation, raised border ridges and depressed waterbanks. Farm parcels are graded and covered with tessellated surfaces conforming to terrain.
- All editable parcels have IDs; placement snapshots serialize ID, type, parcelId, world x/z and yaw rotation.

## GLB data and instancing

- `scripts/generate_assets.py` writes glTF 2.0 binary assets directly using original parametric forms.
- `GLTFLoader` loads the reusable GLB parts, and each part becomes an `InstancedMesh` per populated camera chunk.
- `seeded(seed)` controls placement distribution, rotation and scale (no network assets, no runtime procedural download).
- Nature is excluded from buildable polygon interiors, dirt-road clearances, and water margins.
- `VegetationSystem.populate` creates a deterministic chunk manifest; `update` lazy-loads nearby render chunks and evicts remote instance buffers. Chunk centers are anchored to configurable 52-unit cells.
- Chunk size and nature densities are world-configuration values. Reduce densities for lower-end phones.
- This is **chunked instance loading**, not a network streaming system for large city world-data files yet. For very large worlds, add a chunk JSON manifest and network fetch layer.

## Save contract

`schemaVersion=1`, `worldId`, `seed` and `objects[]`.

Each object has unique `id`, `type`, `parcelId`, `x`, `z`, `rotation`. Data importing checks schema, world match, maximum object count, known types, numeric coordinates, duplicates, bounds, water, paths, parcels and inter-building overlaps. Saves contain only player additions; seed/config terrain is reconstructed on load.

## Collision contract

The current prototype uses a conservative two-stage planner:

1. Four rotated footprint corner checks (plus center) against `polyContains` and minimum polygon edge clearance; also checks each point against river/lake regions and path ribbons.
2. Bounding-radius separation of every placed structure, with a small extra clearance to prevent overlapping structure footprints.

This is sufficient for starter-map placement. A production large-city edition should replace coarse bounding-circle collision with spatial hashing plus separating-axis theorem or physics collider primitives.

## City and eco-settlement reuse

- Reusable: scene/renderer, orbit controls, terrain topology, water, picking, persistence, parcel polygon validation, chunked instancing, responsive layout.
- Parameterize per new JSON: world size/seed, terrain height or heightmap, water/paths, parcel zoning and biomes, decorations, material colors, sky/sun.
- Expand by new modules: `ZonePolicies` (city blocks / green rules), GLB asset catalogs, traffic/path networks, roads and urban objects **only for city maps**. Do not pollute the farm starter scene with urban elements.
- The current JSON is farm-specific and should be treated as the first adapter, not as proof that city and eco-settlement content already exists.

## Performance and visual tuning

- Target around 57,681 terrain vertices, user-configurable segmentation.
- Current scene uses real-time sunlight shadows; map shadow size is lower on mobile.
- Uses 3D assets across forest-edge density with several hundred broadleaf and pine trees plus thousands of minor foliage/rocks/flowers.
- Pixel ratio capped at 1.85 for desktops and 1.50 for touch devices.
- An orthographic projection provides isometric readability while preserving real 3D orbit rotation and perspective depth cues from geometry.
- Planned follow-ups: terrain LOD, foliage shadows LOD, occlusion culling, per-chunk network loading and optional quality settings, procedural foliage atlas and profiler overlay.
