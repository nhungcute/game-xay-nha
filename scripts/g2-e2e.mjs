/**
 * G2 online E2E (docs/10 §4 items 1, 2, 6, 8) against web (online mode) + API + Postgres.
 * BASE_URL defaults to the dev server (vite --mode online on :5191 proxying /api).
 * Writes docs/evidence/g2/*.jpg and g2-e2e.json; exit code 1 on any failed check.
 */
import { chromium } from '@playwright/test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5191';
const OUT = process.env.OUT ?? 'docs/evidence/g2';
await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith('.jpg')) await rm(`${OUT}/${f}`);
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const checks = [], errors = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); };
let shotNo = 0;
const shot = (page, name) => page.screenshot({ path: `${OUT}/${String(++shotNo).padStart(2, '0')}-${name}.jpg`, type: 'jpeg', quality: 80 });
async function newPage(context) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|ERR_INTERNET/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return page;
}
const debug = (page, fn, arg) => page.evaluate(([f, a]) => window.__debug[f](...(a ?? [])), [fn, arg]);
const apiCall = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const token = localStorage.getItem('xay-nha.token');
  const r = await fetch(p, { method: m, headers: { authorization: `Bearer ${token}`, ...(b ? { 'content-type': 'application/json' } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [method, path, body]);
const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const essence = s => JSON.stringify(stable({ revision: s.revision, wallet: s.wallet, progress: s.progress, buildings: s.buildings.map(b => [b.id, b.defId, b.anchor, b.status]), removed: [...s.delta.removedEnvIds].sort(), zones: Object.keys(s.delta.zones).sort() }));
async function waitSynced(page, timeout = 15000) {
  await page.waitForFunction(() => /Đã đồng bộ/.test(document.querySelector('.sub-hud [role=status]')?.textContent ?? ''), null, { timeout });
}
async function tool(page, label) { await page.locator('nav.tools button', { hasText: label }).first().click(); await page.waitForTimeout(150); }
async function at(page, cell) {
  const p = await debug(page, 'project', [cell[0] * 2 + 1, cell[1] * 2 + 1]);
  const tag = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [p.x, p.y]);
  if (tag !== 'CANVAS') throw new Error(`cell ${cell} covered by ${tag}`);
  return p;
}
async function drag(page, a, b) { const p = await at(page, a), q = await at(page, b); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300); }
async function click(page, cell) { const p = await at(page, cell); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300); }

// ---- 1. New player: map choice → name → recovery code → game ----
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await newPage(ctxA);
await page.goto(`${BASE}/?debug=1`);
await page.getByText('Chọn vùng đất').waitFor({ timeout: 20000 });
await shot(page, 'map-select');
await page.locator('.map-card.farm button', { hasText: 'Tạo nhân vật' }).click();
const name = `Thử Nghiệm ${String(Date.now()).slice(-4)}`;
await page.locator('.field input').fill('ab');
check('name shorter than 3 characters keeps "Vào chơi" disabled', await page.locator('button.primary', { hasText: 'Vào chơi' }).isDisabled());
await page.locator('.field input').fill(name);
await shot(page, 'create-character');
await page.locator('button.primary', { hasText: 'Vào chơi' }).click();
await page.locator('.code').waitFor({ timeout: 15000 });
const recoveryCode = (await page.locator('.code').innerText()).trim();
check('recovery code shown once in XXXX-XXXX-XXXX format', /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(recoveryCode), recoveryCode);
await shot(page, 'recovery-code');
await page.locator('button', { hasText: 'Tiếp tục' }).click();
await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 });
await waitSynced(page);
const hud = await page.locator('header.hud').innerText();
check('game HUD shows the new character (level 1, $2,000)', hud.includes(name) && /Cấp 1/.test(hud) && hud.includes('$2,000'), hud.split('\n').slice(0, 4));
await shot(page, 'game-start');

// ---- 2. Play through the UI; every action reaches the server ----
await debug(page, 'camera', [143, 157, 60, 0, 62]); await page.waitForTimeout(400);
await page.locator('.resources button').first().click();
await page.locator('.side.panel .item', { hasText: 'Gỗ' }).locator('button', { hasText: 'Mua 10' }).click();
await page.locator('.side.panel .close').click();
await tool(page, 'Dọn'); await drag(page, [71, 77], [73, 79]);
await tool(page, 'Xây');
await page.locator('.catalog button', { hasText: 'Chợ' }).first().click();
await page.locator('.tool-options label', { hasText: 'San tự động' }).locator('input').check();
await click(page, [71, 77]);
await tool(page, 'Khám phá');
await waitSynced(page);
const quest = page.locator('aside.quest button', { hasText: 'Nhận thưởng' });
await quest.click(); await page.waitForTimeout(500); await waitSynced(page);
await shot(page, 'market-built');
const local = await debug(page, 'snapshot');
const server = await apiCall(page, 'GET', `/api/worlds/${local.worldId}`);
check('server has the market and the claimed quest', server.body.snapshot.buildings.some(b => b.defId === 'market') && server.body.snapshot.progress.questIndex >= 1, { buildings: server.body.snapshot.buildings.map(b => b.defId), questIndex: server.body.snapshot.progress.questIndex });
check('client and server agree after sync (revision, wallet, buildings, terrain delta)', essence(local) === essence(server.body.snapshot), essence(local) === essence(server.body.snapshot) ? { revision: local.revision } : { local: essence(local), server: essence(server.body.snapshot) });

// ---- 3. Reload: same world, identical state ----
await page.reload();
await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 });
await waitSynced(page);
const reloaded = await debug(page, 'snapshot');
check('reload goes straight back into the same character with identical state', reloaded.worldId === local.worldId && essence(reloaded) === essence(local));

// ---- 4. Offline then online: queued command is delivered ----
await ctxA.setOffline(true);
await page.locator('.resources button').first().click();
await page.locator('.side.panel .item', { hasText: 'Đá' }).locator('button', { hasText: 'Mua 1' }).first().click();
await page.locator('.side.panel .close').click();
await page.waitForFunction(() => /Mất kết nối|Đang đồng bộ/.test(document.querySelector('.sub-hud [role=status]')?.textContent ?? ''), null, { timeout: 10000 });
const offlineStatus = await page.locator('.sub-hud [role=status]').innerText();
await shot(page, 'offline-queued');
check('offline: action applied optimistically and shown as pending', /\(1\)/.test(offlineStatus), offlineStatus);
await ctxA.setOffline(false);
await waitSynced(page, 40000);
const afterOffline = await apiCall(page, 'GET', `/api/worlds/${local.worldId}`);
check('back online: queued command reached the server exactly once', afterOffline.body.snapshot.revision === reloaded.revision + 1 && afterOffline.body.snapshot.wallet.stone === reloaded.wallet.stone + 1,
  { revision: afterOffline.body.snapshot.revision, stone: afterOffline.body.snapshot.wallet.stone });

// ---- 5. Crafted illegal command over HTTP is rejected ----
const snap = afterOffline.body.snapshot;
const crafted = await apiCall(page, 'POST', `/api/worlds/${snap.worldId}/commands`, { commands: [{ commandId: crypto.randomUUID?.() ?? '00000000-0000-4000-8000-000000000001', worldId: snap.worldId, expectedRevision: snap.revision, type: 'PLACE_BUILDING', payload: { defId: 'market', anchor: [61, 70], rotation: 0 }, clientTime: Date.now() }] });
const afterCrafted = await apiCall(page, 'GET', `/api/worlds/${snap.worldId}`);
check('crafted illegal command (market on the river) rejected; wallet unchanged', crafted.body.results[0].accepted === false && afterCrafted.body.snapshot.wallet.cash === snap.wallet.cash, crafted.body.results[0].code);

// ---- 6. Recovery on a fresh browser profile ----
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageB = await newPage(ctxB);
await pageB.goto(`${BASE}/?debug=1`);
await pageB.getByText('Tôi có mã khôi phục').click();
await pageB.locator('.field input').fill(recoveryCode.toLowerCase());
await pageB.locator('button.primary', { hasText: 'Khôi phục' }).click();
await pageB.locator('.map-card.farm .who').waitFor({ timeout: 15000 });
check('recovery lists the character on the new device', (await pageB.locator('.map-card.farm .who').innerText()).includes(name));
await shot(pageB, 'recovered');
await pageB.locator('.map-card.farm button', { hasText: 'Chơi tiếp' }).click();
await pageB.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 });
const onB = await debug(pageB, 'snapshot');
check('recovered device loads the same world', onB.worldId === snap.worldId && onB.revision === afterCrafted.body.snapshot.revision);
const errorsBeforeRevokedCall = errors.length;
const oldTokenMe = await apiCall(page, 'GET', '/api/me');
errors.splice(errorsBeforeRevokedCall); // the 401 below is the expected result of using a revoked token
check('the old device token is revoked after recovery', oldTokenMe.status === 401, oldTokenMe.status);

check('no page/console errors', errors.length === 0, errors);
await writeFile(`${OUT}/g2-e2e.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), checks, errors }, null, 2));
await browser.close();
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
