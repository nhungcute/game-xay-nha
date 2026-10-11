// D030: compare far billboards and near models against a no-environment frame on both full-world snapshots.
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190', OUT = 'docs/evidence/g4/trees/lod-qa';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { base: BASE, at: new Date().toISOString(), threshold: 0.6, maps: {} };
let failed = false;
function decodePng(png) {
  let offset = 8, width = 0, height = 0, channels = 0; const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0; }
    if (type === 'IDAT') idat.push(data);
    offset += length + 12; if (type === 'IEND') break;
  }
  if (!channels) throw new Error('Unsupported screenshot PNG color type');
  const stride = width * channels, packed = inflateSync(Buffer.concat(idat)), data = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const filter = packed[y * (stride + 1)], value = packed[y * (stride + 1) + x + 1], left = x >= channels ? data[y * stride + x - channels] : 0;
    const up = y ? data[(y - 1) * stride + x] : 0, ul = y && x >= channels ? data[(y - 1) * stride + x - channels] : 0;
    data[y * stride + x] = (value + (filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, ul) : 0)) & 255;
  }
  return { data, width, height, channels };
}
await mkdir(OUT, { recursive: true });
try {
  for (const [kind, mapId] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']]) {
    const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
    const snapshot = JSON.parse(await readFile(`docs/evidence/g4/full-world/${kind}-snapshot.json`, 'utf8'));
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/worlds/farm-g1/template.v1.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: template }));
    await page.goto(`${BASE}/?debug=1&test=1`);
    await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
    const loaded = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
    if (!loaded.ok) throw new Error(`${kind}: snapshot rejected ${JSON.stringify(loaded.errors)}`);
    await page.waitForTimeout(2500);
    const views = {};
    for (const [label, camera] of [['oblique-45', [128, 128, 160, 200, 45]], ['overview-75', [128, 128, 220, 45, 75]]]) {
      await page.evaluate(c => window.__debug.camera(...c), camera);
      await page.waitForTimeout(700);
      const captures = {};
      for (const [lod, nearCount] of [['far', 0], ['near', Number.MAX_SAFE_INTEGER]]) {
        await page.evaluate(n => { window.__debug.envVisible(true); window.__debug.treeLod({ nearCount: n }); }, nearCount);
        await page.waitForTimeout(250);
        const tree = await page.evaluate(() => window.__debug.screenshot());
        captures[lod] = Buffer.from(tree.split(',')[1], 'base64');
        await page.evaluate(() => window.__debug.envVisible(false));
        await page.waitForTimeout(100);
        const baseline = await page.evaluate(() => window.__debug.screenshot());
        captures[`${lod}Baseline`] = Buffer.from(baseline.split(',')[1], 'base64');
        await page.evaluate(() => window.__debug.envVisible(true));
      }
      const coverage = {};
      for (const lod of ['far', 'near']) {
        const baseline = decodePng(captures[`${lod}Baseline`]);
        const image = decodePng(captures[lod]); let changed = 0;
      let luminance = 0, hue = 0;
        for (let i = 0; i < image.data.length; i += image.channels) {
          const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
          if (Math.max(Math.abs(r - baseline.data[i]), Math.abs(g - baseline.data[i + 1]), Math.abs(b - baseline.data[i + 2])) > 24) {
            changed++; luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
            let degrees = 0;
            if (delta) degrees = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
            hue += (degrees + 360) % 360;
          }
        }
        coverage[lod] = changed / (baseline.width * baseline.height);
        coverage[`${lod}MeanLuma`] = changed ? luminance / changed : 0;
        coverage[`${lod}MeanHueDeg`] = changed ? hue / changed : 0;
        await writeFile(`${OUT}/${kind}-${label}-${lod}.png`, captures[lod]);
        await writeFile(`${OUT}/${kind}-${label}-${lod}-baseline.png`, captures[`${lod}Baseline`]);
      }
      const ratio = coverage.far / Math.max(coverage.near, Number.EPSILON);
      const brightnessDelta = (coverage.farMeanLuma - coverage.nearMeanLuma) / Math.max(coverage.nearMeanLuma, 1);
      const hueDeltaDeg = Math.abs(coverage.farMeanHueDeg - coverage.nearMeanHueDeg);
      views[label] = { coverage, farNearRatio: ratio, brightnessDelta, hueDeltaDeg, pass: ratio >= 0.6 && Math.abs(brightnessDelta) <= 0.15 && hueDeltaDeg <= 20 };
      if (!views[label].pass) failed = true;
    }
    report.maps[kind] = views;
    console.log(kind, JSON.stringify(views));
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
if (failed) process.exitCode = 1;
