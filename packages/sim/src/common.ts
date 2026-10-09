import { CellFlag, GRID, Surface, cellIndex, type Cell, type Cost, type ErrorCode, type Rect, type PlacedBuilding, type PlacedBridge } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { inBounds, isUnlocked, neighbors, type SimState } from './state';
import { footprintCells } from './footprint';

export class RuleError extends Error {
  constructor(public readonly code: ErrorCode, message: string = code) { super(message); }
}
export function guard(condition: unknown, code: ErrorCode, message?: string): asserts condition {
  if (!condition) throw new RuleError(code, message);
}
export const zeroCost = (): Cost => ({ cash: 0, wood: 0, stone: 0 });
export function lookup<T>(record: Record<string,T>, id: string): T | undefined { return Object.hasOwn(record,id) ? record[id] : undefined; }
export const scaleCost = (cost: Cost, n: number): Cost => ({ cash: cost.cash * n, wood: cost.wood * n, stone: cost.stone * n });
export const addCost = (a: Cost, b: Cost): Cost => ({ cash: a.cash + b.cash, wood: a.wood + b.wood, stone: a.stone + b.stone });
export function rectCells([x0, z0, x1, z1]: Rect): Cell[] {
  guard(x0 <= x1 && z0 <= z1 && [x0,z0,x1,z1].every(Number.isInteger), 'INVALID_COMMAND');
  guard((x1 - x0 + 1) * (z1 - z0 + 1) <= 256, 'AREA_TOO_LARGE');
  const cells: Cell[] = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells.push([x,z]);
  return cells;
}
export function requireEditable(s: SimState, c: Cell): void {
  guard(inBounds(c) && isUnlocked(s,c), 'ZONE_LOCKED');
  guard(!(s.flags[cellIndex(...c)]! & CellFlag.PROTECTED), 'PROTECTED');
}
export function requireLevel(s: SimState, level: number): void { guard(s.snapshot.progress.level >= level, 'LEVEL_REQUIRED'); }
export function addXp(s: SimState, xp: number): void {
  guard(Number.isSafeInteger(xp) && xp >= 0, 'INVALID_COMMAND');
  const p = s.snapshot.progress; p.xp += xp;
  const table = economy.xp.cumulative[s.template.mapKind];
  while (p.level < economy.xp.maxLevel && p.xp >= table[p.level + 1]!) {
    p.level++; s.snapshot.wallet.cash += economy.xp.levelReward * p.level;
  }
}
export function cashXp(s: SimState, cash: number, kind: 'spend' | 'collect'): void {
  const key = `${kind}_xp_remainder`, divisor = kind === 'spend' ? economy.xp.spendDivisor : economy.xp.collectDivisor;
  const total = (s.snapshot.progress.questProgress[key] ?? 0) + cash;
  s.snapshot.progress.questProgress[key] = total % divisor;
  addXp(s, Math.floor(total / divisor));
}
export function pay(s: SimState, cost: Cost, spend = false): void {
  for (const key of ['cash','wood','stone'] as const) {
    guard(Number.isSafeInteger(cost[key]) && cost[key] >= 0, 'INVALID_COMMAND');
    guard(s.snapshot.wallet[key] >= cost[key], 'INSUFFICIENT_FUNDS');
  }
  for (const key of ['cash','wood','stone'] as const) s.snapshot.wallet[key] -= cost[key];
  if (spend) cashXp(s,cost.cash,'spend');
}
export function refund(s: SimState, cost: Cost, fraction = 1): void {
  for (const key of ['cash','wood','stone'] as const) s.snapshot.wallet[key] += Math.floor(cost[key] * fraction);
}
export function event(s: SimState, action: string, kind: string, count = 1): void {
  const q = catalog.quests[s.template.mapKind][s.snapshot.progress.questIndex];
  if (q?.action === action && (q.kind === kind || q.buildingId === kind || q.cropId === kind)) {
    s.snapshot.progress.questProgress[q.id] = (s.snapshot.progress.questProgress[q.id] ?? 0) + count;
  }
}

export function isFarBank(s: SimState, cells: Cell[]): boolean {
  const flood = (starts: Cell[]): Uint8Array => {
    const visited = new Uint8Array(GRID * GRID), queue = [...starts];
    for (const c of starts) visited[cellIndex(...c)] = 1;
    for (let head = 0; head < queue.length; head++) for (const n of neighbors(queue[head]!)) {
      const i = cellIndex(...n);
      if (!visited[i] && s.surface[i] !== Surface.WATER) { visited[i] = 1; queue.push(n); }
    }
    return visited;
  };
  const home = flood(s.template.entryCells), target = flood(cells);
  return cells.every(c => !home[cellIndex(...c)]) && s.snapshot.bridges.some(b => b.status === 'ACTIVE'
    && ((home[cellIndex(...b.a)] && target[cellIndex(...b.b)]) || (home[cellIndex(...b.b)] && target[cellIndex(...b.a)])));
}

export function constructionCompleted(s: SimState, object: PlacedBuilding | PlacedBridge): void {
  addXp(s, Math.round(economy.xp.buildMultiplier * Math.sqrt(object.investedValue)));
  if ('defId' in object) {
    event(s,'BUILD',object.defId);
    const def = catalog.buildings[object.defId]!;
    if (def.baseRatePerHour && isFarBank(s,footprintCells(def,object.anchor,object.rotation))) event(s,'BUILD','income_far_bank');
  } else event(s,'BRIDGE',object.typeId);
}
