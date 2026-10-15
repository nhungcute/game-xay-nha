// D039: offline random-map flow. ?random=1 (or VITE_RANDOM_MAPS=1) on a VITE_OFFLINE=1 build:
// first load generates a farm map once and stores it in IndexedDB (xay-nha-offline-v1), reload keeps it,
// Settings -> "Map mới" (after a confirm) clears the save and generates a different map.
// Usage: BASE_URL=http://127.0.0.1:5195 node scripts/random-map-offline-qa.mjs   (exit 1 on failure)
import { chromium } from '@playwright/test';
import { dismissLevelUp, openSettings } from './lib/hud.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5195';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', msg => { if (msg.type() === 'error' && !/favicon/.test(msg.text())) errors.push(msg.text()); });
page.on('pageerror', error => errors.push(String(error)));
const failures = [];
const stored = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = window.indexedDB.open('xay-nha-offline-v1', 1);
  open.onsuccess = () => { const get = open.result.transaction('worlds').objectStore('worlds').get('offline-template'); get.onsuccess = () => resolve(get.result?.mapId ?? null); get.onerror = () => reject(get.error); };
  open.onerror = () => reject(open.error);
}));
const ready = async () => { await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 90000 }); await page.waitForTimeout(1200); };
const mapId = () => page.evaluate(() => window.__debug.snapshot().mapId);
const url = `${BASE_URL}/?random=1&debug=1&test=1`;

await page.goto(url); await ready();
const first = await mapId();
if (!/^rnd-farm-\d+$/.test(first)) failures.push(`first load map is ${first}`);
if (await stored() !== first) failures.push('template not stored in IndexedDB');
await page.evaluate(() => window.__debug.command('BUY_MATERIAL', { wood: 3 })); await page.evaluate(() => window.__debug.flush());
await page.reload(); await ready();
if (await mapId() !== first) failures.push('reload changed the map');
const woodAfterReload = await page.evaluate(() => window.__debug.snapshot().wallet.wood);
if (woodAfterReload < 3) failures.push(`offline save lost after reload (wood ${woodAfterReload})`);

page.once('dialog', dialog => dialog.dismiss());
await openSettings(page);
await page.locator('button[aria-label="Map mới"]').click();
await page.waitForTimeout(500);
if (await mapId() !== first) failures.push('cancelled confirm still changed the map');
page.once('dialog', dialog => dialog.accept());
await page.locator('button[aria-label="Map mới"]').click();
await page.waitForLoadState('load'); await page.waitForTimeout(500); await ready();
const second = await mapId();
if (second === first || !/^rnd-farm-\d+$/.test(second)) failures.push(`Map mới did not produce a new map (${first} -> ${second})`);
const woodNew = await page.evaluate(() => window.__debug.snapshot().wallet.wood);
if (woodNew >= woodAfterReload && woodAfterReload !== 0 && woodNew === woodAfterReload) failures.push('old save survived Map mới');
if (await stored() !== second) failures.push('new template not stored');
await dismissLevelUp(page);

// Default offline (no ?random) keeps the hand-authored farm.
const plain = await context.newPage();
await plain.goto(`${BASE_URL}/?debug=1&test=1`);
await plain.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 90000 });
const plainMap = await plain.evaluate(() => window.__debug.snapshot().mapId);
if (/^rnd-/.test(plainMap)) failures.push(`default offline map is random (${plainMap})`);
if (await plain.locator('button[aria-label="Map mới"]').count()) failures.push('Map mới shown without random mode');
await browser.close();
if (errors.length) failures.push(`console errors: ${errors.slice(0, 3).join(' | ')}`);
console.log(JSON.stringify({ first, second, plainMap, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
