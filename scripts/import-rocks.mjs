// D032: turn the reviewed Stone Pack source into six game-ready, textured rock GLBs.
// Source files are intentionally not committed. `--check` rebuilds in memory and byte-compares outputs.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const CHECK = process.argv.includes('--check');
const SOURCE_FILE = 'map/hon_da/stone_pack.glb';
const OUT_DIR = 'apps/web/public/assets/models/env';
const CONFIG_PATH = 'scripts/rocks.config.json';

const CREDITS = {
  title: 'Stone Pack',
  author: 'ashkan.fancy',
  license: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  url: 'https://sketchfab.com/3d-models/stone-pack-f3e0a67b9ca243b09119177649f21e17',
};

// Tone: the source chroma is pulled toward the warm-grey ground rock tint (`chroma` keeps that share of the
// source's own colour; the small-rock highlights read pink otherwise), then a gain lifts the AO-darkened texture
// and a soft shoulder rolls highlights off toward `ceiling` instead of clipping them. A plain multiplier cannot
// reach the target mean without clipping: the large-rock paint is high-contrast (~26% clipped at the old ×2.6).
const PARAMETERS = {
  triangleCaps: { rock: 300, rock_large: 1000 },
  footprintM: { rock: 2, rock_large: 4 },
  footprintMargin: { rock: 0.8, rock_large: 0.88 },
  targetMaxHorizontalM: { rock: 1.4, rock_large: 3.5 },
  sink: { heightFraction: 0.05, maxM: 0.08 },
  texture: { rockPx: 256, rockLargePx: 512, quantizer: { method: 'median-cut', colors: { rock: 256, rock_large: 64 } } },
  tone: {
    tint: '#8e877a', // GROUND.rock in apps/web/src/game/render/groundPalette.ts
    rock: { chroma: 0.35, gain: 1.6, knee: 0.8, ceiling: 0.95 },
    rock_large: { chroma: 0.35, gain: 1.75, knee: 0.7, ceiling: 0.9 },
  },
  simplify: { initialError: 0.001, uvWeight: 0.5 },
};

const ROCKS = [
  { id: 'rock_01', sourceMesh: 'Small_1', family: 'rock' },
  { id: 'rock_02', sourceMesh: 'Small_2', family: 'rock' },
  { id: 'rock_03', sourceMesh: 'Small_3', family: 'rock' },
  { id: 'rock_04', sourceMesh: 'Small_4', family: 'rock' },
  { id: 'rock_large_01', sourceMesh: 'Mid_1', family: 'rock_large' },
  { id: 'rock_large_02', sourceMesh: 'Mid_2', family: 'rock_large' },
];

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pad4(bytes) {
  return Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4)]);
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
  if (Math.abs(determinant) < 1e-12) throw new Error('Selected source node has a singular world matrix');
  const inv00 = (a11 * a22 - a12 * a21) / determinant;
  const inv01 = (a02 * a21 - a01 * a22) / determinant;
  const inv02 = (a01 * a12 - a02 * a11) / determinant;
  const inv10 = (a12 * a20 - a10 * a22) / determinant;
  const inv11 = (a00 * a22 - a02 * a20) / determinant;
  const inv12 = (a02 * a10 - a00 * a12) / determinant;
  const inv20 = (a10 * a21 - a11 * a20) / determinant;
  const inv21 = (a01 * a20 - a00 * a21) / determinant;
  const inv22 = (a00 * a11 - a01 * a10) / determinant;
  // (M^-1)^T, stored in the same column-major layout used by the position transform below.
  return [inv00, inv01, inv02, inv10, inv11, inv12, inv20, inv21, inv22];
}

function transformGeometry(json, binary, primitive, matrix) {
  if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('Only triangle primitives are supported');
  const positions = readAccessor(json, binary, primitive.attributes.POSITION);
  const inputNormals = primitive.attributes.NORMAL === undefined ? null : readAccessor(json, binary, primitive.attributes.NORMAL);
  const uvs = primitive.attributes.TEXCOORD_0 === undefined ? null : readAccessor(json, binary, primitive.attributes.TEXCOORD_0);
  if (!uvs) throw new Error('Rock source is missing TEXCOORD_0');
  const inputIndices = primitive.indices === undefined ? null : readAccessor(json, binary, primitive.indices);
  const indices = new Uint32Array(inputIndices ? inputIndices.length : positions.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = inputIndices ? inputIndices[i] : i;
  const transformed = new Float32Array(positions.length), normals = new Float32Array(positions.length);
  const normal = normalMatrix(matrix);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const offset = vertex * 3, x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
    transformed[offset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    transformed[offset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    transformed[offset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    const nx = inputNormals ? inputNormals[offset] : 0, ny = inputNormals ? inputNormals[offset + 1] : 1, nz = inputNormals ? inputNormals[offset + 2] : 0;
    const tx = normal[0] * nx + normal[3] * ny + normal[6] * nz;
    const ty = normal[1] * nx + normal[4] * ny + normal[7] * nz;
    const tz = normal[2] * nx + normal[5] * ny + normal[8] * nz;
    const length = Math.hypot(tx, ty, tz) || 1;
    normals[offset] = tx / length; normals[offset + 1] = ty / length; normals[offset + 2] = tz / length;
  }
  return { positions: transformed, normals, uvs: new Float32Array(uvs), indices, material: primitive.material ?? 0 };
}

function selectedPrimitive(json, binary, sourceMesh) {
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const matches = [];
  const visit = (nodeIndex, parentMatrix, selected) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`Missing node ${nodeIndex}`);
    const isSelected = selected || node.name === sourceMesh;
    const world = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined && isSelected) {
      const mesh = json.meshes?.[node.mesh];
      if (!mesh || mesh.primitives?.length !== 1) throw new Error(`${sourceMesh}: expected one source mesh primitive`);
      matches.push(transformGeometry(json, binary, mesh.primitives[0], world));
    }
    for (const child of node.children ?? []) visit(child, world, isSelected);
  };
  for (const root of roots) visit(root, identity(), false);
  if (matches.length !== 1) throw new Error(`${sourceMesh}: expected exactly one mesh below the named parent node, found ${matches.length}`);
  return matches[0];
}

function sourceImage(parsed, textureIndex) {
  const texture = parsed.json.textures?.[textureIndex];
  const image = parsed.json.images?.[texture?.source];
  const view = parsed.json.bufferViews?.[image?.bufferView];
  if (!texture || !image || !view || image.mimeType !== 'image/png') throw new Error(`Texture ${textureIndex}: expected embedded PNG`);
  return parsed.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

function materialTextures(parsed, materialIndex) {
  const material = parsed.json.materials?.[materialIndex];
  const base = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  const orm = material?.occlusionTexture?.index ?? material?.pbrMetallicRoughness?.metallicRoughnessTexture?.index;
  if (base === undefined || orm === undefined) throw new Error(`Material ${materialIndex}: expected baseColor and ORM textures`);
  return { base: sourceImage(parsed, base), orm: sourceImage(parsed, orm) };
}

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
  return { width, height, rgba };
}

const LUMA = [0.2126, 0.7152, 0.0722];

/** Linear up to `knee`, then an exponential roll-off that approaches `ceiling` with slope 1 at the knee. */
function shoulder(value, knee, ceiling) {
  return value <= knee ? value : knee + (ceiling - knee) * (1 - Math.exp(-(value - knee) / (ceiling - knee)));
}

function compositeTexture(base, orm, tone) {
  if (base.width !== orm.width || base.height !== orm.height) throw new Error('baseColor and ORM texture sizes differ');
  const tint = [1, 3, 5].map(at => parseInt(PARAMETERS.tone.tint.slice(at, at + 2), 16) / 255);
  const tintLuma = tint[0] * LUMA[0] + tint[1] * LUMA[1] + tint[2] * LUMA[2];
  const rgba = new Uint8ClampedArray(base.rgba.length);
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    const ao = orm.rgba[pixel] / 255;
    const color = [0, 1, 2].map(channel => base.rgba[pixel + channel] / 255 * ao);
    const luma = color[0] * LUMA[0] + color[1] * LUMA[1] + color[2] * LUMA[2];
    for (let channel = 0; channel < 3; channel++) {
      const tinted = luma * tint[channel] / tintLuma + (color[channel] - luma) * tone.chroma;
      rgba[pixel + channel] = Math.round(255 * Math.max(0, shoulder(tinted * tone.gain, tone.knee, tone.ceiling)));
    }
    rgba[pixel + 3] = base.rgba[pixel + 3];
  }
  return { width: base.width, height: base.height, rgba };
}

function downscale(image, targetSize) {
  if (image.width !== image.height || image.width % targetSize) throw new Error(`Cannot deterministically resize ${image.width}x${image.height} to ${targetSize}`);
  const factor = image.width / targetSize;
  if (factor === 1) return image;
  const rgba = new Uint8ClampedArray(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y++) for (let x = 0; x < targetSize; x++) {
    let red = 0, green = 0, blue = 0, alpha = 0;
    for (let yy = 0; yy < factor; yy++) for (let xx = 0; xx < factor; xx++) {
      const offset = ((y * factor + yy) * image.width + x * factor + xx) * 4, a = image.rgba[offset + 3];
      red += image.rgba[offset] * a; green += image.rgba[offset + 1] * a; blue += image.rgba[offset + 2] * a; alpha += a;
    }
    const at = (y * targetSize + x) * 4, count = factor * factor;
    if (alpha) { rgba[at] = Math.round(red / alpha); rgba[at + 1] = Math.round(green / alpha); rgba[at + 2] = Math.round(blue / alpha); }
    rgba[at + 3] = Math.round(alpha / count);
  }
  return { width: targetSize, height: targetSize, rgba };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write(type, 4, 'ascii'); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function medianCutPalette(image, maxColors) {
  const colorsByKey = new Map();
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const offset = pixel * 4, alpha = image.rgba[offset + 3];
    if (!alpha) continue;
    const red = image.rgba[offset], green = image.rgba[offset + 1], blue = image.rgba[offset + 2];
    const key = (red << 16) | (green << 8) | blue;
    const color = colorsByKey.get(key);
    if (color) color.weight += alpha;
    else colorsByKey.set(key, { key, red, green, blue, weight: alpha });
  }
  const box = colors => {
    let weight = 0, minRed = 255, minGreen = 255, minBlue = 255, maxRed = 0, maxGreen = 0, maxBlue = 0;
    for (const color of colors) {
      weight += color.weight;
      minRed = Math.min(minRed, color.red); minGreen = Math.min(minGreen, color.green); minBlue = Math.min(minBlue, color.blue);
      maxRed = Math.max(maxRed, color.red); maxGreen = Math.max(maxGreen, color.green); maxBlue = Math.max(maxBlue, color.blue);
    }
    return { colors, weight, ranges: [maxRed - minRed, maxGreen - minGreen, maxBlue - minBlue] };
  };
  const boxes = [box([...colorsByKey.values()])];
  while (boxes.length < maxColors) {
    let selected = -1, selectedScore = -1;
    for (let index = 0; index < boxes.length; index++) {
      const candidate = boxes[index], range = Math.max(...candidate.ranges), score = range * candidate.weight;
      if (candidate.colors.length > 1 && score > selectedScore) { selected = index; selectedScore = score; }
    }
    if (selected < 0) break;
    const candidate = boxes[selected], channel = candidate.ranges.indexOf(Math.max(...candidate.ranges));
    const colors = [...candidate.colors].sort((a, b) => a[['red', 'green', 'blue'][channel]] - b[['red', 'green', 'blue'][channel]]
      || a.red - b.red || a.green - b.green || a.blue - b.blue);
    let accumulated = 0, split = 0;
    while (split < colors.length - 1 && accumulated + colors[split].weight < candidate.weight / 2) accumulated += colors[split++].weight;
    boxes.splice(selected, 1, box(colors.slice(0, split + 1)), box(colors.slice(split + 1)));
  }
  const entries = boxes.map(candidate => {
    let red = 0, green = 0, blue = 0;
    for (const color of candidate.colors) { red += color.red * color.weight; green += color.green * color.weight; blue += color.blue * color.weight; }
    return { ...candidate, red: Math.round(red / candidate.weight), green: Math.round(green / candidate.weight), blue: Math.round(blue / candidate.weight) };
  }).sort((a, b) => {
    const luminance = color => color.red * 54 + color.green * 183 + color.blue * 19;
    return luminance(a) - luminance(b) || a.red - b.red || a.green - b.green || a.blue - b.blue;
  });
  const indices = new Map();
  for (let index = 0; index < entries.length; index++) for (const color of entries[index].colors) indices.set(color.key, index);
  return { entries, indices };
}

function indexedPng(image, colors) {
  const { entries, indices } = medianCutPalette(image, colors);
  const palette = Buffer.alloc(entries.length * 3), indexed = Buffer.alloc(image.width * image.height);
  for (let index = 0; index < entries.length; index++) {
    const offset = index * 3, color = entries[index];
    palette[offset] = color.red; palette[offset + 1] = color.green; palette[offset + 2] = color.blue;
  }
  for (let pixel = 0; pixel < indexed.length; pixel++) {
    const offset = pixel * 4, key = (image.rgba[offset] << 16) | (image.rgba[offset + 1] << 8) | image.rgba[offset + 2];
    indexed[pixel] = indices.get(key) ?? 0;
  }
  const rows = Buffer.alloc((image.width + 1) * image.height);
  const signedCost = value => value < 128 ? value : 256 - value;
  for (let y = 0; y < image.height; y++) {
    const source = indexed.subarray(y * image.width, (y + 1) * image.width);
    const up = y ? indexed.subarray((y - 1) * image.width, y * image.width) : null;
    let best = null;
    for (let filter = 0; filter <= 4; filter++) {
      const row = Buffer.alloc(image.width); let cost = 0;
      for (let x = 0; x < image.width; x++) {
        const left = x ? source[x - 1] : 0, above = up ? up[x] : 0, upperLeft = up && x ? up[x - 1] : 0;
        const p = left + above - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - above), pc = Math.abs(p - upperLeft);
        const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        const value = (source[x] - predictor) & 255;
        row[x] = value; cost += signedCost(value);
      }
      if (!best || cost < best.cost) best = { filter, row, cost };
    }
    rows[y * (image.width + 1)] = best.filter;
    best.row.copy(rows, y * (image.width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; ihdr[9] = 3;
  return { bytes: Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('PLTE', palette), pngChunk('IDAT', deflateSync(rows, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]), paletteColors: entries.length };
}

function weld(geometry) {
  const vertexByAttributes = new Map(), positions = [], normals = [], uvs = [], indices = [];
  for (const sourceIndex of geometry.indices) {
    const position = sourceIndex * 3, uv = sourceIndex * 2;
    const key = [
      Math.round(geometry.positions[position] * 1e6), Math.round(geometry.positions[position + 1] * 1e6), Math.round(geometry.positions[position + 2] * 1e6),
      Math.round(geometry.normals[position] * 1e6), Math.round(geometry.normals[position + 1] * 1e6), Math.round(geometry.normals[position + 2] * 1e6),
      Math.round(geometry.uvs[uv] * 1e6), Math.round(geometry.uvs[uv + 1] * 1e6),
    ].join(',');
    let targetIndex = vertexByAttributes.get(key);
    if (targetIndex === undefined) {
      targetIndex = positions.length / 3;
      vertexByAttributes.set(key, targetIndex);
      positions.push(geometry.positions[position], geometry.positions[position + 1], geometry.positions[position + 2]);
      normals.push(geometry.normals[position], geometry.normals[position + 1], geometry.normals[position + 2]);
      uvs.push(geometry.uvs[uv], geometry.uvs[uv + 1]);
    }
    indices.push(targetIndex);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
}

let simplifier;
async function simplify(geometry, cap) {
  if (geometry.indices.length / 3 <= cap) return { indices: geometry.indices, error: 0 };
  simplifier ??= (await import('meshoptimizer/simplifier')).MeshoptSimplifier;
  await simplifier.ready;
  const attributes = new Float32Array(geometry.positions.length / 3 * 2);
  for (let vertex = 0; vertex < geometry.positions.length / 3; vertex++) {
    attributes[vertex * 2] = geometry.uvs[vertex * 2];
    attributes[vertex * 2 + 1] = geometry.uvs[vertex * 2 + 1];
  }
  let best = null;
  for (let error = PARAMETERS.simplify.initialError; error <= 1; error *= 2) {
    for (const flags of [['LockBorder'], ['LockBorder', 'Permissive'], []]) {
      const [indices] = simplifier.simplifyWithAttributes(
        geometry.indices, geometry.positions, 3, attributes, 2, [PARAMETERS.simplify.uvWeight, PARAMETERS.simplify.uvWeight], null, cap * 3, error, flags,
      );
      if (indices.length / 3 <= cap) return { indices, error };
      if (!best || indices.length < best.indices.length) best = { indices, error };
    }
  }
  if (!best) throw new Error('meshoptimizer returned no candidate');
  if (best.indices.length / 3 > cap) throw new Error(`meshoptimizer could not reach ${cap} triangles (best ${best.indices.length / 3})`);
  return best;
}

function referencedBounds(positions, indices) {
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const index of indices) for (let axis = 0; axis < 3; axis++) {
    const value = positions[index * 3 + axis];
    minimum[axis] = Math.min(minimum[axis], value); maximum[axis] = Math.max(maximum[axis], value);
  }
  return { min: minimum, max: maximum };
}

function compactAndFit(geometry, simplified, family) {
  const sourceBounds = referencedBounds(geometry.positions, geometry.indices);
  const sourceWidth = sourceBounds.max[0] - sourceBounds.min[0], sourceDepth = sourceBounds.max[2] - sourceBounds.min[2];
  const sourceHorizontal = Math.max(sourceWidth, sourceDepth);
  if (!(sourceHorizontal > 0)) throw new Error('Source mesh has no horizontal extent');
  const scale = PARAMETERS.targetMaxHorizontalM[family] / sourceHorizontal;
  const centerX = (sourceBounds.min[0] + sourceBounds.max[0]) / 2, centerZ = (sourceBounds.min[2] + sourceBounds.max[2]) / 2;
  const sourceHeight = sourceBounds.max[1] - sourceBounds.min[1];
  const sink = Math.min(PARAMETERS.sink.maxM, sourceHeight * scale * PARAMETERS.sink.heightFraction);
  const remap = new Map(), positions = [], normals = [], uvs = [], indices = [];
  for (const sourceIndex of simplified.indices) {
    let targetIndex = remap.get(sourceIndex);
    if (targetIndex === undefined) {
      targetIndex = positions.length / 3; remap.set(sourceIndex, targetIndex);
      const position = sourceIndex * 3, uv = sourceIndex * 2;
      positions.push(
        (geometry.positions[position] - centerX) * scale,
        (geometry.positions[position + 1] - sourceBounds.min[1]) * scale - sink,
        (geometry.positions[position + 2] - centerZ) * scale,
      );
      normals.push(geometry.normals[position], geometry.normals[position + 1], geometry.normals[position + 2]);
      uvs.push(geometry.uvs[uv], geometry.uvs[uv + 1]);
    }
    indices.push(targetIndex);
  }
  const result = { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) };
  const bounds = referencedBounds(result.positions, result.indices);
  const limit = PARAMETERS.footprintM[family] * PARAMETERS.footprintMargin[family];
  if (bounds.max[0] - bounds.min[0] > limit + 1e-6 || bounds.max[2] - bounds.min[2] > limit + 1e-6) throw new Error(`Fitted ${family} exceeds its ${limit} m footprint margin`);
  return { geometry: result, bounds, scale, sink, sourceBounds };
}

function round(value) {
  return +value.toFixed(6);
}

function writeGlb(geometry, png, generator) {
  const indices = geometry.positions.length / 3 <= 65535 ? Uint16Array.from(geometry.indices) : geometry.indices;
  const buffers = [
    Buffer.from(geometry.positions.buffer, geometry.positions.byteOffset, geometry.positions.byteLength),
    Buffer.from(geometry.normals.buffer, geometry.normals.byteOffset, geometry.normals.byteLength),
    Buffer.from(geometry.uvs.buffer, geometry.uvs.byteOffset, geometry.uvs.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength),
    png,
  ];
  let byteOffset = 0;
  const bufferViews = buffers.map((buffer, index) => {
    const view = { buffer: 0, byteOffset, byteLength: buffer.length, ...(index < 3 ? { target: 34962 } : index === 3 ? { target: 34963 } : {}) };
    byteOffset += buffer.length + (4 - buffer.length % 4) % 4;
    return view;
  });
  const bounds = referencedBounds(geometry.positions, geometry.indices);
  const document = {
    asset: { version: '2.0', generator },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'rock', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{ name: 'stone', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 } }],
    textures: [{ sampler: 0, source: 0 }], images: [{ bufferView: 4, mimeType: 'image/png' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    buffers: [{ byteLength: byteOffset }], bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: geometry.positions.length / 3, type: 'VEC3', min: bounds.min, max: bounds.max },
      { bufferView: 1, componentType: 5126, count: geometry.normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: geometry.uvs.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: indices instanceof Uint16Array ? 5123 : 5125, count: indices.length, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document)), jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const binary = Buffer.concat(buffers.map(pad4));
  const header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + jsonPadding.length + 8 + binary.length, 8);
  jsonHeader.writeUInt32LE(json.length + jsonPadding.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return { bytes: Buffer.concat([header, jsonHeader, json, jsonPadding, binaryHeader, binary]), triangles: geometry.indices.length / 3, bounds };
}

async function buildAll() {
  const parsed = parseGlb(await readFile(join(process.cwd(), SOURCE_FILE)));
  const outputs = [], config = {
    generatedBy: 'scripts/import-rocks.mjs', source: SOURCE_FILE, parameters: PARAMETERS, credits: CREDITS, models: {},
  };
  for (const rock of ROCKS) {
    const source = selectedPrimitive(parsed.json, parsed.binary, rock.sourceMesh);
    const welded = weld(source), cap = PARAMETERS.triangleCaps[rock.family];
    const simplified = await simplify(welded, cap);
    const fitted = compactAndFit(welded, simplified, rock.family);
    const textureSize = rock.family === 'rock' ? PARAMETERS.texture.rockPx : PARAMETERS.texture.rockLargePx;
    const { base, orm } = materialTextures(parsed, source.material);
    const texture = indexedPng(downscale(compositeTexture(decodePng(base), decodePng(orm), PARAMETERS.tone[rock.family]), textureSize),
      PARAMETERS.texture.quantizer.colors[rock.family]);
    const glb = writeGlb(fitted.geometry, texture.bytes, `Xay Nha import-rocks.mjs (D032, source: ${CREDITS.title} by ${CREDITS.author}, ${CREDITS.license})`);
    if (glb.triangles > cap) throw new Error(`${rock.id}: ${glb.triangles} triangles exceed ${cap}`);
    if (glb.bytes.length >= 150 * 1024) throw new Error(`${rock.id}: ${glb.bytes.length} bytes exceeds the 150 KB asset budget`);
    const file = `${OUT_DIR}/${rock.id}.glb`;
    config.models[rock.id] = {
      file, sourceMesh: rock.sourceMesh, family: rock.family, triangles: glb.triangles, triangleCap: cap,
      bounds: { min: glb.bounds.min.map(round), max: glb.bounds.max.map(round) },
      scale: round(fitted.scale), sink: round(fitted.sink), tone: { tint: PARAMETERS.tone.tint, ...PARAMETERS.tone[rock.family] },
      texture: { width: textureSize, height: textureSize, bytes: texture.bytes.length, paletteColors: texture.paletteColors }, bytes: glb.bytes.length,
      simplifyError: simplified.error, sourceBounds: { min: fitted.sourceBounds.min.map(round), max: fitted.sourceBounds.max.map(round) },
    };
    outputs.push({ id: rock.id, file, bytes: glb.bytes });
  }
  return { outputs, config };
}

if (!existsSync(join(process.cwd(), SOURCE_FILE))) {
  console.log('Rock source is absent (map/hon_da is not committed); skipping D032 import check.');
  process.exit(0);
}

const { outputs, config } = await buildAll();
const configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
if (CHECK) {
  let drifted = 0;
  for (const output of outputs) {
    let existing = null;
    try { existing = await readFile(join(process.cwd(), output.file)); } catch { /* reported below */ }
    if (!existing || !existing.equals(output.bytes)) { console.error(`DRIFT ${output.file}${existing ? ` (${existing.length} -> ${output.bytes.length} bytes)` : ' (missing)'}`); drifted++; }
  }
  let existingConfig = null;
  try { existingConfig = await readFile(join(process.cwd(), CONFIG_PATH)); } catch { /* reported below */ }
  if (!existingConfig || !existingConfig.equals(configBytes)) { console.error(`DRIFT ${CONFIG_PATH}${existingConfig ? '' : ' (missing)'}`); drifted++; }
  if (drifted) { console.error(`--check FAILED: ${drifted} file(s) would change; re-run without --check.`); process.exit(1); }
  console.log(`--check PASS: ${outputs.length} D032 rocks + config are deterministic.`);
} else {
  await mkdir(join(process.cwd(), OUT_DIR), { recursive: true });
  await writeFile(join(process.cwd(), CONFIG_PATH), configBytes);
  for (const output of outputs) await writeFile(join(process.cwd(), output.file), output.bytes);
  console.log(`Imported ${outputs.length} D032 rocks into ${OUT_DIR}:`);
  for (const rock of ROCKS) {
    const model = config.models[rock.id];
    console.log(`  ${rock.id.padEnd(15)} ${String(model.triangles).padStart(4)}/${model.triangleCap} tris  ${Math.round(model.bytes / 1024)} KB  ${model.sourceMesh}`);
  }
}
