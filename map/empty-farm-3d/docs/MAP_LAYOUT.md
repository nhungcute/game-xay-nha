# Original empty farmland layout

The provided reference is used **only** as visual guidance for density, color, water emphasis, and legible high-angle presentation. No reference pixels or 2D photo surfaces are imported into the application.

## Terrain composition

- **Far north (negative Z)**: uphill wilderness, tree clusters, rock outcrops, modest waterfall on the eastern tributary.
- **Main river**: a winding watercourse starting toward the north-west and meandering diagonally to the south-west, with a broad lake basin near the front-left.
- **East tributary**: a second real stream originating at a rocky waterfall and meeting the main river near the center-north.
- **Ponds**: broad south-west lake, lower meadow pond to the east, upper waterfall basin.
- **Central land**: empty green meadows and brown prepared-soil parcels, no crops or pre-built structures.
- **Nature**: deterministic tree stands around the outer edges and rocky streams, patches of shrubs, wildflowers, grass and stones, with build zones intentionally kept clear.
- **Dirt tracks**: separate corridors on both sides of the rivers. They **do not** cross water; no bridge or paved highway.
- **Parcel IDs**: `FARM-001` to `FARM-016`, a blend of soil and meadow fields; all 16 have a collision-free buildable center for the starter field footprint.

## Data-driven control

The following are editable directly in `public/worlds/farm-valley.json`:

- Size, seed, terrain mesh detail and decoration chunk size
- Waterway centerline points/width/height and elliptical lake data
- Path centerlines and widths
- Parcel polygon coordinates, ID, label and kind
- Tree, flower, rock and grass densities
- Background/lighting atmosphere and starter camera pose

Coordinates are stored in `[x,z]`, in engine units, not geospatial coordinates. Forest distribution is regenerated deterministically from the supplied seed on every load.

## Restrictions audited

Starter scene contains no home, barn, shed, stable, industrial structure, road asphalt, bridge, label floating in the world, tractor, windmill or urban decoration. The **UI overlay** contains construction options for the *player* to place future objects; those structures are not in the starter scene.
