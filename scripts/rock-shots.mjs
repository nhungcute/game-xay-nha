// D032 visual QA: compare the committed placeholder rocks with the imported Stone Pack in the real game,
// then record close-ups, map views, clear actions, mobile views and renderer metrics.
// Usage: start the offline Vite server, set BASE_URL when it is not :5190, then run this script.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';
import { dismissLevelUp, openSettings } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g4/rocks';
const SNAPSHOTS = 'docs/evidence/g4/full-world';
const ROCK_IDS = ['rock_01', 'rock_02', 'rock_03', 'rock_04', 'rock_large_01', 'rock_large_02'];
// These anchors exist only in an in-memory QA template. They make every imported variant
// reachable in the initial farm zones without changing a committed world template.
const QA_ANCHORS = ROCK_IDS.map((assetId, index) => ({
  id: `A-${index}`,
  assetId,
  cell: [[52, 48], [56, 48], [60, 60], [68, 60], [64, 64], [72, 72]][index],
  footprint: index < 4 ? 1 : 2,
  offsetXZ: [0, 0],
  yawDeg: (index * 47) % 360,
  scale: 1,
  blocking: true,
}));
const beforeBytes = new Map(ROCK_IDS.map(id => [id, execFileSync('git', ['show', `HEAD:apps/web/public/assets/models/${id}.glb`]) ]));

await mkdir(`${OUT}/mobile`, { recursive: true });
const report = { base: BASE, at: new Date().toISOString(), shots: [], metrics: { placeholder: [], imported: [], clearActions: [], variantRockColors: [] }, errors: [] };
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

function recordError(scope, message) {
  report.errors.push(`${scope}: ${message}`);
}

async function routePlaceholderRocks(page) {
  for (const id of ROCK_IDS) {
    await page.route(`**/assets/models/env/${id}.glb`, route => route.fulfill({ contentType: 'model/gltf-binary', body: beforeBytes.get(id) }));
  }
}

async function loadWorld(page, kind, placeholder = false, options = {}) {
  const mapId = kind === 'city' ? 'city-coast-01' : 'farm-valley-01';
  const template = options.templateBody ?? await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = options.useSnapshot === false ? null : JSON.parse(await readFile(`${SNAPSHOTS}/${kind}-snapshot.json`, 'utf8'));
  if (placeholder) await routePlaceholderRocks(page);
  await page.route('**/worlds/farm-g1/template.v1.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (snapshot) {
    const loaded = await page.evaluate(next => {
      const current = window.__debug.snapshot();
      next.worldId = current.worldId; next.accountId = current.accountId;
      return window.__debug.loadSnapshot(next);
    }, snapshot);
    if (!loaded.ok) throw new Error(`${kind} snapshot rejected: ${JSON.stringify(loaded.errors).slice(0, 300)}`);
  }
  await page.waitForTimeout(2500);
  await dismissLevelUp(page);
}

async function qaFarmTemplate() {
  const template = JSON.parse(await readFile('apps/web/public/worlds/farm-valley-01/template.v2.json', 'utf8'));
  template.env.anchors = QA_ANCHORS;
  return JSON.stringify(template);
}

async function aim(page, x, z, distance, pitch = 30, yaw = 35) {
  await page.evaluate(([targetX, targetZ, cameraDistance, cameraYaw, cameraPitch]) => window.__debug.camera(targetX, targetZ, cameraDistance, cameraYaw, cameraPitch), [x, z, distance, yaw, pitch]);
  await page.waitForTimeout(750);
  return page.evaluate(([targetX, targetZ]) => window.__debug.project(targetX, targetZ), [x, z]);
}

async function shot(page, file, label, meta = {}) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 82 });
  const metrics = await page.evaluate(() => window.__debug.metrics());
  report.shots.push({ file, label, ...meta, drawCalls: metrics.drawCalls, triangles: metrics.triangles, fps: Math.round(metrics.fps) });
  console.log(`${file}: ${metrics.drawCalls} calls, ${metrics.triangles} tris`);
  return metrics;
}

async function captureCanvasPixels(page, key) {
  await page.evaluate(async captureKey => {
    const source = document.querySelector('canvas');
    if (!source) throw new Error('Game canvas is unavailable for D032 color QA');
    const image = new Image();
    image.src = source.toDataURL('image/png');
    await image.decode();
    const copy = document.createElement('canvas');
    copy.width = image.width; copy.height = image.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable for D032 color QA');
    context.drawImage(image, 0, 0);
    const snapshots = globalThis.__d032RockColorQa ??= new Map();
    snapshots.set(captureKey, { pixels: context.getImageData(0, 0, copy.width, copy.height).data, width: copy.width, height: copy.height });
  }, key);
}

async function measureRockPixels(page, key, projected, radius) {
  return page.evaluate(async ({ captureKey, center, sampleRadius }) => {
    const snapshots = globalThis.__d032RockColorQa;
    const before = snapshots?.get(captureKey);
    if (!before) throw new Error(`Missing D032 color baseline: ${captureKey}`);
    const source = document.querySelector('canvas');
    if (!source) throw new Error('Game canvas is unavailable for D032 color QA');
    const image = new Image();
    image.src = source.toDataURL('image/png');
    await image.decode();
    const copy = document.createElement('canvas');
    copy.width = image.width; copy.height = image.height;
    const context = copy.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable for D032 color QA');
    context.drawImage(image, 0, 0);
    const after = context.getImageData(0, 0, copy.width, copy.height).data;
    if (before.width !== copy.width || before.height !== copy.height) throw new Error('D032 color capture dimensions changed');
    const scaleX = copy.width / source.getBoundingClientRect().width, scaleY = copy.height / source.getBoundingClientRect().height;
    const x0 = Math.max(0, Math.floor(center.x * scaleX - sampleRadius * scaleX));
    const x1 = Math.min(copy.width, Math.ceil(center.x * scaleX + sampleRadius * scaleX));
    const y0 = Math.max(0, Math.floor(center.y * scaleY - sampleRadius * scaleY));
    const y1 = Math.min(copy.height, Math.ceil(center.y * scaleY + sampleRadius * scaleY));
    let pixels = 0, red = 0, green = 0, blue = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const offset = (y * copy.width + x) * 4;
      const r = before.pixels[offset], g = before.pixels[offset + 1], b = before.pixels[offset + 2];
      const delta = Math.max(Math.abs(r - after[offset]), Math.abs(g - after[offset + 1]), Math.abs(b - after[offset + 2]));
      // Clearing the anchor yields an object mask. Restrict it to warm/neutral pixels to exclude the green ground shadow.
      if (delta < 24 || r < g * 0.82 || b < g * 0.72) continue;
      pixels++; red += r; green += g; blue += b;
    }
    snapshots.delete(captureKey);
    if (!pixels) throw new Error(`D032 color mask was empty for ${captureKey}`);
    const meanRgb = [red, green, blue].map(value => Math.round(value / pixels));
    return { method: 'clear-difference warm-neutral mask (delta >= 24)', pixelCount: pixels, meanRgb, meanHex: `#${meanRgb.map(value => value.toString(16).padStart(2, '0')).join('')}` };
  }, { captureKey: key, center: projected, sampleRadius: radius });
}

const point = instance => [
  (instance.cell[0] + 0.5) * 2 + (instance.offsetXZ?.[0] ?? 0),
  (instance.cell[1] + 0.5) * 2 + (instance.offsetXZ?.[1] ?? 0),
];

async function representativeRocks(page) {
  return page.evaluate(ids => {
    const env = window.__debug.env();
    return ids.map((assetId, index) => env.find(instance => instance.id === `A-${index}`)
      ?? env.filter(instance => instance.assetId === assetId)
        .sort((a, b) => Math.hypot((a.cell[0] - 64) * 2, (a.cell[1] - 64) * 2) - Math.hypot((b.cell[0] - 64) * 2, (b.cell[1] - 64) * 2))[0])
      .filter(Boolean);
  }, ROCK_IDS);
}

function compactCommand(result) {
  return { accepted: Boolean(result?.accepted), code: result?.code ?? null };
}

async function overviewMetrics(kind, placeholder) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), scope = `${placeholder ? 'placeholder' : 'imported'}-${kind}`;
  page.on('pageerror', error => recordError(scope, error.message));
  page.on('console', message => { if (message.type() === 'error') recordError(scope, message.text()); });
  await loadWorld(page, kind, placeholder);
  const result = [];
  for (const quality of ['high', 'low']) {
    if (quality === 'low') {
      await openSettings(page);
      await page.locator('.settings button', { hasText: 'Thấp' }).click();
      await page.locator('.side.panel .close').click();
      await page.waitForTimeout(900);
    }
    await aim(page, 128, 128, 220, 75, 45);
    const file = `${placeholder ? 'before' : 'after'}-${kind}-${quality}-overview.jpg`;
    const metrics = await shot(page, file, `${placeholder ? 'placeholder' : 'imported'} ${kind} ${quality} overview`, { kind, quality, variant: placeholder ? 'placeholder' : 'imported' });
    result.push({ kind, quality, drawCalls: metrics.drawCalls, triangles: metrics.triangles });
  }
  await context.close();
  return result;
}

// Original rock GLB bytes from HEAD are routed in memory: these pictures are the required pre-change evidence.
for (const kind of ['farm', 'city']) report.metrics.placeholder.push(...await overviewMetrics(kind, true));
for (const kind of ['farm', 'city']) report.metrics.imported.push(...await overviewMetrics(kind, false));

// Close-up comparison and actual clear actions use the imported assets plus six QA-only template anchors.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', error => recordError('farm', error.message));
page.on('console', message => { if (message.type() === 'error') recordError('farm', message.text()); });
  await loadWorld(page, 'farm', false, { templateBody: await qaFarmTemplate(), useSnapshot: false });
  // Make the camera's initial target match the QA field so each close-up starts from a useful context.
  await page.evaluate(() => window.__debug.camera(128, 128, 220, 45, 75));
let instances = (await representativeRocks(page)).sort((a, b) => ROCK_IDS.indexOf(a.assetId) - ROCK_IDS.indexOf(b.assetId));
if (instances.length !== ROCK_IDS.length) recordError('farm', `only ${instances.length}/${ROCK_IDS.length} rock ids available for QA`);
for (const instance of instances) {
  const [x, z] = point(instance);
  const projected = await aim(page, x, z, instance.assetId.startsWith('rock_large') ? 23 : 14);
  await shot(page, `variant-${instance.assetId}.jpg`, 'imported rock close-up', { assetId: instance.assetId, targetId: instance.id, projected });
  await captureCanvasPixels(page, instance.id);
  const colorCommand = await page.evaluate(id => window.__debug.command('CLEAR_ENV', { envIds: [id] }), instance.id);
  if (!colorCommand?.accepted) recordError('farm', `D032 color mask clear failed for ${instance.id}: ${colorCommand?.code ?? 'unknown'}`);
  await page.waitForTimeout(1600);
  try {
    const color = await measureRockPixels(page, instance.id, projected, instance.assetId.startsWith('rock_large') ? 170 : 120);
    report.metrics.variantRockColors.push({ assetId: instance.assetId, ...color });
    report.shots.at(-1).rockColor = color;
  } catch (error) { recordError('farm', error instanceof Error ? error.message : String(error)); }
}
// The color masks clear their temporary anchors. A fresh browser context avoids retaining those saves for gameplay QA.
await context.close();
const clearContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const clearPage = await clearContext.newPage();
clearPage.on('pageerror', error => recordError('farm-clear', error.message));
clearPage.on('console', message => { if (message.type() === 'error') recordError('farm-clear', message.text()); });
await loadWorld(clearPage, 'farm', false, { templateBody: await qaFarmTemplate(), useSnapshot: false });
await clearPage.evaluate(() => window.__debug.camera(128, 128, 220, 45, 75));
instances = (await representativeRocks(clearPage)).sort((a, b) => ROCK_IDS.indexOf(a.assetId) - ROCK_IDS.indexOf(b.assetId));
for (const family of ['rock', 'rock_large']) {
  const instance = instances.find(item => family === 'rock' ? !item.assetId.startsWith('rock_large') : item.assetId.startsWith('rock_large'));
  if (!instance) continue;
  const [x, z] = point(instance);
  await aim(clearPage, x, z, family === 'rock' ? 28 : 38, 35, 40);
  const before = await shot(clearPage, `clear-${family}-before.jpg`, `before CLEAR_ENV (${family})`, { family, targetId: instance.id, assetId: instance.assetId });
  const command = await clearPage.evaluate(id => window.__debug.command('CLEAR_ENV', { envIds: [id] }), instance.id);
  const compact = compactCommand(command);
  await clearPage.waitForTimeout(1200);
  const after = await shot(clearPage, `clear-${family}-after.jpg`, `after CLEAR_ENV (${family}, ${compact.accepted ? 'accepted' : compact.code})`, { family, targetId: instance.id, assetId: instance.assetId, command: compact });
  report.metrics.clearActions.push({ family, assetId: instance.assetId, targetId: instance.id, command: compact, before: { drawCalls: before.drawCalls, triangles: before.triangles }, after: { drawCalls: after.drawCalls, triangles: after.triangles } });
}
await clearContext.close();

for (const [name, device] of [['pixel7', devices['Pixel 7']], ['iphone13', devices['iPhone 13']]]) {
  const mobileContext = await browser.newContext({ ...device, deviceScaleFactor: 1 });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => recordError(name, error.message));
  mobile.on('console', message => { if (message.type() === 'error') recordError(name, message.text()); });
  await loadWorld(mobile, 'farm', false, { templateBody: await qaFarmTemplate(), useSnapshot: false });
  const [instance] = await representativeRocks(mobile);
  if (instance) {
    const [x, z] = point(instance);
    await aim(mobile, x, z, 26, 36, 35);
    await shot(mobile, `mobile/${name}-rock.jpg`, `imported rock on ${name}`, { device: name, targetId: instance.id, assetId: instance.assetId });
  }
  await mobileContext.close();
}

await browser.close();
await writeFile(`${OUT}/metrics.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`saved ${report.shots.length} D032 screenshots; errors: ${report.errors.length}`);
if (report.errors.length) process.exitCode = 1;
