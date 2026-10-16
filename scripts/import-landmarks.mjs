// D037: Import 4 iconic landmarks from map/nha2 into game-ready authored GLBs.
// Outputs: apps/web/public/assets/models/authored/landmark_*.glb
// Each GLB has 1 mesh, 1 primitive, 1 MeshStandardMaterial, 1 baseColor texture (JPEG <= 1024x1024),
// with vertex attributes: POSITION, NORMAL, TEXCOORD_0, and indices (no COLOR_0, no unlit, no blend).
// Deterministic: byte-identical output across runs.
// When map/nha2 is absent, skips cleanly with exit 0.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';
import jpeg from 'jpeg-js';
import { bakeAtlas, dropDownFacing, weldPositions } from './lib/atlas-bake.mjs';

const CHECK = process.argv.includes('--check');
// Dev aid: --only=<id> processes one landmark and never touches the shared config (so --check ignores it too).
const ONLY = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const OUT_DIR = 'apps/web/public/assets/models/authored';
const CONFIG_PATH = 'scripts/landmarks.config.json';
const SOURCE_DIR = 'map/nha2';

const CELL_SIZE_M = 2;
const MARGIN = 0.92;

const MODELS = [
  {
    id: 'landmark_palace',
    sourceFile: 'map/nha2/st_jamess_palace.glb',
    title: "St James's Palace",
    author: 'QuintusHortensiusHortalus',
    license: 'CC-BY-4.0',
    url: 'https://sketchfab.com/3d-models/st-jamess-palace-9ebcaaca6ba8451eabd6344230272c0f',
    footprint: [5, 5],
    triangleCap: 6000,
    rotationY: Math.PI, // Clock tower / gatehouse faces -Z
    textureSize: 1024,
    cutBase: false,
    flattenY0: false,
  },
  {
    id: 'landmark_castle',
    sourceFile: 'map/nha2/monserrate_palace_-_scale_model_scaniverse.glb',
    title: 'Monserrate Palace - Scale Model (Scaniverse)',
    author: 'JFN',
    license: 'CC-BY-4.0',
    url: 'https://sketchfab.com/3d-models/monserrate-palace-scale-model-scaniverse-e9d5212d88a34cf98912ed59df136888',
    footprint: [8, 4],
    triangleCap: 8000,
    rotationY: Math.PI, // Main entrance facade faces -Z
    textureSize: 1024,
    cutBase: true, // Cut orange wooden base plate at y < 0.044
    cutY: 0.044,
    flattenY0: false,
  },
  {
    id: 'landmark_culture',
    sourceFile: 'map/nha3/east_kowloon_cultural_centre_b401812058301063a0.glb',
    title: 'East Kowloon Cultural Centre',
    author: 'patrick.young',
    license: 'CC-BY-4.0',
    url: 'https://sketchfab.com/3d-models/east-kowloon-cultural-centre-b401812058301063a0-58d32ac488c04597a7058b011f4d7cd8',
    footprint: [7, 6],
    triangleCap: 6000,
    rotationY: 0,
    textureSize: 1024,
    cutBase: false,
    flattenY0: false,
  },
  {
    id: 'landmark_rome',
    sourceFile: 'map/nha3/rome_river_side.glb',
    title: 'Rome River Side',
    author: 'Shahriar Shahrabi',
    license: 'CC-BY-4.0',
    url: 'https://sketchfab.com/3d-models/rome-river-side-8521d86dcd9043eba0b518ccab430d0f',
    footprint: [10, 9],
    triangleCap: 11000,
    maxBytes: 1024 * 1024, // a whole quarter: bigger than the 700 KB single-building budget
    rotationY: Math.PI, // Temple facade and its stairs face +Z in the source; the quay edge ends up at -Z
    textureSize: 1024,
    cutBase: false,
    flattenY0: false,
    skipMaterials: [0, 2], // "Fire" (alpha-blended flames) and "Attachments" (tiny figures on their own 1024 texture)
    bake: true, // re-bake the atlas onto a position-simplified proxy (see scripts/lib/atlas-bake.mjs)
    cutSrcZ: 0.269, // Source-space Z of the north quay edge: everything south of it (canal water, bridge, boats, far bank) is clipped away
  },
];

// Helper to pad buffer to 4-byte alignment
function pad4(bytes, fill = 0) {
  const rem = bytes.length % 4;
  if (rem === 0) return bytes;
  return Buffer.concat([bytes, Buffer.alloc(4 - rem, fill)]);
}

function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  if (bytes.readUInt32LE(4) !== 2) throw new Error('Only glTF 2.0 GLBs are supported');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error('GLB has no BIN chunk');
  const binLength = bytes.readUInt32LE(binHeader);
  return { json, binary: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

const COMPONENT_BYTES = { 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(json, binary, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor || accessor.sparse) throw new Error(`Unsupported accessor ${accessorIndex}`);
  const view = json.bufferViews?.[accessor.bufferView];
  const bytes = COMPONENT_BYTES[accessor.componentType], count = COMPONENT_COUNT[accessor.type];
  if (!view || !bytes || !count) throw new Error(`Invalid accessor ${accessorIndex}`);
  const stride = view.byteStride ?? bytes * count;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(accessor.count * count);
  const read = accessor.componentType === 5126 ? (at => binary.readFloatLE(at))
    : accessor.componentType === 5125 ? (at => binary.readUInt32LE(at))
      : accessor.componentType === 5123 ? (at => binary.readUInt16LE(at))
        : accessor.componentType === 5122 ? (at => binary.readInt16LE(at))
          : (at => binary.readUInt8(at));
  for (let vertex = 0; vertex < accessor.count; vertex++) {
    for (let component = 0; component < count; component++) {
      out[vertex * count + component] = read(start + vertex * stride + component * bytes);
    }
  }
  return out;
}

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1]
      + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
  }
  return out;
}

function composeTrs(translation = [], rotation = [], scale = []) {
  const [x = 0, y = 0, z = 0] = translation;
  const [qx = 0, qy = 0, qz = 0, qw = 1] = rotation;
  const [sx = 1, sy = 1, sz = 1] = scale;
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

function nodeMatrix(node) {
  return node.matrix ? [...node.matrix] : composeTrs(node.translation, node.rotation, node.scale);
}

function normalMatrix(matrix) {
  const a00 = matrix[0], a01 = matrix[4], a02 = matrix[8];
  const a10 = matrix[1], a11 = matrix[5], a12 = matrix[9];
  const a20 = matrix[2], a21 = matrix[6], a22 = matrix[10];
  const determinant = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(determinant) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inv00 = (a11 * a22 - a12 * a21) / determinant;
  const inv01 = (a02 * a21 - a01 * a22) / determinant;
  const inv02 = (a01 * a12 - a02 * a11) / determinant;
  const inv10 = (a12 * a20 - a10 * a22) / determinant;
  const inv11 = (a00 * a22 - a02 * a20) / determinant;
  const inv12 = (a02 * a10 - a00 * a12) / determinant;
  const inv20 = (a10 * a21 - a11 * a20) / determinant;
  const inv21 = (a01 * a20 - a00 * a21) / determinant;
  const inv22 = (a00 * a11 - a01 * a10) / determinant;
  return [inv00, inv01, inv02, inv10, inv11, inv12, inv20, inv21, inv22];
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG');
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, transparency = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`Unsupported PNG (depth ${bitDepth}, interlace ${interlace})`);
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels || (colorType === 3 && !palette)) throw new Error(`Unsupported PNG color type ${colorType}`);
  const packed = inflateSync(Buffer.concat(idat)), stride = width * channels, raw = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)], row = y * stride, previous = y ? (y - 1) * stride : 0;
    for (let x = 0; x < stride; x++) {
      const value = packed[y * (stride + 1) + x + 1], left = x >= channels ? raw[row + x - channels] : 0;
      const up = y ? raw[previous + x] : 0, upperLeft = y && x >= channels ? raw[previous + x - channels] : 0;
      raw[row + x] = (value + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, upperLeft))) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let source = 0, target = 0; source < raw.length; source += channels, target += 4) {
    if (colorType === 0) rgba[target] = rgba[target + 1] = rgba[target + 2] = raw[source];
    else if (colorType === 2) { rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1]; rgba[target + 2] = raw[source + 2]; }
    else if (colorType === 3) { const color = raw[source]; rgba[target] = palette[color * 3]; rgba[target + 1] = palette[color * 3 + 1]; rgba[target + 2] = palette[color * 3 + 2]; rgba[target + 3] = transparency?.[color] ?? 255; continue; }
    else if (colorType === 4) { rgba[target] = rgba[target + 1] = rgba[target + 2] = raw[source]; rgba[target + 3] = raw[source + 1]; continue; }
    else { rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1]; rgba[target + 2] = raw[source + 2]; rgba[target + 3] = raw[source + 3]; continue; }
    rgba[target + 3] = 255;
  }
  return { width, height, data: rgba };
}

function decodeGlbImage(parsed, imageIndex) {
  const image = parsed.json.images?.[imageIndex];
  const view = parsed.json.bufferViews?.[image?.bufferView];
  if (!image || !view) throw new Error(`Missing image ${imageIndex}`);
  const imgBuf = parsed.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  if (image.mimeType === 'image/png') {
    return decodePng(imgBuf);
  }
  if (image.mimeType === 'image/jpeg') {
    return jpeg.decode(imgBuf, { useTArray: true, maxMemoryUsageInMB: 2048 });
  }
  throw new Error(`Unsupported image mimeType: ${image.mimeType}`);
}

// Deterministic box downscale
function downscale(image, targetW, targetH = targetW) {
  if (image.width === targetW && image.height === targetH) return image;
  const factorX = image.width / targetW, factorY = image.height / targetH;
  const rgba = new Uint8ClampedArray(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * factorY), y1 = Math.floor((y + 1) * factorY);
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * factorX), x1 = Math.floor((x + 1) * factorX);
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const at = (yy * image.width + xx) * 4;
          r += image.data[at];
          g += image.data[at + 1];
          b += image.data[at + 2];
          a += image.data[at + 3];
          count++;
        }
      }
      const outAt = (y * targetW + x) * 4;
      rgba[outAt] = Math.round(r / count);
      rgba[outAt + 1] = Math.round(g / count);
      rgba[outAt + 2] = Math.round(b / count);
      rgba[outAt + 3] = Math.round(a / count);
    }
  }
  return { width: targetW, height: targetH, data: rgba };
}

// Fast downscale with adaptive stride for large textures in Kowloon Atlas
function downscaleKowloon(image, targetW, targetH = targetW) {
  if (image.width === targetW && image.height === targetH) return image;
  const factorX = image.width / targetW, factorY = image.height / targetH;
  const stepX = Math.max(1, Math.floor(factorX / 4));
  const stepY = Math.max(1, Math.floor(factorY / 4));
  const rgba = new Uint8ClampedArray(targetW * targetH * 4);
  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * factorY), y1 = Math.floor((y + 1) * factorY);
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * factorX), x1 = Math.floor((x + 1) * factorX);
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let yy = y0; yy < y1; yy += stepY) {
        for (let xx = x0; xx < x1; xx += stepX) {
          const at = (yy * image.width + xx) * 4;
          r += image.data[at];
          g += image.data[at + 1];
          b += image.data[at + 2];
          a += image.data[at + 3];
          count++;
        }
      }
      const outAt = (y * targetW + x) * 4;
      rgba[outAt] = Math.round(r / count);
      rgba[outAt + 1] = Math.round(g / count);
      rgba[outAt + 2] = Math.round(b / count);
      rgba[outAt + 3] = Math.round(a / count);
    }
  }
  return { width: targetW, height: targetH, data: rgba };
}

function shoulder(value, knee, ceiling) {
  return value <= knee ? value : knee + (ceiling - knee) * (1 - Math.exp(-(value - knee) / (ceiling - knee)));
}

// Clean tone for Monserrate: shadow lift and highlight shoulder
function cleanToneMonserrate(image) {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    let r = image.data[i] / 255;
    let g = image.data[i + 1] / 255;
    let b = image.data[i + 2] / 255;
    // Shadow lift: gamma ~ 0.82 lifts baked scan shadow
    r = Math.pow(r, 0.82) * 1.08;
    g = Math.pow(g, 0.82) * 1.08;
    b = Math.pow(b, 0.82) * 1.08;
    data[i] = Math.round(Math.min(255, shoulder(r * 255, 200, 245)));
    data[i + 1] = Math.round(Math.min(255, shoulder(g * 255, 200, 245)));
    data[i + 2] = Math.round(Math.min(255, shoulder(b * 255, 200, 245)));
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

// ---- East Kowloon Cultural Centre Atlas builder ----
const KOWLOON_ATLAS_LAYOUT = {
  0: { x: 768, y: 512, w: 128, h: 256 },
  1: { x: 896, y: 512, w: 128, h: 256 },
  2: { x: 512, y: 768, w: 256, h: 128 },
  3: { x: 768, y: 768, w: 128, h: 128 },
  4: { x: 0, y: 0, w: 512, h: 512 },
  5: { x: 512, y: 0, w: 512, h: 512 },
  6: { x: 896, y: 768, w: 128, h: 128 },
  7: { x: 512, y: 512, w: 256, h: 256 },
  8: { x: 0, y: 512, w: 512, h: 512 },
};

function buildKowloonAtlas(parsed) {
  const atlas = new Uint8ClampedArray(1024 * 1024 * 4);
  for (const [imgIdxStr, rect] of Object.entries(KOWLOON_ATLAS_LAYOUT)) {
    const imgIdx = Number(imgIdxStr);
    const decoded = decodeGlbImage(parsed, imgIdx);
    const scaled = downscaleKowloon(decoded, rect.w, rect.h);
    for (let dy = 0; dy < rect.h; dy++) {
      for (let dx = 0; dx < rect.w; dx++) {
        const srcAt = (dy * rect.w + dx) * 4;
        const dstAt = ((rect.y + dy) * 1024 + (rect.x + dx)) * 4;
        atlas[dstAt] = scaled.data[srcAt];
        atlas[dstAt + 1] = scaled.data[srcAt + 1];
        atlas[dstAt + 2] = scaled.data[srcAt + 2];
        atlas[dstAt + 3] = 255;
      }
    }
  }
  return { width: 1024, height: 1024, data: atlas };
}

// Rotation matrix around Y axis
function rotY(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    0, 0, 0, 1,
  ];
}

// Collect all transformed primitives from GLB scene
function collectSceneGeometry(parsed, config) {
  const { json, binary } = parsed;
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const primitives = [];

  const visit = (nodeIndex, parentMatrix) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = json.meshes?.[node.mesh];
      if (mesh?.primitives) {
        for (const prim of mesh.primitives) {
          if (prim.mode !== undefined && prim.mode !== 4) continue;
          const pos = readAccessor(json, binary, prim.attributes.POSITION);
          const nrm = prim.attributes.NORMAL !== undefined ? readAccessor(json, binary, prim.attributes.NORMAL) : null;
          const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(json, binary, prim.attributes.TEXCOORD_0) : null;
          if (!uv) throw new Error('Landmark primitive is missing TEXCOORD_0');
          const inputIdx = prim.indices !== undefined ? readAccessor(json, binary, prim.indices) : null;
          const idx = new Uint32Array(inputIdx ? inputIdx.length : pos.length / 3);
          for (let i = 0; i < idx.length; i++) idx[i] = inputIdx ? inputIdx[i] : i;
          primitives.push({ positions: pos, normals: nrm, uvs: uv, indices: idx, matrix: world, material: prim.material ?? 0 });
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, identity());

  // Apply node matrices and combine
  const combinedPos = [];
  const combinedNrm = [];
  const combinedUv = [];
  const combinedIdx = [];

  const modelRot = rotY(config.rotationY);

  const combinedSrcZ = [];

  for (const prim of primitives) {
    if (config.skipMaterials?.includes(prim.material)) continue;
    const fullMat = multiply(modelRot, prim.matrix);
    const nrmMat = normalMatrix(fullMat);
    const baseVertex = combinedPos.length / 3;

    for (let v = 0; v < prim.positions.length / 3; v++) {
      const offset = v * 3;
      const x = prim.positions[offset], y = prim.positions[offset + 1], z = prim.positions[offset + 2];
      const tx = fullMat[0] * x + fullMat[4] * y + fullMat[8] * z + fullMat[12];
      const ty = fullMat[1] * x + fullMat[5] * y + fullMat[9] * z + fullMat[13];
      const tz = fullMat[2] * x + fullMat[6] * y + fullMat[10] * z + fullMat[14];
      combinedPos.push(tx, ty, tz);
      if (config.cutSrcZ !== undefined) {
        combinedSrcZ.push(prim.matrix[2] * x + prim.matrix[6] * y + prim.matrix[10] * z + prim.matrix[14]);
      }

      let nx = prim.normals ? prim.normals[offset] : 0;
      let ny = prim.normals ? prim.normals[offset + 1] : 1;
      let nz = prim.normals ? prim.normals[offset + 2] : 0;
      const tnx = nrmMat[0] * nx + nrmMat[3] * ny + nrmMat[6] * nz;
      const tny = nrmMat[1] * nx + nrmMat[4] * ny + nrmMat[7] * nz;
      const tnz = nrmMat[2] * nx + nrmMat[5] * ny + nrmMat[8] * nz;
      const len = Math.hypot(tnx, tny, tnz) || 1;
      combinedNrm.push(tnx / len, tny / len, tnz / len);

      let uvU = prim.uvs[v * 2];
      let uvV = prim.uvs[v * 2 + 1];
      if (config.id === 'landmark_culture') {
        const mat = parsed.json.materials?.[prim.material];
        const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index ?? prim.material;
        const imgIdx = parsed.json.textures?.[texIdx]?.source ?? texIdx;
        const rect = KOWLOON_ATLAS_LAYOUT[imgIdx] ?? { x: 0, y: 0, w: 512, h: 512 };
        uvU = uvU - Math.floor(uvU);
        uvV = uvV - Math.floor(uvV);
        uvU = (rect.x + uvU * rect.w) / 1024;
        uvV = (rect.y + uvV * rect.h) / 1024;
      }
      combinedUv.push(uvU, uvV);
    }

    for (let i = 0; i < prim.indices.length; i++) {
      combinedIdx.push(baseVertex + prim.indices[i]);
    }
  }

  // Rome: clip the scene at a source-space Z plane (keeps Z <= cutSrcZ), splitting straddling triangles
  if (config.cutSrcZ !== undefined) {
    const limit = config.cutSrcZ;
    const kept = [];
    const lerpVertex = (a, b, t) => {
      const at = combinedPos.length / 3;
      for (let k = 0; k < 3; k++) combinedPos.push(combinedPos[a * 3 + k] + (combinedPos[b * 3 + k] - combinedPos[a * 3 + k]) * t);
      const nx = combinedNrm[a * 3] + (combinedNrm[b * 3] - combinedNrm[a * 3]) * t;
      const ny = combinedNrm[a * 3 + 1] + (combinedNrm[b * 3 + 1] - combinedNrm[a * 3 + 1]) * t;
      const nz = combinedNrm[a * 3 + 2] + (combinedNrm[b * 3 + 2] - combinedNrm[a * 3 + 2]) * t;
      const len = Math.hypot(nx, ny, nz) || 1;
      combinedNrm.push(nx / len, ny / len, nz / len);
      for (let k = 0; k < 2; k++) combinedUv.push(combinedUv[a * 2 + k] + (combinedUv[b * 2 + k] - combinedUv[a * 2 + k]) * t);
      combinedSrcZ.push(limit);
      return at;
    };
    for (let t = 0; t < combinedIdx.length; t += 3) {
      const tri = [combinedIdx[t], combinedIdx[t + 1], combinedIdx[t + 2]];
      const inside = tri.map(i => combinedSrcZ[i] <= limit);
      const count = inside.filter(Boolean).length;
      if (count === 3) { kept.push(...tri); continue; }
      if (count === 0) continue;
      // Sutherland-Hodgman against one plane keeps the winding of the polygon
      const polygon = [];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const aIn = inside[e], bIn = inside[(e + 1) % 3];
        if (aIn) polygon.push(a);
        if (aIn !== bIn) polygon.push(lerpVertex(a, b, (limit - combinedSrcZ[a]) / (combinedSrcZ[b] - combinedSrcZ[a])));
      }
      for (let k = 1; k + 1 < polygon.length; k++) kept.push(polygon[0], polygon[k], polygon[k + 1]);
    }
    combinedIdx.length = 0;
    for (const i of kept) combinedIdx.push(i);
  }

  // Handle cutting base plate (Monserrate) or flattening Y=0
  let finalIndices = combinedIdx;
  if (config.cutBase && config.cutY !== undefined) {
    // Drop triangles where all 3 vertices are below cutY
    const keptIdx = [];
    for (let t = 0; t < combinedIdx.length; t += 3) {
      const i0 = combinedIdx[t], i1 = combinedIdx[t + 1], i2 = combinedIdx[t + 2];
      const y0 = combinedPos[i0 * 3 + 1], y1 = combinedPos[i1 * 3 + 1], y2 = combinedPos[i2 * 3 + 1];
      if (y0 < config.cutY && y1 < config.cutY && y2 < config.cutY) continue;
      keptIdx.push(i0, i1, i2);
    }
    finalIndices = keptIdx;
    // Clamp any remaining vertices below cutY to cutY
    for (let v = 0; v < combinedPos.length / 3; v++) {
      if (combinedPos[v * 3 + 1] < config.cutY) combinedPos[v * 3 + 1] = config.cutY;
    }
  }

  if (config.flattenY0) {
    for (let v = 0; v < combinedPos.length / 3; v++) {
      if (combinedPos[v * 3 + 1] < 0) combinedPos[v * 3 + 1] = 0;
    }
  }

  return {
    positions: new Float32Array(combinedPos),
    normals: new Float32Array(combinedNrm),
    uvs: new Float32Array(combinedUv),
    indices: new Uint32Array(finalIndices),
  };
}

function weld(geometry) {
  const vertexByAttributes = new Map();
  const positions = [], normals = [], uvs = [], indices = [];
  for (const sourceIndex of geometry.indices) {
    const pOff = sourceIndex * 3, uvOff = sourceIndex * 2;
    const px = Math.round(geometry.positions[pOff] * 1e5);
    const py = Math.round(geometry.positions[pOff + 1] * 1e5);
    const pz = Math.round(geometry.positions[pOff + 2] * 1e5);
    const nx = Math.round(geometry.normals[pOff] * 1e3);
    const ny = Math.round(geometry.normals[pOff + 1] * 1e3);
    const nz = Math.round(geometry.normals[pOff + 2] * 1e3);
    const u = Math.round(geometry.uvs[uvOff] * 1e4);
    const v = Math.round(geometry.uvs[uvOff + 1] * 1e4);
    const key = `${px},${py},${pz},${nx},${ny},${nz},${u},${v}`;
    let targetIndex = vertexByAttributes.get(key);
    if (targetIndex === undefined) {
      targetIndex = positions.length / 3;
      vertexByAttributes.set(key, targetIndex);
      positions.push(geometry.positions[pOff], geometry.positions[pOff + 1], geometry.positions[pOff + 2]);
      normals.push(geometry.normals[pOff], geometry.normals[pOff + 1], geometry.normals[pOff + 2]);
      uvs.push(geometry.uvs[uvOff], geometry.uvs[uvOff + 1]);
    }
    indices.push(targetIndex);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

async function simplifyGeometry(geometry, cap) {
  if (geometry.indices.length / 3 <= cap) return { indices: geometry.indices, error: 0 };
  await MeshoptSimplifier.ready;
  const attributes = new Float32Array(geometry.positions.length / 3 * 2);
  for (let vertex = 0; vertex < geometry.positions.length / 3; vertex++) {
    attributes[vertex * 2] = geometry.uvs[vertex * 2];
    attributes[vertex * 2 + 1] = geometry.uvs[vertex * 2 + 1];
  }
  let best = null;
  const flagSets = [['LockBorder'], ['LockBorder', 'Permissive'], []];
  const uvWeights = [0.5, 0.5];

  for (let error = 0.001; error <= 0.5; error *= 2) {
    for (const flags of flagSets) {
      const [indices] = MeshoptSimplifier.simplifyWithAttributes(
        geometry.indices, geometry.positions, 3, attributes, 2, uvWeights, null, cap * 3, error, flags,
      );
      if (indices.length / 3 <= cap) return { indices, error };
      if (!best || indices.length < best.indices.length) best = { indices, error };
    }
  }
  if (!best) throw new Error(`meshoptimizer returned no candidate for cap ${cap}`);
  if (best.indices.length / 3 > cap) {
    throw new Error(`meshoptimizer could not reach ${cap} triangles (best ${best.indices.length / 3})`);
  }
  return best;
}

// Position-only simplification: no UV constraint, tiny disconnected props are pruned first. The closed source shells
// are simplified whole (open bottoms would lock their borders); the down-facing faces are dropped afterwards, so the
// target is scaled until the surviving face count lands just under the cap.
async function simplifyPositions(mesh, cap) {
  await MeshoptSimplifier.ready;
  let target = cap;
  for (let attempt = 0; attempt < 6; attempt++) {
    let simplified = null;
    for (let error = 0.001; error <= 0.5; error *= 2) {
      const [indices] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target * 3, error, ['Prune']);
      if (indices.length / 3 <= target) { simplified = { indices, error }; break; }
    }
    if (!simplified) throw new Error(`meshoptimizer could not reach ${target} triangles position-only`);
    const visible = dropDownFacing(mesh.positions, simplified.indices);
    const count = visible.length / 3;
    if (count <= cap && count >= cap * 0.97) return { indices: visible, error: simplified.error };
    target = Math.round(target * (cap * 0.985) / count);
  }
  throw new Error(`position-only simplification did not settle under ${cap} triangles`);
}

function referencedBounds(positions, indices) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const index of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const val = positions[index * 3 + axis];
      min[axis] = Math.min(min[axis], val);
      max[axis] = Math.max(max[axis], val);
    }
  }
  return { min, max };
}

function compactAndFit(geometry, simplified, footprint) {
  const bounds = referencedBounds(geometry.positions, simplified.indices);
  const width = bounds.max[0] - bounds.min[0];
  const depth = bounds.max[2] - bounds.min[2];
  if (!(width > 0) || !(depth > 0)) throw new Error('Source mesh has no horizontal extent');

  const maxW = footprint[0] * CELL_SIZE_M * MARGIN;
  const maxD = footprint[1] * CELL_SIZE_M * MARGIN;
  const scale = Math.min(maxW / width, maxD / depth);

  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
  const baseY = bounds.min[1];

  const remap = new Map();
  const positions = [], normals = [], uvs = [], indices = [];

  for (const srcIdx of simplified.indices) {
    let targetIdx = remap.get(srcIdx);
    if (targetIdx === undefined) {
      targetIdx = positions.length / 3;
      remap.set(srcIdx, targetIdx);
      const pOff = srcIdx * 3, uvOff = srcIdx * 2;
      positions.push(
        (geometry.positions[pOff] - centerX) * scale,
        (geometry.positions[pOff + 1] - baseY) * scale,
        (geometry.positions[pOff + 2] - centerZ) * scale,
      );
      normals.push(geometry.normals[pOff], geometry.normals[pOff + 1], geometry.normals[pOff + 2]);
      uvs.push(geometry.uvs[uvOff], geometry.uvs[uvOff + 1]);
    }
    indices.push(targetIdx);
  }

  const result = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
  const fittedBounds = referencedBounds(result.positions, result.indices);
  return { geometry: result, bounds: fittedBounds, scale, sourceBounds: bounds };
}

function round(val) {
  return +val.toFixed(6);
}

function writeGlb(geometry, jpegBytes, generator, modelId) {
  const indices = geometry.positions.length / 3 <= 65535 ? new Uint16Array(geometry.indices) : geometry.indices;
  const buffers = [
    Buffer.from(geometry.positions.buffer, geometry.positions.byteOffset, geometry.positions.byteLength),
    Buffer.from(geometry.normals.buffer, geometry.normals.byteOffset, geometry.normals.byteLength),
    Buffer.from(geometry.uvs.buffer, geometry.uvs.byteOffset, geometry.uvs.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
    jpegBytes,
  ];

  let byteOffset = 0;
  const bufferViews = buffers.map((buf, idx) => {
    const view = { buffer: 0, byteOffset, byteLength: buf.length, ...(idx < 3 ? { target: 34962 } : idx === 3 ? { target: 34963 } : {}) };
    byteOffset += buf.length + (4 - buf.length % 4) % 4;
    return view;
  });

  const bounds = referencedBounds(geometry.positions, geometry.indices);
  const document = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: modelId, mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: 'landmark_material',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
    }],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/jpeg' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    buffers: [{ byteLength: byteOffset }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: geometry.positions.length / 3, type: 'VEC3', min: bounds.min, max: bounds.max },
      { bufferView: 1, componentType: 5126, count: geometry.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: geometry.uvs.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: indices instanceof Uint16Array ? 5123 : 5125, count: indices.length, type: 'SCALAR' },
    ],
  };

  const jsonBuf = Buffer.from(JSON.stringify(document));
  const jsonPadding = Buffer.alloc((4 - jsonBuf.length % 4) % 4, 32);
  const binaryBuf = Buffer.concat(buffers.map(buf => pad4(buf)));

  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  const totalLength = 12 + 8 + jsonBuf.length + jsonPadding.length + 8 + binaryBuf.length;
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  jsonHeader.writeUInt32LE(jsonBuf.length + jsonPadding.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);

  binHeader.writeUInt32LE(binaryBuf.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return {
    bytes: Buffer.concat([header, jsonHeader, jsonBuf, jsonPadding, binHeader, binaryBuf]),
    triangles: geometry.indices.length / 3,
    bounds,
  };
}

async function processModel(config) {
  const rawGlb = await readFile(join(process.cwd(), config.sourceFile));
  const parsed = parseGlb(rawGlb);

  // 1. Process texture
  const downscaled = config.id === 'landmark_culture' ? null : downscale(decodeGlbImage(parsed, 0), config.textureSize);
  // 2. Collect and transform geometry
  const rawGeometry = collectSceneGeometry(parsed, config);

  let textureRgba = config.id === 'landmark_castle' ? cleanToneMonserrate(downscaled)
    : config.id === 'landmark_culture' ? buildKowloonAtlas(parsed) : downscaled;

  let welded, simplified;
  if (config.bake) {
    // 3. Simplify positions only, then re-bake the atlas onto the proxy (the source UV islands cannot survive 30x)
    const sourceMesh = weldPositions(rawGeometry.positions, rawGeometry.indices);
    const proxy = await simplifyPositions(sourceMesh, config.triangleCap);
    const baked = bakeAtlas({ proxy: { positions: sourceMesh.positions, indices: proxy.indices }, source: rawGeometry, texture: downscaled, size: config.textureSize });
    welded = baked.geometry;
    simplified = { indices: baked.geometry.indices, error: proxy.error };
    textureRgba = baked.texture;
  } else {
    welded = weld(rawGeometry);
    // 3. Simplify
    simplified = await simplifyGeometry(welded, config.triangleCap);
  }

  const jpegBytes = Buffer.from(jpeg.encode({ data: textureRgba.data, width: textureRgba.width, height: textureRgba.height }, 85).data);

  // 4. Fit footprint
  const fitted = compactAndFit(welded, simplified, config.footprint);

  // 5. Write GLB
  const generator = `Xay Nha import-landmarks.mjs (D037, source: ${config.title} by ${config.author}, ${config.license})`;
  const glb = writeGlb(fitted.geometry, jpegBytes, generator, config.id);

  if (glb.triangles > config.triangleCap) {
    throw new Error(`${config.id}: ${glb.triangles} triangles exceed cap of ${config.triangleCap}`);
  }
  const maxBytes = config.maxBytes ?? 700 * 1024;
  if (glb.bytes.length >= maxBytes) {
    throw new Error(`${config.id}: ${glb.bytes.length} bytes exceed the ${Math.round(maxBytes / 1024)} KB budget`);
  }

  const outFile = `${OUT_DIR}/${config.id}.glb`;
  return {
    id: config.id,
    outFile,
    bytes: glb.bytes,
    triangles: glb.triangles,
    triangleCap: config.triangleCap,
    bounds: {
      min: glb.bounds.min.map(round),
      max: glb.bounds.max.map(round),
    },
    scale: round(fitted.scale),
    texture: {
      width: textureRgba.width,
      height: textureRgba.height,
      bytes: jpegBytes.length,
    },
    credits: {
      title: config.title,
      author: config.author,
      license: config.license,
      url: config.url,
      source: config.sourceFile,
    },
    footprint: config.footprint,
  };
}

async function main() {
  if (!existsSync(join(process.cwd(), SOURCE_DIR))) {
    console.log('Landmark sources in map/nha2 are absent; skipping D037 import check.');
    process.exit(0);
  }

  for (const m of MODELS) {
    if (!existsSync(join(process.cwd(), m.sourceFile))) {
      console.log(`Missing source file ${m.sourceFile}; skipping D037 import check.`);
      process.exit(0);
    }
  }

  console.log('Importing D037 landmarks from map/nha2...');
  const results = [];
  const configOutput = {
    generatedBy: 'scripts/import-landmarks.mjs',
    models: {},
  };

  for (const modelConfig of ONLY ? MODELS.filter(model => model.id === ONLY) : MODELS) {
    console.log(`Processing ${modelConfig.id} (${modelConfig.title})...`);
    const t0 = Date.now();
    const res = await processModel(modelConfig);
    console.log(`  Done ${modelConfig.id} in ${Date.now() - t0} ms: ${res.triangles}/${res.triangleCap} tris, ${Math.round(res.bytes.length / 1024)} KB`);
    results.push(res);
    configOutput.models[res.id] = {
      file: res.outFile,
      footprint: res.footprint,
      triangles: res.triangles,
      triangleCap: res.triangleCap,
      bounds: res.bounds,
      scale: res.scale,
      texture: res.texture,
      bytes: res.bytes.length,
      credits: res.credits,
    };
  }

  const configBytes = Buffer.from(`${JSON.stringify(configOutput, null, 2)}\n`);

  if (CHECK) {
    let drifted = 0;
    for (const r of results) {
      let existing = null;
      try { existing = await readFile(join(process.cwd(), r.outFile)); } catch { /* reported below */ }
      if (!existing || !existing.equals(r.bytes)) {
        console.error(`DRIFT ${r.outFile}${existing ? ` (${existing.length} -> ${r.bytes.length} bytes)` : ' (missing)'}`);
        drifted++;
      }
    }
    let existingConfig = null;
    try { existingConfig = await readFile(join(process.cwd(), CONFIG_PATH)); } catch { /* reported below */ }
    if (!ONLY && (!existingConfig || !existingConfig.equals(configBytes))) {
      console.error(`DRIFT ${CONFIG_PATH}${existingConfig ? '' : ' (missing)'}`);
      drifted++;
    }
    if (drifted) {
      console.error(`--check FAILED: ${drifted} file(s) would change; re-run without --check.`);
      process.exit(1);
    }
    console.log(`--check PASS: ${results.length} D037 landmarks + config are deterministic.`);
  } else {
    await mkdir(join(process.cwd(), OUT_DIR), { recursive: true });
    if (!ONLY) await writeFile(join(process.cwd(), CONFIG_PATH), configBytes);
    for (const r of results) {
      await writeFile(join(process.cwd(), r.outFile), r.bytes);
    }
    console.log(`Successfully imported ${results.length} D037 landmarks into ${OUT_DIR}:`);
    for (const r of results) {
      console.log(`  ${r.id.padEnd(20)} ${String(r.triangles).padStart(5)}/${r.triangleCap} tris  ${Math.round(r.bytes.length / 1024)} KB  (${r.footprint[0]}x${r.footprint[1]} cells)`);
    }
  }
}

await main();
