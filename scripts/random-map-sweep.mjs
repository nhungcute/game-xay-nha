// D039: Random map sweep — 500 seeds per map kind, gate 100% pass, diversity metrics,
// hillshade 24-seed minimap sheets, and 4 in-game 3D renders per map kind.
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import {
  generateWorldTemplate,
  rasterizeWater,
  decodeLayers,
  cellVertices,
  zoneOfCell,
} from '../packages/worldgen/src/index.ts';

const OUT_DIR = 'docs/evidence/g4/random-maps';
await mkdir(OUT_DIR, { recursive: true });

const SEED_COUNT = process.env.SWEEP_SEEDS ? parseInt(process.env.SWEEP_SEEDS, 10) : 500;
const START_SEED = 20260000;

function computeStats(values) {
  if (!values.length) return { min: 0, max: 0, avg: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { min, max, avg, median };
}

function findBridgeSpan(template, layers, water) {
  const startZonesSet = new Set(template.startZones);
  const startDryCells = [];
  for (const zid of template.startZones) {
    const ox = (zid % 8) * 16, oz = Math.floor(zid / 8) * 16;
    for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) {
      const cx = ox + dx, cz = oz + dz;
      if (!water[cz * 128 + cx]) startDryCells.push([cx, cz]);
    }
  }

  const visited = new Uint8Array(128 * 128);
  const dryComponents = [];
  for (const [cx, cz] of startDryCells) {
    const idx = cz * 128 + cx;
    if (visited[idx]) continue;
    const comp = [];
    const queue = [idx];
    visited[idx] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const x = cur % 128, z = Math.floor(cur / 128);
      comp.push([x, z]);
      for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
        if (nx >= 0 && nx < 128 && nz >= 0 && nz < 128) {
          const nIdx = nz * 128 + nx;
          if (!visited[nIdx] && !water[nIdx] && startZonesSet.has(zoneOfCell(nx, nz))) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
    }
    dryComponents.push(comp);
  }
  dryComponents.sort((a, b) => b.length - a.length);
  const homeBank = dryComponents[0] ?? [];
  const homeBankSet = new Set(homeBank.map(([x, z]) => z * 128 + x));

  function edgeHeight(heights, [x, z], [dx, dz]) {
    const v = dx ? [z * 129 + x + (dx > 0 ? 1 : 0), (z + 1) * 129 + x + (dx > 0 ? 1 : 0)]
      : [(z + (dz > 0 ? 1 : 0)) * 129 + x, (z + (dz > 0 ? 1 : 0)) * 129 + x + 1];
    return (heights[v[0]] + heights[v[1]]) / 2;
  }

  for (const [hx, hz] of homeBank) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let span = 1; span <= 6; span++) {
        const mx = hx + dx * span, mz = hz + dz * span;
        if (mx < 0 || mx >= 128 || mz < 0 || mz >= 128 || !water[mz * 128 + mx]) break;
        const tx = hx + dx * (span + 1), tz = hz + dz * (span + 1);
        if (tx >= 0 && tx < 128 && tz >= 0 && tz < 128 && startZonesSet.has(zoneOfCell(tx, tz))) {
          const tIdx = tz * 128 + tx;
          if (!water[tIdx] && !homeBankSet.has(tIdx)) {
            const hH = edgeHeight(layers.heightsDm, [hx, hz], [dx, dz]);
            const tH = edgeHeight(layers.heightsDm, [tx, tz], [-dx, -dz]);
            if (Math.abs(hH - tH) <= 10) {
              return { span, from: [hx, hz], to: [tx, tz] };
            }
          }
        }
      }
    }
  }
  return { span: 0, from: null, to: null };
}

async function runSweepForKind(kind) {
  console.log(`\n=== Starting sweep for ${kind.toUpperCase()} (${SEED_COUNT} seeds) ===`);
  const results = [];
  const sheetTiles = [];
  const ingameTemplates = [];

  for (let i = 0; i < SEED_COUNT; i++) {
    const seed = START_SEED + i;
    const t0 = performance.now();
    const { template, attempt, meta } = generateWorldTemplate(kind, seed, 50);
    const durationMs = performance.now() - t0;

    const layers = decodeLayers(template);
    const water = rasterizeWater(template.water);
    const totalWater = water.reduce((s, w) => s + w, 0);
    const waterPct = totalWater / 16384;

    // Start zones flat buildable
    let flatBuildable = 0;
    for (const zid of template.startZones) {
      const ox = (zid % 8) * 16, oz = Math.floor(zid / 8) * 16;
      for (let dz = 0; dz < 16; dz++) for (let dx = 0; dx < 16; dx++) {
        const cx = ox + dx, cz = oz + dz;
        if (!water[cz * 128 + cx]) {
          const verts = cellVertices(cx, cz).map(v => layers.heightsDm[v]);
          const slope = Math.max(...verts) - Math.min(...verts);
          if (slope <= 10) flatBuildable++;
        }
      }
    }
    const flatBuildablePct = flatBuildable / 1024;
    const bridge = findBridgeSpan(template, layers, water);

    const record = {
      seed,
      attempt: attempt + 1,
      durationMs: Math.round(durationMs * 10) / 10,
      waterCells: totalWater,
      waterPct: Math.round(waterPct * 10000) / 100,
      flatBuildableCells: flatBuildable,
      flatBuildablePct: Math.round(flatBuildablePct * 10000) / 100,
      bridgeSpan: bridge.span,
      lakeCV: meta.lakeCV,
      forkDistM: meta.fork.distToStartM,
      forkAngleDeg: meta.fork.angleToStartDeg,
      elevationRangeM: meta.elevationRangeM,
    };
    results.push(record);

    if (i < 4) {
      ingameTemplates.push({ seed, template });
    }

    // Save data for the 24 sheet tiles with hillshade
    if (i < 24) {
      const pixelColors = new Uint8Array(128 * 128 * 3);
      for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) {
        const idx = z * 128 + x;
        const pIdx = idx * 3;
        if (water[idx]) {
          pixelColors[pIdx] = 59;     // R (water blue)
          pixelColors[pIdx + 1] = 130; // G
          pixelColors[pIdx + 2] = 246; // B
        } else {
          // Check if shore
          let isShore = false;
          for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]) {
            if (nx >= 0 && nx < 128 && nz >= 0 && nz < 128 && water[nz * 128 + nx]) {
              isShore = true;
              break;
            }
          }
          if (isShore) {
            pixelColors[pIdx] = 214;
            pixelColors[pIdx + 1] = 200;
            pixelColors[pIdx + 2] = 140;
          } else {
            // Hillshade lighting: Northwest light (-0.7071, -0.7071)
            const hL = layers.heightsDm[z * 129 + Math.max(0, x - 1)] ?? 25;
            const hR = layers.heightsDm[z * 129 + Math.min(128, x + 1)] ?? 25;
            const hU = layers.heightsDm[Math.max(0, z - 1) * 129 + x] ?? 25;
            const hD = layers.heightsDm[Math.min(128, z + 1) * 129 + x] ?? 25;
            const dzdx = (hR - hL) * 0.5;
            const dzdz = (hD - hU) * 0.5;
            const hillshade = Math.max(-35, Math.min(35, Math.round((-dzdx - dzdz) * 1.5)));

            if (layers.biome[idx] === 2) {
              // Rocky crags
              pixelColors[pIdx] = Math.max(30, Math.min(220, 120 + hillshade));
              pixelColors[pIdx + 1] = Math.max(30, Math.min(220, 120 + hillshade));
              pixelColors[pIdx + 2] = Math.max(30, Math.min(220, 110 + hillshade));
            } else if (layers.biome[idx] === 1) {
              // Forest green
              pixelColors[pIdx] = Math.max(20, Math.min(200, 34 + hillshade));
              pixelColors[pIdx + 1] = Math.max(30, Math.min(220, 78 + hillshade));
              pixelColors[pIdx + 2] = Math.max(20, Math.min(200, 34 + hillshade));
            } else {
              // Rolling grass
              pixelColors[pIdx] = Math.max(30, Math.min(220, 110 + hillshade));
              pixelColors[pIdx + 1] = Math.max(40, Math.min(235, 160 + hillshade));
              pixelColors[pIdx + 2] = Math.max(20, Math.min(200, 68 + hillshade));
            }
          }
        }
      }

      const c0 = template.startZones[0] % 8;
      const r0 = Math.floor(template.startZones[0] / 8);
      sheetTiles.push({
        seed,
        attempt: attempt + 1,
        waterPct: record.waterPct,
        flatPct: record.flatBuildablePct,
        span: bridge.span,
        lakeCV: record.lakeCV,
        elevationRangeM: record.elevationRangeM,
        szRect: [c0 * 16, r0 * 16, 32, 32],
        bridgeLine: bridge.from && bridge.to ? [bridge.from, bridge.to] : null,
        pixelsBase64: Buffer.from(pixelColors).toString('base64'),
      });
    }

    if ((i + 1) % 100 === 0 || i === SEED_COUNT - 1) {
      console.log(`Processed ${i + 1}/${SEED_COUNT} seeds... (last: seed ${seed}, att ${attempt + 1}, ${(waterPct * 100).toFixed(1)}% water, CV: ${meta.lakeCV}, ${Math.round(durationMs)} ms)`);
    }
  }

  // Aggregate stats
  const attemptCounts = {};
  for (const r of results) attemptCounts[r.attempt] = (attemptCounts[r.attempt] || 0) + 1;
  const spanCounts = {};
  for (const r of results) spanCounts[r.bridgeSpan] = (spanCounts[r.bridgeSpan] || 0) + 1;

  const waterStats = computeStats(results.map(r => r.waterPct));
  const flatStats = computeStats(results.map(r => r.flatBuildablePct));
  const cvStats = computeStats(results.map(r => r.lakeCV));
  const elevStats = computeStats(results.map(r => r.elevationRangeM));
  const durationStats = computeStats(results.map(r => r.durationMs));
  const sortedDurations = results.map(r => r.durationMs).sort((a, b) => a - b);
  const p95Duration = sortedDurations[Math.floor(sortedDurations.length * 0.95)];

  // Fork distance distribution
  const forkDistBuckets = { '<40m': 0, '40-60m': 0, '60-80m': 0, '>80m': 0 };
  for (const r of results) {
    if (r.forkDistM < 40) forkDistBuckets['<40m']++;
    else if (r.forkDistM <= 60) forkDistBuckets['40-60m']++;
    else if (r.forkDistM <= 80) forkDistBuckets['60-80m']++;
    else forkDistBuckets['>80m']++;
  }

  const summary = {
    mapKind: kind,
    totalSeeds: SEED_COUNT,
    passedSeeds: results.length,
    gatePassed: results.length === SEED_COUNT && results.every(r => r.attempt <= 50),
    attemptsDistribution: attemptCounts,
    avgAttempts: Math.round((results.reduce((s, r) => s + r.attempt, 0) / results.length) * 100) / 100,
    maxAttempts: Math.max(...results.map(r => r.attempt)),
    waterPct: {
      min: Math.round(waterStats.min * 100) / 100,
      max: Math.round(waterStats.max * 100) / 100,
      avg: Math.round(waterStats.avg * 100) / 100,
      median: Math.round(waterStats.median * 100) / 100,
    },
    flatBuildablePct: {
      min: Math.round(flatStats.min * 100) / 100,
      max: Math.round(flatStats.max * 100) / 100,
      avg: Math.round(flatStats.avg * 100) / 100,
    },
    lakeCV: {
      min: Math.round(cvStats.min * 100) / 100,
      max: Math.round(cvStats.max * 100) / 100,
      avg: Math.round(cvStats.avg * 100) / 100,
      passGate: cvStats.min >= 0.4,
    },
    elevationRangeM: {
      min: Math.round(elevStats.min * 10) / 10,
      max: Math.round(elevStats.max * 10) / 10,
      avg: Math.round(elevStats.avg * 10) / 10,
    },
    bridgeSpanDistribution: spanCounts,
    riverForkDistribution: forkDistBuckets,
    durationMs: {
      avg: Math.round(durationStats.avg * 10) / 10,
      max: Math.round(durationStats.max * 10) / 10,
      p95: Math.round((p95Duration || 0) * 10) / 10,
    },
    sampleSeeds: results.slice(0, 24),
  };

  return { summary, sheetTiles, ingameTemplates };
}

async function renderSheet(browser, kind, tiles) {
  console.log(`Rendering 24-seed minimap sheet for ${kind} with hillshade & biomes...`);
  const page = await browser.newPage({ viewport: { width: 1100, height: 860 } });

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 16px; background: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e2e8f0; }
  h1 { margin: 0 0 12px 0; font-size: 20px; font-weight: 600; text-align: center; }
  .grid { display: grid; grid-template-columns: repeat(6, 160px); gap: 12px; justify-content: center; }
  .card { background: #1e293b; border-radius: 6px; padding: 8px; border: 1px solid #334155; }
  .header { font-size: 10px; margin-bottom: 4px; line-height: 1.35; }
  .header b { color: #38bdf8; }
  .header span { color: #a5f3fc; }
  canvas { display: block; border-radius: 4px; image-rendering: pixelated; width: 144px; height: 144px; }
</style>
</head>
<body>
  <h1>${kind === 'city' ? 'City (Thành phố)' : 'Farm (Nông thôn)'} — D039 Hillshade Minimap Sheet (24 Seeds)</h1>
  <div class="grid" id="sheet">
    ${tiles.map((t, idx) => `
      <div class="card">
        <div class="header">
          <b>#${idx + 1}</b> Seed <b>${t.seed}</b> (Att ${t.attempt})<br/>
          Nước: <span>${t.waterPct}%</span> | Đất: <span>${t.flatPct}%</span><br/>
          Cầu: <span>${t.span} ô</span> | CV: <span>${t.lakeCV}</span> | ΔH: <span>${t.elevationRangeM}m</span>
        </div>
        <canvas id="cv_${idx}" width="128" height="128"></canvas>
      </div>
    `).join('')}
  </div>
  <script>
    const tiles = ${JSON.stringify(tiles)};
    for (let idx = 0; idx < tiles.length; idx++) {
      const t = tiles[idx];
      const cv = document.getElementById('cv_' + idx);
      const ctx = cv.getContext('2d');
      const bin = atob(t.pixelsBase64);
      const imgData = ctx.createImageData(128, 128);
      for (let i = 0; i < 128 * 128; i++) {
        imgData.data[i * 4] = bin.charCodeAt(i * 3);
        imgData.data[i * 4 + 1] = bin.charCodeAt(i * 3 + 1);
        imgData.data[i * 4 + 2] = bin.charCodeAt(i * 3 + 2);
        imgData.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);

      // Start zones golden border
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(t.szRect[0], t.szRect[1], t.szRect[2], t.szRect[3]);

      // Bridge marker line
      if (t.bridgeLine) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.bridgeLine[0][0], t.bridgeLine[0][1]);
        ctx.lineTo(t.bridgeLine[1][0], t.bridgeLine[1][1]);
        ctx.stroke();
      }
    }
  </script>
</body>
</html>
  `;

  await page.setContent(html);
  await page.waitForTimeout(1000);
  const outPath = `${OUT_DIR}/sheet-${kind}.png`;
  await page.locator('#sheet').screenshot({ path: outPath, type: 'png' });
  console.log(`Saved sheet to ${outPath}`);
  await page.close();
}

async function renderIngameScreenshots(browser, kind, ingameTemplates) {
  console.log(`\nRendering in-game 3D overview shots for 4 seeds of ${kind}...`);
  for (const { seed, template } of ingameTemplates) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/worlds/farm-g1/template.v1.json', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(template),
      });
    });

    await page.goto('http://127.0.0.1:5190/?debug=1&test=1');
    await page.waitForFunction(() => !!window.__debug?.camera, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.__debug.camera(128, 128, 220, 35, 50);
      window.__debug.timeOfDay(13);
    });
    await page.waitForTimeout(1200);

    const shotFile = `${OUT_DIR}/ingame-${kind}-seed-${seed}.png`;
    await page.screenshot({ path: shotFile, type: 'png' });
    console.log(`Saved in-game shot: ${shotFile}`);
    await page.close();
  }
}

console.log('=== RANDOM MAP SWEEP & IN-GAME QA (D039) ===');
console.log(`Config: ${SEED_COUNT} seeds each for City and Farm.`);

const tStart = performance.now();
const cityData = await runSweepForKind('city');
const farmData = await runSweepForKind('farm');
const totalTime = Math.round((performance.now() - tStart) / 1000);

const sweepReport = {
  at: new Date().toISOString(),
  totalDurationSeconds: totalTime,
  gatePassed: cityData.summary.gatePassed && farmData.summary.gatePassed && cityData.summary.lakeCV.passGate && farmData.summary.lakeCV.passGate,
  city: cityData.summary,
  farm: farmData.summary,
};

const jsonPath = `${OUT_DIR}/sweep.json`;
await writeFile(jsonPath, JSON.stringify(sweepReport, null, 2));
console.log(`Saved sweep statistics to ${jsonPath}`);

// Launch browser for sheets and 3D in-game renders
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

await renderSheet(browser, 'city', cityData.sheetTiles);
await renderSheet(browser, 'farm', farmData.sheetTiles);

await renderIngameScreenshots(browser, 'city', cityData.ingameTemplates);
await renderIngameScreenshots(browser, 'farm', farmData.ingameTemplates);

await browser.close();

console.log(`\n=== SWEEP COMPLETED in ${totalTime}s ===`);
console.log(`Gate passed: ${sweepReport.gatePassed ? 'YES (100% pass, lake CV >= 0.4)' : 'FAILED'}`);
console.log(`City: avg att ${cityData.summary.avgAttempts}, water ${cityData.summary.waterPct.avg}%, flat ${cityData.summary.flatBuildablePct.avg}%, lake CV ${cityData.summary.lakeCV.avg}, elev ${cityData.summary.elevationRangeM.avg}m`);
console.log(`Farm: avg att ${farmData.summary.avgAttempts}, water ${farmData.summary.waterPct.avg}%, flat ${farmData.summary.flatBuildablePct.avg}%, lake CV ${farmData.summary.lakeCV.avg}, elev ${farmData.summary.elevationRangeM.avg}m`);

if (!sweepReport.gatePassed) {
  process.exitCode = 1;
}
