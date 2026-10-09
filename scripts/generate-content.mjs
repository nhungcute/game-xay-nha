import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('docs/16_ECONOMY_AND_BALANCE.md', root), 'utf8');
// The reference model's CLI must stay silent when used as a data source.
const savedArgs = process.argv;
process.argv = [savedArgs[0], savedArgs[1], '--quiet'];
const { P, CITY, FARM, CROPS, PRODUCERS, PRODUCTS } = await import('../docs/tools/economy/model.mjs');
process.argv = savedArgs;

function section(start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  if (from < 0 || to < 0) throw new Error(`Missing economy section: ${start}`);
  return source.slice(from, to);
}
function rows(text) {
  return text.split('\n').filter(line => line.startsWith('|') && !line.includes('---'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim().replaceAll('**', '').replaceAll('`', '')));
}
function number(text) {
  const match = text.replace(/(?<=\d) (?=\d)/g, '').match(/-?\d+(?:[.,]\d+)?/u);
  if (!match) throw new Error(`Missing number: ${text}`);
  return Number(match[0].replace(',', '.'));
}
function findRow(text, name) {
  const row = rows(text).find(row => row[0] === name);
  if (!row) throw new Error(`Missing economy row: ${name}`);
  return row;
}
function cost(text) {
  const result = { cash: 0, wood: 0, stone: 0 };
  for (const segment of text.split('+')) {
    if (segment.includes('$')) result.cash = number(segment);
    if (segment.includes('gỗ')) result.wood = number(segment);
    if (segment.includes('đá')) result.stone = number(segment);
  }
  return result;
}
function seconds(text) {
  return number(text) * (text.includes('giờ') ? 3600 : text.includes('phút') ? 60 : 1);
}
function capture(pattern, text = source) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Missing source value: ${pattern}`);
  return number(match[1]);
}
const infraSource = section('## 5.', '## 6.');
const citySource = section('### 6.1', '### 6.2');
const cropSource = section('### 7.1', '### 7.2');
const producerSource = section('### 7.2', '### 7.3');
const farmSource = section('### 7.3', '### 7.4');
const questsSource = section('## 10.', '## 11.');
const translations = {};
const name = (prefix, id, value) => {
  const key = `${prefix}.${id}`;
  translations[key] = value;
  return key;
};
const buildings = {};
function building(def, table, mapKind) {
  const row = findRow(table, def.id);
  const result = {
    id: def.id, mapKinds: [mapKind], nameKey: name('building', def.id, row[1]),
    size: [def.w, def.d], entranceSide: 'S', cost: def.cost,
    unlockLevel: def.L, buildSeconds: def.build * 60,
    buildXp: P.xpBuild(def.cost.cash + def.cost.wood * P.wood + def.cost.stone * P.stone),
    modelId: def.id,
  };
  if (def.limit) result.limit = def.id === 'bank' ? [def.limit[0], 1 / 3, def.limit[2]] : def.limit;
  if (def.maxCount) result.maxCount = def.maxCount;
  if (def.pop) result.population = def.pop;
  if (def.jobs) result.jobs = def.jobs;
  if (def.rate) result.baseRatePerHour = def.rate;
  if (def.decor) result.decor = { bonus: def.decor, radius: capture(/bán kính (\d+) ô/, row[10]) };
  if (def.id === 'bank') result.bankCapHours = P.bankCapH;
  if (def.id === 'hotel') result.waterBonusOverride = capture(/Khách sạn nhận thưởng view nước \+(\d+)%/) / 100;
  if (def.costs) { result.costScaling = def.costs; result.unlockLevels = def.levels; }
  if (def.quota) result.fieldQuota = def.quota;
  if (def.id === 'well') result.irrigationRadius = capture(/bán kính (\d+) ô/, row[8]);
  if (def.id === 'silo') result.storageBonus = number(row[8]);
  if (def.slots) {
    result.limit = [1, 1 / 3, capture(/min\((\d+), 1 \+ floor/, producerSource)];
    result.production = { slots: def.slots, queueLimit: def.queue, recipes: [def.id] };
  }
  buildings[def.id] = result;
}
CITY.forEach(def => building(def, citySource, 'city'));
FARM.forEach(def => building(def, farmSource, 'farm'));
PRODUCERS.forEach(def => building(def, producerSource, 'farm'));
const flower = findRow(farmSource, 'deco_flowerbed');
building({ id: flower[0], w: number(flower[2].split('×')[0]), d: number(flower[2].split('×')[1]),
  cost: { cash: number(flower[3]), wood: number(flower[4]), stone: number(flower[5]) },
  L: number(flower[6]), build: seconds(flower[7]) / 60 }, farmSource, 'farm');
const crops = Object.fromEntries(CROPS.map(def => [def.id, {
  id: def.id, nameKey: name('crop', def.id, findRow(cropSource, def.id)[1]),
  unlockLevel: def.L, seedCost: def.seed, growSeconds: def.cycleMin * 60,
  yield: def.yield, itemId: def.id, xp: def.xp,
  stageModels: [`${def.id}_seed`, `${def.id}_growing`, `${def.id}_ripe`],
}]));
const recipes = Object.fromEntries(PRODUCERS.map(def => [def.id, {
  id: def.id, inputs: def.in, output: def.out, seconds: def.cycleMin * 60, xp: def.xp,
}]));
const items = Object.fromEntries([...CROPS, ...PRODUCTS].map(def => [def.id, {
  id: def.id, nameKey: name('item', def.id, 'by' in def
    ? findRow(producerSource, def.by)[11] : findRow(cropSource, def.id)[1]),
  sellPrice: def.price, iconId: def.id,
}]));
const bridges = Object.fromEntries([
  ['bridge_wood', 'Cầu gỗ', ['city', 'farm']],
  ['bridge_stone', 'Cầu đá', ['city', 'farm']],
  ['bridge_concrete', 'Cầu bê tông', ['city']],
].map(([id, label, mapKinds]) => {
  const row = findRow(infraSource, label);
  return [id, { id, nameKey: name('bridge', id, label), mapKinds,
    maxSpan: capture(/nhịp tối đa (\d+)/, row[1]), costPerCell: cost(row[1]),
    unlockLevel: number(row[2]), buildSecondsPerCell: seconds(row[4]) }];
}));
const roadTiers = Object.fromEntries([
  ['1', 'Đường đất (tier 1)'], ['2', 'Đường sỏi (tier 2)'], ['3', 'Đường nhựa (tier 3)'],
].map(([tier, label]) => {
  const row = findRow(infraSource, label);
  const multiplier = section('### 6.3', '### 6.4').match(/roadMult = ([\d.]+) \/ ([\d.]+) \/ ([\d.]+)/);
  if (!multiplier) throw new Error('Missing road multipliers');
  return [tier, { cost: cost(row[1]), unlockLevel: number(row[2]), mapKinds: ['city', 'farm'], multiplier: Number(multiplier[Number(tier)]) }];
}));
const clear = Object.fromEntries([
  ['tree', 'Chặt cây'], ['rock', 'Đập đá tảng (1 ô)'], ['rock_large', 'Đập đá lớn (2 × 2)'], ['bush', 'Phát bụi'],
].map(([id, label]) => {
  const row = findRow(section('## 4.', '## 5.'), label);
  return [id, { cost: cost(row[1]), reward: cost(row[2]) }];
}));
const embankRow = findRow(infraSource, 'Kè đá');
const tillRow = findRow(infraSource, 'Cuốc đất');
const terraformRow = findRow(infraSource, 'San nền');
const buildSection = section('### 3.1', '### 3.2');
const incomeSection = section('### 6.3', '### 6.4');
const farmSection = section('### 7.1', '### 7.2');
const economy = {
  contentVersion: 1,
  sources: ['docs/16_ECONOMY_AND_BALANCE.md', 'docs/tools/economy/model.mjs'],
  principles: { paybackBaseH: P.paybackBaseH, paybackGrowth: P.paybackGrowth,
    housePaybackMul: P.housePaybackMul, bankPaybackMul: P.bankPaybackMul,
    prodPaybackMul: P.prodPaybackMul, cropP0: P.cropP0, cropCycleExp: P.cropCycleExp, cropLevelGrowth: P.cropLevelGrowth },
  start: { cash: P.startCash, wood: P.startWood, stone: P.startStone, level: 1, xp: 0,
    unlockedZoneCount: capture(/(\d+) khu trung tâm đã mở/) },
  materialPrices: { wood: P.wood, stone: P.stone },
  construction: {
    builders: [...buildSection.matchAll(/(\d+) \(cấp (\d+)\)/g)].map(match => ({ unlockLevel: Number(match[2]), count: Number(match[1]) })),
    speedupPct: capture(/ceil\((\d+)%/, buildSection) / 100,
    speedupMinimumCash: capture(/tối thiểu \$(\d+)/, buildSection),
    cancelRefund: number(findRow(buildSection, 'Hủy khi đang xây')[1]) / 100,
    refund: P.refund, tutorialInstantThroughQuest: capture(/nhiệm vụ 1–(\d+)/, buildSection),
  },
  clear, terraform: { costPerStep: number(terraformRow[1]), stepDm: capture(/\(([\d,]+) m\)/, terraformRow[1]) * 10, unlockLevel: number(terraformRow[2]) },
  till: { cost: number(tillRow[1]), removeCost: number(findRow(infraSource, 'Bỏ cuốc')[1]), unlockLevel: number(tillRow[2]) },
  embank: { cost: cost(embankRow[1]), unlockLevel: number(embankRow[2]) }, roadTiers,
  income: { capBaseH: P.capBaseH, bankCapH: P.bankCapH, bankCapMax: P.bankCapMax,
    decorCap: capture(/decor\s*= min\(([\d.]+)/, incomeSection), waterBonus: capture(/water\s*= ([\d.]+)/, incomeSection),
    waterRadius: capture(/bán kính (\d+) ô/, incomeSection), hotelWaterBonus: buildings.hotel.waterBonusOverride,
    bubbleFraction: capture(/accrued ≥ (\d+)%/) / 100 },
  farm: { baseStorage: capture(/Sức chứa kho cơ bản:\*\* (\d+)/),
    irrigationMultiplier: capture(/thời gian × ([\d,]+)/, farmSection),
    waterIrrigationRadius: capture(/ô nước trong bán kính (\d+) ô/, farmSection),
    productionQueueLimit: capture(/hàng chờ (\d+) mẻ/, producerSource) },
  xp: { buildMultiplier: capture(/round\((\d+) × √V\)/), spendDivisor: capture(/1 XP \/ \$(\d+) chi/),
    collectDivisor: capture(/1 XP \/ \$(\d+) thu được/), cumulative: { city: P.xpCumMap.city.slice(0, 21), farm: P.xpCumMap.farm.slice(0, 21) },
    levelReward: P.levelReward, maxLevel: P.xpCumMap.city.slice(0, 21).length - 1 },
  zones: { maxBuy: P.zoneMaxBuy, costBase: capture(/\$\(([^+]+)\+/), costLinear: capture(/\+ ([\d ]+)·k \+/),
    costQuadratic: capture(/\+ ([\d ]+)·k²/), unlockBase: capture(/min\(20, (\d+) \+ floor\(k \/ 3\)\)/),
    unlockEvery: capture(/floor\(k \/ (\d+)\)/), unlockMax: capture(/min\((\d+), 2 \+ floor\(k/),
    waterThreshold: capture(/Khu có > (\d+)%/) / 100, waterPriceMultiplier: capture(/diện tích là nước: giá × ([\d,]+)/) },
  tutorial: { cityIncomeMultiplier: capture(/tích lũy tăng tốc (\d+)×/, questsSource), farmGrowSeconds: capture(/chín sau (\d+) giây/, questsSource) },
  repeatQuests: { defined: false, rewardIncomeMinutes: capture(/thưởng ≈ (\d+) phút/, questsSource) },
};

// Quest predicates transcribe §10; no random quest pool is invented.
const questRules = {
  city: [
    { action: 'CLEAR', kind: 'tree', target: 3 },
    { action: 'ROAD', kind: 'connected_cells', target: 6, requiresRoad: true },
    { action: 'TERRAFORM', kind: 'flat_2x2', target: 1 },
    { action: 'BUILD', kind: 'building', target: 1, buildingId: 'house_small' },
    { action: 'BUILD', kind: 'building', target: 1, buildingId: 'shop_grocery' },
    { action: 'COLLECT', kind: 'first_collection', target: 1 },
    { action: 'POPULATION', kind: 'population', target: 12 },
    { action: 'BUILD', kind: 'building', target: 1, buildingId: 'deco_garden' },
    { action: 'UNLOCK_ZONE', kind: 'zone', target: 1 },
    { action: 'EMBANK', kind: 'cells', target: 4 },
    { action: 'BRIDGE', kind: 'bridge_wood', target: 1 },
    { action: 'BUILD', kind: 'income_far_bank', target: 1, farBank: true },
  ],
  farm: [
    { action: 'BUILD', kind: 'building', target: 1, buildingId: 'market', requiresRoad: true },
    { action: 'BUILD', kind: 'building', target: 1, buildingId: 'farmhouse' },
    { action: 'TILL', kind: 'cells', target: 6 },
    { action: 'PLANT', kind: 'crop', target: 1, cropId: 'veg_greens' },
    { action: 'HARVEST', kind: 'first_harvest', target: 1 },
    { action: 'SELL', kind: 'farm_items', target: 10 },
    { action: 'PLANT', kind: 'cells', target: 10, cropId: 'rice' },
    { action: 'BUILD', kind: 'building', target: 1, buildingId: 'well' },
    { action: 'PRODUCE', kind: 'building_and_feed', target: 1, buildingId: 'chicken_coop' },
    { action: 'EMBANK', kind: 'cells', target: 4 },
    { action: 'BRIDGE', kind: 'bridge_wood', target: 1 },
    { action: 'TILL', kind: 'cells_far_bank', target: 1, farBank: true },
  ],
};
const quests = Object.fromEntries(Object.entries(questRules).map(([mapKind, rules]) => {
  const table = section(mapKind === 'city' ? '### 10.1' : '### 10.2', mapKind === 'city' ? '### 10.2' : '## 11.');
  return [mapKind, rules.map((rule, index) => {
    const row = findRow(table, String(index + 1));
    const id = `${mapKind}-${index + 1}`;
    return { id, nameKey: name('quest', id, row[1]), ...rule, reward: cost(row[2].replaceAll(',', '+')),
      xp: /XP/.test(row[2]) ? capture(/(\d+) XP/, row[2]) : 0, tutorial: index < economy.construction.tutorialInstantThroughQuest };
  })];
}));
const catalog = { contentVersion: 1, buildings, crops, recipes, items, bridges, quests };
// docs/16 requires the economy artifact to contain every balance table.
economy.catalog = catalog;
const files = {
  'packages/content/economy.v1.json': economy,
  'packages/content/catalog.v1.json': catalog,
  'packages/content/quests.v1.json': { contentVersion: 1, quests },
  'packages/content/i18n/vi.json': translations,
};
for (const [relativePath, value] of Object.entries(files)) {
  const destination = new URL(relativePath, root);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (savedArgs.includes('--check')) {
    const actual = await readFile(destination, 'utf8');
    if (actual !== expected) throw new Error(`Generated content is stale: ${relativePath}`);
  } else {
    await mkdir(new URL('./', destination), { recursive: true });
    await writeFile(destination, expected, 'utf8');
  }
}
console.log(`${savedArgs.includes('--check') ? 'Verified' : 'Generated'} ${Object.keys(files).length} content files from docs/16 + economy model (${fileURLToPath(root)}).`);
