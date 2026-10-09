/**
 * G1 evidence planner.
 * Plays the provisional farm map through the real sim (no shortcuts) until the character can
 * embank and build a wooden bridge, then dry-runs the exact UI sequence the browser test performs.
 * Output: test-results/g1/plan.json = { snapshot, steps, sites } consumed by scripts/g1-evidence.mjs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { WorldTemplateSchema, cellIndex, type Cell, type CommandType } from '@xay-nha/contracts';
import { generateEnvironment } from '@xay-nha/worldgen';
import { createState, execute, footprintCells, meanHeight, recompute, type SimState } from '@xay-nha/sim';
import { catalog } from '@xay-nha/content';

const template = WorldTemplateSchema.parse(JSON.parse(await readFile('apps/web/public/worlds/farm-g1/template.v1.json', 'utf8')));
// Must match apps/web WorldStore identity so the browser accepts the snapshot.
const identity = { worldId: 'offline-farm', accountId: 'offline', displayName: 'Người chơi', tag: '0001' };
let now = Date.now() - 3 * 24 * 3_600_000;
let s: SimState = createState(template, now, generateEnvironment(template), identity);
recompute(s);
let seq = 0;

function run(type: CommandType, payload: unknown, label = type): void {
  const e = execute(s, { type, payload, worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision,
    commandId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, clientTime: now }, now);
  if (!e.result.accepted) throw new Error(`${label} rejected: ${e.result.code} ${JSON.stringify(e.result.detail ?? '')}`);
  s = e.state;
}
// Sim time advances inside execute(); moving `now` forward is enough for the next command.
function tick(ms: number): void { now += ms; }
const envOn = (cells: Cell[]): string[] => [...new Set(cells.map(c => s.occupancy.get(cellIndex(...c))).filter((id): id is string => !!id && s.env.some(e => e.id === id)))];
function clear(cells: Cell[]): void { const ids = envOn(cells); if (ids.length) run('CLEAR_ENV', { envIds: ids }, `clear ${ids.length}`); }
function rect([x0, z0, x1, z1]: [number, number, number, number]): Cell[] { const out: Cell[] = []; for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push([x, z]); return out; }
function place(defId: string, anchor: Cell, rotation: 0 | 1 | 2 | 3 = 0): void {
  const def = catalog.buildings[defId]!;
  const cells = footprintCells(def, anchor, rotation);
  clear(cells);
  const h = Math.round(cells.reduce((v, c) => v + meanHeight(s, c), 0) / cells.length / 5) * 5;
  run('PLACE_BUILDING', { defId, anchor, rotation, autoFlattenHDm: h }, `place ${defId}`);
}
function sellAll(): void { const items = Object.fromEntries(Object.entries(s.snapshot.inventory).filter(([, n]) => n > 0)); if (Object.keys(items).length) run('SELL', { items }); }
function finish(): void { tick(4 * 3_600_000); }
function claim(): void {
  const q = catalog.quests.farm[s.snapshot.progress.questIndex];
  if (q) run('CLAIM_QUEST', { questId: q.id }, `claim ${q.id}`);
}
const log = (label: string): void => console.log(`${label.padEnd(28)} L${s.snapshot.progress.level} xp=${s.snapshot.progress.xp} $${s.snapshot.wallet.cash} wood=${s.snapshot.wallet.wood} stone=${s.snapshot.wallet.stone} q=${s.snapshot.progress.questIndex}`);

// ---- 1. Play to level 4 through real progression ----
log('start');
run('BUY_MATERIAL', { wood: 10, stone: 15 }, 'buy materials');
place('market', [71, 77]); claim(); log('market');
place('farmhouse', [67, 77]); claim(); log('farmhouse');
clear(rect([72, 60, 77, 61]));
run('TILL', { rect: [72, 60, 77, 61] }); claim(); log('till 12');
run('PLANT', { rect: [72, 60, 77, 61], cropId: 'veg_greens' }); claim(); log('plant greens');
tick(10 * 60_000);
run('HARVEST', { cells: rect([72, 60, 77, 61]) }); claim(); log('harvest');
sellAll(); claim(); log('sell');
run('PLANT', { rect: [72, 60, 77, 61], cropId: 'rice' }); claim(); log('plant rice');
place('well', [78, 66]); finish(); claim(); log('well');
place('silo', [76, 63]); finish(); log('silo');
for (let i = 0; i < 6 && s.snapshot.progress.level < 4; i++) {
  tick(15 * 60_000);
  run('HARVEST', { cells: rect([72, 60, 77, 61]) });
  sellAll();
  run('PLANT', { rect: [72, 60, 77, 61], cropId: 'rice' });
  log(`farm loop ${i}`);
}
if (s.snapshot.progress.level < 4) throw new Error(`could not reach level 4 (L${s.snapshot.progress.level})`);
tick(15 * 60_000);
run('HARVEST', { cells: rect([72, 60, 77, 61]) });
sellAll();
for (let i = 0; i < 30 && s.snapshot.wallet.cash < 3600; i++) {
  run('PLANT', { rect: [72, 60, 77, 61], cropId: 'corn' });
  tick(31 * 60_000);
  run('HARVEST', { cells: rect([72, 60, 77, 61]) });
  sellAll();
}
log('corn rounds');
if (s.snapshot.wallet.cash < 3600) throw new Error(`need cash for the bridge scenario, have ${s.snapshot.wallet.cash}`);
log('ready');
const snapshot = structuredClone(s.snapshot);

// ---- 2. Dry-run the browser UI sequence on a copy ----
const sites = {
  roadFrom: [70, 78] as Cell, roadCorner: [70, 70] as Cell, nearEnd: [64, 70] as Cell,
  farEnd: [59, 70] as Cell, farRoad: [58, 70] as Cell, farRoad2: [57, 70] as Cell, buildRect: [55, 67, 57, 69] as [number, number, number, number],
  buildingId: 'chicken_coop', grass: [80, 66] as Cell,
};
const roadPath: Cell[] = [];
for (let z = 78; z >= 70; z--) roadPath.push([70, z]);
for (let x = 69; x >= 65; x--) roadPath.push([x, 70]);
const steps: { tool: string; cells?: Cell[]; rect?: number[]; options?: Record<string, unknown>; advanceMs?: number; note: string }[] = [];
const clearCells = [...roadPath, sites.nearEnd, sites.farEnd, sites.farRoad, sites.farRoad2, ...rect(sites.buildRect)];
const step = (st: (typeof steps)[number], type: CommandType | null, payload?: unknown): void => { steps.push(st); if (type) run(type, payload, st.note); };
step({ tool: 'buy', options: { wood: 30, stone: 20 }, note: 'Mua vật liệu ở cửa hàng' }, 'BUY_MATERIAL', { wood: 30, stone: 20 });
// Pick a 3×3 patch with blocking trees/rocks near the site so the Clear tool has real work to show.
let clearRect: [number, number, number, number] | null = null;
for (let z = 66; z <= 76 && !clearRect; z++) for (let x = 50; x <= 77 && !clearRect; x++) {
  const r: [number, number, number, number] = [x, z, x + 2, z + 2];
  const ids = envOn(rect(r)).filter(id => s.env.find(e => e.id === id)?.blocking);
  if (ids.length >= 2 && rect(r).every(c => !roadPath.some(p => p[0] === c[0] && p[1] === c[1]))) clearRect = r;
}
if (!clearRect) throw new Error('no tree patch to clear near the site');
step({ tool: 'clear', rect: clearRect, note: `Dọn ${envOn(rect(clearRect)).length} cây/đá trong vùng ${clearRect.join(',')}` }, 'CLEAR_ENV', { envIds: envOn(rect(clearRect)) });
// The UI scenario does not clear the route itself, so it must already be free of blocking objects.
const blockers = envOn(clearCells).filter(id => s.env.find(e => e.id === id)?.blocking);
if (blockers.length) throw new Error(`route/site has blocking env: ${blockers.join(',')}`);
step({ tool: 'road', cells: roadPath, options: { tier: 1 }, note: 'Làm đường đất từ điểm vào tới sát bờ sông' }, 'BUILD_ROAD', { tier: 1, cells: roadPath });
step({ tool: 'embank', cells: [sites.nearEnd], note: 'Kè bờ gần' }, 'EMBANK', { cells: [sites.nearEnd] });
step({ tool: 'terraform', rect: [sites.nearEnd[0], sites.nearEnd[1], sites.nearEnd[0], sites.nearEnd[1]], options: { mode: 'FLATTEN' }, note: 'San phẳng ô bờ đã kè' },
  'TERRAFORM', { rect: [sites.nearEnd[0], sites.nearEnd[1], sites.nearEnd[0], sites.nearEnd[1]], mode: 'FLATTEN' });
step({ tool: 'road', cells: [sites.nearEnd], options: { tier: 1 }, note: 'Nối đường ra mố cầu bờ gần' }, 'BUILD_ROAD', { tier: 1, cells: [sites.nearEnd] });
step({ tool: 'embank', cells: [sites.farEnd], note: 'Kè bờ xa' }, 'EMBANK', { cells: [sites.farEnd] });
step({ tool: 'terraform', rect: [sites.farEnd[0], sites.farEnd[1], sites.farEnd[0], sites.farEnd[1]], options: { mode: 'FLATTEN' }, note: 'San phẳng bờ xa' },
  'TERRAFORM', { rect: [sites.farEnd[0], sites.farEnd[1], sites.farEnd[0], sites.farEnd[1]], mode: 'FLATTEN' });
step({ tool: 'road', cells: [sites.farEnd, sites.farRoad, sites.farRoad2], options: { tier: 1 }, note: 'Làm đường ở bờ xa' }, 'BUILD_ROAD', { tier: 1, cells: [sites.farEnd, sites.farRoad, sites.farRoad2] });
step({ tool: 'bridge', cells: [sites.nearEnd, sites.farEnd], options: { bridgeId: 'bridge_wood' }, note: 'Bắc cầu gỗ nhịp 4 ô' }, 'BUILD_BRIDGE', { typeId: 'bridge_wood', a: sites.nearEnd, b: sites.farEnd });
tick(5 * 60_000);
step({ tool: 'wait', advanceMs: 5 * 60_000, note: 'Chờ cầu xây xong (4 phút)' }, null);
step({ tool: 'build', cells: [[sites.buildRect[0], sites.buildRect[1]]], options: { buildingId: sites.buildingId }, note: 'Xây chuồng gà ở bờ xa' },
  'PLACE_BUILDING', { defId: sites.buildingId, anchor: [sites.buildRect[0], sites.buildRect[1]], rotation: 0 });
tick(6 * 60_000);
step({ tool: 'wait', advanceMs: 6 * 60_000, note: 'Chờ chuồng gà xây xong' }, null);
run('BUY_MATERIAL', { wood: 1 }, 'advance clock');
const coop = s.snapshot.buildings.find(b => b.defId === sites.buildingId)!;
// A free, flat, editable cell for the place/cancel leak loop (cleared patch is ideal).
const freeCell = rect(clearRect).find(c => !s.occupancy.get(cellIndex(...c)) && s.surface[cellIndex(...c)] !== 7 && !s.roadTier[cellIndex(...c)]);
if (!freeCell) throw new Error('no free cell for leak loop');
(sites as Record<string, unknown>).freeCell = freeCell; (sites as Record<string, unknown>).clearRect = clearRect;
if (coop.status !== 'ACTIVE') throw new Error('coop not active after wait');
log('scenario ok');

await mkdir('test-results/g1', { recursive: true });
await writeFile('test-results/g1/plan.json', JSON.stringify({ snapshot, steps, sites, generatedAt: new Date().toISOString() }));
console.log(`plan: ${steps.length} UI steps; snapshot L${snapshot.progress.level} $${snapshot.wallet.cash} serverTime ${new Date(snapshot.serverTime).toISOString()}`);
