// Mô hình kinh tế "Xây Nhà" — tính bảng giá từ nguyên tắc + mô phỏng nhịp lên cấp.
// Chạy: node model.mjs [--tables] [--sim]
const args = new Set(process.argv.slice(2));

// ---------------- 1. NGUYÊN TẮC ----------------
export const P = {
  wood: 15, stone: 20,                       // giá mua vật liệu ($/đơn vị)
  paybackBaseH: 1.5, paybackGrowth: 1.15,    // T(L) = 1.5 × 1.15^(L-1) giờ
  housePaybackMul: 1.5,                      // nhà ở hoàn vốn chậm hơn (bù bằng dân)
  bankPaybackMul: 1.3,                       // ngân hàng bù bằng trần kho tiền
  prodPaybackMul: 2.0,                       // xưởng/chuồng (Quê) – cần nguyên liệu + thao tác
  cropP0: 36.5, cropCycleExp: -0.2, cropLevelGrowth: 1.06, // lãi/ô/giờ = P0 × 1.06^(L-1) × cycleH^-0.2
  capBaseH: 6, bankCapH: 2, bankCapMax: 4,
  xpPerSpend: 1 / 20, xpPerIncome: 0,        // XP / $ (hạ tầng); thu tiền không cho XP
  xpBuild: (V) => Math.round(2 * Math.sqrt(V)),
  xpCollect: (amount) => amount / 500,               // 1 XP / $500 thu được
  xpHarvestDiv: 20,                                  // XP/ô = lãi/ô ÷ 20
  xpMapMul: { city: 1, farm: 1 },
  // Bảng XP tích lũy để ĐẠT cấp L (index = L), đã hiệu chỉnh bằng calib.mjs cho người chơi 3 phiên/ngày
  xpCumMap: {
    city: [0, 0, 40, 150, 340, 1600, 2900, 4200, 6100, 9500, 14000, 22000, 36000, 54000, 73000, 100000, 140000, 180000, 240000, 330000, 430000, 860000],
    farm: [0, 0, 40, 120, 220, 960, 2200, 3500, 5700, 8800, 14000, 21000, 33000, 45000, 58000, 75000, 95000, 120000, 150000, 190000, 240000, 480000],
  },
  xpBase: 60, xpGrowth: 1.45,                // XP lên cấp kế = xpBase × xpGrowth^(L-1)
  zoneMaxBuy: 60,
  levelReward: 150,                          // $ × L khi lên cấp
  refund: 0.5,
  overheadPerCell: 10,                       // dọn + san + đường dẫn trung bình / ô footprint
  usableCellsPerZone: 256 * 0.5,
  zoneCost: (k) => 1000 + 800 * k + 150 * k * k,
  zoneLevel: (k) => Math.min(20, 2 + Math.floor(k / 3)),
  builders: (L) => 2 + (L >= 5) + (L >= 10),
  speedupPct: 0.3,                           // bỏ qua thời gian xây: 30% giá $ × phần thời gian còn lại
  startCash: 2000, startWood: 20, startStone: 10,
};
export const xpNeed = (L, cum = P.xpCum) => (cum ? cum[L + 1] - cum[L] : Math.round(P.xpBase * P.xpGrowth ** (L - 1) / 10) * 10);
export const T = (L) => P.paybackBaseH * P.paybackGrowth ** (L - 1);
const V = (c) => c.cash + c.wood * P.wood + c.stone * P.stone;
export const maxCount = (def, L) => def.limit ? Math.min(def.limit[2], Math.floor(def.limit[0] + def.limit[1] * (L - def.L))) : Infinity;
const r10 = (x) => Math.round(x / 10) * 10;
const r5 = (x) => Math.max(1, Math.round(x / 5) * 5);

// ---------------- 2. CATALOG GỐC (chi phí + thời gian xây; thu nhập được TÍNH) ----------------
// build: phút
const CITY = [
  { id: 'house_small',      L: 1,  w: 2, d: 2, cost: { cash: 300,    wood: 5,  stone: 0 }, limit: [4, 2, 40],   pop: 4,  build: 0.5,  kind: 'house' },
  { id: 'shop_grocery',     L: 1,  w: 2, d: 2, cost: { cash: 500,    wood: 5,  stone: 0 }, limit: [3, 1, 25],   jobs: 3, build: 1,    kind: 'shop' },
  { id: 'deco_garden',      L: 2,  w: 1, d: 1, cost: { cash: 100,    wood: 0,  stone: 0 }, limit: [4, 2, 60],   decor: 0.05, cover: 6, build: 0.25, kind: 'decor' },
  { id: 'house_town',       L: 3,  w: 2, d: 3, cost: { cash: 1200,   wood: 10, stone: 5 }, limit: [3, 2, 50],   pop: 10, build: 3,    kind: 'house' },
  { id: 'shop_cafe',        L: 3,  w: 2, d: 2, cost: { cash: 1500,   wood: 10, stone: 5 }, limit: [2, 1, 25],   jobs: 5, build: 5,    kind: 'shop' },
  { id: 'shop_restaurant',  L: 5,  w: 3, d: 3, cost: { cash: 4000,   wood: 20, stone: 15 }, limit: [2, 1, 20],  jobs: 10, build: 15,  kind: 'shop' },
  { id: 'deco_park',        L: 5,  w: 3, d: 3, cost: { cash: 2000,   wood: 10, stone: 10 }, limit: [1, 1, 25],  decor: 0.10, cover: 12, build: 10, kind: 'decor' },
  { id: 'bank',             L: 7,  w: 3, d: 3, cost: { cash: 12000,  wood: 10, stone: 40 }, limit: [1, 0.34, 4],  jobs: 15, build: 30,  kind: 'bank' },
  { id: 'house_apartment',  L: 8,  w: 4, d: 4, cost: { cash: 15000,  wood: 20, stone: 60 }, limit: [2, 1, 30],  pop: 60, build: 45,   kind: 'house' },
  { id: 'shop_supermarket', L: 9,  w: 4, d: 4, cost: { cash: 22000,  wood: 30, stone: 40 }, limit: [1, 1, 18],  jobs: 30, build: 60,  kind: 'shop' },
  { id: 'hotel',            L: 12, w: 4, d: 5, cost: { cash: 50000,  wood: 40, stone: 80 }, limit: [1, 0.5, 10],  jobs: 40, build: 120, kind: 'shop' },
  { id: 'office_tower',     L: 15, w: 4, d: 4, cost: { cash: 100000, wood: 20, stone: 120 }, limit: [1, 0.5, 10], jobs: 60, build: 240, kind: 'shop' },
];
for (const b of CITY) {
  b.V = V(b.cost);
  if (b.kind === 'decor') { b.rate = 0; continue; }
  const mul = b.kind === 'house' ? P.housePaybackMul : b.kind === 'bank' ? P.bankPaybackMul : 1;
  b.payback = T(b.L) * mul;
  b.rate = r10(b.V / b.payback);
}

// Cây trồng: giá bán được TÍNH từ lãi mục tiêu/ô/giờ.
const CROPS = [
  { id: 'veg_greens', xp: 1, L: 1,  seed: 3,  cycleMin: 5,   yield: 2 },
  { id: 'rice', xp: 1,       L: 1,  seed: 5,  cycleMin: 10,  yield: 2 },
  { id: 'corn', xp: 2,       L: 2,  seed: 10, cycleMin: 30,  yield: 3 },
  { id: 'tomato', xp: 2,     L: 4,  seed: 20, cycleMin: 60,  yield: 4 },
  { id: 'sugarcane', xp: 3,  L: 6,  seed: 30, cycleMin: 120, yield: 4 },
  { id: 'watermelon', xp: 4, L: 8,  seed: 50, cycleMin: 240, yield: 2 },
  { id: 'pumpkin', xp: 5,    L: 10, seed: 80, cycleMin: 480, yield: 3 },
  { id: 'coffee', xp: 6,     L: 12, seed: 120, cycleMin: 720, yield: 4 },
];
for (const c of CROPS) {
  const h = c.cycleMin / 60;
  c.targetProfitPerH = P.cropP0 * P.cropLevelGrowth ** (c.L - 1) * h ** P.cropCycleExp;
  c.price = Math.round((c.seed + c.targetProfitPerH * h) / c.yield);
  c.profit = c.price * c.yield - c.seed;
  c.profitPerH = c.profit / h;
}
const priceOf = (id) => (CROPS.find((c) => c.id === id) ?? PRODUCTS.find((p) => p.id === id)).price;

// Công trình Quê
const FARM = [
  { id: 'market',    L: 1, w: 3, d: 3, cost: { cash: 200, wood: 5, stone: 0 }, build: 0.5, maxCount: 1 },
  { id: 'farmhouse', L: 1, w: 3, d: 3, costs: [500, 1500, 4000, 8000, 15000, 25000, 40000, 60000, 90000, 130000], levels: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19], cost: { cash: 500, wood: 10, stone: 5 }, quota: 24, build: 1, maxCount: 10 },
  { id: 'well',      L: 2, w: 1, d: 1, cost: { cash: 300, wood: 0, stone: 5 }, build: 2 },
  { id: 'silo',      L: 2, w: 2, d: 2, cost: { cash: 800, wood: 10, stone: 10 }, build: 5 },
];
// Xưởng/chuồng: giá sản phẩm được TÍNH = giá trị nguyên liệu + biên lợi nhuận để hoàn vốn trong 2×T(L) khi chạy đủ công suất.
const PRODUCERS = [
  { id: 'chicken_coop', xp: 2, L: 3, w: 3, d: 3, cost: { cash: 1500,  wood: 20, stone: 5 },  slots: 6, queue: 3, build: 5,   out: 'egg',    in: { corn: 1 },            cycleMin: 20 },
  { id: 'rice_mill', xp: 2,    L: 5, w: 3, d: 3, cost: { cash: 3000,  wood: 20, stone: 20 }, slots: 3, queue: 3, build: 15,  out: 'flour',  in: { rice: 3 },            cycleMin: 15 },
  { id: 'cow_barn', xp: 4,     L: 7, w: 4, d: 4, cost: { cash: 6000,  wood: 40, stone: 20 }, slots: 6, queue: 3, build: 30,  out: 'milk',   in: { corn: 3, rice: 3 },   cycleMin: 60 },
  { id: 'bakery', xp: 6,       L: 9, w: 3, d: 3, cost: { cash: 12000, wood: 20, stone: 40 }, slots: 3, queue: 3, build: 60,  out: 'bread',  in: { flour: 2, egg: 1 },   cycleMin: 30 },
];
const PRODUCTS = [];
for (const p of PRODUCERS) {
  p.V = V(p.cost);
  const payback = T(p.L) * P.prodPaybackMul;
  const marginPerSlotH = p.V / payback / p.slots;
  const inputV = Object.entries(p.in).reduce((s, [id, n]) => s + priceOf(id) * n, 0);
  const margin = marginPerSlotH * (p.cycleMin / 60);
  const price = r5(inputV + margin);
  PRODUCTS.push({ id: p.out, price, inputV, margin: price - inputV, by: p.id });
  p.inputV = inputV; p.price = price; p.marginPerSlotH = (price - inputV) / (p.cycleMin / 60);
  p.payback = p.V / (p.marginPerSlotH * p.slots);
}

// ---------------- 3. BẢNG ----------------
function tables() {
  console.log('\nT(L) giờ hoàn vốn mục tiêu:', Array.from({ length: 15 }, (_, i) => `L${i + 1}=${T(i + 1).toFixed(2)}`).join(' '));
  console.log('\n== THÀNH PHỐ ==');
  console.table(CITY.map((b) => ({ id: b.id, L: b.L, cells: b.w * b.d, cash: b.cost.cash, wood: b.cost.wood, stone: b.cost.stone, V: b.V, 'thu/h': b.rate, 'hoàn vốn h': b.rate ? +(b.V / b.rate).toFixed(2) : '-', '$/ô/h': b.rate ? Math.round(b.rate / (b.w * b.d)) : '-', 'xây (phút)': b.build })));
  console.log('\n== CÂY TRỒNG ==');
  console.table(CROPS.map((c) => ({ id: c.id, L: c.L, seed: c.seed, 'phút': c.cycleMin, yield: c.yield, 'giá bán': c.price, 'lãi/ô': c.profit, 'lãi/ô/h': +c.profitPerH.toFixed(1) })));
  console.log('\n== XƯỞNG / CHUỒNG ==');
  console.table(PRODUCERS.map((p) => ({ id: p.id, L: p.L, V: p.V, slots: p.slots, 'phút': p.cycleMin, in: JSON.stringify(p.in), 'giá trị vào': p.inputV, out: p.out, 'giá bán': p.price, 'lãi/slot/h': Math.round(p.marginPerSlotH), 'hoàn vốn h (đủ công suất)': +p.payback.toFixed(1) })));
  console.log('== XP (tích lũy để đạt cấp) ==');
  console.table(Array.from({ length: 20 }, (_, i) => ({ L: i + 1, city: P.xpCumMap.city[i + 1], farm: P.xpCumMap.farm[i + 1] })));
}

// ---------------- 4. MÔ PHỎNG ----------------

// lịch: [ngàyBắtĐầu(phút trong ngày), thờiLượng phút]
const PLAYERS = {
  cham:  { name: 'Chăm (4 phiên/ngày)', day1: [[8 * 60, 60], [12 * 60, 15], [17 * 60, 15], [21 * 60, 15]], daily: [[7 * 60, 15], [12 * 60, 15], [17 * 60, 15], [21 * 60, 15]] },
  thuong:{ name: 'Thường (3 phiên/ngày)', day1: [[20 * 60, 25]], daily: [[8 * 60, 8], [12 * 60 + 30, 8], [21 * 60, 10]] },
  nhan:  { name: 'Nhàn (1 phiên/ngày)', day1: [[21 * 60, 15]], daily: [[21 * 60, 10]] },
};
function sessions(pl, days) {
  const out = [];
  for (let d = 0; d < days; d++) for (const [s, len] of d === 0 ? pl.day1 : pl.daily) {
    if (d === 0 && pl === PLAYERS.nhan) {} out.push([d * 1440 + s, d * 1440 + s + len]);
  }
  // ngày 1 của "thường"/"nhàn": phiên đầu là phiên dài; bỏ các phiên daily trùng ngày 0
  return out.sort((a, b) => a[0] - b[0]);
}
function captureFraction(pl, capH) { // phần thu nhập/ngày giữ được với trần capH khi chơi theo lịch daily
  const s = pl.daily; let got = 0;
  for (let i = 0; i < s.length; i++) {
    const end = s[i][0] + s[i][1], next = (s[(i + 1) % s.length][0] + (i + 1 === s.length ? 1440 : 0));
    got += s[i][1] / 60 + Math.min((next - end) / 60, capH);
  }
  return Math.min(1, got / 24);
}

function simCity(pl, days = 60) {
  const XM = 1, CUM = P.xpCumMap.city || P.xpCum; let xpTot = 0; const xpSeries = [];
  let cash = P.startCash, wood = P.startWood, stone = P.startStone, L = 1, xp = 0, zones = 4, zonesBought = 0;
  const built = []; let used = 0, t0 = null; const log = []; const quest = { done: new Set() };
  const levelAt = {};
  const S = sessions(pl, days); let last = S[0][0];
  const stats = () => {
    const pop = built.filter((b) => b.done <= cur && b.def.pop).reduce((s, b) => s + b.def.pop, 0);
    const jobs = built.filter((b) => b.done <= cur && b.def.jobs).reduce((s, b) => s + b.def.jobs, 0);
    const banks = Math.min(P.bankCapMax, built.filter((b) => b.done <= cur && b.def.kind === 'bank').length);
    const nInc = built.filter((b) => b.done <= cur && b.def.rate).length || 1;
    const decorPts = built.filter((b) => b.done <= cur && b.def.decor).reduce((s, b) => s + b.def.decor * b.def.cover, 0);
    return { pop, jobs, banks, E: jobs ? Math.min(1, pop / jobs) : 1, decor: Math.min(0.3, decorPts / nInc) };
  };
  let cur = last;
  const rateOf = (b, st) => b.def.rate * (b.def.jobs ? st.E : 1) * (1 + st.decor);
  const totalRate = () => { const st = stats(); return built.filter((b) => b.done <= cur && b.def.rate).reduce((s, b) => s + rateOf(b, st), 0); };
  const gainXP = (x) => { xpTot += x * XM; xp += x * XM; while (L < 20 && xp >= xpNeed(L, CUM)) { xp -= xpNeed(L, CUM); L++; cash += P.levelReward * L; levelAt[L] = cur; } };
  const accrue = (to) => {
    const st = stats(); const cap = P.capBaseH + P.bankCapH * st.banks;
    for (const b of built) { if (!b.def.rate) continue; const from = Math.max(b.last, b.done); if (to <= from) continue; b.acc = Math.min(rateOf(b, st) * cap, b.acc + rateOf(b, st) * (to - from) / 60); b.last = to; }
  };
  const collect = () => { let g = 0, x = 0; for (const b of built) { const f = Math.floor(b.acc); x += P.xpCollect(f); g += f; b.acc -= f; } cash += g; gainXP(x); return g; };
  const builderFree = () => built.filter((b) => b.done > cur).length < P.builders(L);
  const pay = (c) => { const needW = Math.max(0, c.wood - wood), needS = Math.max(0, c.stone - stone); const total = c.cash + needW * P.wood + needS * P.stone; if (cash < total) return false; cash -= total; wood -= c.wood - needW; stone -= c.stone - needS; return true; };
  const costCash = (c) => c.cash + Math.max(0, c.wood - wood) * P.wood + Math.max(0, c.stone - stone) * P.stone;
  const capt = (banks) => captureFraction(pl, P.capBaseH + P.bankCapH * Math.min(P.bankCapMax, banks));
  const tryBuy = () => {
    for (let guard = 0; guard < 50; guard++) {
      if (!builderFree()) return;
      const st = stats(); const base = totalRate();
      let best = null;
      for (const def of CITY) {
        if (def.L > L) continue;
        const cnt = built.filter((b) => b.def === def).length; if (cnt >= maxCount(def, L)) continue;
        const cells = def.w * def.d, over = cells * P.overheadPerCell;
        // delta thu nhập hiệu quả (đã tính trần kho tiền theo lịch chơi)
        let pop = st.pop + (def.pop || 0), jobs = st.jobs + (def.jobs || 0);
        const E2 = jobs ? Math.min(1, pop / jobs) : 1;
        let after = 0; const nInc = built.filter((b) => b.def.rate).length + (def.rate ? 1 : 0);
        const decor2 = Math.min(0.3, (built.filter((b) => b.def.decor).reduce((s, b) => s + b.def.decor * b.def.cover, 0) + (def.decor || 0) * (def.cover || 0)) / (nInc || 1));
        for (const b of built.filter((b) => b.def.rate)) after += b.def.rate * (b.def.jobs ? E2 : 1) * (1 + decor2);
        if (def.rate) after += def.rate * (def.jobs ? E2 : 1) * (1 + decor2);
        const banksNow = built.filter((b) => b.def.kind === 'bank').length;
        const delta = after * capt(banksNow + (def.kind === 'bank' ? 1 : 0)) - base * capt(banksNow);
        const price = costCash(def.cost) + over;
        const ratio = delta / price;
        if (ratio > 0 && (!best || ratio > best.ratio)) best = { def, ratio, price, cells, over };
      }
      if (!best) return;
      // không đủ tiền cho lựa chọn tốt nhất → chờ nếu ≤ 3 giờ thu nhập, ngược lại mua lựa chọn đủ tiền tốt nhất
      if (cash < best.price) return;
      // đất
      if (used + best.cells > zones * P.usableCellsPerZone) {
        const zc = P.zoneCost(zonesBought);
        if (zonesBought < P.zoneMaxBuy && L >= P.zoneLevel(zonesBought) && cash >= zc + best.price) { cash -= zc; zones++; zonesBought++; }
        else {
          // hết đất: phá công trình mật độ thu thấp để thay bằng công trình mật độ cao hơn (vòng chơi cuối game)
          const dens = (d) => (d.rate || 1) / (d.w * d.d);
          if (!best.def.rate || dens(best.def) < 1.5 * Math.min(...built.filter((b) => b.done <= cur && b.def.rate).map((b) => dens(b.def)))) return;
          const victims = built.filter((b) => b.done <= cur && b.def.rate && b.def.kind === (best.def.kind === 'bank' ? 'shop' : best.def.kind) && dens(b.def) * 1.5 <= dens(best.def)).sort((a, b) => dens(a.def) - dens(b.def));
          let freed = zones * P.usableCellsPerZone - used; const rm = [];
          for (const v of victims) { if (freed >= best.cells) break; rm.push(v); freed += v.def.w * v.def.d; }
          if (freed < best.cells) return;
          for (const v of rm) { built.splice(built.indexOf(v), 1); used -= v.def.w * v.def.d; cash += Math.floor(v.def.V * P.refund) + Math.floor(v.acc); }
          if (cash < best.price) return;
        }
      }
      cash -= best.over; gainXP(best.over * P.xpPerSpend);
      pay(best.def.cost); gainXP(P.xpBuild(best.def.V));
      built.push({ def: best.def, done: cur + best.def.build, acc: 0, last: cur + best.def.build });
      used += best.cells;
    }
  };
  // nhiệm vụ tân thủ (xấp xỉ)
  const quests = () => {
    const q = (id, cond, r) => { if (!quest.done.has(id) && cond) { quest.done.add(id); cash += r; } };
    q('tut', true, 700);
    q('pop12', stats().pop >= 12, 300);
    q('garden', built.some((b) => b.def.id === 'deco_garden'), 200);
    q('zone', zonesBought >= 1, 500);
    if (L >= 4 && !quest.done.has('bridge') && cash > 1000) { cash -= 360 + 620; gainXP(P.xpBuild(620) + 18); quest.done.add('bridge'); cash += 300 + 800 + 1000; }
  };
  let si = 0;
  for (const [s, e] of S) {
    for (let m = s; m <= e; m += 1) {
      cur = m; accrue(m);
      if ((m - s) % 5 === 0 || m === e) collect(); quests(); tryBuy();
    }
    // nhiệm vụ lặp: ≈ 15 phút thu nhập mỗi phiên sau tutorial
    if (si++ > 0) cash += Math.round(totalRate() * 0.25);
    log.push({ day: +(s / 1440).toFixed(2), L, rate: Math.round(totalRate()), n: built.length, zones }); xpSeries.push([e, xpTot]);
  }
  return { levelAt, log, xpSeries, final: { L, rate: Math.round(totalRate()), n: built.length, zones, cash } };
}

function simFarm(pl, days = 60) {
  const XM = 1, CUM = P.xpCumMap.farm || P.xpCum; let xpTot = 0; const xpSeries = [];
  let cash = P.startCash, L = 1, xp = 0, wood = P.startWood, stone = P.startStone;
  const levelAt = {}; let cur = 0;
  const S = sessions(pl, days);
  const owned = { market: 0, farmhouse: 0, well: 0 }; const prod = []; // {def, slots:[{queue:[readyAt...]}]}
  let tilled = 0; const fields = []; // {n, crop, readyAt}
  let builders = []; const log = [];
  const gainXP = (x) => { xpTot += x * XM; xp += x * XM; while (L < 20 && xp >= xpNeed(L, CUM)) { xp -= xpNeed(L, CUM); L++; cash += P.levelReward * L; levelAt[L] = cur; } };
  const spend = (c) => { const needW = Math.max(0, c.wood - wood), needS = Math.max(0, c.stone - stone); const tot = c.cash + needW * P.wood + needS * P.stone; if (cash < tot) return false; cash -= tot; wood -= c.wood - needW; stone -= c.stone - needS; gainXP(P.xpBuild(V(c))); return true; };
  const quota = () => 24 * owned.farmhouse;
  const nextSessionStart = (t) => { const n = S.find(([s]) => s > t); return n ? n[0] : t + 1440; };
  const builderFree = () => builders.filter((d) => d > cur).length < P.builders(L);
  const irrig = () => (owned.well > 0 ? 0.8 : 1);
  const realizedCellH = { v: 30 };
  let si = 0;
  for (const [s, e] of S) {
    for (let m = s; m <= e; m++) {
      cur = m;
      // thu hoạch + bán
      for (const f of fields) if (f.readyAt <= m && f.n) { const c = f.crop; const g = c.price * c.yield * f.n; cash += g; gainXP(f.n * c.xp); f.n = 0; }
      for (let i = fields.length - 1; i >= 0; i--) if (!fields[i].n) fields.splice(i, 1);
      // sản xuất: thu sản phẩm + nạp hàng chờ (mua nguyên liệu theo giá bán = chi phí cơ hội)
      for (const p of prod) { if (p.done > m) continue; for (const sl of p.slots) {
        while (sl.length && sl[0] <= m) { sl.shift(); cash += p.def.price; gainXP(p.def.xp); }
        while (sl.length < p.def.queue && cash > p.def.inputV * 3) { cash -= p.def.inputV; const start = Math.max(m, sl.length ? sl[sl.length - 1] : m); sl.push(start + p.def.cycleMin); }
      } }
      // gieo: chọn cây lãi nhất theo thời gian thực tới lần thu
      const busy = fields.reduce((s, f) => s + f.n, 0), free = tilled - busy;
      if (free > 0 && owned.market) {
        let best = null;
        for (const c of CROPS) { if (c.L > L) continue; const cyc = c.cycleMin * irrig(); const ready = m + cyc; const harvestAt = ready <= e ? ready : nextSessionStart(ready - 1); const per = c.profit / Math.max(1, harvestAt - m); if (!best || per > best.per) best = { c, ready, per }; }
        const n = Math.min(free, Math.floor(cash / best.c.seed)); if (n > 0) { cash -= best.c.seed * n; fields.push({ n, crop: best.c, readyAt: best.ready }); realizedCellH.v = best.per * 60; }
      }
      // xây dựng (tham lam theo tỉ lệ lợi nhuận/giá)
      for (let g = 0; g < 10; g++) {
        if (!builderFree()) break;
        const opts = [];
        if (!owned.market) opts.push({ id: 'market', ratio: 99, c: FARM[0].cost, build: 0.5, apply: () => owned.market++ });
        const fh = FARM[1];
        if (owned.farmhouse < 10 && L >= fh.levels[owned.farmhouse]) { const c = { ...fh.cost, cash: fh.costs[owned.farmhouse] + 24 * 5 }; opts.push({ id: 'farmhouse', ratio: (24 * realizedCellH.v) / V(c), c, build: fh.build, apply: () => { owned.farmhouse++; tilled += 24; } }); }
        if (!owned.well && L >= 2) opts.push({ id: 'well', ratio: (Math.min(tilled, 30) * realizedCellH.v * 0.25) / V(FARM[2].cost), c: FARM[2].cost, build: 2, apply: () => owned.well++ });
        for (const p of PRODUCERS) { if (p.L > L) continue; const cnt = prod.filter((x) => x.def === p).length; if (cnt >= Math.min(4, 1 + Math.floor((L - p.L) / 3))) continue;
          // thông lượng thực tế/ngày với hàng chờ: ước lượng qua lịch
          const perDay = pl.daily.reduce((s, [st, len], i, a) => { const next = a[(i + 1) % a.length][0] + (i + 1 === a.length ? 1440 : 0); return s + Math.min(p.queue, (next - st) / p.cycleMin) + len / p.cycleMin; }, 0);
          opts.push({ id: p.id, ratio: (p.slots * perDay * (p.price - p.inputV) / 24) / V(p.cost), c: p.cost, build: p.build, apply: () => prod.push({ def: p, done: cur + p.build, slots: Array.from({ length: p.slots }, () => []) }) }); }
        opts.sort((a, b) => b.ratio - a.ratio); const o = opts[0]; if (!o) break;
        const over = 9 * P.overheadPerCell; const costC = o.c.cash + Math.max(0, o.c.wood - wood) * P.wood + Math.max(0, o.c.stone - stone) * P.stone + over;
        if (cash < costC + 50) break;
        cash -= over; gainXP(over * P.xpPerSpend); spend(o.c); o.apply(); builders.push(cur + o.build);
      }
    }
    if (si++ > 0) cash += Math.round(24 * owned.farmhouse * realizedCellH.v * 0.25);
    log.push({ day: +(s / 1440).toFixed(2), L, fields: tilled, prod: prod.length }); xpSeries.push([e, xpTot]);
  }
  return { levelAt, log, xpSeries, final: { L, fields: tilled, prod: prod.map((p) => p.def.id).join(','), cash } };
}

function fmtT(min) { if (min == null) return '—'; const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60); return d ? `ngày ${d + 1} ${h}h` : (min < 60 ? `${Math.round(min)} phút` : `${(min / 60).toFixed(1)} giờ`); }
export { captureFraction, simCity, simFarm, PLAYERS, sessions, CITY, CROPS, PRODUCERS, PRODUCTS, FARM };
function simReport() {
  for (const [map, fn] of [['THÀNH PHỐ', simCity], ['QUÊ', simFarm]]) {
    console.log(`\n== MÔ PHỎNG ${map} (60 ngày) ==`);
    const res = Object.fromEntries(Object.entries(PLAYERS).map(([k, pl]) => [k, fn(pl)]));
    const rows = [];
    for (const L of [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 20]) {
      const row = { 'Cấp': L };
      for (const [k, r] of Object.entries(res)) { const first = sessions(PLAYERS[k], 1)[0][0]; row[PLAYERS[k].name] = r.levelAt[L] != null ? fmtT(r.levelAt[L] - first) : '—'; }
      rows.push(row);
    }
    console.table(rows);
    for (const [k, r] of Object.entries(res)) console.log(PLAYERS[k].name, '→ cuối:', JSON.stringify(r.final));
  }
}
if (args.has('--tables') || args.size === 0) tables();
if (args.has('--quiet')) {}
if (args.has('--sim') || args.size === 0) simReport();
