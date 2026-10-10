// G4 soak (docs/10 §8 "0 console errors in 15 minutes of normal play"): drives the production UI only
// (no test hooks): camera orbit/zoom/reset, every tool with real map clicks/drags + confirm or cancel, panels,
// buying materials, claiming quests, collecting, graphics toggle and a map switch. Records console/page/HTTP
// errors and GPU object counts at warm-up vs the end (docs/10 §4.1).
// Usage: BASE_URL=http://127.0.0.1:8090 MINUTES=15 node scripts/g4-soak.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8090', OUT = process.env.OUT ?? 'docs/evidence/g4/soak';
const MINUTES = Number(process.env.MINUTES ?? 15), END = Date.now() + MINUTES * 60_000;
await mkdir(OUT, { recursive: true });
let seed = 20261010;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(5000); // a missing control fails a step quickly instead of stalling the session for 30 s
const errors = [], actions = {}, timeline = [];
page.on('pageerror', e => errors.push({ at: new Date().toISOString(), type: 'pageerror', text: e.message }));
page.on('console', m => { if (m.type() === 'error') errors.push({ at: new Date().toISOString(), type: 'console', text: m.text() }); });
page.on('response', r => { if (r.status() >= 400 && r.status() !== 429) errors.push({ at: new Date().toISOString(), type: 'http', text: `${r.status()} ${r.url()}` }); });
const count = name => { actions[name] = (actions[name] ?? 0) + 1; };
const metrics = () => page.evaluate(() => window.__debug.metrics());
const inGame = async () => { await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 60000 }); await page.waitForTimeout(2500); };
async function create(kind, name) {
  await page.locator(`.map-card.${kind} button`, { hasText: /Tạo nhân vật|Chơi tiếp/ }).click();
  if (await page.locator('.field input').count()) {
    await page.locator('.field input').fill(name);
    await page.locator('button.primary', { hasText: 'Vào chơi' }).click();
    if (await page.locator('p.code').waitFor({ timeout: 8000 }).then(() => true, () => false)) await page.locator('button', { hasText: 'Tiếp tục' }).click();
  }
  await inGame();
}
// A cell near the camera target, projected to the screen (production keeps __debug.project/camera with ?debug=1).
async function screenCell(dx = 0, dz = 0) {
  return page.evaluate(([dx, dz]) => {
    const t = window.__debug.cameraState().target, cx = Math.floor(t[0] / 2) + dx, cz = Math.floor(t[2] / 2) + dz;
    const p = window.__debug.project(cx * 2 + 1, cz * 2 + 1);
    return p.x > 300 && p.x < 1300 && p.y > 160 && p.y < 760 ? p : null;
  }, [dx, dz]);
}
// The scenery item closest to the camera target that is on screen (for a realistic, valid "Dọn" drag).
async function treeOnScreen() {
  return page.evaluate(() => {
    const t = window.__debug.cameraState().target;
    const env = window.__debug.env().map(e => ({ e, d: Math.hypot(e.cell[0] * 2 - t[0], e.cell[1] * 2 - t[2]) })).sort((a, b) => a.d - b.d);
    for (const { e } of env.slice(0, 40)) { const p = window.__debug.project(e.cell[0] * 2 + 1, e.cell[1] * 2 + 1); if (p.x > 300 && p.x < 1300 && p.y > 160 && p.y < 760) return p; }
    return null;
  });
}
async function useTool(label) {
  const tool = page.locator('nav.tools button', { hasText: label });
  if (!(await tool.count())) return;
  await tool.click(); count(`tool:${label}`);
  if (label === 'Xây') { const items = page.locator('.catalog.panel button'); const n = await items.count(); if (n) await items.nth(rnd(n)).click(); }
  const a = label === 'Dọn' ? await treeOnScreen() : await screenCell(rnd(9) - 4, rnd(9) - 4);
  const b = label === 'Dọn' && a ? { x: a.x + 12, y: a.y + 8 } : await screenCell(rnd(9) - 4, rnd(9) - 4);
  if (!a) return;
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  if (b && ['Đường', 'Cuốc', 'San nền', 'Kè', 'Dọn', 'Gieo'].includes(label)) await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up(); await page.waitForTimeout(300);
  const confirm = page.locator('.tool-options button.primary');
  if (await confirm.count() && await confirm.isEnabled()) { await confirm.click(); count(`confirm:${label}`); }
  else if (await page.locator('.tool-options button', { hasText: 'Hủy' }).count()) await page.locator('.tool-options button', { hasText: 'Hủy' }).click();
}
const steps = [
  async () => { await page.mouse.move(700, 450); await page.mouse.down({ button: 'right' }); await page.mouse.move(700 + rnd(300) - 150, 450 + rnd(120) - 60, { steps: 8 }); await page.mouse.up({ button: 'right' }); count('orbit'); },
  async () => { await page.mouse.move(400 + rnd(600), 250 + rnd(400)); await page.mouse.wheel(0, rnd(2) ? 300 : -300); count('wheel'); },
  async () => { await page.locator('.camera-buttons button').nth(rnd(3)).click(); count('camera-button'); },
  async () => { const key = ['w', 'a', 's', 'd'][rnd(4)]; await page.keyboard.down(key); await page.waitForTimeout(400); await page.keyboard.up(key); await page.keyboard.press('Escape'); count('keys'); },
  async () => useTool(['Dọn', 'San nền', 'Đường', 'Kè', 'Cầu', 'Xây', 'Phá', 'Khu đất', 'Cuốc', 'Gieo', 'Thu hoạch'][rnd(11)]),
  async () => useTool('Dọn'),
  async () => useTool('Đường'),
  async () => { await page.locator('.resources button').first().click(); await page.locator('.side.panel .item button').nth(rnd(2) * 2).click(); await page.locator('.side.panel .close').click(); count('buy'); },
  async () => { const c = page.locator('aside.quest button:not([disabled])', { hasText: 'Nhận thưởng' }); if (await c.count()) { await c.first().click(); count('claim'); } },
  async () => { const c = page.locator('.resources button', { hasText: 'Thu tất cả' }); if (await c.count()) { await c.click(); count('collect-all'); } },
  async () => { await page.locator('header .brand').click(); await page.waitForTimeout(300); await page.locator('.side.panel .close').click(); count('profile'); },
  async () => { await page.locator('nav.tools button', { hasText: 'Khám phá' }).click(); count('explore'); },
];

await page.goto(`${BASE}/?debug=1`);
await create('city', 'Thử Lâu Phố');
await page.waitForTimeout(3000);
const warm = await metrics();
let switched = false, toggled = false, i = 0;
while (Date.now() < END) {
  const elapsed = (MINUTES * 60_000 - (END - Date.now())) / 60_000;
  try {
    if (!toggled && elapsed > MINUTES * 0.3) {
      await page.locator('header .brand').click(); await page.locator('.settings button', { hasText: 'Thấp' }).click();
      await page.waitForTimeout(800); await page.locator('.settings button', { hasText: 'Cao' }).click(); await page.locator('.side.panel .close').click();
      toggled = true; count('graphics-toggle');
    }
    if (!switched && elapsed > MINUTES * 0.5) {
      await page.locator('button[aria-label="Đổi bản đồ"]').click(); await create('farm', 'Thử Lâu Quê'); switched = true; count('map-switch');
      timeline.push({ minute: Number(elapsed.toFixed(1)), event: 'switched to farm', metrics: await metrics() });
    }
    await steps[rnd(steps.length)]();
  } catch (error) { count('step-skipped'); await page.keyboard.press('Escape').catch(() => {}); }
  await page.waitForTimeout(250 + rnd(600));
  if (++i % 100 === 0) { const m = await metrics(); timeline.push({ minute: Number(elapsed.toFixed(1)), revision: m.revision, fps: Math.round(m.fps), drawCalls: m.drawCalls, geometries: m.geometries, textures: m.textures, programs: m.programs, errors: errors.length }); console.log(JSON.stringify(timeline.at(-1))); }
}
await page.locator('button[aria-label="Đổi bản đồ"]').click(); await page.locator('.map-card.city button', { hasText: 'Chơi tiếp' }).click(); await inGame();
const end = await metrics(), snapshot = await page.evaluate(() => { const s = window.__debug.snapshot(); return { revision: s.revision, level: s.progress.level, buildings: s.buildings.length, cash: s.wallet.cash, netWorth: s.character.netWorth }; });
await page.screenshot({ path: `${OUT}/end.jpg`, type: 'jpeg', quality: 78 });
const report = { base: BASE, minutes: MINUTES, actions, warm, end, cityAtEnd: snapshot, timeline, errors,
  gpuGrowth: { geometries: end.geometries - warm.geometries, textures: end.textures - warm.textures, programs: end.programs - warm.programs } };
await writeFile(`${OUT}/soak.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`soak ${MINUTES} min: ${Object.values(actions).reduce((a, b) => a + b, 0)} actions, ${errors.length} errors, GPU growth ${JSON.stringify(report.gpuGrowth)}, city revision ${snapshot.revision}`);
await browser.close();
if (errors.length) process.exitCode = 1;
