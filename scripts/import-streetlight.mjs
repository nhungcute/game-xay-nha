// D035: import the Street Light model (map/street_light.glb, CC-BY-4.0 by dodotcreatives)
// into a game-ready authored GLB for the BuildingRenderer.
// Single mesh, single primitive, single material: flat normals, per-vertex linear colors (COLOR_0),
// custom vertex attribute _LAMP (float: 1.0 for bulb, 0.0 elsewhere),
// height 4.5 m, pivot at bottom-center of the column (y=0, centered on grid cell).
// Deterministic: produces byte-identical output across runs.
// When map/street_light.glb is absent, `--check` skips with exit 0 so clean CI passes.
//
// Usage: node scripts/import-streetlight.mjs            # (re)generate model + streetlight.config.json
//        node scripts/import-streetlight.mjs --check    # byte-compare outputs, exit 1 on drift

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const SOURCE_PATH = 'map/street_light.glb';
const OUT_FILE = 'apps/web/public/assets/models/authored/deco_streetlight.glb';
const CONFIG_PATH = 'scripts/streetlight.config.json';
const CHECK = process.argv.includes('--check');

const CREDITS = {
  name: 'Street_Light',
  author: 'dodotcreatives',
  license: 'CC-BY-4.0',
  url: 'https://sketchfab.com/3d-models/street-light-16fc20d9d6564adb84ea27e35778da06',
  modified: true,
};

const TARGET_HEIGHT = 4.5;
const CELL_SIZE_M = 2;
const MARGIN = 0.92;
const MAX_XZ_SPAN = CELL_SIZE_M * MARGIN; // 1.84 m
const TRIANGLE_CAP = 800;
const MIN_COLUMN_DIAMETER = 0.18;
const TARGET_COLUMN_DIAMETER = 0.185;

// sRGB hex to linear bytes [0..255]
const srgbToLinear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function hexToLinearBytes(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return new Uint8Array([
    Math.round(srgbToLinear(r) * 255),
    Math.round(srgbToLinear(g) * 255),
    Math.round(srgbToLinear(b) * 255),
  ]);
}

const COLOR_GOD = hexToLinearBytes('#c8962e');       // antique gold / bronze
const COLOR_GREY = hexToLinearBytes('#2b3038');      // charcoal grey (lighter than pitch black)
const COLOR_BULB = hexToLinearBytes('#fff3d6');      // warm white, opaque
const COLOR_ELEPHANT = hexToLinearBytes('#fcecc5');  // ivory cream average

// glTF reading
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

function composeTrs(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z] = t, [qx, qy, qz, qw] = r, [sx, sy, sz] = s;
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
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
  }
  return out;
}

function collectPrimitives(json, binary) {
  const primitives = [];
  const visit = (node, matrix) => {
    const world = multiply(matrix, node.matrix ? [...node.matrix] : composeTrs(node.translation, node.rotation, node.scale));
    if (node.mesh !== undefined) {
      const mesh = json.meshes[node.mesh];
      for (const primitive of mesh.primitives) {
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
        primitives.push({
          nodeName: node.name ?? '',
          meshName: mesh.name ?? '',
          positions: baked,
          indices,
          material: primitive.material ?? 0,
        });
      }
    }
    for (const child of node.children ?? []) visit(json.nodes[child], world);
  };
  for (const sceneNode of json.scenes[json.scene ?? 0]?.nodes ?? []) visit(json.nodes[sceneNode], composeTrs());
  return primitives;
}

function assignColor(json, prim) {
  const node = prim.nodeName;
  const matName = json.materials?.[prim.material]?.name ?? '';
  if (matName === 'Bulb' || node.includes('Bulb')) return { bytes: COLOR_BULB, isBulb: true, name: 'Bulb' };
  if (matName === 'Elephant' || node.includes('Elephant')) return { bytes: COLOR_ELEPHANT, isBulb: false, name: 'Elephant' };
  if (matName === 'material' || node.includes('God')) return { bytes: COLOR_GOD, isBulb: false, name: 'God' };
  return { bytes: COLOR_GREY, isBulb: false, name: 'Grey' };
}

function floatingParts(positions, padM = 0.03, groundedM = 0.05, sizeFloorM = 0.3) {
  const faceCount = positions.length / 9;
  const key = index => `${Math.round(positions[index] * 1e4) + 0},${Math.round(positions[index + 1] * 1e4) + 0},${Math.round(positions[index + 2] * 1e4) + 0}`;
  const vertexRoot = new Map();
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
  return { count: floats.length, floats, totalComponents: list.length };
}

function writeGlb(pos, norm, col, lmp) {
  const rawBuffers = [
    Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength),
    Buffer.from(norm.buffer, norm.byteOffset, norm.byteLength),
    Buffer.from(col.buffer, col.byteOffset, col.byteLength),
    Buffer.from(lmp.buffer, lmp.byteOffset, lmp.byteLength),
  ];
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) {
    minimum[c] = Math.min(minimum[c], pos[i + c]); maximum[c] = Math.max(maximum[c], pos[i + c]);
  }
  let offset = 0;
  const bufferViews = rawBuffers.map(buffer => {
    const view = { buffer: 0, byteOffset: offset, byteLength: buffer.length, target: 34962 };
    offset += buffer.length + (4 - buffer.length % 4) % 4;
    return view;
  });
  const binary = Buffer.concat(rawBuffers.map(buffer => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4)])));
  const document = {
    asset: { version: '2.0', generator: 'AI Farm import-streetlight.mjs (D035, source: street_light.glb)' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, _LAMP: 3 }, material: 0 }] }],
    materials: [{ name: 'vertex-palette', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 } }],
    buffers: [{ byteLength: binary.length }], bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: minimum, max: maximum },
      { bufferView: 1, componentType: 5126, count: norm.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count: col.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5126, count: lmp.length, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + jsonPadding.length + 8 + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, jsonPadding, binHeader, binary]);
}

export async function buildStreetlight() {
  await MeshoptSimplifier.ready;

  const buffer = await readFile(join(process.cwd(), SOURCE_PATH));
  const { json, binary } = parseGlb(buffer);
  const primitives = collectPrimitives(json, binary);

  // 1. Determine pole axis (pCylinder1 center) and base Y
  let cyl1MinX = Infinity, cyl1MaxX = -Infinity, cyl1MinZ = Infinity, cyl1MaxZ = -Infinity;
  let rawMinY = Infinity, rawMaxY = -Infinity;

  for (const p of primitives) {
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i], y = p.positions[i + 1], z = p.positions[i + 2];
      rawMinY = Math.min(rawMinY, y); rawMaxY = Math.max(rawMaxY, y);
      if (p.nodeName.includes('pCylinder1')) {
        cyl1MinX = Math.min(cyl1MinX, x); cyl1MaxX = Math.max(cyl1MaxX, x);
        cyl1MinZ = Math.min(cyl1MinZ, z); cyl1MaxZ = Math.max(cyl1MaxZ, z);
      }
    }
  }

  const poleX = (cyl1MinX + cyl1MaxX) / 2;
  const poleZ = (cyl1MinZ + cyl1MaxZ) / 2;
  const rawHeight = rawMaxY - rawMinY;
  const scale = TARGET_HEIGHT / rawHeight;

  // 2. Column thickening factor (diameter >= 0.18 m)
  const rawPoleDiameter = cyl1MaxX - cyl1MinX;
  const scaledDiameterBefore = rawPoleDiameter * scale;
  const thickRatio = TARGET_COLUMN_DIAMETER / scaledDiameterBefore;
  const actualDiameter = scaledDiameterBefore * thickRatio;

  // 3. Transform vertices:
  // - center column at (0, 0)
  // - align bottom at y = 0
  // - scale uniformly to 4.5m
  // - thicken column parts XZ around the column center
  for (const p of primitives) {
    const isColumn = p.nodeName.includes('pCylinder1') || p.nodeName.includes('pCube13') || p.nodeName.includes('pCube7') || p.nodeName.includes('pCube11');
    for (let i = 0; i < p.positions.length; i += 3) {
      let x = (p.positions[i] - poleX) * scale;
      let y = (p.positions[i + 1] - rawMinY) * scale;
      let z = (p.positions[i + 2] - poleZ) * scale;

      if (isColumn) {
        x *= thickRatio;
        z *= thickRatio;
      }

      p.positions[i] = x;
      p.positions[i + 1] = y;
      p.positions[i + 2] = z;
    }
  }

  // 4. Per-primitive simplification with Meshopt
  const simplifiedParts = [];
  for (const p of primitives) {
    const { bytes: color, isBulb } = assignColor(json, p);
    const pMap = new Map();
    const pPos = [], pInd = [];
    for (const idx of p.indices) {
      const x = p.positions[idx * 3], y = p.positions[idx * 3 + 1], z = p.positions[idx * 3 + 2];
      const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
      let vIdx = pMap.get(key);
      if (vIdx === undefined) {
        vIdx = pPos.length / 3;
        pMap.set(key, vIdx);
        pPos.push(x, y, z);
      }
      pInd.push(vIdx);
    }
    const posArr = new Float32Array(pPos);
    const indArr = new Uint32Array(pInd);

    let targetTris = 20;
    if (isBulb) targetTris = 28;
    else if (p.nodeName.includes('polySurface35') || p.nodeName.includes('polySurface41')) targetTris = 40; // shades
    else if (p.nodeName.includes('pCylinder2') || p.nodeName.includes('pCylinder3')) targetTris = 52; // curved arms
    else if (p.nodeName.includes('pCylinder1')) targetTris = 32; // column shaft
    else if (p.nodeName.includes('Elephant')) targetTris = 16;
    else if (p.nodeName.includes('polySurface2')) targetTris = 30; // top finial

    let simplifiedInd;
    try {
      const [res] = MeshoptSimplifier.simplify(indArr, posArr, 3, targetTris * 3, 0.25, ['Permissive']);
      simplifiedInd = res;
    } catch {
      simplifiedInd = indArr;
    }
    simplifiedParts.push({ pos: posArr, ind: simplifiedInd, color, isBulb, nodeName: p.nodeName });
  }

  // 5. Flat normals & merging into single triangle stream
  const allPositions = [];
  const allNormals = [];
  const allColors = [];
  const allLamps = [];

  for (const part of simplifiedParts) {
    const { pos, ind, color, isBulb } = part;
    const lampVal = isBulb ? 1.0 : 0.0;
    for (let t = 0; t < ind.length / 3; t++) {
      const i0 = ind[t * 3], i1 = ind[t * 3 + 1], i2 = ind[t * 3 + 2];
      const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
      const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
      const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];

      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
        allPositions.push(x, y, z);
        allNormals.push(nx, ny, nz);
        allColors.push(color[0], color[1], color[2]);
        allLamps.push(lampVal);
      }
    }
  }

  // Align ground floor exactly at y=0
  let finalMinY = Infinity;
  for (let i = 1; i < allPositions.length; i += 3) finalMinY = Math.min(finalMinY, allPositions[i]);
  if (Math.abs(finalMinY) > 1e-6) {
    for (let i = 1; i < allPositions.length; i += 3) allPositions[i] -= finalMinY;
  }

  const finalPositions = new Float32Array(allPositions);
  const finalNormals = new Float32Array(allNormals);
  const finalColors = new Uint8Array(allColors);
  const finalLamps = new Float32Array(allLamps);
  const triangles = finalPositions.length / 9;

  if (triangles > TRIANGLE_CAP) throw new Error(`deco_streetlight: ${triangles} triangles exceed cap ${TRIANGLE_CAP}`);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < finalPositions.length; i += 3) {
    minX = Math.min(minX, finalPositions[i]); maxX = Math.max(maxX, finalPositions[i]);
    minY = Math.min(minY, finalPositions[i + 1]); maxY = Math.max(maxY, finalPositions[i + 1]);
    minZ = Math.min(minZ, finalPositions[i + 2]); maxZ = Math.max(maxZ, finalPositions[i + 2]);
  }

  const spanX = maxX - minX, spanZ = maxZ - minZ;
  if (spanX > MAX_XZ_SPAN || spanZ > MAX_XZ_SPAN) {
    throw new Error(`deco_streetlight XZ bounds (${spanX.toFixed(2)}×${spanZ.toFixed(2)}m) exceed footprint margin ${MAX_XZ_SPAN}m`);
  }

  const lampVertices = finalLamps.filter(v => v > 0).length;
  if (lampVertices === 0) throw new Error('deco_streetlight: produced zero _LAMP vertices');

  const gate = floatingParts(finalPositions);
  if (gate.count > 0) throw new Error(`deco_streetlight: ${gate.count} floating components detected`);

  const glbBytes = writeGlb(finalPositions, finalNormals, finalColors, finalLamps);

  const config = {
    id: 'deco_streetlight',
    source: SOURCE_PATH,
    credits: CREDITS,
    scale: +scale.toFixed(6),
    rawHeightM: +rawHeight.toFixed(4),
    targetHeightM: TARGET_HEIGHT,
    columnDiameterM: +actualDiameter.toFixed(4),
    triangles,
    triangleCap: TRIANGLE_CAP,
    lampVertices,
    bounds: {
      min: [+minX.toFixed(4), +minY.toFixed(4), +minZ.toFixed(4)],
      max: [+maxX.toFixed(4), +maxY.toFixed(4), +maxZ.toFixed(4)],
      span: [+spanX.toFixed(4), +(maxY - minY).toFixed(4), +spanZ.toFixed(4)],
    },
    bytes: glbBytes.length,
    floatingComponents: gate.count,
  };

  return { glbBytes, config };
}

if (CHECK && !existsSync(join(process.cwd(), SOURCE_PATH))) {
  console.log('Streetlight source is absent (map/street_light.glb is not committed); skipping D035 import check.');
  process.exit(0);
}

const { glbBytes, config } = await buildStreetlight();
const configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);

if (CHECK) {
  let drifted = false;
  let existingGlb;
  try { existingGlb = await readFile(join(process.cwd(), OUT_FILE)); } catch { existingGlb = null; }
  if (!existingGlb || !existingGlb.equals(glbBytes)) {
    console.error(`DRIFT ${OUT_FILE}${existingGlb ? ` (${existingGlb.length} → ${glbBytes.length} bytes)` : ' (missing)'}`);
    drifted = true;
  }
  let existingConfig;
  try { existingConfig = await readFile(join(process.cwd(), CONFIG_PATH)); } catch { existingConfig = null; }
  if (!existingConfig || !existingConfig.equals(configBytes)) {
    console.error(`DRIFT ${CONFIG_PATH}${existingConfig ? '' : ' (missing)'}`);
    drifted = true;
  }
  if (drifted) {
    console.error('--check FAILED: streetlight outputs drifted; rerun without --check to refresh.');
    process.exit(1);
  }
  console.log(`--check PASS: deco_streetlight.glb (${config.triangles} tris, ${(config.bytes / 1024).toFixed(1)} KB) matches config.`);
} else {
  await writeFile(join(process.cwd(), OUT_FILE), glbBytes);
  await writeFile(join(process.cwd(), CONFIG_PATH), configBytes);
  console.log(`Imported deco_streetlight into ${OUT_FILE}:`);
  console.log(`  Triangles: ${config.triangles}/${config.triangleCap}`);
  console.log(`  Column diameter: ${config.columnDiameterM} m (>= ${MIN_COLUMN_DIAMETER} m)`);
  console.log(`  Lamp vertices: ${config.lampVertices}`);
  console.log(`  Bounds: ${config.bounds.span.map(v => v.toFixed(2)).join('×')} m`);
  console.log(`  File size: ${(config.bytes / 1024).toFixed(1)} KB`);
}
