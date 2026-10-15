// Shared selectors/actions for the in-game HUD (reference layout: top pills, mission panel, category bar + tray).
// Used by the E2E, smoke and soak scripts so a UI change only needs updating here.

/** Category of each tool button (bottom bar → tray). */
const TOOL_CATEGORY = {
  'Dọn': 'land', 'San nền': 'land', 'Đường': 'roads', 'Cầu': 'roads', 'Kè': 'roads',
  'Cuốc': 'farms', 'Gieo': 'farms', 'Thu hoạch': 'farms', 'Khu đất': 'land',
};
export const SYNC = '.sync-status';
export const syncText = page => page.evaluate(sel => document.querySelector(sel)?.textContent ?? '', SYNC);
export const waitSynced = (page, timeout = 20000) =>
  page.waitForFunction(sel => /Đã đồng bộ/.test(document.querySelector(sel)?.textContent ?? ''), SYNC, { timeout });

/** The level-up card is modal; scripts acknowledge it like a player would. */
export async function dismissLevelUp(page) {
  const ok = page.locator('.levelup-card .primary');
  if (await ok.isVisible().catch(() => false)) { await ok.click(); await page.waitForTimeout(150); }
}
async function openCategory(page, category, tap = false) {
  await dismissLevelUp(page);
  const button = page.locator(`.hud3-cat[data-cat=${category}]`);
  if ((await button.getAttribute('aria-pressed')) !== 'true') await (tap ? button.tap() : button.click());
}
/** Choose a tool by its label ("Khám phá" returns to explore mode by closing the open category). */
export async function pickTool(page, label, { tap = false } = {}) {
  await dismissLevelUp(page);
  if (label === 'Khám phá' || label === 'Xây') {
    const open = page.locator('.hud3-cat[aria-pressed=true]');
    if (label === 'Khám phá') { if (await open.count()) await (tap ? open.first().tap() : open.first().click()); await page.keyboard.press('Escape'); return; }
    await openCategory(page, 'buildings', tap); return;
  }
  if (label === 'Phá') { // quick toggle beside the Dock, in no tab
    const quick = page.locator('.hud3-quick');
    if ((await quick.getAttribute('aria-pressed')) !== 'true') await (tap ? quick.tap() : quick.click());
    await page.waitForTimeout(120); return;
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
/** Vật liệu panel (open): type `count` into the material's quantity box and press Mua. */
export async function buyMaterial(page, label, count) {
  const row = page.locator('.side.panel .material-row', { hasText: label });
  await row.locator('input').fill(String(count));
  await row.locator('button', { hasText: 'Mua' }).click();
}
export const inventoryButton = page => page.locator('.hud3-chip[data-res=inventory]');
export const profileButton = page => page.locator('.hud3-player');
export const hudBar = page => page.locator('.hud3-top');
export const cameraButtons = page => page.locator('.hud3-controls button');
/** Map switching lives in Settings. */
export async function openSwitchMap(page) {
  await dismissLevelUp(page);
  await page.locator('.hud3-status button[aria-label="Cài đặt"]').click();
  await page.locator('button[aria-label="Đổi bản đồ"]').click();
}
export async function openSettings(page) { await dismissLevelUp(page); await page.locator('.hud3-status button[aria-label="Cài đặt"]').click(); }

// ---------- D027 entry: username + PIN ----------
/** Usernames are unique and the dev DB persists between runs: base (≤ 14 chars) + 5 digits. */
export const uniqueName = base => `${base.slice(0, 14)} ${String(Date.now() % 100000).padStart(5, '0')}`;
const act = (locator, tap) => (tap ? locator.tap() : locator.click());
/** New player: map card → username + PIN twice → submit. Resolves when the game has loaded. */
export async function registerUI(page, kind, name, pin = '2468', { tap = false } = {}) {
  await act(page.locator(`.map-card.${kind} button`, { hasText: 'Tạo nhân vật' }), tap);
  await page.locator('#reg-username').fill(name);
  await page.locator('#reg-pin').fill(pin);
  await page.locator('#reg-pin2').fill(pin);
  await act(page.locator('.entry-submit'), tap);
  await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 60000 });
}
/** Signed-in player opens the other map (no form: the account's name is used). */
export async function createOtherMapUI(page, kind) {
  await page.locator(`.map-card.${kind} button`, { hasText: 'Tạo nhân vật' }).click();
  await page.waitForFunction(k => window.__debug?.snapshot?.().mapKind === k, kind, { timeout: 60000 });
}
/** Returning player on any device: username + PIN. Resolves on the map screen or in the game. */
export async function loginUI(page, name, pin) {
  await page.locator('.entry-header-action', { hasText: 'Đăng nhập' }).click();
  await page.locator('#login-username').fill(name);
  await page.locator('#login-pin').fill(pin);
  await page.locator('.entry-submit').click();
}
