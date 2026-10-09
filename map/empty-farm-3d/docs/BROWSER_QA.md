# Browser validation checklist (run after installing dependencies)

1. Open desktop view at `http://localhost:5173`. Wait for the loading panel to disappear.
2. Confirm the scene has true 3D contours, a visible meandering river, separate lake meshes, real tree trunks and crowns, and 16 land polygons. There must be **0** starter structures.
3. Left-drag 360° around the map; check rock, terrain, trees and the waterfall from behind and at oblique angles. No surface should flip into a billboard photo.
4. Right-drag to pan; scroll/pinch and test ＋/－, then reset camera; check limits.
5. Select three different parcels. The panel should display their own IDs. No nameplates are drawn in the 3D world.
6. Choose a build type. Hover over a valid parcel center (green), water, road, and another building (red). Place an object, then rotate a second with Q/E and place it separately. Test the collision warning by clicking the occupied area.
7. Select an existing object and remove it. Press **Lưu** to save, add an object, press **Tải** to restore. Test exporting JSON and re-importing it.
8. Resize the browser to 390×844, use touch gestures if available, and confirm controls and toolbar remain usable.
9. Open DevTools Console, verify no exceptions or missing GLBs. For programmatic tests run `python tests/browser_smoke.py`.
10. With the browser test, inspect `tests/screenshots/initial.png` and `rotated_90_degrees.png`. Different camera angles MUST produce different object silhouettes, not an unchanged 2D terrain photograph.

## Reproducible debug helpers

Open developer console:

```js
window.__farmDebug.summary()
window.__farmDebug.rotateCamera(Math.PI / 2)
window.__farmDebug.buildings.serialize()
```

## Verification disclosure

The source was checked with Node's parser; deterministic geometry/placement/save tests passed; GLB files were inspected with `trimesh`. The authoring container could not resolve npm package-registry hosts, so an actual Vite/WebGL browser run was not possible there. No run was falsely represented as completed. Execute the above steps in an internet-connected environment before deployment.
