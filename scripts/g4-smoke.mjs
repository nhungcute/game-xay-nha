// G4 production smoke (docs/10 §8): against the Docker stack, on Chromium desktop and WebKit (iPhone 13).
// One account per browser (production limit: 5 new accounts/hour/IP): register username + PIN with a City character
// through the real UI, buy 1 wood, reload; then "Đổi bản đồ" → open the Farm character on the same account, buy,
// reload; finally log in with username + PIN in a fresh browser context (another device) and see both characters.
// Checks HUD, no test hooks in production, reload restores the same world, graphics default per device, draw-call
// budget, no console/page errors or HTTP ≥ 400.
// Usage: BASE_URL=http://127.0.0.1:8090 node scripts/g4-smoke.mjs
import { chromium, devices, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { SYNC, createOtherMapUI, hudBar, loginUI, materialsButton, openSwitchMap, registerUI, uniqueName } from './lib/hud.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8090', OUT = process.env.OUT ?? 'docs/evidence/g4/smoke';
await mkdir(OUT, { recursive: true });
const runs = [
  { name: 'chromium-desktop', type: chromium, launch: { executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] }, context: { viewport: { width: 1440, height: 900 } }, quality: 'high' },
  { name: 'webkit-iphone13', type: webkit, launch: {}, context: { ...devices['iPhone 13'] }, quality: 'low' },
];
const report = { base: BASE, startedAt: new Date().toISOString(), health: (await (await fetch(`${BASE}/health`)).text()).trim(), runs: {} };
let failed = report.health !== 'ok';
const synced = page => page.waitForFunction(sel => /Đã đồng bộ/.test(document.querySelector(sel)?.textContent ?? ''), SYNC, { timeout: 30000 });
const inGame = async page => { await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 60000 }); await synced(page); await page.waitForTimeout(2000); };
// Time-independent world summary (income/serverTime advance between loads, so the full state hash may differ).
const essence = page => page.evaluate(() => { const s = window.__debug.snapshot();
  return JSON.stringify({ worldId: s.worldId, mapId: s.mapId, revision: s.revision, wallet: s.wallet, level: s.progress.level, xp: s.progress.xp, questIndex: s.progress.questIndex, buildings: s.buildings.map(b => [b.id, b.defId, b.anchor]), removed: [...s.delta.removedEnvIds].sort() }); });

for (const run of runs) {
  const browser = await run.type.launch({ headless: true, ...run.launch });
  const context = await browser.newContext(run.context), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(`pageerror ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const result = report.runs[run.name] = { maps: {}, errors };
  const name = uniqueName('Kiểm Thử'), pin = '305917';
  for (const kind of ['city', 'farm']) {
    const started = Date.now();
    if (kind === 'city') await page.goto(`${BASE}/?debug=1`);
    else await openSwitchMap(page);
    await page.locator(`.map-card.${kind} button`, { hasText: 'Tạo nhân vật' }).waitFor({ timeout: 30000 });
    const mapScreenMs = Date.now() - started;
    if (kind === 'city') await registerUI(page, kind, name, pin, { tap: false }); else await createOtherMapUI(page, kind);
    await inGame(page);
    // One real UI command (buy 1 wood), confirmed by the server, so the reload check covers persistence.
    await materialsButton(page).click();
    await page.locator('.side.panel .item', { hasText: 'Gỗ' }).locator('button', { hasText: 'Mua 1' }).first().click();
    await page.locator('.side.panel .close').click();
    await page.waitForFunction(() => window.__debug.snapshot().revision >= 1, null, { timeout: 20000 });
    await synced(page);
    const before = await essence(page);
    const metrics = await page.evaluate(() => window.__debug.metrics()), hooks = await page.evaluate(() => typeof window.__debug.command);
    const hud = await hudBar(page).innerText();
    await page.screenshot({ path: `${OUT}/${run.name}-${kind}.jpg`, type: 'jpeg', quality: 78 });
    await page.reload();
    await inGame(page);
    const after = await essence(page);
    const checks = {
      hud: hud.includes(name),
      noTestHooksInProduction: hooks === 'undefined',
      reloadSameWorld: after === before && JSON.parse(before).revision >= 1 && JSON.parse(before).mapId.startsWith(kind),
      graphicsDefault: metrics.quality === run.quality,
      drawCallBudget: metrics.drawCalls <= (run.quality === 'low' ? 150 : 300),
    };
    result.maps[kind] = { world: JSON.parse(before), mapScreenMs, metrics, checks };
    if (Object.values(checks).some(v => !v)) failed = true;
    console.log(`${run.name} ${kind}: ${Object.entries(checks).map(([k, v]) => `${k}=${v ? 'PASS' : 'FAIL'}`).join(' ')} calls=${metrics.drawCalls} fps=${Math.round(metrics.fps)}`);
  }
  // Another device: username + PIN lists both characters of this account.
  const other = await browser.newContext(run.context), pageB = await other.newPage();
  await pageB.goto(`${BASE}/?debug=1`);
  await pageB.locator('.map-card.city').waitFor({ timeout: 30000 });
  await loginUI(pageB, name, pin);
  await pageB.locator('.map-card.farm .who').waitFor({ timeout: 30000 });
  const loginBoth = (await pageB.locator('.map-card.city .who').innerText()).includes(name) && (await pageB.locator('.map-card.farm .who').innerText()).includes(name);
  result.loginOnAnotherDevice = loginBoth; if (!loginBoth) failed = true;
  console.log(`${run.name} login on another device (username + PIN): ${loginBoth ? 'PASS' : 'FAIL'}`);
  await other.close();
  console.log(`${run.name}: ${errors.length} console/page/HTTP errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  if (errors.length) failed = true;
  await context.close(); await browser.close();
}
report.finishedAt = new Date().toISOString();
await writeFile(`${OUT}/smoke.json`, `${JSON.stringify(report, null, 2)}\n`);
if (failed) { console.error('G4 smoke: FAIL'); process.exitCode = 1; } else console.log('G4 smoke: PASS');
