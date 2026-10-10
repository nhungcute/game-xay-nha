// Shared selectors/actions for the in-game HUD (reference layout: top pills, mission panel, category bar + tray).
// Used by the E2E, smoke and soak scripts so a UI change only needs updating here.

/** Category of each tool button (bottom bar → tray). */
const TOOL_CATEGORY = {
  'Dọn': 'nature', 'San nền': 'nature', 'Đường': 'roads', 'Cầu': 'roads', 'Kè': 'roads',
  'Cuốc': 'farms', 'Gieo': 'farms', 'Thu hoạch': 'farms', 'Khu đất': 'utilities', 'Phá': 'utilities',
};
export const SYNC = '.hud3-sync';
export const syncText = page => page.evaluate(sel => document.querySelector(sel)?.textContent ?? '', SYNC);
export const waitSynced = (page, timeout = 20000) =>
  page.waitForFunction(sel => /Đã đồng bộ/.test(document.querySelector(sel)?.textContent ?? ''), SYNC, { timeout });

async function openCategory(page, category, tap = false) {
  const button = page.locator(`.hud3-cat[data-cat=${category}]`);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await (tap ? button.tap() : button.click());
}
/** Choose a tool by its label ("Khám phá" returns to explore mode by closing the open category). */
export async function pickTool(page, label, { tap = false } = {}) {
  if (label === 'Khám phá' || label === 'Xây') {
    const open = page.locator('.hud3-cat[aria-pressed=true]');
    if (label === 'Khám phá') { if (await open.count()) await (tap ? open.first().tap() : open.first().click()); await page.keyboard.press('Escape'); return; }
    await openCategory(page, 'buildings', tap); return;
  }
  const category = TOOL_CATEGORY[label];
  if (!category) throw new Error(`Unknown tool label ${label}`);
  await openCategory(page, category, tap);
  const button = page.locator('.hud3-tray .hud3-tool', { hasText: label }).first();
  await (tap ? button.tap() : button.click());
  await page.waitForTimeout(120);
}
/** Choose a building card by name, searching the categories that hold buildings. */
export async function pickBuilding(page, name) {
  for (const category of ['buildings', 'farms', 'utilities', 'decorations']) {
    const cat = page.locator(`.hud3-cat[data-cat=${category}]`);
    if (!(await cat.count())) continue;
    await openCategory(page, category);
    const card = page.locator('.hud3-tray .hud3-card', { hasText: name }).first();
    if (await card.count()) { await card.click(); await page.waitForTimeout(120); return; }
  }
  throw new Error(`Building card not found: ${name}`);
}
export const claimButton = page => page.locator('.hud3-missions .hud3-claim');
export const materialsButton = page => page.locator('.hud3-chip[data-res=wood]');
export const inventoryButton = page => page.locator('.hud3-chip[data-res=inventory]');
export const profileButton = page => page.locator('.hud3-player');
export const hudBar = page => page.locator('.hud3-top');
export const cameraButtons = page => page.locator('.hud3-controls button');
/** Map switching lives in Settings. */
export async function openSwitchMap(page) {
  await page.locator('.hud3-status button[aria-label="Cài đặt"]').click();
  await page.locator('button[aria-label="Đổi bản đồ"]').click();
}
export async function openSettings(page) { await page.locator('.hud3-status button[aria-label="Cài đặt"]').click(); }
