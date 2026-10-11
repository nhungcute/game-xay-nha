// docs/10 §5: five camera angles per map from the real client (online mode), plus a scene audit.
import { chromium } from '@playwright/test';
import { registerUI, uniqueName } from './lib/hud.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5191', OUT = process.env.OUT ?? 'docs/evidence/g3';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = {};
const shots = {
  city: [['default', null], ['topdown', [128, 128, 220, 0, 75]], ['rotate180', [128, 132, 160, 220, 50]], ['shore', [118, 46, 50, 20, 40]], ['road', [80, 133, 45, 60, 45]]],
  farm: [['default', null], ['topdown', [128, 128, 220, 0, 75]], ['rotate180', [130, 136, 160, 190, 50]], ['shore', [92, 120, 45, 300, 40]], ['falls', [232, 24, 60, 200, 40]]],
};
for (const kind of ['city', 'farm']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/?debug=1`);
  await registerUI(page, kind, uniqueName(kind === 'city' ? 'Thị Trưởng' : 'Lão Nông'));
  await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  for (const [name, cam] of shots[kind]) {
    if (cam) await page.evaluate(c => window.__debug.camera(...c), cam);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${kind}-${name}.jpg`, type: 'jpeg', quality: 82 });
  }
  report[kind] = { audit: await page.evaluate(() => window.__debug.auditScene()), metrics: await page.evaluate(() => window.__debug.metrics()), snapshot: await page.evaluate(() => { const s = window.__debug.snapshot(); return { mapId: s.mapId, buildings: s.buildings.length, bridges: s.bridges.length, crops: s.crops.length }; }), errors };
  await context.close();
}
await writeFile(`${OUT}/map-shots.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await browser.close();
