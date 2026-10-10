// Real login/recovery UI round trip on the dev API; keeps the one-time code in memory only.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5191';
const out = process.env.OUT ?? 'docs/evidence/entry-design';
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const report = { base, startedAt: new Date().toISOString(), scope: 'Real dev API and Postgres; recovery code never persisted', checks: [], errors: [] };
const check = (name, condition) => { assert(condition, name); report.checks.push(name); };
const watch = page => {
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push('console error'); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
};
const inGame = page => page.waitForFunction(() => !!window.__debug?.snapshot &&
  /Đã đồng bộ/.test(document.querySelector('.sub-hud [role=status]')?.textContent ?? ''), null, { timeout: 60000 });
try {
  const original = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await original.newPage(); watch(page);
  await page.goto(`${base}/?debug=1`);
  await page.locator('.map-card.city button').click();
  await page.getByLabel('Tên nhân vật', { exact: true }).fill('An Nhiên');
  await page.getByRole('button', { name: 'Vào chơi', exact: true }).click();
  const code = await page.locator('.code').innerText({ timeout: 30000 });
  check('first character receives one-time code', /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code));
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click(); await inGame(page);
  const worldId = await page.evaluate(() => window.__debug.snapshot().worldId);
  check('city enters synced game', await page.locator('header.hud').isVisible());
  await page.getByRole('button', { name: 'Đổi bản đồ', exact: true }).click();
  await page.locator('.map-card.farm button').click();
  check('second map suggests existing display name', await page.getByLabel('Tên nhân vật', { exact: true }).inputValue() === 'An Nhiên');
  await page.getByLabel('Tên nhân vật', { exact: true }).fill('Bình Yên');
  await page.getByRole('button', { name: 'Vào chơi', exact: true }).click(); await inGame(page);
  check('farm enters game without another one-time code', await page.locator('.code').count() === 0);
  await original.close();

  const recovered = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const next = await recovered.newPage(); watch(next);
  await next.goto(`${base}/?debug=1`);
  await next.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await next.getByLabel('Mã khôi phục', { exact: true }).fill(code);
  await next.getByRole('button', { name: 'Khôi phục', exact: true }).click();
  await next.locator('.map-card.city .who').waitFor({ timeout: 30000 });
  check('real recovery restores both named characters', /An Nhiên/.test(await next.locator('.city .who').innerText()) &&
    /Bình Yên/.test(await next.locator('.farm .who').innerText()));
  await next.locator('.map-card.city button').click(); await inGame(next);
  check('recovered city is the original world', await next.evaluate(() => window.__debug.snapshot().worldId) === worldId);
  await next.reload(); await inGame(next);
  check('recovered login survives reload', await next.evaluate(() => window.__debug.snapshot().worldId) === worldId);
  check('no browser or HTTP errors', report.errors.length === 0);
  await recovered.close();
  report.finishedAt = new Date().toISOString();
  await mkdir(out, { recursive: true });
  await writeFile(`${out}/recovery-smoke.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`Real recovery PASS: ${report.checks.length} checks, ${report.errors.length} errors. No codes/tokens saved.`);
} finally { await browser.close(); }
