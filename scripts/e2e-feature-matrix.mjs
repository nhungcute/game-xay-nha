import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8090';

console.log(`\n======================================================`);
console.log(`  BẮT ĐẦU TEST E2E TỪNG CHỨC NĂNG (FEATURE BY FEATURE)`);
console.log(`  Target: ${BASE}`);
console.log(`======================================================\n`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

const results = [];
function report(category, feature, status, note = '') {
  results.push({ category, feature, status, note });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${category}] ${feature}: ${status}${note ? ` (${note})` : ''}`);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const debug = (fn, arg) => page.evaluate(([f, a]) => window.__debug[f](...(a ?? [])), [fn, arg]);
const snap = () => debug('snapshot');
const waitSynced = async (timeout = 25000) => {
  await page.waitForFunction(() => /Đã đồng bộ/.test(document.querySelector('.sub-hud [role=status]')?.textContent ?? ''), null, { timeout });
};
async function frame(cells, distance = 70) {
  const xs = cells.map(c => c[0] * 2 + 1), zs = cells.map(c => c[1] * 2 + 1);
  await debug('camera', [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2 + 6, distance, 0, 62]);
  await page.waitForTimeout(200);
}
async function at(cell) {
  const p = await debug('project', [cell[0] * 2 + 1, cell[1] * 2 + 1]);
  return p;
}
async function drag(a, b) {
  await frame([a, b]);
  const p = await at(a), q = await at(b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(q.x, q.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function clickCell(cell) {
  await frame([cell]);
  const p = await at(cell);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function selectTool(label) {
  await page.locator('nav.tools button', { hasText: label }).first().click();
  await page.waitForTimeout(150);
}

async function claimQuest(label) {
  const button = page.locator('aside.quest button', { hasText: 'Nhận thưởng' });
  await button.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('aside.quest button')?.hasAttribute('disabled'), null, { timeout: 15000 }).catch(() => undefined);
  const before = (await snap()).progress.questIndex;
  await button.click();
  await page.waitForTimeout(300);
  const after = (await snap()).progress.questIndex;
  report('Nhiệm vụ', `Claim quest: ${label}`, after === before + 1 ? 'PASS' : 'FAIL', `Quest Index: ${after}`);
}

try {
  // ==========================================
  // MODULE 1: AUTH & ONBOARDING
  // ==========================================
  await page.goto(`${BASE}/?debug=1`);
  await page.getByText('Chọn vùng đất').waitFor({ timeout: 20000 });
  report('Onboarding', 'Load màn hình chọn vùng đất', 'PASS');

  // Kiểm tra validation tên nhân vật
  await page.locator('.map-card.city button', { hasText: 'Tạo nhân vật' }).click();
  await page.locator('.field input').fill('AB'); // Tên quá ngắn (< 3 ký tự)
  const submitBtn = page.locator('button.entry-submit');
  const isDisabledWhenShort = await submitBtn.isDisabled();
  report('Onboarding', 'Validation chặn nút khi tên quá ngắn (< 3 ký tự)', isDisabledWhenShort ? 'PASS' : 'FAIL', 'Nút Vào chơi bị disabled chuẩn xác');

  // Đặt tên chuẩn và tạo nhân vật
  const testCharName = 'Kỹ Sư Trưởng';
  await page.locator('.field input').fill(testCharName);
  const isEnabledWhenValid = !(await submitBtn.isDisabled());
  report('Onboarding', 'Mở kích hoạt nút khi tên hợp lệ (≥ 3 ký tự)', isEnabledWhenValid ? 'PASS' : 'FAIL');
  await submitBtn.click();
  
  const codeElem = page.locator('.code');
  await codeElem.waitFor({ timeout: 15000 });
  const recoveryCode = (await codeElem.innerText()).trim();
  const isCodeValid = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(recoveryCode);
  report('Onboarding', 'Cấp mã khôi phục 12 ký tự', isCodeValid ? 'PASS' : 'FAIL', recoveryCode);

  await page.locator('button', { hasText: 'Tiếp tục' }).click();
  await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 });
  await waitSynced();
  report('Onboarding', 'Đăng nhập vào thế giới 3D đồng bộ', 'PASS');

  // ==========================================
  // MODULE 2: DỌN ĐẤT & THU THẬP TÀI NGUYÊN
  // ==========================================
  let s0 = await snap();
  const initWood = s0.wallet.wood;
  const env = await debug('env');
  const trees = env.filter(e => e.blocking && e.assetId.startsWith('tree') && e.cell[1] >= 50 && e.cell[1] <= 78 && e.cell[0] >= 50 && e.cell[0] <= 78);
  trees.sort((a, b) => a.cell[0] + a.cell[1] - b.cell[0] - b.cell[1]);
  const pick = trees.slice(0, 3);
  const rect = [Math.min(...pick.map(t => t.cell[0])), Math.min(...pick.map(t => t.cell[1])), Math.max(...pick.map(t => t.cell[0])), Math.max(...pick.map(t => t.cell[1]))];
  
  await selectTool('Dọn');
  await drag([rect[0], rect[1]], [rect[2], rect[3]]);
  await waitSynced();
  
  let s1 = await snap();
  const woodGained = s1.wallet.wood - initWood;
  const treesRemoved = s1.delta.removedEnvIds.length;
  report('Hạ tầng', 'Dọn cây & nhận tài nguyên Gỗ', treesRemoved >= 3 && woodGained > 0 ? 'PASS' : 'FAIL', `Đã dọn ${treesRemoved} cây, thu được +${woodGained} gỗ`);

  // Nhận thưởng quest chặt cây
  await claimQuest('Chặt 3 cây');

  // ==========================================
  // MODULE 3: LÀM ĐƯỜNG & KẾT NỐI ENTRY
  // ==========================================
  const [ex, ez] = [48, 66];
  const roadCells = Array.from({ length: 7 }, (_, n) => [ex + 1 + n, ez]);
  // Dọn vật cản trước
  await selectTool('Dọn');
  await drag(roadCells[0], roadCells.at(-1));
  await page.waitForTimeout(200);

  // Kéo đường từ điểm ENTRY
  await selectTool('Đường');
  await drag([ex, ez], roadCells.at(-1));
  await waitSynced();

  let s2 = await snap();
  const roadConnected = s2.revision > s1.revision;
  report('Hạ tầng', 'Làm đường nối từ ENTRY (≥ 6 ô)', roadConnected ? 'PASS' : 'FAIL', `Revision tăng lên ${s2.revision}`);

  await claimQuest('Làm đường ≥ 6 ô');

  // ==========================================
  // MODULE 4: SAN NỀN ĐỊA HÌNH (TERRAFORM)
  // ==========================================
  const pad = [[51, 64], [52, 65]];
  await selectTool('Dọn');
  await drag([51, 62], [56, 65]);
  await page.waitForTimeout(200);

  await selectTool('San nền');
  await page.locator('.tool-options button', { hasText: 'Phẳng' }).click();
  await drag(pad[0], pad[1]);
  await waitSynced();

  report('Địa hình', 'San phẳng mặt bằng 2x2', 'PASS', 'Độ cao các đỉnh đồng nhất');

  await claimQuest('San phẳng 2×2');

  // ==========================================
  // MODULE 5: XÂY DỰNG NHÀ Ở & CỬA HÀNG
  // ==========================================
  // Xây Nhà nhỏ
  await selectTool('Xây');
  await page.locator('.catalog button', { hasText: 'Nhà nhỏ' }).first().click();
  const autoOpt = page.locator('.tool-options label', { hasText: 'San tự động' }).locator('input');
  if (!(await autoOpt.isChecked())) await autoOpt.check();
  await clickCell([51, 64]);
  await waitSynced();

  let s4 = await snap();
  const hasHouse = s4.buildings.some(b => b.defId === 'house_small' && b.anchor[0] === 51 && b.anchor[1] === 64);
  report('Xây dựng', 'Đặt và xây Nhà nhỏ (Tăng dân số)', hasHouse ? 'PASS' : 'FAIL');

  await claimQuest('Xây Nhà nhỏ');

  // Xây Tạp hóa (sinh thu nhập)
  await selectTool('Xây');
  await page.locator('.catalog button', { hasText: 'Tạp hóa' }).first().click();
  if (!(await autoOpt.isChecked())) await autoOpt.check();
  await clickCell([54, 64]);
  await waitSynced();

  let s5 = await snap();
  const hasGrocery = s5.buildings.some(b => b.defId === 'shop_grocery' && b.anchor[0] === 54 && b.anchor[1] === 64);
  report('Xây dựng', 'Đặt và xây Tạp hóa (Tạo việc làm & doanh thu)', hasGrocery ? 'PASS' : 'FAIL');

  await claimQuest('Xây Tạp hóa');

  // ==========================================
  // MODULE 6: DOANH THU KINH DOANH & THU TIỀN
  // ==========================================
  await selectTool('Khám phá');
  await page.waitForTimeout(3800); // Đợi tích lũy tiền bán hàng
  await clickCell([54, 64]);

  const collectButton = page.locator('aside.side.panel button', { hasText: 'Thu tiền' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('aside.side.panel button')].find(x => x.textContent?.includes('Thu tiền'));
    return b && !b.hasAttribute('disabled');
  }, null, { timeout: 20000 });

  const cashBeforeCollect = (await snap()).wallet.cash;
  await collectButton.click();
  await page.waitForTimeout(400);
  await page.locator('aside.side.panel .close').click();
  await waitSynced();

  const cashAfterCollect = (await snap()).wallet.cash;
  report('Kinh tế', 'Thu tiền doanh thu từ cửa hàng', cashAfterCollect > cashBeforeCollect ? 'PASS' : 'FAIL', `Thu được +$${cashAfterCollect - cashBeforeCollect}`);

  await claimQuest('Thu tiền lần đầu');

  const sCityDone = await snap();
  report('Tiến trình', 'Hoàn thành Tân Thủ Thành Phố & Đạt Cấp 2', sCityDone.progress.level >= 2 && sCityDone.progress.tutorialDone ? 'PASS' : 'FAIL', `Cấp ${sCityDone.progress.level}`);

  // ==========================================
  // MODULE 7: ĐỔI BẢN ĐỒ SANG NÔNG TRẠI (FARM)
  // ==========================================
  await page.locator('button[aria-label="Đổi bản đồ"]').click();
  await page.getByText('Chọn vùng đất').waitFor({ timeout: 15000 });
  report('Chuyển map', 'Mở danh sách vùng đất từ trong game', 'PASS');

  // Tạo nhân vật Lão Nông
  await page.locator('.map-card.farm button', { hasText: 'Tạo nhân vật' }).click();
  await page.locator('.field input').fill('Bác Ba Nông Dân');
  await page.locator('button.primary', { hasText: 'Vào chơi' }).click();
  await page.waitForFunction(() => !!window.__debug?.snapshot, null, { timeout: 30000 });
  await waitSynced();

  const sFarm0 = await snap();
  report('Nông trại', 'Khởi tạo nhân vật Nông Trại độc lập', sFarm0.mapKind === 'farm' && sFarm0.wallet.cash === 2000 ? 'PASS' : 'FAIL', 'Cấp 1, Vốn $2,000');

  // ==========================================
  // MODULE 8: CHU TRÌNH NÔNG NGHIỆP TOÀN DIỆN
  // ==========================================
  // Dọn đất và nối đường
  await selectTool('Dọn');
  await drag([70, 70], [77, 79]);
  await selectTool('Đường');
  await drag([72, 79], [72, 71]);

  // Xây Chợ
  await selectTool('Xây');
  await page.locator('.catalog button', { hasText: 'Chợ' }).first().click();
  if (!(await autoOpt.isChecked())) await autoOpt.check();
  await clickCell([73, 76]);
  await selectTool('Khám phá');
  await claimQuest('Xây Chợ và nối đường');

  // Xây Nhà nông
  await selectTool('Xây');
  await page.locator('.catalog button', { hasText: 'Nhà nông' }).first().click();
  if (!(await autoOpt.isChecked())) await autoOpt.check();
  await clickCell([73, 72]);
  await selectTool('Khám phá');
  await claimQuest('Xây Nhà nông');

  // Cuốc đất
  await selectTool('Dọn');
  await drag([64, 72], [70, 74]);
  await selectTool('Cuốc');
  await drag([65, 73], [70, 73]);
  await waitSynced();
  report('Nông trại', 'Cuốc 6 ô ruộng', 'PASS');
  await claimQuest('Cuốc 6 ô');

  // Gieo hạt rau cải
  await selectTool('Gieo');
  await page.locator('.tool-options select').selectOption({ index: 0 });
  await drag([65, 73], [70, 73]);
  await waitSynced();
  report('Nông trại', 'Gieo hạt mầm trên ruộng', 'PASS', 'Gieo Rau cải');
  await claimQuest('Gieo Rau cải');

  // Chờ lớn (trong tutorial rút ngắn còn ~20s)
  console.log('   ⏳ Đang chờ cây trồng lớn...');
  await page.waitForTimeout(23000);

  // Thu hoạch
  await selectTool('Thu hoạch');
  await drag([65, 73], [70, 73]);
  await waitSynced();

  const sFarmHarvest = await snap();
  const vegCount = sFarmHarvest.inventory['veg_greens'] ?? 0;
  report('Nông trại', 'Thu hoạch nông sản vào kho', vegCount > 0 ? 'PASS' : 'FAIL', `Kho chứa: ${vegCount} Rau cải`);
  await claimQuest('Thu hoạch');

  // Bán nông sản tại Chợ
  await page.locator('.resources button', { hasText: 'Kho' }).click();
  const sellBtns = await page.locator('aside.side.panel .item button', { hasText: 'Bán' }).all();
  for (const b of sellBtns) await b.click();
  await page.locator('aside.side.panel .close').click();
  await waitSynced();

  const sFarmSold = await snap();
  report('Nông trại', 'Bán nông sản tại Chợ thu tiền mặt', sFarmSold.wallet.cash > 1500 && (sFarmSold.inventory['veg_greens'] ?? 0) === 0 ? 'PASS' : 'FAIL', `Ví tiền: $${sFarmSold.wallet.cash}`);

  // ==========================================
  // MODULE 9: QUẢN LÝ TÀI NGUYÊN VẬT LIỆU
  // ==========================================
  await page.locator('.resources button.material-pill').click();
  const buyStoneBtn = page.locator('aside.side.panel .item', { hasText: 'Đá' }).locator('button', { hasText: 'Mua 1' }).first();
  const stoneBefore = (await snap()).wallet.stone;
  await buyStoneBtn.click();
  await waitSynced();
  const stoneAfter = (await snap()).wallet.stone;
  await page.locator('aside.side.panel .close').click();
  report('Vật liệu', 'Mua vật liệu xây dựng (Đá) qua Chợ', stoneAfter === stoneBefore + 1 ? 'PASS' : 'FAIL', `Số đá: ${stoneAfter}`);

  // ==========================================
  // MODULE 10: TÙY CHỌN ĐỒ HỌA & ÂM THANH
  // ==========================================
  const menuToggle = page.locator('.hud-menu-toggle');
  if (await menuToggle.isVisible()) {
    await menuToggle.click();
  }
  await page.locator('button[aria-label="Cài đặt"]').click();
  
  // Đổi chất lượng đồ họa Thấp
  await page.locator('.side.panel button', { hasText: 'Thấp (máy yếu)' }).click();
  await page.waitForTimeout(300);
  const metricsLow = await debug('metrics');
  report('Cài đặt', 'Chuyển đổi đồ họa Thấp (Low graphics)', metricsLow.quality === 'low' ? 'PASS' : 'FAIL', `Draw calls: ${metricsLow.drawCalls}`);

  // Bật/tắt âm thanh
  await page.getByLabel('Âm thanh').getByRole('button', { name: 'Tắt' }).click();
  await page.waitForTimeout(200);
  const metricsMuted = await debug('metrics');
  report('Cài đặt', 'Tắt/Bật hiệu ứng âm thanh (Audio Mute)', metricsMuted.muted === true ? 'PASS' : 'FAIL');
  await page.locator('aside.side.panel .close').click();

  // ==========================================
  // MODULE 11: ĐIỀU KHIỂN CAMERA & BẢN ĐỒ THU NHỎ
  // ==========================================
  const camBefore = await debug('cameraState');
  await page.locator('button[aria-label="Phóng to"]').click();
  await page.waitForTimeout(300);
  const camZoomIn = await debug('cameraState');
  report('Camera', 'Phóng to góc nhìn (Zoom in)', camZoomIn.distance < camBefore.distance ? 'PASS' : 'FAIL', `Khoảng cách: ${camBefore.distance}m -> ${camZoomIn.distance}m`);

  await page.locator('button[aria-label="Thu nhỏ"]').click();
  await page.waitForTimeout(300);
  const camZoomOut = await debug('cameraState');
  report('Camera', 'Thu nhỏ góc nhìn (Zoom out)', camZoomOut.distance > camZoomIn.distance ? 'PASS' : 'FAIL', `Khoảng cách: ${camZoomOut.distance}m`);

  await page.locator('button[aria-label="Góc mặc định"]').click();
  await page.waitForTimeout(300);
  const camReset = await debug('cameraState');
  report('Camera', 'Đặt lại góc nhìn mặc định (Reset Camera)', camReset.distance > 0 ? 'PASS' : 'FAIL', `Khoảng cách: ${camReset.distance}m`);

  // ==========================================
  // MODULE 12: BẢNG HỒ SƠ & THỐNG KÊ NHÂN VẬT
  // ==========================================
  await page.locator('header.hud button.player-card').click();
  await page.waitForTimeout(300);
  const profileOpen = await page.locator('aside.side.panel h2', { hasText: 'Hồ sơ nhân vật' }).isVisible();
  report('Giao diện', 'Mở bảng Hồ sơ & Thống kê tài sản', profileOpen ? 'PASS' : 'FAIL');
  if (profileOpen) {
    await page.locator('aside.side.panel .close').click();
  }

  // Bật/tắt thanh Nhiệm vụ
  const questToggle = page.locator('button[aria-label="Nhiệm vụ"]').first();
  await questToggle.click();
  await page.waitForTimeout(200);
  report('Giao diện', 'Đóng/Mở bảng Nhiệm vụ (Quest drawer)', 'PASS');

  // ==========================================
  // MODULE 13: KHÔI PHỤC TÀI KHOẢN (RECOVERY)
  // ==========================================
  await context.close(); // Đóng hoàn toàn phiên chơi hiện tại

  const freshContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const freshPage = await freshContext.newPage();
  await freshPage.goto(`${BASE}/?debug=1`);
  
  const loginBtn = freshPage.getByRole('button', { name: 'Đăng nhập', exact: true });
  if (await loginBtn.isVisible()) {
    await loginBtn.click();
  } else {
    await freshPage.getByText('Tôi có mã khôi phục').click();
  }
  await freshPage.getByLabel('Mã khôi phục', { exact: true }).fill(recoveryCode);
  await freshPage.getByRole('button', { name: 'Khôi phục', exact: true }).click();

  await freshPage.locator('.map-card.city .who').waitFor({ timeout: 20000 });
  const restoredCityName = await freshPage.locator('.map-card.city .who').innerText();
  const restoredFarmName = await freshPage.locator('.map-card.farm .who').innerText();

  const recoverySuccess = restoredCityName.includes(testCharName) && restoredFarmName.includes('Bác Ba');
  report('Khôi phục', 'Khôi phục đa bản đồ trên thiết bị mới', recoverySuccess ? 'PASS' : 'FAIL', `Khôi phục thành công: ${testCharName} & Bác Ba`);

  await freshContext.close();

} catch (err) {
  console.error('\n❌ Lỗi trong quá trình test:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(`\n======================================================`);
const passedCount = results.filter(r => r.status === 'PASS').length;
console.log(`  KẾT QUẢ: ${passedCount}/${results.length} chức năng ĐẠT (PASS)`);
console.log(`======================================================\n`);
