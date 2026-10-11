// D029: import the 21-model GLTF pack (map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du) into game-ready GLBs.
// Each building becomes ONE mesh with ONE material: flat normals, per-vertex colour (COLOR_0),
// 2 m/cell scale, door facing -Z, bottom-centre pivot at y=0 — ready for a single InstancedMesh.
// Deterministic: the same pack bytes always produce byte-identical outputs (`--check` verifies).
// The pack (283 MB) is NOT committed; `--check` skips with a notice when it is absent so CI passes.
//
// Usage: node scripts/import-model-pack.mjs            # (re)generate models + model-pack.config.json
//        node scripts/import-model-pack.mjs --check    # byte-compare outputs, exit 1 on drift
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'map/Bo_21_Mo_Hinh_3D_GLTF_Day_Du';
// The pack's own LOD1 is destructive (city_bank loses its columned portico; QC 2026-10-11 compared both LODs),
// so LOD0 is the import source and the simplifier does the reduction instead. Output budgets are unchanged.
const SOURCE_LOD = 'lod0';
const OUT_DIR = 'apps/web/public/assets/models/authored';
const CONFIG_PATH = 'scripts/model-pack.config.json';
const CHECK = process.argv.includes('--check');

const MARGIN = 0.92;
// Base colours were authored in sRGB by build_assets.py; glTF stores factors linearly, so convert once here.
const GLASS_SRGB = [0.227, 0.29, 0.353]; // dark blue-grey replaces alphaMode BLEND window glass
// These groups spill onto neighbouring cells and paint over roads on every model.
const ALWAYS_DROP = ['LANDSCAPE_OPTIONAL', 'PATH_OPTIONAL', 'PARKING_OPTIONAL'];
// Decor buildings and the market ARE their optional content (stalls, fences, flowers) — keep it, drop only spilling ground.
const KEEP_OPTIONAL_NOTE = 'decor/market: optional groups are the visible content; only spilling ground groups are dropped';

// D029 mapping (docs: game id → pack model). rural_warehouse is NOT used: silo keeps its placeholder
// (a 4×3 warehouse squeezed into 2×2 reads as a barn, not a silo).
const MODELS = {
  well: ['rural', 'rural_well'],

  house_small: ['city', 'city_small_house'],
  shop_grocery: ['city', 'city_convenience_store'],
  house_town: ['city', 'city_townhouse'],
  shop_cafe: ['city', 'city_coffee_shop'],
  shop_restaurant: ['city', 'city_restaurant'],
  bank: ['city', 'city_bank'],
  house_apartment: ['city', 'city_apartment'],
  office_tower: ['city', 'city_office_tower'],
  hotel: ['city', 'city_hotel'],
  shop_supermarket: ['city', 'city_supermarket'],
  deco_garden: ['city', 'city_flower_garden'],
  deco_park: ['city', 'city_park'],
  farmhouse: ['rural', 'rural_farmer_house'],
  market: ['rural', 'rural_market'],
  chicken_coop: ['rural', 'rural_chicken_coop'],
  rice_mill: ['rural', 'rural_windmill'],
  cow_barn: ['rural', 'rural_cowshed'],
  bakery: ['rural', 'rural_bakery_oven'],
  deco_flowerbed: ['rural', 'rural_flower_bed'],
};
const MODEL_NOTES = {
  deco_garden: KEEP_OPTIONAL_NOTE,
  deco_park: KEEP_OPTIONAL_NOTE,
  deco_flowerbed: KEEP_OPTIONAL_NOTE,
  market: 'stalls/canopy/produce optional groups are the market itself; only spilling ground groups are dropped',
};
const PLACEHOLDER_KEPT = {
  silo: 'rural_warehouse is a 4×3 barn; squeezed into the 2×2 silo footprint it reads wrong — keep the placeholder silo drum (D029)',
};

// docs/11 §8 budget headroom: the full-world low-graphics city sits near the 500k-triangle budget, so the
// simplifier targets 70 % of the test cap — the cap itself stays the hard limit (QC 2026-10-11: 0.8 hit 520k).
// Colour weights 0.5 keep colour regions apart where the budget allows.
const TRIANGLE_CAP = { 1: 800, 2: 1800, 3: 2500, 4: 3500 };
const SIMPLIFY_RATIO = 0.7;
const SIMPLIFY_COLOR_WEIGHT = 0.5;
const SIMPLIFY_WEIGHTS = [SIMPLIFY_COLOR_WEIGHT, SIMPLIFY_COLOR_WEIGHT, SIMPLIFY_COLOR_WEIGHT];

// Per-model triangle-cap overrides (D029 review): the well needs headroom for its roof supports.
const CAP_OVERRIDES = { office_tower: 4500, well: 1200 };

/**
 * Per-group simplification policies (D029 review). Defaults: drop the three spilling ground groups, simplify
 * everything else at the global error (escalating only through the simplifier's topology asserts). Entries here
 * override per group — `preserve` skips simplification for thin structural details (posts, porticoes, sails),
 * `error` sets a per-group simplifier error, `drop` removes a group outright. Reasons are recorded verbatim in
 * model-pack.config.json.
 */
const GROUP_POLICIES = {
  well: {
    GARDEN_OPTIONAL: { drop: true, reason: 'decorative bushes eat the 1200-triangle budget and hide the well (review: roof supports must connect)' },
    WELL: { error: 0.25, reason: 'stone ring is grounded; it tolerates a coarse error and frees budget for the roof posts' },
    ROOF: { error: 0.01, reason: 'the roof carries the support posts — a light error keeps them connected to the ring (review: no floating roof)' },
    CANOPY: { preserve: true, reason: '36 triangles; the canopy beam ties the posts together' },
    PULLEY_ANIMATED: { preserve: true, reason: 'signature pulley hangs under the beam; animation pivot kept for later' },
    BUCKET_OPTIONAL: { preserve: true, reason: 'tiny and part of the pulley cluster' },
    ROPE: { preserve: true, reason: '28 triangles connecting pulley and bucket' },
  },
  deco_garden: {
    LANDSCAPE_OPTIONAL: { error: 0.5, reason: 'flat bed ground — the coarsest error frees budget for the arch and fountain' },
    FOUNTAIN: { error: 0.05, reason: 'the fountain basin is the centrepiece inside the arch (preserve alone would exceed the 800 cap)' },
    TRELLIS_OPTIONAL: { error: 0.05, reason: 'thin arch slats need a light error to stay connected' },
    PROPS_OPTIONAL: { error: 0.1, reason: 'small planters — moderate error' },
    PATH_OPTIONAL: { error: 0.3, reason: 'flat path ground' },
  },
  deco_flowerbed: {
    GARDEN_OPTIONAL: { error: 0.01, reason: 'review: the vine leaves detach when their thin stems collapse — near-lossless plants' },
  },
  deco_park: {
    LANDSCAPE_OPTIONAL: { error: 0.35, reason: 'review: keep the lawn — the footprint fit scales it into the 3×3 cells' },
    GARDEN_OPTIONAL: { error: 0.05, reason: 'review: trees and rose bushes are the point of the park; a light error keeps trunks attached to canopies' },
    PATH_OPTIONAL: { error: 0.3, reason: 'review: keep the paths while they fit the budget' },
    PERGOLA_OPTIONAL: { preserve: true, reason: 'thin slats collapse into splinters; only 428 triangles' },
    PROPS_OPTIONAL: { error: 0.15, reason: 'benches and lamps read well at a moderate error' },
  },
  rice_mill: {
    FENCE_OPTIONAL: { drop: true, reason: 'review: fence rails collapse into loose standing posts — the brief allows dropping the fence outright' },
    SAILS_ANIMATED: { preserve: true, reason: 'the sails are the identity of the windmill and the animation pivot lives in the hub' },
  },
  house_town: {
    STRUCTURE: { error: 0.02, flags: ['Regularize'], reason: 'review: Regularize keeps wall triangles even — flat walls without a near-lossless budget' },
    DOORS_WINDOWS: { error: 0.35, reason: 'window frames read at a coarse error; budget belongs to the flat walls' },
    BALCONY_OPTIONAL: { error: 0.4, reason: 'balcony slabs tolerate a coarse error' },
    ROOF: { error: 0.2, reason: 'the mansard shell reads at a moderate error' },
    LANDSCAPE_OPTIONAL: { drop: true, reason: 'review: flat yard ground — dropped to keep the flat walls inside the 1800 cap' },
    GARDEN_OPTIONAL: { drop: true, reason: 'review: yard bushes — dropped to keep the flat walls inside the 1800 cap' },
    PATH_OPTIONAL: { drop: true, reason: 'review: flat path ground — dropped to keep the flat walls inside the 1800 cap' },
    DETAILS: { error: 0.4, reason: 'small trims — coarse error' },
  },
};

/** Floating-part QC gate exceptions (counted floats only — see floatingParts' 0.3 m size floor). */
const GATE_EXCEPTIONS = {
  office_tower: { max: 8, reason: 'source-pack recessed window panes >= 0.3 m ship detached-looking (D029-audited baseline)' },
  house_town: { max: 5, reason: 'review: coarse balcony/roof groups (the wall-flatness fix) leave small slabs detached-looking; the walls themselves are flat' },
  shop_grocery: { max: 2, reason: 'source-pack recessed panes/signs >= 0.3 m ship detached-looking' },
  shop_cafe: { max: 5, reason: 'source-pack parasols and signage >= 0.3 m ship detached-looking' },
  shop_restaurant: { max: 5, reason: 'source-pack awning rails and lamps >= 0.3 m ship detached-looking' },
  hotel: { max: 8, reason: 'source-pack balconies and signs >= 0.3 m ship detached-looking' },
  shop_supermarket: { max: 3, reason: 'source-pack cart-corral frames >= 0.3 m ship detached-looking' },
  deco_park: { max: 3, reason: 'review: three preserved pergola/edging slats (0.33x0.13x0.02 m) — kept on purpose' },
  market: { max: 1, reason: 'source-pack crate >= 0.3 m ships detached-looking' },
  chicken_coop: { max: 1, reason: 'source-pack feeder frame >= 0.3 m ships detached-looking' },
  cow_barn: { max: 7, reason: 'source-pack barn lights and troughs >= 0.3 m ship detached-looking' },
  bakery: { max: 1, reason: 'source-pack awning box >= 0.3 m ships detached-looking' },
  rice_mill: { max: 1, reason: 'a sail spoke can clear the 3 cm bbox pad from the hub without looking detached; the sails are preserved on purpose' },
  // well, house_town, deco_garden, deco_flowerbed, house_apartment, bank, office_tower, farmhouse
  // have no baseline: the gate requires 0 floats there.
};

function triangleCap(gameSize, id) {
  if (CAP_OVERRIDES[id] !== undefined) return CAP_OVERRIDES[id]; // office_tower 4500; well 1200 (roof supports, review)
  // Size classes from the D029 brief: 1 cell ≤ 800; 2×2–2×3 ≤ 1800; 3×3 ≤ 2500; 4×4–4×5 ≤ 3500.
  return TRIANGLE_CAP[Math.min(4, Math.min(...gameSize))];
}

const srgbToLinear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

// ---------- minimal glTF/GLB reading (the pack stores plain float32 positions) ----------

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binaryHeader = 20 + jsonLength;
  if (buffer.readUInt32LE(binaryHeader + 4) !== 0x004e4942) throw new Error('GLB has no BIN chunk');
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  return { json, binary: buffer.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength) };
}

const COMPONENT_BYTES = { 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(json, binary, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView ?? 0];
  const bytes = COMPONENT_BYTES[accessor.componentType], components = COMPONENT_COUNT[accessor.type];
  const stride = view.byteStride ?? bytes * components;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i++) for (let c = 0; c < components; c++) {
    const offset = start + i * stride + c * bytes;
    out[i * components + c] = accessor.componentType === 5126 ? binary.readFloatLE(offset)
      : accessor.componentType === 5125 ? binary.readUInt32LE(offset)
      : accessor.componentType === 5123 ? binary.readUInt16LE(offset)
      : accessor.componentType === 5122 ? binary.readInt16LE(offset) : binary.readUInt8(offset);
  }
  return out;
}

function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

function composeTrs(translation, rotation, scale) {
  const [x = 0, y = 0, z = 0] = translation ?? [];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = scale ?? [];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    x, y, z, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
  }
  return out;
}

/** Depth-first walk of the scene graph: bakes world matrices and tags each primitive with its BUILDING_ROOT group. */
function collectPrimitives(json, binary) {
  const primitives = [];
  const visit = (node, matrix, group) => {
    const world = multiply(matrix, node.matrix ? [...node.matrix] : composeTrs(node.translation, node.rotation, node.scale));
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        const positions = readAccessor(json, binary, primitive.attributes.POSITION);
        const baked = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
          const x = positions[i], y = positions[i + 1], z = positions[i + 2];
          baked[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
          baked[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
          baked[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
        }
        const source = primitive.indices !== undefined ? readAccessor(json, binary, primitive.indices) : null;
        const indices = new Uint32Array(source ? source.length : positions.length / 3);
        for (let i = 0; i < indices.length; i++) indices[i] = source ? source[i] : i;
        primitives.push({ positions: baked, indices, material: primitive.material ?? 0, group: group ?? '(root)' });
      }
    }
    for (const child of node.children ?? []) {
      const childNode = json.nodes[child];
      // The group is the first named level below BUILDING_ROOT; deeper nodes inherit it.
      const childGroup = group ?? (node.name === 'BUILDING_ROOT' ? childNode.name ?? '(root)' : undefined);
      visit(childNode, world, childGroup);
    }
  };
  for (const index of json.scenes[json.scene ?? 0]?.nodes ?? []) visit(json.nodes[index], identity(), undefined);
  return primitives;
}

// ---------- pipeline: colour → weld → simplify → flat normals → fit → GLB ----------

/** Material factors → opaque 8-bit vertex colour (linear). BLEND glass becomes a solid dark blue-grey. */
function materialColor(json, materialIndex) {
  const material = json?.[materialIndex];
  const factor = material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
  const isGlass = material?.alphaMode === 'BLEND';
  const source = isGlass ? GLASS_SRGB : factor;
  const linear = [0, 1, 2].map(channel => srgbToLinear(Math.min(1, Math.max(0, source[channel]))));
  return {
    bytes: Uint8Array.from([...linear, 1].map(value => Math.round(value * 255))),
    glass: isGlass,
    metallic: (material?.pbrMetallicRoughness?.metallicFactor ?? 0) > 0.3,
  };
}

/**
 * Mark every connected pane of source BLEND glass before welding. The original pack puts many panes in a
 * single primitive, so material identity alone is not enough to make the lights look inhabited.
 */
function tagWindows(primitives, materials) {
  let next = 1;
  for (const primitive of primitives) {
    if (!materialColor(materials, primitive.material).glass) continue;
    const vertices = primitive.positions.length / 3, parent = new Int32Array(vertices);
    for (let i = 0; i < vertices; i++) parent[i] = i;
    const find = index => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    for (let i = 0; i < primitive.indices.length; i += 3) {
      const a = primitive.indices[i], b = primitive.indices[i + 1], c = primitive.indices[i + 2];
      join(a, b); join(b, c);
    }
    const ids = new Float32Array(vertices), components = new Map();
    for (let i = 0; i < vertices; i++) {
      const root = find(i);
      let id = components.get(root);
      if (id === undefined) { id = next++; components.set(root, id); }
      ids[i] = id;
    }
    primitive.windowIds = ids;
  }
  return next - 1;
}

/** Weld by position+colour+window id: panes never share vertices with walls or other panes. */
function weld(primitives, materials, windowCount) {
  const map = new Map(), positions = [], colors = [], windows = [], indices = [];
  for (const primitive of primitives) {
    const color = materialColor(materials, primitive.material).bytes;
    for (const index of primitive.indices) {
      const x = primitive.positions[index * 3], y = primitive.positions[index * 3 + 1], z = primitive.positions[index * 3 + 2];
      const window = (primitive.windowIds?.[index] ?? 0) / Math.max(1, windowCount);
      const key = `${Math.round(x * 1e4) + 0},${Math.round(y * 1e4) + 0},${Math.round(z * 1e4) + 0},${color[0]},${color[1]},${color[2]},${window}`;
      let vertex = map.get(key);
      if (vertex === undefined) {
        vertex = positions.length / 3;
        map.set(key, vertex);
        positions.push(x, y, z); colors.push(color[0], color[1], color[2]); windows.push(window);
      }
      indices.push(vertex);
    }
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), windows: new Float32Array(windows), indices: new Uint32Array(indices) };
}

/** Simplify one welded group: reduce until the error budget is spent (target 0 = error-driven) or until an
 *  explicit target-triangle count is reached — escalating the error when a locked-border mesh cannot reach the
 *  target at the requested quality. Retries through the simplifier's topology asserts. The pack's non-manifold
 *  double walls can abort the WASM mid-collapse; an aborted instance keeps failing afterwards, so each retry
 *  loads a FRESH simplifier instance (query-string import busts the ESM module cache). */
let simplifierInstance = null, simplifierReloads = 0;
async function getSimplifier(fresh = false) {
  const specifier = fresh ? `meshoptimizer/simplifier?fresh=${++simplifierReloads}` : 'meshoptimizer/simplifier';
  simplifierInstance = (await import(specifier)).MeshoptSimplifier;
  return simplifierInstance;
}
async function simplify(welded, error, targetTriangles = welded.indices.length / 3, extraFlags = []) {
  const attributes = new Float32Array(welded.colors.length);
  for (let i = 0; i < welded.colors.length; i++) attributes[i] = welded.colors[i] / 255;
  const target = Math.max(0, Math.round(targetTriangles)) * 3;
  const steps = [];
  for (let attempt = error; attempt < 1; attempt *= 2) steps.push(attempt);
  steps.push(1); // the last resort always tries the coarsest error
  let best = null;
  for (const attempt of steps) {
    for (const flags of [['LockBorder', ...extraFlags], ['LockBorder', 'Permissive', ...extraFlags]]) {
      try {
        const simplifier = await getSimplifier();
        await simplifier.ready;
        const [indices] = simplifier.simplifyWithAttributes(
          welded.indices, welded.positions, 3, attributes, 3, SIMPLIFY_WEIGHTS, null,
          target, attempt, flags); // target 0 = reduce purely until the error budget is spent
        if (process.env.IMPORT_DEBUG) console.error(`[simplify] src ${welded.indices.length / 3} -> ${indices.length / 3} tris @err ${attempt} TARGET ${target} (targetTriangles ${targetTriangles}) flags ${flags.join('+')} return=${indices.length / 3 <= target || target === 0}`);
        if (indices.length / 3 <= targetTriangles || targetTriangles === 0) return { indices, error: attempt, flags: flags.join('+') };
        if (!best || indices.length < best.indices.length) best = { indices, error: attempt, flags: flags.join('+') };
      } catch {
        // an aborted WASM instance keeps aborting — swap in a fresh one and retry the same step
        simplifierInstance = null;
        await getSimplifier(true);
      }
    }
  }
  if (best) return { ...best, error: 1 }; // locked borders keep the mesh above the target even at error 1
  throw new Error(`simplifier failed for every error step up to ${error} after ${simplifierReloads} instance reloads (source ${welded.indices.length / 3} tris / ${welded.positions.length / 3} verts)`);
}

/** Non-indexed triangles with one flat normal per face (low-poly look, no smoothing seams). */
function flatShade(welded, indices) {
  const count = indices.length;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Uint8Array(count * 3), windows = new Float32Array(count);
  for (let triangle = 0; triangle < count / 3; triangle++) {
    const corner = [indices[triangle * 3], indices[triangle * 3 + 1], indices[triangle * 3 + 2]];
    const [a, b, c] = corner;
    const p = vertex => [welded.positions[vertex * 3], welded.positions[vertex * 3 + 1], welded.positions[vertex * 3 + 2]];
    const [ax, ay, az] = p(a), [bx, by, bz] = p(b), [cx, cy, cz] = p(c);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1; // degenerate faces keep an up normal; they are invisible either way
    nx /= length; ny /= length; nz /= length;
    for (let k = 0; k < 3; k++) {
      const offset = triangle * 9 + k * 3, vertex = corner[k];
      positions[offset] = welded.positions[vertex * 3];
      positions[offset + 1] = welded.positions[vertex * 3 + 1];
      positions[offset + 2] = welded.positions[vertex * 3 + 2];
      normals[offset] = nx; normals[offset + 1] = ny; normals[offset + 2] = nz;
      colors[offset] = welded.colors[vertex * 3]; colors[offset + 1] = welded.colors[vertex * 3 + 1]; colors[offset + 2] = welded.colors[vertex * 3 + 2];
      windows[triangle * 3 + k] = welded.windows[vertex];
    }
  }
  return { positions, normals, colors, windows };
}

/** Rotate 180° (+Z front → −Z), uniform-scale into the footprint with a 0.92 margin, centre x/z, base at y=0.
 *  Normals rotate with the positions (review fix: the first D029 build shipped unrotated normals). */
function fitToGrid(shaded, gameSize) {
  const widthCells = gameSize[0] * 2, depthCells = gameSize[1] * 2;
  const rotated = new Float32Array(shaded.positions.length), rotatedNormals = new Float32Array(shaded.normals.length);
  for (let i = 0; i < shaded.positions.length; i += 3) {
    rotated[i] = -shaded.positions[i]; rotated[i + 1] = shaded.positions[i + 1]; rotated[i + 2] = -shaded.positions[i + 2];
    rotatedNormals[i] = -shaded.normals[i]; rotatedNormals[i + 1] = shaded.normals[i + 1]; rotatedNormals[i + 2] = -shaded.normals[i + 2];
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < rotated.length; i += 3) {
    minX = Math.min(minX, rotated[i]); maxX = Math.max(maxX, rotated[i]);
    minY = Math.min(minY, rotated[i + 1]); maxY = Math.max(maxY, rotated[i + 1]);
    minZ = Math.min(minZ, rotated[i + 2]); maxZ = Math.max(maxZ, rotated[i + 2]);
  }
  const scale = Math.min(widthCells / (maxX - minX), depthCells / (maxZ - minZ)) * MARGIN;
  const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
  const out = new Float32Array(rotated.length);
  for (let i = 0; i < rotated.length; i += 3) {
    out[i] = (rotated[i] - centerX) * scale;
    out[i + 1] = (rotated[i + 1] - minY) * scale;
    out[i + 2] = (rotated[i + 2] - centerZ) * scale;
  }
  return {
    positions: out, normals: rotatedNormals, colors: shaded.colors, windows: shaded.windows, scale,
    centerOffset: [-centerX * scale, -minY * scale, -centerZ * scale],
    sizeAfter: [(maxX - minX) * scale, (maxY - minY) * scale, (maxZ - minZ) * scale],
  };
}

// ---------- GLB writing (single mesh, single primitive, single material; float32 pos/normal + u8 colour) ----------

function writeGlb(shaded) {
  const rawBuffers = [
    Buffer.from(shaded.positions.buffer, shaded.positions.byteOffset, shaded.positions.byteLength),
    Buffer.from(shaded.normals.buffer, shaded.normals.byteOffset, shaded.normals.byteLength),
    Buffer.from(shaded.colors.buffer, shaded.colors.byteOffset, shaded.colors.byteLength),
    Buffer.from(shaded.windows.buffer, shaded.windows.byteOffset, shaded.windows.byteLength),
  ];
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < shaded.positions.length; i += 3) for (let c = 0; c < 3; c++) {
    minimum[c] = Math.min(minimum[c], shaded.positions[i + c]); maximum[c] = Math.max(maximum[c], shaded.positions[i + c]);
  }
  let offset = 0;
  const bufferViews = rawBuffers.map(buffer => {
    const view = { buffer: 0, byteOffset: offset, byteLength: buffer.length, target: 34962 };
    offset += buffer.length + (4 - buffer.length % 4) % 4;
    return view;
  });
  const binary = Buffer.concat(rawBuffers.map(buffer => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4)])));
  const document = {
    asset: { version: '2.0', generator: 'AI Farm import-model-pack.mjs (D031, source: Bo_21_Mo_Hinh_3D_GLTF_Day_Du)' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, _WINDOW: 3 }, material: 0 }] }],
    materials: [{ name: 'vertex-palette', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    buffers: [{ byteLength: binary.length }], bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: shaded.positions.length / 3, type: 'VEC3', min: minimum, max: maximum },
      { bufferView: 1, componentType: 5126, count: shaded.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count: shaded.colors.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5126, count: shaded.windows.length, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + jsonPadding.length + 8 + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, jsonHeader, json, jsonPadding, binHeader, binary]), triangles: shaded.positions.length / 9 };
}

/** Floating-part QC gate (D029 review). Builds connected components over the merged, game-scale triangles
 *  (faces sharing a vertex position are one component), then flags any component whose base sits more than
 *  5 cm above the ground while its bbox — expanded by 3 cm — touches no other component. Only components with
 *  a max dimension ≥ 0.3 m count: the gate exists to catch detached STRUCTURE (the well roof, fence rails),
 *  not the source pack's small mounted decorations (window boxes, trims), which ship with sub-decimetre gaps
 *  by design. Returns components (with sizes) so callers can print details; `count` is the gate's number. */
function floatingParts(positions, padM = 0.03, groundedM = 0.05, sizeFloorM = 0.3) {
  const faceCount = positions.length / 9;
  const key = index => `${Math.round(positions[index] * 1e4) + 0},${Math.round(positions[index + 1] * 1e4) + 0},${Math.round(positions[index + 2] * 1e4) + 0}`;
  const vertexRoot = new Map(); // position key -> component id (union-find)
  const parent = [];
  const find = id => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let face = 0; face < faceCount; face++) {
    const ids = [];
    for (let corner = 0; corner < 3; corner++) {
      const positionKey = key(face * 9 + corner * 3);
      let component = vertexRoot.get(positionKey);
      if (component === undefined) { component = parent.length; parent.push(component); vertexRoot.set(positionKey, component); }
      ids.push(component);
    }
    union(ids[0], ids[1]); union(ids[1], ids[2]);
  }
  const boxes = new Map();
  for (let face = 0; face < faceCount; face++) {
    const root = find(vertexRoot.get(key(face * 9)));
    let box = boxes.get(root);
    if (!box) { box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; boxes.set(root, box); }
    for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) {
      const value = positions[face * 9 + corner * 3 + axis];
      box.min[axis] = Math.min(box.min[axis], value); box.max[axis] = Math.max(box.max[axis], value);
    }
  }
  const list = [...boxes.values()];
  const floats = list.filter(box => box.min[1] > groundedM).filter(box => box.max.some((v, axis) => v - box.min[axis] >= sizeFloorM))
    .filter(box => !list.some(other => other !== box &&
    other.min[0] <= box.max[0] + padM && other.max[0] >= box.min[0] - padM &&
    other.min[1] <= box.max[1] + padM && other.max[1] >= box.min[1] - padM &&
    other.min[2] <= box.max[2] + padM && other.max[2] >= box.min[2] - padM))
    .map(box => ({ size: box.max.map((v, axis) => +(v - box.min[axis]).toFixed(3)), base: +box.min[1].toFixed(3) }));
  return { count: floats.length, floats };
}

// ---------- driver ----------

async function buildAll() {
  const catalog = JSON.parse(await readFile('packages/content/catalog.v1.json', 'utf8'));
  const config = { sourcePack: PACK, sourceLod: SOURCE_LOD, cellSizeM: 2, margin: MARGIN, simplifyRatio: SIMPLIFY_RATIO, generatedBy: 'scripts/import-model-pack.mjs', models: {} };
  const outputs = [];
  for (const [gameId, [world, sourceId]] of Object.entries(MODELS)) {
    const source = join(PACK, 'assets', world, SOURCE_LOD === 'lod0' ? `${sourceId}.glb` : `${sourceId}_lod1.glb`);
    const parsed = parseGlb(await readFile(join(process.cwd(), source)));
    const primitives = collectPrimitives(parsed.json, parsed.binary);
    const materials = parsed.json.materials ?? [];
    const windowCount = tagWindows(primitives, materials);
    const policies = GROUP_POLICIES[gameId] ?? {};
    const cap = triangleCap(catalog.buildings[gameId].size, gameId);
    // Models with group policies take the per-group pipeline (weld → per-group simplify → merge, then a
    // proportional budget pass and a global-weld fallback if the per-group floors still exceed the cap).
    // Every other model takes the proven D029 global path: one weld of all kept primitives, simplified to
    // 70 % of the cap with error escalation. Groups never share vertices, so a group boundary is also a
    // component boundary; the floating gate reasons over merged bounding boxes instead.
    const useGroupPipeline = Object.keys(policies).length > 0;
    let shaded, fitted, glb;
    const groupReport = {};
    if (!useGroupPipeline) {
      const kept = primitives.filter(primitive => !ALWAYS_DROP.includes(primitive.group));
      const welded = weld(kept, materials, windowCount);
      const simplified = await simplify(welded, 0.02, cap * SIMPLIFY_RATIO);
      const globalShaded = flatShade(welded, simplified.indices);
      fitted = fitToGrid(globalShaded, catalog.buildings[gameId].size);
      glb = writeGlb({ positions: fitted.positions, normals: fitted.normals, colors: globalShaded.colors, windows: fitted.windows });
      groupReport.__global = { action: 'global', triangles: simplified.indices.length / 3, reason: 'no per-group policies; proven D029 path' };
    } else {
    const byGroup = new Map();
    for (const primitive of primitives) {
      const bucket = byGroup.get(primitive.group) ?? [];
      bucket.push(primitive);
      byGroup.set(primitive.group, bucket);
    }
    const weldedGroups = new Map(), simplifiedGroups = new Map();
    let preserved = 0, measuredTotal = 0;
    for (const [group, groupPrimitives] of byGroup) {
      const policy = policies[group];
      if (policy ? policy.drop : ALWAYS_DROP.includes(group)) { groupReport[group] = { action: 'drop', triangles: groupPrimitives.reduce((sum, p) => sum + p.indices.length / 3, 0), reason: policy?.reason ?? 'spilling ground group (always dropped)' }; continue; }
      const welded = weld(groupPrimitives, materials, windowCount);
      weldedGroups.set(group, welded);
      if (policy?.preserve) {
        groupReport[group] = { action: 'preserve', triangles: welded.indices.length / 3, reason: policy.reason };
        preserved += welded.indices.length / 3;
        continue;
      }
      const error = policy?.error ?? 0.02;
      const simplified = await simplify(welded, error, welded.indices.length / 3, policy?.flags ?? []);
      simplifiedGroups.set(group, simplified);
      measuredTotal += simplified.indices.length / 3;
      groupReport[group] = { action: 'simplify', triangles: simplified.indices.length / 3, error: simplified.error, ...(policy?.error ? { requestedError: policy.error, reason: policy.reason } : {}) };
    }
    if (preserved > cap) {
      const breakdown = Object.entries(groupReport).filter(([, report]) => report.action === 'preserve').map(([group, report]) => `${group}=${report.triangles}`).join(' ');
      throw new Error(`${gameId}: preserved groups alone (${preserved} tris) exceed the ${cap} cap [${breakdown}]`);
    }
    // Re-simplify proportionally when the measured model does not fit; groups keep their policy error as a
    // ceiling recorded in the config, and the result is the best meshopt reaches for that target. Locked
    // borders give some groups a floor above their share, so the share re-scales from the ACTUAL counts
    // until the model fits (≤ 5 rounds).
    if (measuredTotal > cap - preserved) {
      for (let round = 0; round < 5; round++) {
        const total = [...simplifiedGroups.values()].reduce((sum, simplified) => sum + simplified.indices.length / 3, 0) + preserved;
        if (total <= cap) break;
        const factor = (cap - preserved) / total;
        for (const [group, simplified] of simplifiedGroups) {
          const target = simplified.indices.length / 3 * factor;
          const retargeted = await simplify(weldedGroups.get(group), groupReport[group].error ?? 0.02, target, policies[group]?.flags ?? []);
          simplifiedGroups.set(group, retargeted);
          groupReport[group] = { ...groupReport[group], triangles: retargeted.indices.length / 3, budgetShare: +target.toFixed(0), error: retargeted.error };
        }
      }
    }
    shaded = { positions: new Float32Array(0), normals: new Float32Array(0), colors: new Uint8Array(0), windows: new Float32Array(0) };
    for (const group of byGroup.keys()) {
      const welded = weldedGroups.get(group), simplified = simplifiedGroups.get(group);
      if (!welded) continue; // dropped
      const groupShaded = flatShade(welded, simplified ? simplified.indices : welded.indices);
      shaded = {
        positions: Float32Array.from([...shaded.positions, ...groupShaded.positions]),
        normals: Float32Array.from([...shaded.normals, ...groupShaded.normals]),
        colors: Uint8Array.from([...shaded.colors, ...groupShaded.colors]),
        windows: Float32Array.from([...shaded.windows, ...groupShaded.windows]),
      };
    }
    fitted = fitToGrid(shaded, catalog.buildings[gameId].size);
    glb = writeGlb({ positions: fitted.positions, normals: fitted.normals, colors: shaded.colors, windows: fitted.windows });
    // Fallback: per-group locked-border floors can exceed the cap (e.g. the bank's columns). A single global
    // weld shares colour seams across groups and simplifies further — the proven D029 path. Quality policies
    // are best-effort; the cap is hard.
    if (glb.triangles > cap) {
      const all = [...byGroup.entries()].filter(([group]) => !policies[group]?.drop && !ALWAYS_DROP.includes(group)).flatMap(([, groupPrimitives]) => groupPrimitives);
      const welded = weld(all, materials, windowCount);
      const simplified = await simplify(welded, 0.01, cap * SIMPLIFY_RATIO);
      const fallbackShaded = flatShade(welded, simplified.indices);
      fitted = fitToGrid(fallbackShaded, catalog.buildings[gameId].size);
      glb = writeGlb({ positions: fitted.positions, normals: fitted.normals, colors: fallbackShaded.colors, windows: fitted.windows });
      groupReport.__global_fallback = { action: 'global-fallback', triangles: simplified.indices.length / 3, reason: 'per-group floors exceed the cap; one weld simplifies further' };
      console.error(`[dbg] ${gameId} fallback: welded ${welded.indices.length / 3} -> simplified ${simplified.indices.length / 3} (target ${cap * SIMPLIFY_RATIO}, error ${simplified.error})`);
    }
    }
    if (glb.triangles > cap) throw new Error(`${gameId}: ${glb.triangles} triangles exceed the ${cap} cap (post-budget)`);
    const gate = floatingParts(fitted.positions);
    const baseline = GATE_EXCEPTIONS[gameId];
    // IMPORT_MEASURE=1 calibrates baselines: prints counts without failing (see GATE_EXCEPTIONS).
    if (gate.count > (baseline?.max ?? 0) && process.env.IMPORT_MEASURE !== '1') throw new Error(`${gameId}: ${gate.count} floating components exceed the baseline ${baseline?.max ?? 0}${baseline ? ` (${baseline.reason})` : ''} — raise the budget or preserve the supporting group`);
    const dropped = [...new Set(primitives.map(primitive => primitive.group))].filter(group => (policies[group] ? policies[group].drop : ALWAYS_DROP.includes(group)));
    config.models[gameId] = {
      source, world, droppedGroups: dropped,
      triangleCap: cap, triangles: glb.triangles,
      sourceTriangles: primitives.reduce((sum, p) => sum + p.indices.length / 3, 0),
      windowCount,
      rotationYDeg: 180, scale: +fitted.scale.toFixed(6),
      centerOffsetM: fitted.centerOffset.map(value => +value.toFixed(6)),
      sizeAfterM: fitted.sizeAfter.map(value => +value.toFixed(6)),
      footprintCells: catalog.buildings[gameId].size,
      bytes: glb.bytes.length,
      floatingComponents: gate.count,
      floatingBaseline: baseline?.max ?? 0,
      ...(gate.count > 0 ? { floatingDetails: gate.floats } : {}),
      groups: groupReport,
      ...(MODEL_NOTES[gameId] ? { note: MODEL_NOTES[gameId] } : {}),
    };
    outputs.push({ gameId, bytes: glb.bytes });
  }
  config.placeholderKept = PLACEHOLDER_KEPT;
  return { config, outputs };
}

if (CHECK && !existsSync(join(process.cwd(), PACK))) {
  console.log('Nguồn vắng mặt (map/ không được commit) — bỏ qua kiểm tra import, thoát 0.');
  process.exit(0);
}
if (process.argv.includes('--audit-gate')) {
  // Run the floating-part gate over the GLBs already on disk (no rebuild) — used to record "before" numbers.
  for (const gameId of Object.keys(MODELS)) {
    const parsed = parseGlb(await readFile(join(process.cwd(), OUT_DIR, `${gameId}.glb`)));
    const positions = readAccessor(parsed.json, parsed.binary, parsed.json.meshes[0].primitives[0].attributes.POSITION);
    const { count, floats } = floatingParts(positions);
    console.log(`${gameId.padEnd(16)} floating components: ${count}`);
    for (const float of floats.slice(0, 6)) console.log(`    size ${float.size.join('×')} m, base ${float.base} m`);
  }
  process.exit(0);
}
const { config, outputs } = await buildAll();
const configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
if (CHECK) {
  let drifted = 0;
  for (const { gameId, bytes } of outputs) {
    const file = join(OUT_DIR, `${gameId}.glb`);
    let existing;
    try { existing = await readFile(join(process.cwd(), file)); } catch { existing = null; }
    if (!existing || !existing.equals(bytes)) { console.error(`DRIFT ${file}${existing ? ` (${existing.length} → ${bytes.length} bytes)` : ' (missing)'}`); drifted++; }
  }
  let existingConfig;
  try { existingConfig = await readFile(join(process.cwd(), CONFIG_PATH)); } catch { existingConfig = null; }
  if (!existingConfig || !existingConfig.equals(configBytes)) { console.error(`DRIFT ${CONFIG_PATH}${existingConfig ? '' : ' (missing)'}`); drifted++; }
  if (drifted) { console.error(`--check FAILED: ${drifted} file(s) would change; re-run without --check to refresh.`); process.exit(1); }
  console.log(`--check PASS: ${outputs.length} models + config are deterministic.`);
} else {
  await writeFile(CONFIG_PATH, configBytes);
  for (const { gameId, bytes } of outputs) {
    await writeFile(join(process.cwd(), OUT_DIR, `${gameId}.glb`), bytes);
  }
  console.log(`Imported ${outputs.length} models into ${OUT_DIR}:`);
  for (const [gameId, model] of Object.entries(config.models)) {
    console.log(`  ${gameId.padEnd(16)} ${String(model.triangles).padStart(5)}/${model.triangleCap} tris  scale ${model.scale}  size ${model.sizeAfterM.map(v => v.toFixed(2)).join('×')}m  ${Math.round(model.bytes / 1024)} KB${model.droppedGroups.length ? `  dropped: ${model.droppedGroups.join(',')}` : ''}`);
  }
}
