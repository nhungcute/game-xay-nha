// D035 visual QA: Streetlight (deco_streetlight) verification.
// Places 4-6 streetlights along a road in farm and city via __debug PLACE_BUILDING.
// Measures close-up (25 m) and mid-range (70 m) views at 13:00 and 22:00 in high and low quality, plus Pixel 7 at 22:00.
// Gates:
//   1. At 22:00, average brightness on lit cell is at least 2x higher than adjacent cell without light.
//   2. At 13:00, difference between lit cell and adjacent cell is <= 5%.
//   3. Cell >= 2 cells away does not brighten at 22:00.
//   4. Draw calls increase <= 2 compared to without streetlights.
//   5. No console errors.
// Exits non-zero on any gate failure.

import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5190';
const OUT = 'docs/evidence/g4/streetlight';
const FULL_WORLD = 'docs/evidence/g4/full-world';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

const report = {
  base: BASE,
  at: new Date().toISOString(),
  shots: [],
  gates: {},
  measurements: {},
  errors: [],
};

async function loadWorld(page, kind) {
  const mapId = kind === 'city' ? 'city-coast-01' : 'farm-valley-01';
  const template = await readFile(`apps/web/public/worlds/${mapId}/template.v2.json`, 'utf8');
  const snapshot = JSON.parse(await readFile(`${FULL_WORLD}/${kind}-snapshot.json`, 'utf8'));

  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.loadSnapshot, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  const loaded = await page.evaluate(s => {
    const cur = window.__debug.snapshot();
    s.worldId = cur.worldId;
    s.accountId = cur.accountId;
    return window.__debug.loadSnapshot(s);
  }, snapshot);
  if (!loaded.ok) throw new Error(`${kind} snapshot rejected`);
  await page.waitForTimeout(2000);
  await dismissLevelUp(page);
}

// Sample ground luminance around cell center, offsetting from the center to avoid hitting the pole
async function sampleGroundLuma(page, cellX, cellZ) {
  return page.evaluate(([cx, cz]) => {
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    // Sample 4 points in the cell offset 0.4 m from center
    const pts = [
      [cx * 2 + 1 + 0.4, cz * 2 + 1 + 0.4],
      [cx * 2 + 1 - 0.4, cz * 2 + 1 + 0.4],
      [cx * 2 + 1 + 0.4, cz * 2 + 1 - 0.4],
      [cx * 2 + 1 - 0.4, cz * 2 + 1 - 0.4],
    ];
    let sum = 0;
    for (const [wx, wz] of pts) {
      const sc = window.__debug.project(wx, wz);
      const pixels = new Uint8Array(4);
      const glY = canvas.height - Math.round(sc.y);
      gl.readPixels(Math.round(sc.x), glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      sum += 0.2126 * pixels[0] + 0.7152 * pixels[1] + 0.0722 * pixels[2];
    }
    return sum / pts.length;
  }, [cellX, cellZ]);
}

try {
  // Test both worlds: Farm and City
  for (const kind of ['farm', 'city']) {
    console.log(`=== Testing ${kind.toUpperCase()} ===`);
    const pageErrors = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', e => { pageErrors.push(e.message); report.errors.push(`${kind}: ${e.message}`); });
    page.on('console', m => { if (m.type() === 'error') { pageErrors.push(m.text()); report.errors.push(`${kind}: ${m.text()}`); } });

    await loadWorld(page, kind);

    // Pick street placement coordinates along a road:
    // Farm: road along z=64..68, streetlights at [48, 64..67]
    // City: road-adjacent spots at [60, 42], [62, 41], [62, 42], [61, 82]
    const spots = kind === 'farm'
      ? [[48, 64], [48, 65], [48, 66], [48, 67]]
      : [[60, 42], [62, 41], [62, 42], [61, 82]];

    const focusSpot = spots[0];
    const adjSpot = kind === 'farm' ? [49, 64] : [60, 41];
    const farSpot = kind === 'farm' ? [51, 64] : [60, 39];

    // Settle wallet/materials before measuring baseline
    await page.evaluate(() => window.__debug.command('BUY_MATERIAL', { wood: 50, stone: 100 }));
    await page.waitForTimeout(500);

    // 1. Measure baseline metrics without streetlights
    await page.evaluate(() => window.__debug.timeOfDay(13));
    await page.evaluate(([fx, fz]) => window.__debug.camera(fx * 2 + 1, fz * 2 + 1, 25, 30, 45), focusSpot);
    await page.waitForTimeout(1000);
    const _baseCalls13 = (await page.evaluate(() => window.__debug.metrics())).drawCalls;

    await page.evaluate(() => window.__debug.timeOfDay(22));
    await page.waitForTimeout(1000);
    const baseCalls22 = (await page.evaluate(() => window.__debug.metrics())).drawCalls;
    const baseFarLuma22 = await sampleGroundLuma(page, farSpot[0], farSpot[1]);

    // 2. Place streetlights via __debug command PLACE_BUILDING and advance
    const placed = await page.evaluate((cells) => {
      const results = [];
      for (const [x, z] of cells) {
        const res = window.__debug.command('PLACE_BUILDING', { defId: 'deco_streetlight', anchor: [x, z], rotation: 0 });
        if (res.accepted) results.push([x, z]);
      }
      window.__debug.advance(16000);
      return results;
    }, spots);
    console.log(`Placed ${placed.length} streetlights:`, placed);

    await page.waitForTimeout(1500);

    // 3. Measure metrics with streetlights
    const afterCalls22 = (await page.evaluate(() => window.__debug.metrics())).drawCalls;
    const litLuma22 = await sampleGroundLuma(page, focusSpot[0], focusSpot[1]);
    const adjLuma22 = await sampleGroundLuma(page, adjSpot[0], adjSpot[1]);
    const farLuma22 = await sampleGroundLuma(page, farSpot[0], farSpot[1]);

    await page.evaluate(() => window.__debug.timeOfDay(13));
    await page.waitForTimeout(1000);
    const _afterCalls13 = (await page.evaluate(() => window.__debug.metrics())).drawCalls;
    const litLuma13 = await sampleGroundLuma(page, focusSpot[0], focusSpot[1]);
    const adjLuma13 = await sampleGroundLuma(page, adjSpot[0], adjSpot[1]);

    const drawCallDiff = afterCalls22 - baseCalls22;
    const nightRatio = litLuma22 / adjLuma22;
    const dayDiffPct = (Math.abs(litLuma13 - adjLuma13) / adjLuma13) * 100;
    const farBrightened = (farLuma22 - baseFarLuma22) > 2.0;

    console.log(`  22h: lit=${litLuma22.toFixed(1)}, adj=${adjLuma22.toFixed(1)}, ratio=${nightRatio.toFixed(2)}x (need >= 2x)`);
    console.log(`  13h: lit=${litLuma13.toFixed(1)}, adj=${adjLuma13.toFixed(1)}, diff=${dayDiffPct.toFixed(2)}% (need <= 5%)`);
    console.log(`  Far (2 cells away): before=${baseFarLuma22.toFixed(1)}, after=${farLuma22.toFixed(1)}`);
    console.log(`  Draw calls: before=${baseCalls22}, after=${afterCalls22}, diff=${drawCallDiff} (need <= 2)`);

    report.measurements[kind] = {
      spots: placed,
      nightRatio: +nightRatio.toFixed(2),
      dayDiffPct: +dayDiffPct.toFixed(2),
      drawCallDiff,
      farBrightened,
      litLuma22: +litLuma22.toFixed(1),
      adjLuma22: +adjLuma22.toFixed(1),
      litLuma13: +litLuma13.toFixed(1),
      adjLuma13: +adjLuma13.toFixed(1),
    };

    // 4. Capture shots: close (25m) and mid (70m), high and low, 13h and 22h
    for (const [distName, dist] of [['close', 25], ['mid', 70]]) {
      await page.evaluate(([fx, fz, d]) => window.__debug.camera(fx * 2 + 1, fz * 2 + 1, d, 30, 45), [...focusSpot, dist]);
      for (const [hourName, hour] of [['13h', 13], ['22h', 22]]) {
        await page.evaluate(h => window.__debug.timeOfDay(h), hour);
        for (const quality of ['high', 'low']) {
          await page.evaluate(q => window.__debug.setQuality(q), quality);
          await page.waitForTimeout(1000);

          const shotFile = `${OUT}/${kind}-${distName}-${hourName}-${quality}.jpg`;
          await page.screenshot({ path: shotFile, type: 'jpeg', quality: 85 });
          report.shots.push({ kind, distName, hourName, quality, file: shotFile });
          console.log(`  Captured ${shotFile}`);
        }
      }
    }

    // 5. Pixel 7 at 22:00
    await context.close();

    const mobileContext = await browser.newContext({
      ...devices['Pixel 7'],
    });
    const mobilePage = await mobileContext.newPage();
    await loadWorld(mobilePage, kind);
    await mobilePage.evaluate((cells) => {
      window.__debug.command('BUY_MATERIAL', { wood: 50, stone: 100 });
      for (const [x, z] of cells) {
        window.__debug.command('PLACE_BUILDING', { defId: 'deco_streetlight', anchor: [x, z], rotation: 0 });
      }
      window.__debug.advance(16000);
    }, spots);
    await mobilePage.evaluate(([fx, fz]) => window.__debug.camera(fx * 2 + 1, fz * 2 + 1, 35, 30, 45), focusSpot);
    await mobilePage.evaluate(() => window.__debug.timeOfDay(22));
    await mobilePage.waitForTimeout(1500);
    const pixel7File = `${OUT}/${kind}-pixel7-22h.jpg`;
    await mobilePage.screenshot({ path: pixel7File, type: 'jpeg', quality: 85 });
    report.shots.push({ kind, device: 'Pixel 7', file: pixel7File });
    console.log(`  Captured ${pixel7File}`);
    await mobileContext.close();
  }

  // Gates evaluation
  const farmM = report.measurements.farm;
  const cityM = report.measurements.city;

  const gates = {
    farmNightBrightness2x: farmM.nightRatio >= 2.0,
    cityNightBrightness2x: cityM.nightRatio >= 2.0,
    farmDayDiffUnder5Pct: farmM.dayDiffPct <= 5.0,
    cityDayDiffUnder5Pct: cityM.dayDiffPct <= 5.0,
    farmFarUnlit: !farmM.farBrightened,
    cityFarUnlit: !cityM.farBrightened,
    farmDrawCallsOk: farmM.drawCallDiff <= 2,
    cityDrawCallsOk: cityM.drawCallDiff <= 2,
    noConsoleErrors: report.errors.length === 0,
  };

  report.gates = gates;
  console.log('=== GATES SUMMARY ===', JSON.stringify(gates, null, 2));

  await writeFile(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

  const failedGates = Object.entries(gates).filter(([, pass]) => !pass);
  if (failedGates.length > 0) {
    console.error('FAILED GATES:', failedGates.map(([name]) => name).join(', '));
    process.exit(1);
  }

  console.log('ALL GATES PASSED!');
} finally {
  await browser.close();
}
