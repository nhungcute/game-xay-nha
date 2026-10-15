// Source-vs-output visual comparison for model importers (see docs/reports/QA-visual-gate.md).
//
// A GLB is rendered in headless Chrome (three.js from node_modules, served by a tiny local http server) with fixed
// neutral lighting from canonical views after normalising it like the importers do: rotate about Y, fit the largest
// bounding-box dimension to 1, bottom-centre pivot. Source and output are then compared view by view:
//   iou    silhouette IoU of the alpha masks
//   dE     CIE76 distance between the mean Lab colours of the visible pixels
//   dEGrid mean CIE76 distance over a coarse grid of per-cell mean Lab colours (spatial colour layout)
//   dL     mean absolute lightness difference of the visible pixels' sorted-L quantiles (tone / "everything dark")
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

export const VIEWS = ['top', 'front', 'threeQuarter'];
export const RENDER_PX = 256;

/** Pass criteria; every view-averaged value must be on the good side. Chosen from data (see the report). */
export const THRESHOLDS = {
  minIou: 0.45, // dilated silhouette IoU, mean of views
  minIouRebuilt: 0.4,
  maxRatio: 0.8, // colour-mapping consistency: within-bin output colour variance / total (1 = same source colour maps to anything)
  maxDE: 45, // distance of mean Lab colours; retones are deliberate, this only catches gross shifts
  minLRatio: 0.3, // output mean lightness / source mean lightness
  maxLRatio: 3.5,
  minOutMedL: 12, // output median L* (CIE) -- "everything dark" guard
  minOutContrast: 8, // output L* p95 - p5 -- "flat blob" guard
};

const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary' };

/**
 * Rewrites KHR_materials_pbrSpecularGlossiness materials (dropped from three r1xx GLTFLoader) to metal-rough so the
 * diffuse texture shows, and returns a GLB buffer. Other files are returned untouched.
 */
function patchSpecGloss(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) return buffer;
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const ext = 'KHR_materials_pbrSpecularGlossiness';
  if (!json.extensionsUsed?.includes(ext)) return buffer;
  for (const material of json.materials ?? []) {
    const sg = material.extensions?.[ext];
    if (!sg) continue;
    material.pbrMetallicRoughness = {
      baseColorFactor: sg.diffuseFactor ?? [1, 1, 1, 1],
      ...(sg.diffuseTexture ? { baseColorTexture: sg.diffuseTexture } : {}),
      metallicFactor: 0,
      roughnessFactor: 1,
    };
    delete material.extensions[ext];
    if (!Object.keys(material.extensions).length) delete material.extensions;
  }
  json.extensionsUsed = json.extensionsUsed.filter(name => name !== ext);
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter(name => name !== ext);
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  if (!json.extensionsRequired?.length) delete json.extensionsRequired;
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const jsonBuffer = Buffer.from(text);
  const rest = buffer.subarray(20 + jsonLength);
  const out = Buffer.alloc(20 + jsonBuffer.length + rest.length);
  buffer.copy(out, 0, 0, 12);
  out.writeUInt32LE(jsonBuffer.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuffer.copy(out, 20);
  rest.copy(out, 20 + jsonBuffer.length);
  out.writeUInt32LE(out.length, 8);
  return out;
}

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/addons/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const PX = ${RENDER_PX};
const canvas = document.createElement('canvas'); canvas.width = canvas.height = PX; document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(PX, PX, false); renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
const loader = new GLTFLoader();
const keep = (node, name) => { for (let n = node; n; n = n.parent) if (n.name === name) return true; return false; };

function build(gltf, spec) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  // Optional node selection (rock packs) and hidden groups (importer-dropped parts).
  if (spec.onlyNode) {
    root.traverse(o => { if (o.isMesh && !keep(o, spec.onlyNode)) o.visible = false; });
  }
  for (const name of spec.hideNodes ?? []) root.traverse(o => { if (o.isMesh && keep(o, name)) o.visible = false; });
  const holder = new THREE.Group(); holder.add(root);
  holder.rotation.y = (spec.rotationYDeg ?? 0) * Math.PI / 180;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3();
  holder.traverse(o => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  const size = box.getSize(new THREE.Vector3());
  const s = 1 / Math.max(size.x, size.y, size.z);
  const outer = new THREE.Group(); outer.add(holder);
  outer.scale.setScalar(s);
  outer.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  outer.updateMatrixWorld(true);
  return { outer, size: size.toArray() };
}

const cameras = {
  top: { az: 0, el: 90 }, front: { az: 0, el: 0 }, threeQuarter: { az: 40, el: 28 },
};
const HALF = 0.75, TARGET = new THREE.Vector3(0, 0.45, 0);

window.renderModel = async (spec) => {
  const gltf = await loader.loadAsync(spec.url);
  const { outer, size } = build(gltf, spec);
  const scene = new THREE.Scene();
  scene.add(outer);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); scene.add(sun, sun.target);
  const result = {};
  const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.01, 20);
  for (const [name, { az, el }] of Object.entries(cameras)) {
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    camera.position.copy(TARGET).addScaledVector(dir, 5);
    camera.up.set(0, 1, 0); if (el >= 89) camera.up.set(0, 0, -1);
    camera.lookAt(TARGET);
    // Headlight from upper-left of the camera so every view has the same light/shading relation.
    sun.position.copy(camera.position).add(new THREE.Vector3(-1.5, 2.5, 0).applyQuaternion(camera.quaternion)); sun.target.position.copy(TARGET);
    renderer.render(scene, camera);
    const gl = renderer.getContext(), px = new Uint8Array(PX * PX * 4);
    gl.readPixels(0, 0, PX, PX, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const flipped = new Uint8Array(px.length);
    for (let y = 0; y < PX; y++) flipped.set(px.subarray(y * PX * 4, (y + 1) * PX * 4), (PX - 1 - y) * PX * 4);
    let bin = ''; for (let i = 0; i < flipped.length; i += 0x8000) bin += String.fromCharCode.apply(null, flipped.subarray(i, i + 0x8000));
    result[name] = btoa(bin);
  }
  scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const m = Array.isArray(o.material) ? o.material : [o.material]; for (const mat of m) { for (const v of Object.values(mat)) if (v?.isTexture) v.dispose(); mat.dispose(); } } });
  return { views: result, size };
};

// Contact sheet: cells = [{title, fail, views:[{src, out, caption}]}] drawn onto a 2D canvas, returned as PNG base64.
window.makeSheet = (cells, opts) => {
  const T = opts.tile, HEAD = 38, GAP = 10, cols = opts.columns;
  const cellW = VIEWS_N * 2 * T, cellH = HEAD + T + 18;
  const rows = Math.ceil(cells.length / cols);
  const c = document.createElement('canvas'); c.width = cols * (cellW + GAP) + GAP; c.height = rows * (cellH + GAP) + GAP + 26;
  const g = c.getContext('2d'); g.fillStyle = '#1b1e24'; g.fillRect(0, 0, c.width, c.height);
  g.font = '15px sans-serif'; g.fillStyle = '#ddd'; g.fillText(opts.title, GAP, 19);
  const toCanvas = b64 => { const bin = atob(b64), a = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    const t = document.createElement('canvas'); t.width = t.height = ${RENDER_PX}; t.getContext('2d').putImageData(new ImageData(a, ${RENDER_PX}, ${RENDER_PX}), 0, 0); return t; };
  cells.forEach((cell, i) => {
    const x0 = GAP + (i % cols) * (cellW + GAP), y0 = 26 + GAP + Math.floor(i / cols) * (cellH + GAP);
    g.fillStyle = cell.fail ? '#5a1f22' : '#24402c'; g.fillRect(x0, y0, cellW, HEAD);
    g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.fillText((cell.fail ? 'FAIL ' : 'PASS ') + cell.title, x0 + 6, y0 + 15);
    g.font = '12px sans-serif'; g.fillStyle = '#ccd'; g.fillText(cell.summary, x0 + 6, y0 + 31);
    cell.views.forEach((v, k) => {
      for (const [j, key] of ['src', 'out'].entries()) {
        const x = x0 + (k * 2 + j) * T, y = y0 + HEAD;
        g.fillStyle = (j ? '#3b3f48' : '#4a4f5a'); g.fillRect(x, y, T, T);
        g.drawImage(toCanvas(v[key]), x + 1, y + 1, T - 2, T - 2);
      }
      g.fillStyle = '#9ab'; g.font = '11px sans-serif'; g.fillText(v.caption, x0 + k * 2 * T + 4, y0 + HEAD + T + 13);
    });
  });
  return c.toDataURL('image/png').split(',')[1];
};
const VIEWS_N = ${VIEWS.length};
window.ready = true;
</script>`;

function vendorFiles() {
  const t = 'node_modules/three/';
  return {
    '/vendor/three.module.js': t + 'build/three.module.js',
    '/vendor/three.core.js': t + 'build/three.core.js',
    '/vendor/addons/loaders/GLTFLoader.js': t + 'examples/jsm/loaders/GLTFLoader.js',
    '/vendor/addons/utils/BufferGeometryUtils.js': t + 'examples/jsm/utils/BufferGeometryUtils.js',
  };
}

/** Starts the local server + headless Chrome. `roots` are directories GLB paths may be read from. */
export async function startRenderer({ repoRoot = process.cwd(), roots = [repoRoot] } = {}) {
  const vendor = vendorFiles();
  const allowed = roots.map(r => resolve(r));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://x');
      const send = (body, type) => { response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); response.end(body); };
      if (url.pathname === '/') return send(PAGE, 'text/html');
      if (vendor[url.pathname]) return send(await readFile(join(repoRoot, vendor[url.pathname])), 'text/javascript');
      if (url.pathname === '/glb') {
        const file = resolve(url.searchParams.get('p'));
        if (!allowed.some(root => file === root || file.startsWith(root + sep)) && !file.startsWith(resolve(process.env.TEMP ?? '/tmp'))) {
          response.writeHead(403); return response.end();
        }
        return send(patchSpecGloss(await readFile(file)), MIME['.glb']);
      }
      response.writeHead(404); response.end();
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const executablePath = process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(executablePath) ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  page.on('pageerror', error => console.error('[page]', error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });

  return {
    /** spec: { file, rotationYDeg?, onlyNode?, hideNodes? } -> { views: {name: Uint8Array RGBA}, size } */
    async render(spec) {
      const res = await page.evaluate(
        s => window.renderModel(s),
        { ...spec, url: `http://127.0.0.1:${port}/glb?p=${encodeURIComponent(resolve(spec.file))}` });
      const views = {};
      for (const name of VIEWS) views[name] = new Uint8Array(Buffer.from(res.views[name], 'base64'));
      return { views, size: res.size };
    },
    /** cells: [{ title, summary, fail, views: [{ src: RGBA, out: RGBA, caption }] }] -> PNG buffer */
    async sheet(cells, { title, tile = 144, columns = 2 }) {
      const enc = px => Buffer.from(px).toString('base64');
      const payload = cells.map(c => ({ ...c, views: c.views.map(v => ({ ...v, src: enc(v.src), out: enc(v.out) })) }));
      return Buffer.from(await page.evaluate(([c, o]) => window.makeSheet(c, o), [payload, { title, tile, columns }]), 'base64');
    },
    async close() { await browser.close(); server.close(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------------------------
function srgbToLab(r, g, b) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const GRID = 8;
const FINE = 32; // structure grid
const BLK = 32; // block grid for the colour-mapping consistency test
const DILATE = 2; // px tolerance for silhouette IoU (thin poles differ by a pixel or two)

function analyse(px) {
  const n = RENDER_PX * RENDER_PX;
  const mask = new Uint8Array(n), sum = [0, 0, 0];
  const cell = Array.from({ length: GRID * GRID }, () => ({ n: 0, l: 0, a: 0, b: 0 }));
  const Ls = [];
  const fine = Array.from({ length: FINE * FINE }, () => ({ n: 0, l: 0 }));
  const lum = new Float32Array(n);
  const blk = Array.from({ length: BLK * BLK }, () => ({ n: 0, l: 0, a: 0, b: 0 }));
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (px[i * 4 + 3] < 128) continue;
    mask[i] = 1; count++;
    const [l, a, b] = srgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    sum[0] += l; sum[1] += a; sum[2] += b; Ls.push(l); lum[i] = l;
    const bk = blk[Math.floor(i / RENDER_PX / (RENDER_PX / BLK)) * BLK + Math.floor((i % RENDER_PX) / (RENDER_PX / BLK))]; bk.n++; bk.l += l; bk.a += a; bk.b += b;
    const f = fine[Math.floor(i / RENDER_PX / (RENDER_PX / FINE)) * FINE + Math.floor((i % RENDER_PX) / (RENDER_PX / FINE))]; f.n++; f.l += l;
    const c = cell[Math.floor(i / RENDER_PX / (RENDER_PX / GRID)) * GRID + Math.floor((i % RENDER_PX) / (RENDER_PX / GRID))];
    c.n++; c.l += l; c.a += a; c.b += b;
  }
  Ls.sort((p, q) => p - q);
  const quantiles = [0.05, 0.25, 0.5, 0.75, 0.95].map(q => Ls.length ? Ls[Math.min(Ls.length - 1, Math.floor(q * Ls.length))] : 0);
  // Mean absolute L gradient inside the mask (fine texture / noise energy).
  let grad = 0, gradN = 0;
  for (let y = 0; y < RENDER_PX - 1; y++) for (let x = 0; x < RENDER_PX - 1; x++) {
    const i = y * RENDER_PX + x;
    if (mask[i] && mask[i + 1] && mask[i + RENDER_PX]) { grad += Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i + RENDER_PX]); gradN += 2; }
  }
  return { mask, count, mean: count ? sum.map(v => v / count) : [0, 0, 0], cell, fine, blk, quantiles, grad: gradN ? grad / gradN : 0 };
}

function dilate(mask) {
  let cur = mask;
  for (let r = 0; r < DILATE; r++) {
    const next = new Uint8Array(cur);
    for (let y = 1; y < RENDER_PX - 1; y++) for (let x = 1; x < RENDER_PX - 1; x++) {
      const i = y * RENDER_PX + x;
      if (cur[i - 1] | cur[i + 1] | cur[i - RENDER_PX] | cur[i + RENDER_PX]) next[i] = 1;
    }
    cur = next;
  }
  return cur;
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Compares two RGBA images of one view. */
export function compareView(srcPx, outPx) {
  const a = analyse(srcPx), b = analyse(outPx);
  const da = dilate(a.mask), db = dilate(b.mask);
  let inter = 0, union = 0;
  for (let i = 0; i < da.length; i++) { inter += da[i] & db[i]; union += da[i] | db[i]; }
  const iou = union ? inter / union : 0;
  if (!a.count || !b.count) return { iou, dE: 100, dEGrid: 100, dL: 100, corr: 0, grad: 99, spread: 99, ratio: 1, lRatio: 0, outMedL: 0, outContrast: 0 };
  // Structure: Pearson correlation of per-cell mean lightness over cells visible in both (invariant to tone grading).
  const xs = [], ys = [];
  for (let i = 0; i < FINE * FINE; i++) if (a.fine[i].n >= 16 && b.fine[i].n >= 16) { xs.push(a.fine[i].l / a.fine[i].n); ys.push(b.fine[i].l / b.fine[i].n); }
  const mx = xs.reduce((p, q) => p + q, 0) / (xs.length || 1), my = ys.reduce((p, q) => p + q, 0) / (ys.length || 1);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  const sdx = Math.sqrt(sxx / (xs.length || 1)), sdy = Math.sqrt(syy / (ys.length || 1));
  // Flat views (std < 1.5 L) carry no layout information; do not let noise decide.
  const corr = xs.length < 12 || sdx < 1.5 || sdy < 1.5 ? 1 : sxy / Math.sqrt(sxx * syy);
  // Colour-mapping consistency: a retone/palette change maps one source colour to one output colour, whereas a
  // collapsed or mis-addressed atlas maps the same source colour to many. Bin blocks by source Lab, measure the
  // spread of the output Lab inside each bin (rms, in CIE76 units) and relative to the output's total spread.
  const bins = new Map(); let nBlk = 0, tl = 0, ta = 0, tb = 0;
  for (let i = 0; i < BLK * BLK; i++) {
    const p = a.blk[i], q = b.blk[i];
    if (p.n < 8 || q.n < 8) continue;
    const sl = [p.l / p.n, p.a / p.n, p.b / p.n], ol = [q.l / q.n, q.a / q.n, q.b / q.n];
    const key = Math.floor(sl[0] / 8) + ',' + Math.floor(sl[1] / 10) + ',' + Math.floor(sl[2] / 10);
    (bins.get(key) ?? bins.set(key, []).get(key)).push(ol); nBlk++; tl += ol[0]; ta += ol[1]; tb += ol[2];
  }
  let within = 0, total = 0;
  const mt = [tl / (nBlk || 1), ta / (nBlk || 1), tb / (nBlk || 1)];
  for (const list of bins.values()) {
    const m = [0, 1, 2].map(k => list.reduce((x, v) => x + v[k], 0) / list.length);
    for (const v of list) { within += (v[0] - m[0]) ** 2 + (v[1] - m[1]) ** 2 + (v[2] - m[2]) ** 2; total += (v[0] - mt[0]) ** 2 + (v[1] - mt[1]) ** 2 + (v[2] - mt[2]) ** 2; }
  }
  const spread = nBlk >= 20 ? Math.sqrt(within / nBlk) : 0, ratio = nBlk >= 20 && total > 0 ? within / total : 0;
  const grad = a.grad > 0.2 ? b.grad / a.grad : 1;
  const dE = dist(a.mean, b.mean);
  let gridSum = 0, gridN = 0;
  for (let i = 0; i < GRID * GRID; i++) {
    const p = a.cell[i], q = b.cell[i];
    if (p.n < 8 || q.n < 8) continue;
    gridSum += dist([p.l / p.n, p.a / p.n, p.b / p.n], [q.l / q.n, q.a / q.n, q.b / q.n]); gridN++;
  }
  const dEGrid = gridN ? gridSum / gridN : 100;
  const dL = a.quantiles.reduce((s, v, i) => s + Math.abs(v - b.quantiles[i]), 0) / a.quantiles.length;
  return { iou, dE, dEGrid, dL, corr, grad, spread, ratio, lRatio: b.mean[0] / Math.max(a.mean[0], 1), outMedL: b.quantiles[2], outContrast: b.quantiles[4] - b.quantiles[0] };
}

/**
 * Aggregates per-view scores (mean over views) and applies the thresholds. `rebuilt` models (trees/bushes: leaf-card
 * canopies regenerated from the source's leaf texture, hue-shifted) only get the silhouette and tone-sanity checks.
 */
export function compareModel(srcViews, outViews, { rebuilt = false, thresholds = THRESHOLDS } = {}) {
  const per = Object.fromEntries(VIEWS.map(v => [v, compareView(srcViews[v], outViews[v])]));
  const mean = key => VIEWS.reduce((s, v) => s + per[v][key], 0) / VIEWS.length;
  const scores = Object.fromEntries(['iou', 'dE', 'dEGrid', 'dL', 'corr', 'grad', 'spread', 'ratio', 'lRatio', 'outMedL', 'outContrast'].map(k => [k, mean(k)]));
  // Each check: [label, value, headroom in [-inf, 1]] where headroom 0 = at threshold and 1 = ideal.
  const checks = [
    ['iou', scores.iou, (scores.iou - (rebuilt ? thresholds.minIouRebuilt : thresholds.minIou)) / (1 - thresholds.minIou), scores.iou >= (rebuilt ? thresholds.minIouRebuilt : thresholds.minIou), `>= ${rebuilt ? thresholds.minIouRebuilt : thresholds.minIou}`],
    ['lRatio', scores.lRatio, Math.min((scores.lRatio - thresholds.minLRatio) / thresholds.minLRatio, (thresholds.maxLRatio - scores.lRatio) / thresholds.maxLRatio), scores.lRatio >= thresholds.minLRatio && scores.lRatio <= thresholds.maxLRatio, `in [${thresholds.minLRatio}, ${thresholds.maxLRatio}]`],
    ['outMedL', scores.outMedL, (scores.outMedL - thresholds.minOutMedL) / thresholds.minOutMedL, scores.outMedL >= thresholds.minOutMedL, `>= ${thresholds.minOutMedL}`],
    ['outContrast', scores.outContrast, (scores.outContrast - thresholds.minOutContrast) / thresholds.minOutContrast, scores.outContrast >= thresholds.minOutContrast, `>= ${thresholds.minOutContrast}`],
  ];
  if (!rebuilt) {
    checks.push(
      ['ratio', scores.ratio, 1 - scores.ratio / thresholds.maxRatio, scores.ratio <= thresholds.maxRatio, `<= ${thresholds.maxRatio}`],
      ['dE', scores.dE, 1 - scores.dE / thresholds.maxDE, scores.dE <= thresholds.maxDE, `<= ${thresholds.maxDE}`]);
  }
  const failures = checks.filter(c => !c[3]).map(c => `${c[0]} ${c[1].toFixed(2)} (needs ${c[4]})`);
  const margin = Math.min(...checks.map(c => c[2]));
  return { per, scores, pass: failures.length === 0, failures, margin };
}

/** Minimal PNG writer (RGBA8) for debugging dumps. */
export function encodePng(rgba, width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
