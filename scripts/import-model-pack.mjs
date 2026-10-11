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
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

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
  well: ['rural', 'rural_well'],
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
// Colour weights 0.5 keep colour regions apart where the budget allows; the error escalates to 1 so thin-feature
// models (well, silo-class) still fit their caps — QC by eye decides if a model keeps its import or reverts.
const TRIANGLE_CAP = { 1: 800, 2: 1800, 3: 2500, 4: 3500 };
const SIMPLIFY_RATIO = 0.7;
const SIMPLIFY_ERROR_MAX = 1;
const SIMPLIFY_COLOR_WEIGHT = 0.5;
const SIMPLIFY_ERROR_STEPS = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1].filter(error => error <= SIMPLIFY_ERROR_MAX);
const SIMPLIFY_WEIGHTS = [SIMPLIFY_COLOR_WEIGHT, SIMPLIFY_COLOR_WEIGHT, SIMPLIFY_COLOR_WEIGHT];

function triangleCap(gameSize, id) {
  if (id === 'office_tower') return 4500; // tallest structure: extra detail budget
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

/** Weld by position+colour: colour seams stay duplicated, so the simplifier never smears across them. */
function weld(primitives, materials) {
  const map = new Map(), positions = [], colors = [], indices = [];
  for (const primitive of primitives) {
    const color = materialColor(materials, primitive.material).bytes;
    for (const index of primitive.indices) {
      const x = primitive.positions[index * 3], y = primitive.positions[index * 3 + 1], z = primitive.positions[index * 3 + 2];
      const key = `${Math.round(x * 1e4) + 0},${Math.round(y * 1e4) + 0},${Math.round(z * 1e4) + 0},${color[0]},${color[1]},${color[2]}`;
      let vertex = map.get(key);
      if (vertex === undefined) {
        vertex = positions.length / 3;
        map.set(key, vertex);
        positions.push(x, y, z); colors.push(color[0], color[1], color[2]);
      }
      indices.push(vertex);
    }
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), indices: new Uint32Array(indices) };
}

async function simplify(mesh, targetTriangles) {
  await MeshoptSimplifier.ready;
  if (mesh.indices.length / 3 <= targetTriangles) return { indices: mesh.indices, error: 0, skipped: true };
  const attributes = new Float32Array(mesh.colors.length);
  for (let i = 0; i < mesh.colors.length; i++) attributes[i] = mesh.colors[i] / 255;
  // The pack contains coincident double-walled geometry (edges shared by 4+ faces); deep collapses can trip the
  // simplifier's topology assert — escalate the error and relax topology checks until the result fits.
  let best = null;
  for (const error of SIMPLIFY_ERROR_STEPS) {
    for (const flags of [['LockBorder'], ['LockBorder', 'Permissive']]) {
      try {
        const [indices] = MeshoptSimplifier.simplifyWithAttributes(
          mesh.indices, mesh.positions, 3, attributes, 3, SIMPLIFY_WEIGHTS, null,
          targetTriangles * 3, error, flags);
        if (!best || indices.length < best.indices.length) best = { indices, error, flags: flags.join('+') };
        if (indices.length / 3 <= targetTriangles) return { ...best, skipped: false };
      } catch { /* topology assert at this error level — escalate */ }
    }
  }
  if (best) return { ...best, skipped: false };
  throw new Error(`simplifier failed for every error step (source ${mesh.indices.length / 3} tris / ${mesh.positions.length / 3} verts)`);
}

/** Non-indexed triangles with one flat normal per face (low-poly look, no smoothing seams). */
function flatShade(welded, indices) {
  const count = indices.length;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Uint8Array(count * 3);
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
    }
  }
  return { positions, normals, colors };
}

/** Rotate 180° (+Z front → −Z), uniform-scale into the footprint with a 0.92 margin, centre x/z, base at y=0. */
function fitToGrid(shaded, gameSize) {
  const widthCells = gameSize[0] * 2, depthCells = gameSize[1] * 2;
  const rotated = new Float32Array(shaded.positions.length);
  for (let i = 0; i < shaded.positions.length; i += 3) {
    rotated[i] = -shaded.positions[i]; rotated[i + 1] = shaded.positions[i + 1]; rotated[i + 2] = -shaded.positions[i + 2];
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
    positions: out, scale,
    centerOffset: [-centerX * scale, -minY * scale, -centerZ * scale],
    sizeAfter: [(maxX - minX) * scale, (maxY - minY) * scale, (maxZ - minZ) * scale],
  };
}

// ---------- GLB writing (single mesh, single primitive, single material; float32 pos/normal + u8 colour) ----------

function writeGlb(shaded) {
  const buffers = [
    Buffer.from(shaded.positions.buffer, shaded.positions.byteOffset, shaded.positions.byteLength),
    Buffer.from(shaded.normals.buffer, shaded.normals.byteOffset, shaded.normals.byteLength),
    Buffer.from(shaded.colors.buffer, shaded.colors.byteOffset, shaded.colors.byteLength),
  ];
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < shaded.positions.length; i += 3) for (let c = 0; c < 3; c++) {
    minimum[c] = Math.min(minimum[c], shaded.positions[i + c]); maximum[c] = Math.max(maximum[c], shaded.positions[i + c]);
  }
  let offset = 0;
  const document = {
    asset: { version: '2.0', generator: 'AI Farm import-model-pack.mjs (D029, source: Bo_21_Mo_Hinh_3D_GLTF_Day_Du)' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, material: 0 }] }],
    materials: [{ name: 'vertex-palette', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    buffers: [{ byteLength: buffers.reduce((sum, buffer) => sum + buffer.length, 0) }],
    bufferViews: buffers.map(buffer => { const view = { buffer: 0, byteOffset: offset, byteLength: buffer.length, target: 34962 }; offset += buffer.length; return view; }),
    accessors: [
      { bufferView: 0, componentType: 5126, count: shaded.positions.length / 3, type: 'VEC3', min: minimum, max: maximum },
      { bufferView: 1, componentType: 5126, count: shaded.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count: shaded.colors.length / 3, type: 'VEC3' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32), binary = Buffer.concat(buffers);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + jsonPadding.length + 8 + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, jsonHeader, json, jsonPadding, binHeader, binary]), triangles: shaded.positions.length / 9 };
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
    const groups = [...new Set(primitives.map(primitive => primitive.group))];
    const dropped = groups.filter(group => ALWAYS_DROP.includes(group));
    const kept = primitives.filter(primitive => !ALWAYS_DROP.includes(primitive.group));
    const welded = weld(kept, parsed.json.materials ?? []);
    const cap = triangleCap(catalog.buildings[gameId].size, gameId);
    const simplified = await simplify(welded, Math.round(cap * SIMPLIFY_RATIO));
    const shaded = flatShade(welded, simplified.indices);
    const fitted = fitToGrid(shaded, catalog.buildings[gameId].size);
    const glb = writeGlb({ positions: fitted.positions, normals: shaded.normals, colors: shaded.colors });
    if (glb.triangles > cap) throw new Error(`${gameId}: ${glb.triangles} triangles exceed the ${cap} cap`);
    config.models[gameId] = {
      source, world, droppedGroups: dropped,
      triangleCap: cap, triangles: glb.triangles,
      sourceTriangles: welded.indices.length / 3,
      simplifyError: simplified.error, simplifySkipped: simplified.skipped,
      rotationYDeg: 180, scale: +fitted.scale.toFixed(6),
      centerOffsetM: fitted.centerOffset.map(value => +value.toFixed(6)),
      sizeAfterM: fitted.sizeAfter.map(value => +value.toFixed(6)),
      footprintCells: catalog.buildings[gameId].size,
      bytes: glb.bytes.length,
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
