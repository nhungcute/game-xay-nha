// Re-bake a heavy, texture-mapped scene onto a low-poly proxy mesh with a fresh single-image atlas.
//
// Why: a 300k-triangle scene whose 8192x8192 texture is a patchwork of tiny UV islands cannot be simplified with the
// source UVs (collapsing across island borders smears unrelated texels, the D038 Citadel failure). Instead the
// geometry is simplified position-only, the proxy is unwrapped into planar charts, and each chart texel is baked by
// casting a ray from the proxy surface onto the original scene and sampling its texture there.
//
// Everything here is deterministic (no Math.random, no hash-order dependence, fixed iteration order).

const PAD = 2; // gutter around every chart, in texels

function normalizeInPlace(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= length; v[1] /= length; v[2] /= length;
  return v;
}

// Merge vertices that share a position (the source repeats them per UV island / hard normal).
export function weldPositions(positions, indices) {
  const byKey = new Map();
  const outPositions = [], outIndices = [];
  const remap = new Int32Array(positions.length / 3).fill(-1);
  for (const source of indices) {
    let target = remap[source];
    if (target < 0) {
      const x = positions[source * 3], y = positions[source * 3 + 1], z = positions[source * 3 + 2];
      const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
      target = byKey.get(key);
      if (target === undefined) {
        target = outPositions.length / 3;
        byKey.set(key, target);
        outPositions.push(x, y, z);
      }
      remap[source] = target;
    }
    outIndices.push(target);
  }
  // Drop triangles that collapsed to a line or point
  const kept = [];
  for (let t = 0; t < outIndices.length; t += 3) {
    const a = outIndices[t], b = outIndices[t + 1], c = outIndices[t + 2];
    if (a !== b && b !== c && a !== c) kept.push(a, b, c);
  }
  return { positions: new Float32Array(outPositions), indices: new Uint32Array(kept) };
}

// Faces that look down (the underside of the base slab, eaves) are never seen from the game camera
export function dropDownFacing(positions, indices, limit = 0.4) {
  const visible = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny / (Math.hypot(nx, ny, nz) || 1) < -limit) continue;
    visible.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return new Uint32Array(visible);
}

// ---- BVH over the source triangles (closest hit along a ray) ----

function buildBvh(positions, indices) {
  const count = indices.length / 3;
  const triMin = new Float32Array(count * 3), triMax = new Float32Array(count * 3), centroid = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    for (let axis = 0; axis < 3; axis++) {
      const a = positions[indices[t * 3] * 3 + axis], b = positions[indices[t * 3 + 1] * 3 + axis], c = positions[indices[t * 3 + 2] * 3 + axis];
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
      triMin[t * 3 + axis] = lo; triMax[t * 3 + axis] = hi; centroid[t * 3 + axis] = (lo + hi) / 2;
    }
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;

  // nth_element on order[lo..hi) by centroid[axis]
  const select = (lo, hi, nth, axis) => {
    let left = lo, right = hi - 1;
    const key = i => centroid[order[i] * 3 + axis];
    while (left < right) {
      const mid = (left + right) >> 1;
      const pivot = [key(left), key(mid), key(right)].sort((x, y) => x - y)[1];
      let i = left, j = right;
      while (i <= j) {
        while (key(i) < pivot) i++;
        while (key(j) > pivot) j--;
        if (i <= j) { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; i++; j--; }
      }
      if (nth <= j) right = j; else if (nth >= i) left = i; else return;
    }
  };

  const bounds = [], links = []; // links: [left, right, start, count]
  const build = (start, end) => {
    const node = bounds.length / 6;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const cMin = [Infinity, Infinity, Infinity], cMax = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], triMin[t * 3 + axis]); max[axis] = Math.max(max[axis], triMax[t * 3 + axis]);
        cMin[axis] = Math.min(cMin[axis], centroid[t * 3 + axis]); cMax[axis] = Math.max(cMax[axis], centroid[t * 3 + axis]);
      }
    }
    bounds.push(...min, ...max);
    links.push(-1, -1, start, end - start);
    if (end - start > 4) {
      let axis = 0;
      for (let k = 1; k < 3; k++) if (cMax[k] - cMin[k] > cMax[axis] - cMin[axis]) axis = k;
      if (cMax[axis] > cMin[axis]) {
        const mid = (start + end) >> 1;
        select(start, end, mid, axis);
        const left = build(start, mid), right = build(mid, end);
        links[node * 4] = left; links[node * 4 + 1] = right; links[node * 4 + 3] = 0;
      }
    }
    return node;
  };
  build(0, count);
  return { bounds: new Float32Array(bounds), links: new Int32Array(links), order, positions, indices };
}

// Closest hit along origin + t * dir for t in [0, tMax]; returns { t, tri, b1, b2 } or null
function castRay(bvh, origin, dir, tMax) {
  const { bounds, links, order, positions, indices } = bvh;
  const inv = dir.map(d => 1 / (Math.abs(d) < 1e-12 ? 1e-12 : d));
  let best = null, bestT = tMax;
  const stack = [0];
  while (stack.length) {
    const node = stack.pop();
    let near = 0, far = bestT;
    for (let axis = 0; axis < 3; axis++) {
      let t0 = (bounds[node * 6 + axis] - origin[axis]) * inv[axis];
      let t1 = (bounds[node * 6 + 3 + axis] - origin[axis]) * inv[axis];
      if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
      if (t0 > near) near = t0;
      if (t1 < far) far = t1;
      if (near > far) break;
    }
    if (near > far) continue;
    if (links[node * 4] >= 0) { stack.push(links[node * 4 + 1], links[node * 4]); continue; }
    const start = links[node * 4 + 2], count = links[node * 4 + 3];
    for (let i = start; i < start + count; i++) {
      const tri = order[i];
      const a = indices[tri * 3] * 3, b = indices[tri * 3 + 1] * 3, c = indices[tri * 3 + 2] * 3;
      const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
      const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
      const px = dir[1] * e2z - dir[2] * e2y, py = dir[2] * e2x - dir[0] * e2z, pz = dir[0] * e2y - dir[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-18) continue;
      const invDet = 1 / det;
      const tx = origin[0] - positions[a], ty = origin[1] - positions[a + 1], tz = origin[2] - positions[a + 2];
      const b1 = (tx * px + ty * py + tz * pz) * invDet;
      if (b1 < 0 || b1 > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const b2 = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * invDet;
      if (b2 < 0 || b1 + b2 > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
      if (t >= 0 && t < bestT) { bestT = t; best = { t, tri, b1, b2 }; }
    }
  }
  return best;
}

function sampleBilinear(texture, u, v) {
  const { width, height, data } = texture;
  const x = (u - Math.floor(u)) * width - 0.5, y = (v - Math.floor(v)) * height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const out = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const xx = (x0 + (k & 1) + width) % width, yy = (y0 + (k >> 1) + height) % height;
    const weight = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
    const at = (yy * width + xx) * 4;
    out[0] += data[at] * weight; out[1] += data[at + 1] * weight; out[2] += data[at + 2] * weight;
  }
  return out;
}

// ---- Charts: connected, roughly coplanar groups of proxy triangles, projected onto their average plane ----

function buildCharts(proxy, options) {
  const { positions, indices } = proxy;
  const count = indices.length / 3;
  const normals = new Float32Array(count * 3), areas = new Float32Array(count);
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / length; normals[t * 3 + 1] = ny / length; normals[t * 3 + 2] = nz / length;
    areas[t] = length / 2;
  }

  const edgeOwners = new Map();
  const edgeKey = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const key = edgeKey(indices[t * 3 + e], indices[t * 3 + (e + 1) % 3]);
      const list = edgeOwners.get(key);
      if (list) list.push(t); else edgeOwners.set(key, [t]);
    }
  }

  const chartOf = new Int32Array(count).fill(-1);
  const seeds = Array.from({ length: count }, (_, t) => t).sort((a, b) => areas[b] - areas[a] || a - b);
  const charts = [];
  for (const seed of seeds) {
    if (chartOf[seed] >= 0) continue;
    const id = charts.length;
    const sum = [normals[seed * 3] * areas[seed], normals[seed * 3 + 1] * areas[seed], normals[seed * 3 + 2] * areas[seed]];
    const seedNormal = [normals[seed * 3], normals[seed * 3 + 1], normals[seed * 3 + 2]];
    const members = [seed];
    chartOf[seed] = id;
    const stack = [seed];
    while (stack.length) {
      const t = stack.pop();
      for (let e = 0; e < 3; e++) {
        for (const other of edgeOwners.get(edgeKey(indices[t * 3 + e], indices[t * 3 + (e + 1) % 3])) ?? []) {
          if (chartOf[other] >= 0) continue;
          const n = [normals[other * 3], normals[other * 3 + 1], normals[other * 3 + 2]];
          const average = normalizeInPlace([...sum]);
          if (n[0] * average[0] + n[1] * average[1] + n[2] * average[2] < options.cosAverage) continue;
          if (n[0] * seedNormal[0] + n[1] * seedNormal[1] + n[2] * seedNormal[2] < options.cosSeed) continue;
          chartOf[other] = id;
          members.push(other);
          for (let k = 0; k < 3; k++) sum[k] += n[k] * areas[other];
          stack.push(other);
        }
      }
    }
    // Planar basis: top-facing charts follow +X, walls run along the horizontal tangent
    const normal = normalizeInPlace([...sum]);
    let u;
    if (Math.abs(normal[1]) > 0.7) {
      const dot = normal[0];
      u = normalizeInPlace([1 - normal[0] * dot, -normal[1] * dot, -normal[2] * dot]);
    } else {
      u = normalizeInPlace([normal[2], 0, -normal[0]]);
    }
    const v = [normal[1] * u[2] - normal[2] * u[1], normal[2] * u[0] - normal[0] * u[2], normal[0] * u[1] - normal[1] * u[0]];
    // Chart-local vertices (shared inside the chart)
    const localIndex = new Map(), vertices = [];
    const triangles = [];
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    for (const t of members) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const source = indices[t * 3 + k];
        let local = localIndex.get(source);
        if (local === undefined) {
          local = vertices.length;
          localIndex.set(source, local);
          const x = positions[source * 3], y = positions[source * 3 + 1], z = positions[source * 3 + 2];
          const pu = x * u[0] + y * u[1] + z * u[2], pv = x * v[0] + y * v[1] + z * v[2];
          vertices.push({ source, x, y, z, u: pu, v: pv, nx: 0, ny: 0, nz: 0 });
          min[0] = Math.min(min[0], pu); max[0] = Math.max(max[0], pu);
          min[1] = Math.min(min[1], pv); max[1] = Math.max(max[1], pv);
        }
        tri.push(local);
      }
      triangles.push(tri);
      for (const local of tri) {
        vertices[local].nx += normals[t * 3] * areas[t]; vertices[local].ny += normals[t * 3 + 1] * areas[t]; vertices[local].nz += normals[t * 3 + 2] * areas[t];
      }
    }
    for (const vertex of vertices) {
      const length = Math.hypot(vertex.nx, vertex.ny, vertex.nz) || 1;
      vertex.nx /= length; vertex.ny /= length; vertex.nz /= length;
    }
    charts.push({ vertices, triangles, min, max, normal, area: members.reduce((s, t) => s + areas[t], 0) });
  }
  return charts;
}

// Shelf-pack chart rectangles at a uniform density; returns placements or null when they do not fit
function packCharts(charts, density, size) {
  const rects = charts.map((chart, i) => ({
    i,
    w: Math.max(2, Math.ceil((chart.max[0] - chart.min[0]) * density)) + 2 * PAD,
    h: Math.max(2, Math.ceil((chart.max[1] - chart.min[1]) * density)) + 2 * PAD,
  })).sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
  const placements = new Array(charts.length);
  let x = 0, y = 0, rowHeight = 0;
  for (const rect of rects) {
    if (rect.w > size || rect.h > size) return null;
    if (x + rect.w > size) { x = 0; y += rowHeight; rowHeight = 0; }
    if (rowHeight === 0) rowHeight = rect.h;
    if (y + rect.h > size) return null;
    placements[rect.i] = { x, y };
    x += rect.w;
  }
  return placements;
}

export function bakeAtlas({ proxy, source, texture, size = 1024, reach = {} }) {
  const options = { cosAverage: 0.85, cosSeed: 0.62, ...reach };
  const charts = buildCharts(proxy, options);

  let lo = 1, hi = 100000, placements = null;
  for (let iteration = 0; iteration < 40; iteration++) {
    const mid = Math.sqrt(lo * hi);
    const attempt = packCharts(charts, mid, size);
    if (attempt) { lo = mid; placements = attempt; } else hi = mid;
  }
  if (!placements) throw new Error('atlas: charts do not fit');
  const density = lo;

  const bvh = buildBvh(source.positions, source.indices);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const filled = new Uint8Array(size * size);
  const near = options.near ?? 0.012, inside = options.inside ?? 0.02;

  const positions = [], normals = [], uvs = [], indices = [];
  for (let c = 0; c < charts.length; c++) {
    const chart = charts[c], place = placements[c];
    const texelOf = vertex => [place.x + PAD + (vertex.u - chart.min[0]) * density, place.y + PAD + (vertex.v - chart.min[1]) * density];
    const base = positions.length / 3;
    for (const vertex of chart.vertices) {
      const [tx, ty] = texelOf(vertex);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(vertex.nx, vertex.ny, vertex.nz);
      uvs.push(tx / size, ty / size);
    }
    for (const tri of chart.triangles) {
      indices.push(base + tri[0], base + tri[1], base + tri[2]);
      const V = tri.map(i => chart.vertices[i]);
      const T = V.map(texelOf);
      const minX = Math.max(0, Math.floor(Math.min(T[0][0], T[1][0], T[2][0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(T[0][0], T[1][0], T[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(T[0][1], T[1][1], T[2][1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(T[0][1], T[1][1], T[2][1])));
      const denominator = (T[1][1] - T[2][1]) * (T[0][0] - T[2][0]) + (T[2][0] - T[1][0]) * (T[0][1] - T[2][1]);
      if (Math.abs(denominator) < 1e-9) continue;
      const faceNormal = normalizeInPlace([
        (V[1].y - V[0].y) * (V[2].z - V[0].z) - (V[1].z - V[0].z) * (V[2].y - V[0].y),
        (V[1].z - V[0].z) * (V[2].x - V[0].x) - (V[1].x - V[0].x) * (V[2].z - V[0].z),
        (V[1].x - V[0].x) * (V[2].y - V[0].y) - (V[1].y - V[0].y) * (V[2].x - V[0].x),
      ]);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l0 = ((T[1][1] - T[2][1]) * (px - T[2][0]) + (T[2][0] - T[1][0]) * (py - T[2][1])) / denominator;
        const l1 = ((T[2][1] - T[0][1]) * (px - T[2][0]) + (T[0][0] - T[2][0]) * (py - T[2][1])) / denominator;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        const point = [
          V[0].x * l0 + V[1].x * l1 + V[2].x * l2,
          V[0].y * l0 + V[1].y * l1 + V[2].y * l2,
          V[0].z * l0 + V[1].z * l1 + V[2].z * l2,
        ];
        // First hit looking from just outside the proxy inwards; a wider second try when the proxy sits far from the scene
        let hit = null;
        for (const [outward, depth] of [[near, near + inside], [near * 5, near * 5 + inside * 3]]) {
          const origin = [point[0] + faceNormal[0] * outward, point[1] + faceNormal[1] * outward, point[2] + faceNormal[2] * outward];
          hit = castRay(bvh, origin, [-faceNormal[0], -faceNormal[1], -faceNormal[2]], depth);
          if (hit) break;
        }
        if (!hit) continue;
        const a = source.indices[hit.tri * 3], b = source.indices[hit.tri * 3 + 1], cIdx = source.indices[hit.tri * 3 + 2];
        const w0 = 1 - hit.b1 - hit.b2;
        const u = source.uvs[a * 2] * w0 + source.uvs[b * 2] * hit.b1 + source.uvs[cIdx * 2] * hit.b2;
        const v = source.uvs[a * 2 + 1] * w0 + source.uvs[b * 2 + 1] * hit.b1 + source.uvs[cIdx * 2 + 1] * hit.b2;
        const color = sampleBilinear(texture, u, v);
        const at = (y * size + x) * 4;
        rgba[at] = color[0]; rgba[at + 1] = color[1]; rgba[at + 2] = color[2]; rgba[at + 3] = 255;
        filled[y * size + x] = 1;
      }
    }
  }

  // Dilate into gutters and gaps, then paint whatever is left with the mean colour
  let sumR = 0, sumG = 0, sumB = 0, total = 0;
  for (let i = 0; i < size * size; i++) if (filled[i]) { sumR += rgba[i * 4]; sumG += rgba[i * 4 + 1]; sumB += rgba[i * 4 + 2]; total++; }
  for (let pass = 0; pass < PAD + 2; pass++) {
    const additions = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (filled[y * size + x]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size || !filled[yy * size + xx]) continue;
        const at = (yy * size + xx) * 4;
        r += rgba[at]; g += rgba[at + 1]; b += rgba[at + 2]; n++;
      }
      if (n) additions.push([y * size + x, r / n, g / n, b / n]);
    }
    for (const [index, r, g, b] of additions) {
      rgba[index * 4] = r; rgba[index * 4 + 1] = g; rgba[index * 4 + 2] = b; rgba[index * 4 + 3] = 255; filled[index] = 1;
    }
  }
  const mean = total ? [sumR / total, sumG / total, sumB / total] : [128, 128, 128];
  for (let i = 0; i < size * size; i++) if (!filled[i]) { rgba[i * 4] = mean[0]; rgba[i * 4 + 1] = mean[1]; rgba[i * 4 + 2] = mean[2]; rgba[i * 4 + 3] = 255; }

  return {
    geometry: { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) },
    texture: { width: size, height: size, data: rgba },
    stats: { charts: charts.length, density, bakedTexels: total },
  };
}
