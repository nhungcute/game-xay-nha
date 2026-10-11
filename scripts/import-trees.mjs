// D030: import the owner's tree/bush GLBs (map/tree) into game-ready environment models.
// Each of the 12 game ids (tree_deciduous_01..04, tree_conifer_01..04, bush_01..04) becomes a NEAR GLB
// (one mesh, one material, one atlas texture) and a FAR GLB (3 crossed alpha-cutout planes textured with
// pre-rendered captures of the near model, packed into one 512px atlas).
// Deterministic: the same source bytes always produce byte-identical outputs (`--check` verifies; the
// billboard captures render through Chrome's SwiftShader software path so pixels do not depend on the GPU).
// The sources are NOT committed; like import-model-pack.mjs, `--check` skips with a notice when map/tree is
// absent so CI passes.
//
// Licenses (asset.extras of each source GLB):
//   stylized_tree.glb  CC-BY-4.0    "Stylized Tree" by Aki          (hue variants, bark resimplify, leaf-card thinning)
//   fur_tree.glb       CC-BY-SA-4.0 "Fur Tree" by Harri Jones       (spec-gloss → metal-rough, buried trunk cut, brightening)
//   small_bush.glb     CC-BY-4.0    "Small bush" by yanix           (BLEND → MASK, specular ext removed, colour/scale variants)
//   tree_animate.glb   NOT USED (8.7 MB, morph targets, no gameplay need)
// Conifer outputs (CC-BY-SA derivatives) go to models/env-by-sa/ next to their own LICENSE.md.
//
// Usage: node scripts/import-trees.mjs            # (re)generate models + trees.config.json
//        node scripts/import-trees.mjs --check    # byte-compare outputs, exit 1 on drift
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateSync, deflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const CHECK = process.argv.includes('--check');
const SRC_DIR = 'map/tree';
const OUT_CC_BY = 'apps/web/public/assets/models/env';
const OUT_CC_BY_SA = 'apps/web/public/assets/models/env-by-sa';
const CONFIG_PATH = 'scripts/trees.config.json';

// ---------- parameters (recorded verbatim into trees.config.json) ----------
const PARAMETERS = {
  nearLod: { count: 160, radiusM: 60 }, // game-side near/far split (EnvRenderer reads these from the config)
  farLod: { recomputeMoveM: 4, recomputeYawDeg: 10 },
  triangleCaps: { deciduous: { near: 1500, far: 32 }, conifer: { near: 1500, far: 32 }, bush: { near: 320, far: 16 } },
  atlas: { leafSlotPx: 512, barkSlotPx: 128, farTilePx: 256, farAnglesDeg: [0, 60, 120] },
  alphaCutoff: { deciduous: 0.4, conifer: 0.44, bush: 0.4, far: 0.35 },
  // Deciduous: stylized_tree is 8.02 m tall with a ~5.8 m canopy; hue-rotated greens for 01-03, the original
  // red-orange canopy stays on 04 (owner decision).
  deciduous: {
    source: 'stylized_tree.glb', unitScale: 0.01, barkTargetTriangles: 350,
    cardScaleMax: 1.9, canopyMaxM: 3.2, seed: 0xd030,
    variants: [
      { heightM: 4.2, hueShiftDeg: 65, saturation: 0.92, lightness: 1.0, taper: 1.0 },
      { heightM: 4.7, hueShiftDeg: 85, saturation: 1.0, lightness: 0.96, taper: 0.94 },
      { heightM: 5.15, hueShiftDeg: 105, saturation: 0.85, lightness: 1.06, taper: 1.06 },
      { heightM: 5.6, hueShiftDeg: 0, saturation: 1.0, lightness: 1.0, taper: 1.0 },
    ],
  },
  // Conifer: fur_tree is 9.0 m above ground (the trunk is buried 0.5 m — cut at y=0); brightened 15-25 %.
  conifer: {
    source: 'fur_tree.glb', unitScale: 1, branchTargetTriangles: 1420,
    canopyMaxM: 2.6, seed: 0xd031, trunkBrightness: 1.1,
    variants: [
      { heightM: 4.5, brightness: 1.15, hueShiftDeg: -4, taper: 1.0 },
      { heightM: 5.0, brightness: 1.2, hueShiftDeg: 0, taper: 0.92 },
      { heightM: 5.5, brightness: 1.17, hueShiftDeg: 6, taper: 1.06 },
      { heightM: 6.0, brightness: 1.25, hueShiftDeg: 2, taper: 0.96 },
    ],
  },
  // Bush: small_bush is 0.47 m tall, ~0.6 m wide; 4 variants differ in hue and proportion. The sprig scan
  // is very dark, so a base brightness lifts it toward the terrain palette before the per-variant hue shift.
  bush: {
    source: 'small_bush.glb', unitScale: 1, canopyMaxM: 1.4, seed: 0xd032, baseBrightness: 1.6,
    variants: [
      { heightM: 0.9, hueShiftDeg: -6, saturation: 1.05, lightness: 1.0, taper: 1.0 },
      { heightM: 1.0, hueShiftDeg: 8, saturation: 1.0, lightness: 0.95, taper: 0.9 },
      { heightM: 1.05, hueShiftDeg: 0, saturation: 0.9, lightness: 1.08, taper: 1.05 },
      { heightM: 1.1, hueShiftDeg: 18, saturation: 1.1, lightness: 0.92, taper: 0.96 },
    ],
  },
  // Billboard capture: Chrome headless on SwiftShader, game lighting, straight-alpha readback packed 2×2.
  capture: { sizePx: 256, margin: 1.06, elevationDeg: 28 },
};

const CREDITS = {
  stylized_tree: {
    title: 'Stylized Tree', author: 'Aki (https://sketchfab.com/Akishaqs)', license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://sketchfab.com/3d-models/stylized-tree-eb71371ebebd482e804b0f8b5a9b6b40',
  },
  fur_tree: {
    title: 'Fur Tree', author: 'Harri Jones (https://sketchfab.com/HarriJones23)', license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    url: 'https://sketchfab.com/3d-models/fur-tree-41fa3210e50944eaa489c148e5e2ccc7',
  },
  small_bush: {
    title: 'Small bush', author: 'yanix (https://sketchfab.com/yanix)', license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://sketchfab.com/3d-models/small-bush-f6ed4c70fc024ac88e8e6a19991695af',
  },
};

const TREES = [
  { id: 'tree_deciduous_01', family: 'deciduous', variant: 0 },
  { id: 'tree_deciduous_02', family: 'deciduous', variant: 1 },
  { id: 'tree_deciduous_03', family: 'deciduous', variant: 2 },
  { id: 'tree_deciduous_04', family: 'deciduous', variant: 3 },
  { id: 'tree_conifer_01', family: 'conifer', variant: 0 },
  { id: 'tree_conifer_02', family: 'conifer', variant: 1 },
  { id: 'tree_conifer_03', family: 'conifer', variant: 2 },
  { id: 'tree_conifer_04', family: 'conifer', variant: 3 },
  { id: 'bush_01', family: 'bush', variant: 0 },
  { id: 'bush_02', family: 'bush', variant: 1 },
  { id: 'bush_03', family: 'bush', variant: 2 },
  { id: 'bush_04', family: 'bush', variant: 3 },
];

// ---------- PNG codec (8-bit non-interlaced, color types 0/2/6 — exactly what the sources ship) ----------
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG');
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`Unsupported PNG (depth ${bitDepth}, interlace ${interlace})`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null;
  if (!channels) throw new Error(`Unsupported PNG color type ${colorType}`);
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * channels, raw = new Uint8Array(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)], rowStart = y * stride, prevStart = y ? (y - 1) * stride : 0;
    for (let x = 0; x < stride; x++) {
      const value = inflated[y * (stride + 1) + 1 + x];
      const left = x >= channels ? raw[rowStart + x - channels] : 0;
      const up = y ? raw[prevStart + x] : 0;
      const upperLeft = y && x >= channels ? raw[prevStart + x - channels] : 0;
      raw[rowStart + x] = value + (filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up >> 1) : paeth(left, up, upperLeft));
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < raw.length; i += channels, j += 4) {
    rgba[j] = raw[i]; rgba[j + 1] = channels > 1 ? raw[i + 1] : raw[i]; rgba[j + 2] = channels > 2 ? raw[i + 2] : raw[i]; rgba[j + 3] = channels === 4 ? raw[i + 3] : 255;
  }
  return { width, height, rgba };
}

function encodePng(rgba, width, height, subFilter = false) {
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = subFilter ? 1 : 0;
    if (subFilter) for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x] - (x >= 4 ? rgba[y * stride + x - 4] : 0);
    else Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}


// ---------- pixel operations ----------

/** Box-average downscale by an integer factor in premultiplied space (no dark halos on cutout edges). */
function downscale({ width, height, rgba }, factor) {
  if (!Number.isInteger(factor) || factor < 1 || width % factor || height % factor) throw new Error(`Texture ${width}×${height} not divisible by ${factor}`);
  if (factor === 1) return { width, height, rgba };
  const w = width / factor, h = height / factor, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < factor; dy++) for (let dx = 0; dx < factor; dx++) {
      const i = ((y * factor + dy) * width + x * factor + dx) * 4;
      const alpha = rgba[i + 3];
      r += rgba[i] * alpha; g += rgba[i + 1] * alpha; b += rgba[i + 2] * alpha; a += alpha;
    }
    const o = (y * w + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / (factor * factor);
  }
  return { width: w, height: h, rgba: out };
}

const clamp01 = v => Math.min(1, Math.max(0, v));
/** Hue rotation + saturation/lightness scaling in HSL space for every pixel with alpha > 0. */
function hueShift({ rgba }, degrees, saturation = 1, lightness = 1) {
  if (!degrees && saturation === 1 && lightness === 1) return;
  for (let i = 0; i < rgba.length; i += 4) {
    if (!rgba[i + 3]) continue;
    const [h, s, l] = rgbToHsl(rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255);
    const [r, g, b] = hslToRgb((h + degrees / 360 + 1) % 1, clamp01(s * saturation), clamp01(l * lightness));
    rgba[i] = r * 255; rgba[i + 1] = g * 255; rgba[i + 2] = b * 255;
  }
}
function brightness({ rgba }, factor) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = Math.min(255, rgba[i] * factor);
    rgba[i + 1] = Math.min(255, rgba[i + 1] * factor);
    rgba[i + 2] = Math.min(255, rgba[i + 2] * factor);
  }
}
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const channel = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function blit(target, source, dx, dy) {
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const s = (y * source.width + x) * 4, t = ((y + dy) * target.width + x + dx) * 4;
    for (let c = 0; c < 4; c++) target.rgba[t + c] = source.rgba[s + c];
  }
}
function fillRect(target, [x, y, w, h], [r, g, b, a]) {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    const t = (py * target.width + px) * 4;
    target.rgba[t] = r; target.rgba[t + 1] = g; target.rgba[t + 2] = b; target.rgba[t + 3] = a;
  }
}

/** mulberry32 — tiny seeded PRNG so the leaf-card selection is stable across runs. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- GLB reading: raw images + geometry through the game's own GLTFLoader ----------

function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const header = 20 + jsonLength;
  return { json, binary: buffer.subarray(header + 8, header + 8 + buffer.readUInt32LE(header)) };
}

async function loadScene(file) {
  globalThis.self ??= globalThis; // GLTFLoader probes `self` before image decoding; Node has none
  const buffer = await readFile(join(process.cwd(), SRC_DIR, file));
  const glb = parseGlb(buffer);
  const loader = new (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader();
  const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute('position'), normal = object.geometry.getAttribute('normal'), uv = object.geometry.getAttribute('uv');
    if (position.isInterleavedBufferAttribute || (normal && normal.isInterleavedBufferAttribute) || (uv && uv.isInterleavedBufferAttribute)) throw new Error(`${file}: interleaved attributes not supported`);
    const world = object.matrixWorld.elements, count = position.count;
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = uv ? new Float32Array(count * 2) : null;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = world[0] * position.getX(i) + world[4] * position.getY(i) + world[8] * position.getZ(i) + world[12];
      positions[i * 3 + 1] = world[1] * position.getX(i) + world[5] * position.getY(i) + world[9] * position.getZ(i) + world[13];
      positions[i * 3 + 2] = world[2] * position.getX(i) + world[6] * position.getY(i) + world[10] * position.getZ(i) + world[14];
    }
    if (normal) {
      // Sources use uniform node scales, so the rotation part alone transforms normals correctly.
      for (let i = 0; i < count; i++) {
        const x = normal.getX(i), y = normal.getY(i), z = normal.getZ(i);
        const nx = world[0] * x + world[4] * y + world[8] * z, ny = world[1] * x + world[5] * y + world[9] * z, nz = world[2] * x + world[6] * y + world[10] * z;
        const length = Math.hypot(nx, ny, nz) || 1;
        normals[i * 3] = nx / length; normals[i * 3 + 1] = ny / length; normals[i * 3 + 2] = nz / length;
      }
    } else for (let i = 0; i < count * 3; i++) normals[i] = i % 3 === 1 ? 1 : 0;
    if (uv) for (let i = 0; i < count * 2; i++) uvs[i] = uv.array[i];
    const index = object.geometry.getIndex();
    const indices = new Uint32Array(index ? index.count : count);
    for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getX(i) : i;
    parts.push({ name: object.name, positions, normals, uvs, indices });
  });
  return { parts, glb };
}

function sourceImage(glb, imageIndex) {
  const view = glb.json.bufferViews[glb.json.images[imageIndex].bufferView];
  return glb.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

function bbox(part) {
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < part.positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    box.min[axis] = Math.min(box.min[axis], part.positions[i + axis]);
    box.max[axis] = Math.max(box.max[axis], part.positions[i + axis]);
  }
  return box;
}

// ---------- meshoptimizer simplification (fresh WASM instance per retry, like import-model-pack) ----------

let simplifierInstance = null, simplifierReloads = 0;
async function getSimplifier(fresh = false) {
  const specifier = fresh ? `meshoptimizer/simplifier?fresh=${++simplifierReloads}` : 'meshoptimizer/simplifier';
  simplifierInstance = (await import(specifier)).MeshoptSimplifier;
  return simplifierInstance;
}

/** UV-less reduction (flat-coloured bark): escalate the error until the target is met. */
async function simplifyTriangles(part, targetTriangles, error = 0.001) {
  const target = Math.max(0, Math.round(targetTriangles)) * 3;
  for (let attempt = error; attempt < 1; attempt *= 2) {
    for (const flags of [['LockBorder'], ['LockBorder', 'Permissive'], []]) {
      try {
        const simplifier = await getSimplifier();
        await simplifier.ready;
        const [indices] = simplifier.simplify(part.indices, part.positions, 3, target, attempt, flags);
        if (indices.length / 3 <= targetTriangles) return { indices, error: attempt };
      } catch { simplifierInstance = null; await getSimplifier(true); }
    }
  }
  const simplifier = await getSimplifier();
  await simplifier.ready;
  const [indices] = simplifier.simplify(part.indices, part.positions, 3, target, 1, []);
  return { indices, error: 1 };
}

/** Simplify keeping UV error bounded (attribute weights: position ×1, UV ×0.5) — for the textured conifer cards. */
async function simplifyWithUv(part, targetTriangles, error = 0.001) {
  const attributes = new Float32Array(part.positions.length / 3 * 5);
  for (let v = 0; v < part.positions.length / 3; v++) {
    attributes[v * 5] = part.positions[v * 3]; attributes[v * 5 + 1] = part.positions[v * 3 + 1]; attributes[v * 5 + 2] = part.positions[v * 3 + 2];
    attributes[v * 5 + 3] = part.uvs[v * 2]; attributes[v * 5 + 4] = part.uvs[v * 2 + 1];
  }
  const target = Math.max(0, Math.round(targetTriangles)) * 3;
  let best = null;
  for (let attempt = error; attempt < 1; attempt *= 2) {
    for (const flags of [[], ['Permissive']]) {
      try {
        const simplifier = await getSimplifier();
        await simplifier.ready;
        const [indices] = simplifier.simplifyWithAttributes(part.indices, part.positions, 3, attributes, 5, [1, 1, 1, 0.5, 0.5], null, target, attempt, flags);
        if (indices.length / 3 <= targetTriangles) return { indices, error: attempt };
        if (!best || indices.length < best.indices.length) best = { indices, error: attempt };
      } catch { simplifierInstance = null; await getSimplifier(true); }
    }
  }
  if (!best) throw new Error('simplifyWithUv failed for every error step');
  return best;
}

// ---------- foliage-card handling (connected components over shared vertices) ----------

function triangleComponents(part) {
  const parent = new Int32Array(part.positions.length / 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let t = 0; t < part.indices.length / 3; t++) {
    union(part.indices[t * 3], part.indices[t * 3 + 1]);
    union(part.indices[t * 3 + 1], part.indices[t * 3 + 2]);
  }
  const components = new Map();
  for (let t = 0; t < part.indices.length / 3; t++) {
    const root = find(part.indices[t * 3]);
    let list = components.get(root);
    if (!list) components.set(root, list = []);
    list.push(t);
  }
  return [...components.values()];
}

function quadArea(part, triangles) {
  let area = 0;
  for (const t of triangles) {
    const a = part.indices[t * 3] * 3, b = part.indices[t * 3 + 1] * 3, c = part.indices[t * 3 + 2] * 3;
    const ux = part.positions[b] - part.positions[a], uy = part.positions[b + 1] - part.positions[a + 1], uz = part.positions[b + 2] - part.positions[a + 2];
    const vx = part.positions[c] - part.positions[a], vy = part.positions[c + 1] - part.positions[a + 1], vz = part.positions[c + 2] - part.positions[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

/** Keep a seeded subset of leaf cards and grow each kept card around its centroid to compensate lost area.
 *  Cards never share vertices across components (probed: the stylized canopy is 2997 disjoint quads), so
 *  vertices are copied per component — no shared-vertex remapping needed. */
function thinLeafCards(part, keepFraction, maxScale, seed) {
  const components = triangleComponents(part);
  const order = components.map((_, i) => i);
  const random = rng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const keep = new Set(order.slice(0, Math.max(1, Math.round(components.length * keepFraction))));
  const keptArea = components.reduce((sum, triangles, i) => sum + (keep.has(i) ? quadArea(part, triangles) : 0), 0);
  const totalArea = components.reduce((sum, triangles) => sum + quadArea(part, triangles), 0);
  const scale = Math.min(maxScale, Math.sqrt(totalArea / Math.max(1e-9, keptArea)));
  const positions = [], normals = [], uvs = [], indices = [];
  for (const [i, triangles] of components.entries()) {
    if (!keep.has(i)) continue;
    const local = new Map();
    const vertices = new Set(triangles.flatMap(t => [part.indices[t * 3], part.indices[t * 3 + 1], part.indices[t * 3 + 2]]));
    const centroid = [0, 0, 0];
    for (const v of vertices) for (let axis = 0; axis < 3; axis++) centroid[axis] += part.positions[v * 3 + axis] / vertices.size;
    for (const v of vertices) {
      local.set(v, positions.length / 3);
      positions.push((part.positions[v * 3] - centroid[0]) * scale + centroid[0], (part.positions[v * 3 + 1] - centroid[1]) * scale + centroid[1], (part.positions[v * 3 + 2] - centroid[2]) * scale + centroid[2]);
      normals.push(part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]);
      uvs.push(part.uvs[v * 2], part.uvs[v * 2 + 1]);
    }
    for (const t of triangles) for (let corner = 0; corner < 3; corner++) indices.push(local.get(part.indices[t * 3 + corner]));
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

// ---------- atlas + UV remapping ----------

/** Remap UVs into an atlas slot [x, y, w, h] (pixels; y from the top), half-texel inset. frac() keeps wrapped
 *  (tiling) source UVs inside the slot — the single wrap seam on a trunk reads as bark detail. */
function remapUv(part, atlas, [x, y, w, h], wrap = false) {
  const out = new Float32Array(part.uvs.length);
  for (let i = 0; i < part.uvs.length; i += 2) {
    // Leaf/branch cards carry exact 0..1 UVs — frac() would collapse their u=1 edge onto u=0, so it only
    // applies to genuinely tiling slots (the conifer trunk, whose UVs run -0.12..1.12).
    const u = wrap ? part.uvs[i] - Math.floor(part.uvs[i]) : part.uvs[i];
    const v = wrap ? part.uvs[i + 1] - Math.floor(part.uvs[i + 1]) : part.uvs[i + 1];
    out[i] = (x + 0.5 + u * (w - 1)) / atlas.width;
    out[i + 1] = (y + 0.5 + v * (h - 1)) / atlas.height;
  }
  return out;
}

/** All vertices sample one point — used for the stylized tree's flat-colour bark. */
function flatUv(count, atlas, [x, y, w, h]) {
  const u = (x + w / 2) / atlas.width, v = (y + h / 2) / atlas.height, out = new Float32Array(count * 2);
  for (let i = 0; i < out.length; i += 2) { out[i] = u; out[i + 1] = v; }
  return out;
}

/** Per-family atlas: foliage slot 512² (top) + bark slot 128² (bottom); the bush is a single 512² slot. */
async function buildAtlas(family, variant, textures) {
  const { leafSlotPx, barkSlotPx } = PARAMETERS.atlas;
  if (family === 'bush') {
    const tile = downscale(textures.leaves, textures.leaves.width / leafSlotPx);
    brightness(tile, PARAMETERS.bush.baseBrightness);
    hueShift(tile, variant.hueShiftDeg, variant.saturation, variant.lightness);
    return { atlas: tile, leafRect: [0, 0, leafSlotPx, leafSlotPx] };
  }
  const atlas = { width: leafSlotPx, height: leafSlotPx + barkSlotPx, rgba: new Uint8ClampedArray(leafSlotPx * (leafSlotPx + barkSlotPx) * 4) };
  const leafTile = downscale(textures.leaves, textures.leaves.width / leafSlotPx);
  if (family === 'deciduous') hueShift(leafTile, variant.hueShiftDeg, variant.saturation, variant.lightness);
  else { brightness(leafTile, variant.brightness); hueShift(leafTile, variant.hueShiftDeg); }
  blit(atlas, leafTile, 0, 0);
  const barkRect = [0, leafSlotPx, barkSlotPx, barkSlotPx];
  if (family === 'deciduous') {
    // The stylized tree's bark has no texture: bake its glTF linear baseColorFactor into the slot as sRGB.
    const linear = [0.11962991858669911, 0.08170142165793594, 0.08170142165793594];
    const srgb = linear.map(l => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));
    fillRect(atlas, barkRect, [...srgb, 255]);
  } else {
    const barkTile = downscale(textures.bark, textures.bark.width / barkSlotPx);
    brightness(barkTile, PARAMETERS.conifer.trunkBrightness);
    blit(atlas, barkTile, 0, leafSlotPx);
  }
  return { atlas, leafRect: [0, 0, leafSlotPx, leafSlotPx], barkRect };
}

// ---------- GLB writing (one mesh, one primitive, one material + one embedded PNG) ----------

function writeGlb({ positions, normals, uvs, indices, png, alphaCutoff, generator, unlit = false }) {
  const buffers = [
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
    Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
    png,
  ];
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let c = 0; c < 3; c++) {
    minimum[c] = Math.min(minimum[c], positions[i + c]); maximum[c] = Math.max(maximum[c], positions[i + c]);
  }
  let offset = 0;
  const views = buffers.map((buffer, i) => { const view = { buffer: 0, byteOffset: offset, byteLength: buffer.length, ...(i < 4 ? { target: 34962 } : {}) }; offset += buffer.length; return view; });
  const document = {
    asset: { version: '2.0', generator },
    ...(unlit ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'env' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{
      name: 'foliage', alphaMode: 'MASK', alphaCutoff, doubleSided: true,
      ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 },
    }],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/png' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    buffers: [{ byteLength: offset }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: minimum, max: maximum },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: uvs.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const binary = Buffer.concat([...buffers.slice(0, 4).map(pad4), buffers[4]]);
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + jsonPadding.length + 8 + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, jsonHeader, json, jsonPadding, binHeader, binary]), triangles: indices.length / 3 };
}
function pad4(buffer) {
  return Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4)]);
}

// ---------- geometry assembly ----------

/** Merge parts into one primitive, remapping each part's UVs into its atlas slot. */
function mergeParts(parts) {
  const positions = [], normals = [], uvs = [], indices = [];
  let vertexOffset = 0;
  for (const [part, uv] of parts) {
    for (const value of part.positions) positions.push(value);
    for (const value of part.normals) normals.push(value);
    for (const value of uv) uvs.push(value);
    for (const index of part.indices) indices.push(index + vertexOffset);
    vertexOffset += part.positions.length / 3;
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

/** Scale about the origin (y=0 stays the ground): height in Y, canopy clamp + taper in X/Z. */
function scaleGeometry(geometry, sy, sxz) {
  const positions = new Float32Array(geometry.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = geometry.positions[i] * sxz;
    positions[i + 1] = geometry.positions[i + 1] * sy;
    positions[i + 2] = geometry.positions[i + 2] * sxz;
  }
  return { ...geometry, positions };
}

async function buildTree(tree) {
  const family = PARAMETERS[tree.family], variant = family.variants[tree.variant];
  const credits = CREDITS[family.source.replace('.glb', '')];
  const generator = `AI Farm import-trees.mjs (D030, source: ${credits.title} by ${credits.author}, ${credits.license})`;

  if (tree.family === 'deciduous') {
    const config = PARAMETERS.deciduous;
    const scene = await loadScene(config.source);
    const bark = scene.parts.find(part => part.name.startsWith('tree_Bark'));
    const leaves = scene.parts.find(part => part.name.startsWith('Leaves'));
    if (!bark || !leaves) throw new Error('stylized_tree.glb: expected tree_Bark_0 and Leaves meshes');
    for (const part of [bark, leaves]) for (let i = 0; i < part.positions.length; i++) part.positions[i] *= config.unitScale;
    const leafBox = bbox(leaves);
    const canopyWidth = Math.max(leafBox.max[0] - leafBox.min[0], leafBox.max[2] - leafBox.min[2]);
    const sourceHeight = leafBox.max[1];
    const simplifiedBark = { ...bark, indices: (await simplifyTriangles(bark, config.barkTargetTriangles)).indices };
    // Canopy budget: the near cap minus whatever the simplified bark kept, floored so the crown stays readable.
    const leafBudget = Math.max(300, PARAMETERS.triangleCaps.deciduous.near - simplifiedBark.indices.length / 3);
    const keepFraction = Math.min(1, leafBudget / (triangleComponents(leaves).length * 2));
    const thinned = thinLeafCards(leaves, keepFraction, config.cardScaleMax, config.seed + tree.variant);
    const atlasData = await buildAtlas('deciduous', variant, { leaves: decodePng(sourceImage(scene.glb, 0)) });
    const merged = mergeParts([
      [simplifiedBark, flatUv(simplifiedBark.positions.length / 3, atlasData.atlas, atlasData.barkRect)],
      [thinned, remapUv(thinned, atlasData.atlas, atlasData.leafRect)],
    ]);
    const sy = variant.heightM / sourceHeight, sxz = Math.min(sy * variant.taper, config.canopyMaxM / canopyWidth);
    const scaled = scaleGeometry(merged, sy, sxz);
    return {
      near: writeGlb({ ...scaled, png: encodePng(atlasData.atlas.rgba, atlasData.atlas.width, atlasData.atlas.height), alphaCutoff: PARAMETERS.alphaCutoff.deciduous, generator }),
      measured: { sourceHeightM: sourceHeight, canopyWidthM: canopyWidth, sy, sxz, leafQuadsKept: triangleComponents(thinned).length, atlas: `${atlasData.atlas.width}×${atlasData.atlas.height}` },
    };
  }

  if (tree.family === 'conifer') {
    const config = PARAMETERS.conifer;
    const scene = await loadScene(config.source);
    const branch = scene.parts.find(part => part.name.includes('Branch'));
    const trunk = scene.parts.find(part => part.name.includes('lambert'));
    if (!branch || !trunk) throw new Error('fur_tree.glb: expected Branch and lambert meshes');
    const sourceHeight = bbox(trunk).max[1]; // 9.0 m above ground; the buried ~0.5 m is cut away below
    const branchBox = bbox(branch);
    const canopyWidth = Math.max(branchBox.max[0] - branchBox.min[0], branchBox.max[2] - branchBox.min[2]);
    // Cut the below-ground trunk: drop triangles fully below y=0, clamp straddling vertices to the ground.
    const keptTriangles = [], trunkIndices = new Map();
    for (let t = 0; t < trunk.indices.length / 3; t++) {
      const ys = [0, 1, 2].map(c => trunk.positions[trunk.indices[t * 3 + c] * 3 + 1]);
      if (!ys.every(y => y < -0.001)) keptTriangles.push(t);
    }
    const positions = [], normals = [], uvs = [], indices = new Uint32Array(keptTriangles.length * 3);
    keptTriangles.forEach((t, offset) => {
      for (let corner = 0; corner < 3; corner++) {
        const source = trunk.indices[t * 3 + corner];
        if (!trunkIndices.has(source)) {
          const v = source * 3;
          trunkIndices.set(source, positions.length / 3);
          positions.push(trunk.positions[v], Math.max(0, trunk.positions[v + 1]), trunk.positions[v + 2]);
          normals.push(trunk.normals[v], trunk.normals[v + 1], trunk.normals[v + 2]);
          uvs.push(trunk.uvs[source * 2], trunk.uvs[source * 2 + 1]);
        }
        indices[offset * 3 + corner] = trunkIndices.get(source);
      }
    });
    const cutTrunk = { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices };
    const simplifiedBranch = { ...branch, indices: (await simplifyWithUv(branch, config.branchTargetTriangles)).indices };
    const atlasData = await buildAtlas('conifer', variant, { leaves: decodePng(sourceImage(scene.glb, 0)), bark: decodePng(sourceImage(scene.glb, 1)) });
    const merged = mergeParts([
      [simplifiedBranch, remapUv(simplifiedBranch, atlasData.atlas, atlasData.leafRect)],
      [cutTrunk, remapUv(cutTrunk, atlasData.atlas, atlasData.barkRect, true)],
    ]);
    const sy = variant.heightM / sourceHeight, sxz = Math.min(sy * variant.taper, config.canopyMaxM / canopyWidth);
    const scaled = scaleGeometry(merged, sy, sxz);
    return {
      near: writeGlb({ ...scaled, png: encodePng(atlasData.atlas.rgba, atlasData.atlas.width, atlasData.atlas.height), alphaCutoff: PARAMETERS.alphaCutoff.conifer, generator }),
      measured: { sourceHeightM: sourceHeight, canopyWidthM: canopyWidth, sy, sxz, branchTriangles: simplifiedBranch.indices.length / 3, atlas: `${atlasData.atlas.width}×${atlasData.atlas.height}` },
    };
  }

  // bush — keep all 320 triangles, only recolour/rescale. The source model is a botanical sprig on a long
  // stem (all 16 components are near-vertical sprigs around the axis), which reads as a dandelion at game
  // scale — rearrange the sprigs into a dome so the model reads as a shrub (recorded in ASSET_CREDITS.md).
  const config = PARAMETERS.bush;
  const scene = await loadScene(config.source);
  const sprigs = scene.parts[0];
  const random = rng(config.seed);
  const arranged = { positions: [], normals: [], uvs: [], indices: [] };
  triangleComponents(sprigs).forEach((triangles, i) => {
    const vertices = new Set(triangles.flatMap(t => [sprigs.indices[t * 3], sprigs.indices[t * 3 + 1], sprigs.indices[t * 3 + 2]]));
    let centroidX = 0, centroidZ = 0, bottom = Infinity;
    for (const v of vertices) {
      centroidX += sprigs.positions[v * 3] / vertices.size;
      centroidZ += sprigs.positions[v * 3 + 2] / vertices.size;
      bottom = Math.min(bottom, sprigs.positions[v * 3 + 1]);
    }
    const angle = i / 16 * Math.PI * 2 + random() * 0.6, radius = i === 0 ? 0.02 : 0.05 + random() * 0.2, size = 0.9 + random() * 0.5;
    const targetX = Math.cos(angle) * radius, targetZ = Math.sin(angle) * radius;
    const local = new Map();
    for (const v of vertices) {
      local.set(v, arranged.positions.length / 3);
      arranged.positions.push((sprigs.positions[v * 3] - centroidX) * size + targetX, (sprigs.positions[v * 3 + 1] - bottom) * size, (sprigs.positions[v * 3 + 2] - centroidZ) * size + targetZ);
      arranged.normals.push(sprigs.normals[v * 3], sprigs.normals[v * 3 + 1], sprigs.normals[v * 3 + 2]);
      arranged.uvs.push(sprigs.uvs[v * 2], sprigs.uvs[v * 2 + 1]);
    }
    for (const t of triangles) for (let corner = 0; corner < 3; corner++) arranged.indices.push(local.get(sprigs.indices[t * 3 + corner]));
  });
  const bush = { positions: new Float32Array(arranged.positions), normals: new Float32Array(arranged.normals), uvs: new Float32Array(arranged.uvs), indices: new Uint32Array(arranged.indices) };
  const box = bbox(bush);
  const canopyWidth = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]);
  const atlasData = await buildAtlas('bush', variant, { leaves: decodePng(sourceImage(scene.glb, 0)) });
  const merged = mergeParts([[bush, remapUv(bush, atlasData.atlas, atlasData.leafRect)]]);
  const sy = variant.heightM / box.max[1], sxz = Math.min(sy * variant.taper, config.canopyMaxM / canopyWidth);
  const scaled = scaleGeometry(merged, sy, sxz);
  return {
    near: writeGlb({ ...scaled, png: encodePng(atlasData.atlas.rgba, atlasData.atlas.width, atlasData.atlas.height), alphaCutoff: PARAMETERS.alphaCutoff.bush, generator, unlit: true }),
    measured: { sourceHeightM: box.max[1], canopyWidthM: canopyWidth, sy, sxz, atlas: `${atlasData.atlas.width}×${atlasData.atlas.height}` },
  };
}

// ---------- far LOD: billboard atlas captured from the near GLB in headless Chrome (SwiftShader) ----------

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
</head><body><script type="module" src="/page.mjs"></script></body></html>`;

const PAGE_JS = `import { Box3, MeshBasicMaterial, OrthographicCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
document.body.append(renderer.domElement);
window.__capture = async (url, anglesDeg, size, light) => {
  if (!Number.isFinite(light?.elevationDeg)) throw new Error('capture elevationDeg must be a finite number');
  if (!Number.isFinite(light?.margin) || light.margin <= 0) throw new Error('capture margin must be a positive finite number');
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(gltf.scene);
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * light.margin;
  const height = (box.max.y - box.min.y) * light.margin;
  const side = Math.max(width, height);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  // Unlit albedo capture: the game relights billboards, so the pre-rendered texture must carry no lighting.
  gltf.scene.traverse(o => { if (o.isMesh) o.material = new MeshBasicMaterial({ map: o.material.map, alphaTest: o.material.alphaTest, side: o.material.side }); });
  scene.add(gltf.scene);
  // Aim at the trunk axis (model origin), not the canopy centre — offset trunks would double on crossed planes.
  const centre = new Vector3(0, (box.min.y + box.max.y) / 2, 0);
  const camera = new OrthographicCamera(-side / 2, side / 2, side / 2, -side / 2, 0.1, 1000);
  const gl = renderer.getContext();
  const buffer = new Uint8Array(size * size * 4);
  const frames = [];
  for (let frameIndex = 0; frameIndex < anglesDeg.length; frameIndex++) {
    const yawDeg = anglesDeg[frameIndex];
    const frameSide = frameIndex === 3 ? width * 0.74 : side;
    camera.left = -frameSide / 2; camera.right = frameSide / 2; camera.top = frameSide / 2; camera.bottom = -frameSide / 2;
    camera.updateProjectionMatrix();
    const yaw = yawDeg * Math.PI / 180, frameElevation = (light.elevationsDeg?.[frameIndex] ?? light.elevationDeg) * Math.PI / 180;
    camera.position.set(centre.x + Math.sin(yaw) * Math.cos(frameElevation) * 100, centre.y + Math.sin(frameElevation) * 100, centre.z + Math.cos(yaw) * Math.cos(frameElevation) * 100);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, Math.min(i + 0x8000, buffer.length)));
    frames.push(btoa(binary));
  }
  return { frames };
};`;

/** Capture the near model from the configured horizontal angles. gl.readPixels rows start at the BOTTOM, so
 *  the readback is flipped and un-premultiplied (the buffer holds src*alpha over a transparent clear). */
async function captureBillboards(browser, nearBytes, id) {
  const sizePx = id.startsWith('bush_') ? 128 : PARAMETERS.capture.sizePx;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const serve = (body, type = 'application/octet-stream') => { response.writeHead(200, { 'content-type': type }); response.end(body); };
    try {
      if (url.pathname === '/page.html') return serve(PAGE_HTML, 'text/html');
      if (url.pathname === '/page.mjs') return serve(PAGE_JS, 'text/javascript');
      if (url.pathname === '/vendor/three.module.js') return serve(await readFile('node_modules/three/build/three.module.js'), 'text/javascript');
      if (url.pathname === '/vendor/three.core.js') return serve(await readFile('node_modules/three/build/three.core.js'), 'text/javascript');
      if (url.pathname === '/vendor/addons/loaders/GLTFLoader.js') return serve(await readFile('node_modules/three/examples/jsm/loaders/GLTFLoader.js'), 'text/javascript');
      if (url.pathname === '/vendor/addons/utils/BufferGeometryUtils.js') return serve(await readFile('node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'), 'text/javascript');
      if (url.pathname === `/model/${id}.glb`) return serve(nearBytes);
      response.writeHead(404); response.end();
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/page.html`);
    const result = await page.evaluate(async ([modelId, angles, size, light]) => await window.__capture(`/model/${modelId}.glb`, angles, size, light),
      [id, [...PARAMETERS.atlas.farAnglesDeg, 0], sizePx, { ...PARAMETERS.capture, elevationsDeg: [PARAMETERS.capture.elevationDeg, PARAMETERS.capture.elevationDeg, PARAMETERS.capture.elevationDeg, 90] }]);
    await page.close();
    return result.frames.map(b64 => {
      const raw = Buffer.from(b64, 'base64');
      const rgba = new Uint8ClampedArray(raw.length);
      const rowBytes = sizePx * 4;
      for (let y = 0; y < sizePx; y++) for (let x = 0; x < rowBytes; x += 4) {
        const src = (sizePx - 1 - y) * rowBytes + x, dst = y * rowBytes + x; // flip: readPixels origin is bottom-left
        const alpha = raw[src + 3];
        rgba[dst + 3] = alpha;
        if (alpha > 0) {
          rgba[dst] = Math.min(255, raw[src] * 255 / alpha);
          rgba[dst + 1] = Math.min(255, raw[src + 1] * 255 / alpha);
          rgba[dst + 2] = Math.min(255, raw[src + 2] * 255 / alpha);
        }
      }
      return { width: sizePx, height: sizePx, rgba };
    });
  } finally { server.close(); }
}

/** Pack the captured frames into a 2×2 atlas; tile 3 duplicates tile 0 so the sampler never sees an empty tile. */
function packFarAtlas(frames) {
  const tile = frames[0].width, size = tile * 2;
  const atlas = { width: size, height: size, rgba: new Uint8ClampedArray(size * size * 4) };
  frames.forEach((frame, k) => blit(atlas, frame, (k % 2) * tile, Math.floor(k / 2) * tile));
  blit(atlas, frames[3], tile, tile);
  return atlas;
}

function validateFarFrames(id, frames) {
  const coverage = frames.map((frame, tile) => {
    let covered = 0;
    const colors = new Set();
    for (let i = 0; i < frame.rgba.length; i += 4) {
      if (frame.rgba[i + 3] >= 128) {
        covered++;
        colors.add(`${frame.rgba[i]},${frame.rgba[i + 1]},${frame.rgba[i + 2]}`);
      }
    }
    const ratio = covered / (frame.width * frame.height);
    console.log(`  ${id} tile ${tile}: alpha>=128 ${(ratio * 100).toFixed(1)}%`);
    if (ratio < 0.1 || ratio > 0.8 || colors.size < 2) {
      throw new Error(`${id} tile ${tile}: invalid billboard coverage ${(ratio * 100).toFixed(1)}%, colors=${colors.size}`);
    }
    return ratio;
  });
  return coverage;
}

function validateFarPng(id, png) {
  if (png.length < 8 * 1024) throw new Error(`${id}_far atlas PNG is too small: ${png.length} bytes (< 8192)`);
  const { width, rgba } = decodePng(png);
  const tileSize = id.startsWith('bush_') ? 128 : PARAMETERS.capture.sizePx;
  const tiles = [];
  for (let tile = 0; tile < 4; tile++) {
    const frame = { width: tileSize, height: tileSize, rgba: new Uint8ClampedArray(tileSize * tileSize * 4) };
    const x0 = (tile % 2) * tileSize, y0 = Math.floor(tile / 2) * tileSize;
    for (let y = 0; y < tileSize; y++) {
      const src = ((y0 + y) * width + x0) * 4;
      frame.rgba.set(rgba.subarray(src, src + tileSize * 4), y * tileSize * 4);
    }
    tiles.push(frame);
  }
  return validateFarFrames(id, tiles);
}

/** 3 crossed planes (60° apart), each UV-mapped to one captured view; bottom edge at y=0.
 *  Atlas rows run top-down (flipY=false), so a tile's top edge is at v = row*0.5 and the plane's TOP vertex
 *  samples the capture's top (canopy). */
function farGeometry(side, canopyWidth, tileSize) {
  const planes = PARAMETERS.atlas.farAnglesDeg.length;
  const inset = 1 / tileSize / 2; // half a capture texel
  const positions = [], normals = [], uvs = [], indices = [];
  for (let k = 0; k < planes; k++) {
    const angle = k * Math.PI / planes, cos = Math.cos(angle), sin = Math.sin(angle);
    const col = k % 2, row = Math.floor(k / 2);
    const u0 = col * 0.5 + inset, u1 = col * 0.5 + 0.5 - inset;
    const vTop = row * 0.5 + inset, vBottom = row * 0.5 + 0.5 - inset;
    const base = positions.length / 3;
    for (const [x, y, u, v] of [[-side / 2, 0, u0, vBottom], [side / 2, 0, u1, vBottom], [side / 2, side, u1, vTop], [-side / 2, side, u0, vTop]]) {
      positions.push(x * cos, y, x * sin);
      normals.push(sin, 0, cos);
      uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const top = positions.length / 3, y = side * 0.62, half = canopyWidth / 2;
  for (const [x, z, u, v] of [[-half, -half, 0.5 + inset, 0.5 + inset], [half, -half, 1 - inset, 0.5 + inset], [half, half, 1 - inset, 1 - inset], [-half, half, 0.5 + inset, 1 - inset]]) {
    positions.push(x, y, z); normals.push(0, 1, 0); uvs.push(u, v);
  }
  indices.push(top, top + 1, top + 2, top, top + 2, top + 3);
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

// ---------- driver ----------

function outDir(tree) { return tree.family === 'conifer' ? OUT_CC_BY_SA : OUT_CC_BY; }

async function buildAll() {
  if (!existsSync(join(process.cwd(), SRC_DIR))) return { skipped: true };
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-angle=swiftshader', '--disable-gpu', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
  const outputs = [];
  const config = {
    generatedBy: 'scripts/import-trees.mjs', parameters: PARAMETERS, credits: CREDITS, models: {},
    coniferLicense: 'CC-BY-SA-4.0', coniferLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    note: 'Billboard captures render in headless Chrome on SwiftShader; a Chrome update can shift pixels — re-run the import to refresh byte-identical outputs.',
  };
  try {
    for (const tree of TREES) {
      const family = PARAMETERS[tree.family];
      const built = await buildTree(tree);
      const farFrames = await captureBillboards(browser, built.near.bytes, tree.id);
      validateFarFrames(tree.id, farFrames);
      const farAtlas = packFarAtlas(farFrames);
      // The capture fits the model into a square of this side length, so the billboard plane matches it 1:1.
      const farSide = Math.max(built.measured.canopyWidthM * built.measured.sxz, built.measured.sourceHeightM * built.measured.sy) * PARAMETERS.capture.margin;
      if (tree.family === 'bush') for (let i = 0; i < farAtlas.rgba.length; i += 4) {
        farAtlas.rgba[i] = Math.round(farAtlas.rgba[i] / 32) * 32;
        farAtlas.rgba[i + 1] = Math.round(farAtlas.rgba[i + 1] / 32) * 32;
        farAtlas.rgba[i + 2] = Math.round(farAtlas.rgba[i + 2] / 32) * 32;
      }
      const farPng = encodePng(farAtlas.rgba, farAtlas.width, farAtlas.height, true);
      validateFarPng(tree.id, farPng);
      const far = writeGlb({ ...farGeometry(farSide, built.measured.canopyWidthM * built.measured.sxz, farFrames[0].width), png: farPng, alphaCutoff: PARAMETERS.alphaCutoff.far, generator: built.near.generator, unlit: tree.family === 'bush' });
      const caps = PARAMETERS.triangleCaps[tree.family];
      if (built.near.triangles > caps.near) throw new Error(`${tree.id}: ${built.near.triangles} near triangles exceed the ${caps.near} cap`);
      if (far.triangles > caps.far) throw new Error(`${tree.id}: ${far.triangles} far triangles exceed the ${caps.far} cap`);
      config.models[tree.id] = {
        family: tree.family, variant: tree.variant,
        source: family.source, ...CREDITS[family.source.replace('.glb', '')],
        heightM: family.variants[tree.variant].heightM,
        canopyWidthM: +(built.measured.canopyWidthM * built.measured.sxz).toFixed(3),
        nearTriangles: built.near.triangles, nearBytes: built.near.bytes.length,
        farTriangles: far.triangles, farBytes: far.bytes.length,
        farSideM: +farSide.toFixed(3), atlas: built.measured.atlas,
        ...(built.measured.leafQuadsKept !== undefined ? { leafQuadsKept: built.measured.leafQuadsKept } : {}),
        ...(built.measured.branchTriangles !== undefined ? { branchTriangles: built.measured.branchTriangles } : {}),
        file: `${outDir(tree)}/${tree.id}.glb`, farFile: `${outDir(tree)}/${tree.id}_far.glb`,
      };
      outputs.push([`${outDir(tree)}/${tree.id}.glb`, built.near.bytes], [`${outDir(tree)}/${tree.id}_far.glb`, far.bytes]);
      console.log(`${tree.id.padEnd(18)} near ${String(built.near.triangles).padStart(4)}/${caps.near} tris ${Math.round(built.near.bytes.length / 1024)} KB · far ${far.triangles} tris ${Math.round(far.bytes.length / 1024)} KB · ${(built.measured.sourceHeightM * built.measured.sy).toFixed(2)} m tall · canopy ${config.models[tree.id].canopyWidthM} m`);
    }
  } finally { await browser.close(); }
  return { skipped: false, config, outputs };
}

const LICENSE_MD = `# env-by-sa — CC-BY-SA derivatives

The conifer models in this directory are modified derivatives of:

- **"Fur Tree"** by Harri Jones — https://sketchfab.com/3d-models/fur-tree-41fa3210e50944eaa489c148e5e2ccc7
- Licensed under **Creative Commons Attribution-ShareAlike 4.0 International** (CC-BY-SA-4.0):
  https://creativecommons.org/licenses/by-sa/4.0/

Modifications (AI Farm, D030, by scripts/import-trees.mjs): PBR material converted from
KHR_materials_pbrSpecularGlossiness to metal-rough, textures downsampled into one atlas and brightened,
the below-ground trunk section removed, the mesh simplified, four height/taper/colour variants generated,
plus a crossed-plane billboard far LOD rendered from the near model.

The modified models in this directory are therefore redistributed under **CC-BY-SA 4.0**, with credit to
the original author, and carry no additional restrictions.
`;

if (CHECK && !existsSync(join(process.cwd(), SRC_DIR))) {
  console.log('Nguồn vắng mặt (map/tree không được commit) — bỏ qua kiểm tra import cây, thoát 0.');
  process.exit(0);
}
const result = await buildAll();
if (result.skipped) { console.log('Nguồn vắng mặt (map/tree không được commit) — bỏ qua import cây, thoát 0.'); process.exit(0); }
const configBytes = Buffer.from(`${JSON.stringify(result.config, null, 2)}\n`);
if (CHECK) {
  let drifted = 0;
  for (const [file, bytes] of result.outputs) {
    let existing;
    try { existing = await readFile(join(process.cwd(), file)); } catch { existing = null; }
    if (!existing || !existing.equals(bytes)) { console.error(`DRIFT ${file}${existing ? ` (${existing.length} → ${bytes.length} bytes)` : ' (missing)'}`); drifted++; }
  }
  for (const [file, bytes] of [[CONFIG_PATH, configBytes], [`${OUT_CC_BY_SA}/LICENSE.md`, Buffer.from(LICENSE_MD)]]) {
    let existing;
    try { existing = await readFile(join(process.cwd(), file)); } catch { existing = null; }
    if (!existing || !existing.equals(bytes)) { console.error(`DRIFT ${file}`); drifted++; }
  }
  if (drifted) { console.error(`--check FAILED: ${drifted} file(s) would change; re-run without --check to refresh.`); process.exit(1); }
  console.log('--check PASS: 12 near + 12 far tree/bush GLBs + config + LICENSE are deterministic.');
} else {
  await mkdir(OUT_CC_BY, { recursive: true });
  await mkdir(OUT_CC_BY_SA, { recursive: true });
  await writeFile(CONFIG_PATH, configBytes);
  await writeFile(`${OUT_CC_BY_SA}/LICENSE.md`, LICENSE_MD);
  for (const [file, bytes] of result.outputs) await writeFile(join(process.cwd(), file), bytes);
  console.log(`Imported ${TREES.length} near + ${TREES.length} far tree/bush models; parameters and measurements in ${CONFIG_PATH}.`);
}
