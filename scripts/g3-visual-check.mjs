import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g3/parallel-visual';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const output = { base: BASE, startedAt: new Date().toISOString(), browserVersion: browser.version(),
  mode: 'Existing offline Vite. Only the farm-g1 template fetch is fulfilled with the actual G3 template bytes; fresh context per map. No API or DB writes.', maps: {} };
const sha = text => createHash('sha256').update(text).digest('hex');
const watchedFiles = ['apps/web/src/Game.tsx', 'apps/web/src/Root.tsx', 'apps/web/src/game/GameLoop.ts',
  'apps/web/src/game/render/TerrainRenderer.ts', 'apps/web/src/game/render/EnvRenderer.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(watchedFiles.map(async file => [file, sha(await readFile(file))])));
output.sourceHashesBefore = await sourceHashes();
try {
  for (const [kind, mapId] of [['city', 'city-coast-01'], ['farm', 'farm-valley-01']]) {
    const templatePath = `apps/web/public/worlds/${mapId}/template.v2.json`, body = await readFile(templatePath, 'utf8'), template = JSON.parse(body);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [], requests = [], shots = [];
    page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
    page.on('requestfailed', request => requests.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) requests.push({ url: response.url(), status: response.status() }); });
    await page.route('**/worlds/farm-g1/template.v1.json', route => route.fulfill({ status: 200, contentType: 'application/json', body }));
    await page.goto(`${BASE}/?debug=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__debug?.auditScene, null, { timeout: 60000 });
    const debug = (name, args = []) => page.evaluate(([method, arguments_]) => window.__debug[method](...arguments_), [name, args]);
    await page.waitForTimeout(1600);
    const snapshot = await debug('snapshot');
    if (snapshot.mapId !== mapId || snapshot.templateVersion !== template.templateVersion) throw new Error(`Wrong actual map loaded: ${snapshot.mapId}`);
    const defaultCamera = await debug('cameraState');
    const samples = [];
    for (let sample = 0; sample < 16; sample++) { samples.push(await debug('metrics')); await page.waitForTimeout(200); }
    async function capture(label, intent) {
      await page.waitForTimeout(500);
      const prefix = `${OUT}/${kind}-${label}`, camera = await debug('cameraState');
      await page.screenshot({ path: `${prefix}.jpg`, quality: 90, type: 'jpeg' });
      const canvas = await debug('screenshot');
      await writeFile(`${prefix}-canvas.png`, Buffer.from(canvas.split(',')[1], 'base64'));
      const histogram = await page.evaluate(async dataUrl => {
        const image = new Image(); image.src = dataUrl; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data; let clipped = 0;
        for (let index = 0; index < data.length; index += 4) if (data[index] >= 250 && data[index + 1] >= 250 && data[index + 2] >= 250) clipped++;
        return { width: canvas.width, height: canvas.height, blownPct: 100 * clipped / (data.length / 4), threshold: 'all RGB channels ≥250' };
      }, canvas);
      shots.push({ label, intent, camera, image: `${prefix}.jpg`, canvas: `${prefix}-canvas.png`, histogram, metrics: await debug('metrics') });
    }
    await capture('default', 'Template camera, untouched world');
    await debug('camera', [128, 128, 220, 0, 90]);
    await capture('topdown', 'Requested pitch 90°, actual clamped 75° perspective; true orthographic top-down is unavailable in the debug API');
    await debug('camera', [defaultCamera.target[0], defaultCamera.target[2], defaultCamera.distance, defaultCamera.yaw + 180, defaultCamera.pitch]);
    await capture('rotate180', 'Opposite angle from the default template camera');
    const shore = kind === 'city' ? [127, 53, 83, 30, 50] : [112, 112, 83, 35, 50];
    await debug('camera', shore); await capture('shore', 'Natural river/stream shore close-up, before player construction');
    const road = kind === 'city' ? [72, 141, 83, 25, 55] : [145, 175, 83, 25, 55];
    await debug('camera', road); await capture('road-trees', 'Natural road and adjacent vegetation, untouched template');
    const actualWorld = await page.evaluate(async () => {
      const { useWorld } = await import('/src/game/WorldStore.ts');
      const state = useWorld.getState().state;
      const water = 7, roads = 5, tilled = 4, embanked = 1;
      const removed = new Set(state.snapshot.delta.removedEnvIds);
      let treeWater = 0, envWater = 0;
      for (const env of state.env) {
        if (removed.has(env.id)) continue;
        for (let z = 0; z < env.footprint; z++) for (let x = 0; x < env.footprint; x++) {
          if (state.surface[(env.cell[1] + z) * 128 + env.cell[0] + x] === water) {
            envWater++; if (env.assetId.startsWith('tree')) treeWater++;
          }
        }
      }
      const grassSamples = [], roadSamples = [];
      const grassCellSet = new Set();
      for (let z = 3; z < 125; z++) for (let x = 3; x < 125; x++) {
        const index = z * 128 + x;
        if (state.roadTier[index] !== 1 || state.surface[index] !== roads || state.occupancy.has(index)) continue;
        roadSamples.push([x * 2 + 1, z * 2 + 1]);
        for (const [gx, gz] of [[x + 3, z], [x - 3, z], [x, z + 3], [x, z - 3]]) {
          const gi = gz * 128 + gx;
          if (state.surface[gi] === 0 && !state.occupancy.has(gi) && !grassCellSet.has(gi)) {
            grassCellSet.add(gi); grassSamples.push([gx * 2 + 1, gz * 2 + 1]);
          }
        }
      }
      return { mapId: state.template.mapId, templateVersion: state.template.templateVersion, generatorVersion: state.template.generatorVersion,
        envCount: state.env.length, treeWaterFootprintCells: treeWater, envWaterFootprintCells: envWater,
        naturalRoadCells: state.roadTier.filter(tier => tier === 1).length,
        pavedRoadCells: state.roadTier.filter(tier => tier > 1).length,
        embankedCells: state.flags.filter(flags => flags & embanked).length,
        tilledCells: state.surface.filter(surface => surface === tilled).length,
        roadWaterCells: state.surface.reduce((count, surface, index) => count + Number(surface === water && state.roadTier[index] > 0), 0),
        buildings: state.snapshot.buildings.length, bridges: state.snapshot.bridges.length, crops: state.snapshot.crops.length,
        grassSamples, roadSamples };
    });
    const colorEvidence = await page.evaluate(async ({ grass, road }) => {
      const debug = window.__debug, image = new Image(); image.src = debug.screenshot(); await image.decode();
      const imageCanvas = document.createElement('canvas'); imageCanvas.width = image.width; imageCanvas.height = image.height;
      const context = imageCanvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const bounds = document.querySelector('canvas').getBoundingClientRect(), scaleX = image.width / bounds.width, scaleY = image.height / bounds.height;
      function sample(points) {
        const output = [];
        for (const [x, z] of points) {
          const p = debug.project(x, z), px = Math.round((p.x - bounds.left) * scaleX), py = Math.round((p.y - bounds.top) * scaleY);
          if (px < 2 || py < 2 || px >= image.width - 2 || py >= image.height - 2) continue;
          let luminance = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const index = ((py + dz) * image.width + px + dx) * 4;
            luminance += (pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722) / 255;
          }
          output.push({ world: [x, z], pixel: [px, py], luminance: luminance / 9 });
        }
        return output;
      }
      const grassData = sample(grass), roadData = sample(road);
      const median = values => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
      const grassLum = median(grassData.map(p => p.luminance)), roadLum = median(roadData.map(p => p.luminance));
      return { method: 'Median displayed-sRGB luminance of 3×3 pixel patches projected from natural-road cell centers and empty grass three cells away; shadows/perspective remain in the samples.',
        grassLum, roadLum, differencePct: grassLum && roadLum ? 100 * Math.abs(grassLum - roadLum) / Math.max(grassLum, roadLum) : null,
        grassSamples: grassData, roadSamples: roadData };
    }, { grass: actualWorld.grassSamples, road: actualWorld.roadSamples });
    delete actualWorld.grassSamples; delete actualWorld.roadSamples;
    const audit = await debug('auditScene');
    const webgl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { userAgent: navigator.userAgent, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null };
    });
    output.maps[kind] = { templatePath, templateSha256: sha(body), defaultCamera, actualWorld, audit, colorEvidence, samples, shots, errors, requests, webgl };
    await context.close();
    console.log(`${kind}: ${shots.length} angles; ${audit.texturedPlanes} textured planes; ${errors.length} console/page errors; actual ${mapId} v${template.templateVersion}`);
  }
} finally {
  output.finishedAt = new Date().toISOString();
  output.sourceHashesAfter = await sourceHashes();
  output.sourceChangedDuringRun = watchedFiles.filter(file => output.sourceHashesBefore[file] !== output.sourceHashesAfter[file]);
  await writeFile(`${OUT}/visual-check.json`, `${JSON.stringify(output, null, 2)}\n`);
  await browser.close();
}
