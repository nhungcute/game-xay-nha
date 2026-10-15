// Khu đất overlay QA (offline dev server, BASE_URL default :5200): shots (fresh city/farm, mid-game, day/night, Pixel 7, tool off),
// click-test (highlighted zone unlocks and loses its highlight, a non-highlighted one does not), draw calls and FPS on/off.
// Usage: BASE_URL=http://127.0.0.1:5200 node scripts/zone-qa.mjs
import { chromium, devices } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dismissLevelUp } from './lib/hud.mjs';
import { measureFps } from './lib/perf.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5200', OUT = 'docs/evidence/g4/zones', FULL = 'docs/evidence/g4/full-world';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const maps = { city: 'city-coast-01', farm: 'farm-valley-01' };
const report = { base: BASE, at: new Date().toISOString(), failures: [], shots: [], perf: {}, click: {} };
const fail = m => { report.failures.push(m); console.log('FAIL', m); };

async function open(kind, options, mutate) {
  const context = await browser.newContext(options), page = await context.newPage();
  const template = await readFile(`apps/web/public/worlds/${maps[kind]}/template.v2.json`, 'utf8');
  await page.route('**/worlds/farm-g1/template.v1.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: template }));
  await page.goto(`${BASE}/?debug=1&test=1`);
  await page.waitForFunction(() => !!window.__debug?.command, null, { timeout: 60000 });
  await page.addStyleTag({ content: '.debug{display:none!important}' });
  await page.waitForTimeout(1500);
  if (mutate) {
    const snapshot = await mutate();
    const ok = await page.evaluate(s => { const cur = window.__debug.snapshot(); s.worldId = cur.worldId; s.accountId = cur.accountId; return window.__debug.loadSnapshot(s); }, snapshot);
    if (!ok.ok) throw new Error('snapshot rejected ' + JSON.stringify(ok));
  }
  await page.waitForTimeout(2000);
  await dismissLevelUp(page);
  return { context, page };
}
/** Sets cash (and optionally drops land value) keeping the snapshot net-worth invariant. */
const setCash = (s, cash, land = s.landValue) => { s.character.netWorth += (cash - s.wallet.cash) + (land - s.landValue); s.wallet.cash = cash; s.landValue = land; };
const cur = page => page.evaluate(() => window.__debug.snapshot());
async function setSnapshot(page, mut) {
  const s = await cur(page); mut(s);
  const ok = await page.evaluate(x => window.__debug.loadSnapshot(x), s);
  if (!ok.ok) throw new Error('snapshot rejected ' + JSON.stringify(ok));
  await page.waitForTimeout(700);
}
async function zoneTool(page, tap) {
  const click = l => tap ? l.tap() : l.click();
  await click(page.locator('.hud3-cat[data-cat=land]')); await page.waitForTimeout(250);
  await click(page.locator('.hud3-tray [data-tool=zone]')); await page.waitForTimeout(500);
}
const overview = (page, kind) => page.evaluate(k => window.__debug.camera(128, 128, k === 'wide' ? 330 : 250, 35, 52), kind);
const shot = async (page, file) => { await page.screenshot({ path: `${OUT}/${file}.jpg`, type: 'jpeg', quality: 84 }); report.shots.push(file); };
const zoneCount = page => page.evaluate(() => window.__debug.zoneHighlights().reduce((a, h) => (a[h.kind] = (a[h.kind] ?? 0) + 1, a), {}));
const sprites = page => page.evaluate(() => window.__debug.sceneMeshes().filter(m => m.name === 'zone-highlight').map(m => m.visible));

// Mid-game: the full-world snapshot with most unlocked zones removed (kept: zones holding anything) so some remain locked.
async function midGame(kind) {
  const snap = JSON.parse(await readFile(`${FULL}/${kind}-snapshot.json`, 'utf8'));
  const used = new Set([...snap.buildings.map(b => Math.floor(b.anchor[1] / 16) * 8 + Math.floor(b.anchor[0] / 16)), ...(snap.crops ?? []).map(c => Math.floor(c.cell[1] / 16) * 8 + Math.floor(c.cell[0] / 16))]);
  const keep = snap.unlockedZones.filter((z, i) => used.has(z) || i < 6);
  snap.unlockedZones = keep; setCash(snap, 9000, 0);
  return snap;
}

for (const [name, options] of [['1440x900', { viewport: { width: 1440, height: 900 } }], ['pixel7', devices['Pixel 7']]]) {
  const tap = name === 'pixel7';
  for (const kind of ['city', 'farm']) {
    const { context, page } = await open(kind, options);
    await page.evaluate(() => window.__debug.timeOfDay(13));
    await overview(page, 'mid'); await page.waitForTimeout(700);
    await shot(page, `${kind}-tool-off-${name}`);
    const offMeshes = await sprites(page); if (offMeshes.some(Boolean)) fail(`${name} ${kind}: overlay visible with tool off`);
    await zoneTool(page, tap); await page.waitForTimeout(500);
    report[`${name}-${kind}-fresh`] = await zoneCount(page);
    await shot(page, `${kind}-fresh-day-${name}`);
    if (!tap) {
      await page.evaluate(() => window.__debug.timeOfDay(23)); await page.waitForTimeout(900);
      await shot(page, `${kind}-fresh-night-${name}`);
      await page.evaluate(() => window.__debug.timeOfDay(13)); await page.waitForTimeout(500);
      // Close view: label legibility at the default-ish distance.
      const first = (await page.evaluate(() => window.__debug.zoneHighlights())).find(h => h.kind === 'ok' || h.kind === 'poor');
      if (first) { await page.evaluate(z => window.__debug.camera(z % 8 * 32 + 16, Math.floor(z / 8) * 32 + 16, 120, 35, 48), first.zone); await page.waitForTimeout(600); await shot(page, `${kind}-fresh-close-${name}`); }
    }
    await context.close();
  }
  for (const kind of ['city', 'farm']) {
    const { context, page } = await open(kind, options, () => midGame(kind));
    await page.evaluate(() => window.__debug.timeOfDay(13));
    await overview(page, 'mid'); await zoneTool(page, tap); await page.waitForTimeout(600);
    report[`${name}-${kind}-mid`] = await zoneCount(page);
    await shot(page, `${kind}-mid-day-${name}`);
    if (!tap) {
      await setSnapshot(page, s => { setCash(s, 100); }); await page.waitForTimeout(700);
      report[`${name}-${kind}-mid-poor`] = await zoneCount(page);
      await shot(page, `${kind}-mid-poor-${name}`);
    }
    await context.close();
  }
}

// Click-test (city, desktop and touch): a highlighted zone unlocks and loses its highlight; a non-highlighted one does not.
for (const [name, options] of [['1440x900', { viewport: { width: 1440, height: 900 } }], ['pixel7', devices['Pixel 7']]]) {
  const tap = name === 'pixel7';
  const { context, page } = await open('city', options, () => midGame('city'));
  await page.evaluate(() => window.__debug.timeOfDay(13));
  await overview(page, 'mid'); await zoneTool(page, tap); await page.waitForTimeout(600);
  const list = await page.evaluate(() => window.__debug.zoneHighlights()), ok = list.find(h => h.kind === 'ok');
  const unlocked = (await cur(page)).unlockedZones;
  const dead = [...Array(64).keys()].find(z => !unlocked.includes(z) && !list.some(h => h.zone === z && (h.kind === 'ok')));
  const centre = z => page.evaluate(([x, zz]) => window.__debug.project(x, zz), [z % 8 * 32 + 16, Math.floor(z / 8) * 32 + 16]);
  const pick = async z => { await page.evaluate(zz => window.__debug.camera(zz % 8 * 32 + 16, Math.floor(zz / 8) * 32 + 16, 200, 35, 52), z); await page.waitForTimeout(700); const p = await centre(z); if (tap) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(500); };
  const confirm = page.locator('.tool-options button.primary');
  const rec = report.click[name] = { ok: ok?.zone, dead, price: ok?.cost, cash: (await cur(page)).wallet.cash };
  // Non-highlighted: tapping must not unlock (confirm disabled / absent).
  if (dead !== undefined) {
    await pick(dead); rec.deadConfirmEnabled = await confirm.isEnabled().catch(() => false);
    if (rec.deadConfirmEnabled) { await confirm.click().catch(() => {}); await page.waitForTimeout(500); }
    rec.deadUnlocked = (await cur(page)).unlockedZones.includes(dead);
    if (rec.deadUnlocked) fail(`${name}: non-highlighted zone ${dead} got unlocked`);
    await shot(page, `click-dead-${name}`);
  }
  if (ok) {
    await pick(ok.zone); rec.okConfirmEnabled = await confirm.isEnabled().catch(() => false);
    rec.feedback = await page.locator('.feedback span').innerText().catch(() => null); rec.at = await centre(ok.zone);
    await shot(page, `click-ok-picked-${name}`);
    // Desktop confirms on release (already unlocked here); touch waits for the confirm button.
    if (rec.okConfirmEnabled) { await confirm.click(); await page.waitForTimeout(900); }
    rec.okUnlocked = (await cur(page)).unlockedZones.includes(ok.zone);
    rec.stillHighlighted = (await page.evaluate(() => window.__debug.zoneHighlights())).some(h => h.zone === ok.zone);
    rec.cashAfter = (await cur(page)).wallet.cash;
    if (!rec.okUnlocked) fail(`${name}: highlighted zone ${ok.zone} did not unlock`);
    if (rec.stillHighlighted) fail(`${name}: highlight remained after unlock`);
    await shot(page, `click-after-unlock-${name}`);
  } else fail(`${name}: no highlighted zone for click-test`);
  await context.close();
}

// Draw calls and FPS, tool on vs off, city full-world (all zones locked except those holding something), high quality.
{
  const { context, page } = await open('city', { viewport: { width: 1440, height: 900 } }, () => midGame('city'));
  await page.evaluate(() => { window.__debug.timeOfDay(13); window.__debug.camera(128, 128, 250, 35, 52); });
  const metrics = async () => { await page.waitForTimeout(600); const m = await page.evaluate(() => window.__debug.metrics()); return { drawCalls: m.drawCalls, triangles: m.triangles, geometries: m.geometries, textures: m.textures, programs: m.programs }; };
  const rounds = [];
  report.perf.offMetrics = await metrics();
  await zoneTool(page, false); report.perf.onMetrics = await metrics();
  report.perf.activeTool = await page.evaluate(() => document.querySelector('.tool-options strong')?.textContent);
  let mode = 'on';
  for (let i = 0; i < 8; i++) { // interleaved: on, off, on, off... (a second press of the tool returns to explore)
    const active = await page.evaluate(() => window.__debug.zoneHighlights().length);
    if ((mode === 'on') !== (active > 0)) fail(`perf: mode ${mode} but ${active} highlights`);
    rounds.push({ mode, active, ...(await measureFps(page, { warmupMs: 800, samples: 3, framesPerSample: 90 })) });
    await page.locator(`.hud3-tray [data-tool=${mode === 'on' ? 'clear' : 'zone'}]`).click(); // Dọn = tool off
    mode = mode === 'on' ? 'off' : 'on'; await page.waitForTimeout(500);
  }
  report.perf.rounds = rounds;
  await context.close();
}

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.perf), report.failures.length ? 'FAILURES ' + report.failures.length : 'OK');
await browser.close();
process.exit(report.failures.length ? 1 : 0);
