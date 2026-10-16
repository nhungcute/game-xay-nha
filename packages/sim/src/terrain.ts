import { CellFlag, GRID, kindAllows, Surface, VERTS, cellIndex, vertIndex, type Cell, type Command, type Cost, type Rect } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import { addCost, event, guard, pay, rectCells, refund, requireEditable, requireLevel, scaleCost, zeroCost } from './common';
import { affectedVertexCells, corners, isShore, meanHeight, neighbors, slope, type SimState } from './state';
import { forgetRoadPayment, recordRoadPayment, roadPaidValue } from './road-value';

function shoreValid(s: SimState, c: Cell, embanked: boolean): boolean {
  if (!isShore(s,c)) return true;
  const shared = corners(c).filter(i => affectedVertexCells(i).some(n => s.surface[cellIndex(...n)] === Surface.WATER));
  return shared.every(i => s.heights[i]! >= s.template.waterLevelDm + 5 && (embanked || s.heights[i]! <= s.template.waterLevelDm + 20));
}
function roadValid(s: SimState, c: Cell): boolean {
  return slope(s,c) <= 10 && neighbors(c).every(n => !s.roadTier[cellIndex(...n)] || Math.abs(meanHeight(s,c) - meanHeight(s,n)) <= 5);
}

/** Mutates a transaction draft; callers never publish a failed draft. */
export function terraform(s: SimState, rect: Rect, mode: 'RAISE' | 'LOWER' | 'FLATTEN', targetHDm?: number): Cost {
  requireLevel(s,economy.terraform.unlockLevel);
  const cells = rectCells(rect), selected = new Set(cells.map(c => cellIndex(...c)));
  const indices = [...new Set(cells.flatMap(corners))], changed = new Set<number>();
  if (mode === 'FLATTEN') {
    targetHDm ??= Math.round(indices.reduce((sum,i) => sum + s.heights[i]!,0) / indices.length / economy.terraform.stepDm) * economy.terraform.stepDm;
    guard(Number.isInteger(targetHDm) && targetHDm % economy.terraform.stepDm === 0,'INVALID_COMMAND');
  }
  for (const c of cells) {
    requireEditable(s,c);
    guard(s.surface[cellIndex(...c)] !== Surface.WATER && s.surface[cellIndex(...c)] !== Surface.ROAD,'CELL_BLOCKED');
    guard(!s.occupancy.has(cellIndex(...c)),'OCCUPIED');
  }
  let steps = 0;
  for (const i of indices) {
    const previous = s.heights[i]!;
    const next = mode === 'FLATTEN' ? targetHDm! : Math.round(previous / economy.terraform.stepDm) * economy.terraform.stepDm + (mode === 'RAISE' ? 5 : -5);
    guard(next >= s.template.waterLevelDm - 40 && next <= s.template.waterLevelDm + 300,'TOO_STEEP');
    if (previous === next) continue;
    for (const c of affectedVertexCells(i)) {
      requireEditable(s,c);
      guard(!s.snapshot.bridges.some(b => corners(b.a).includes(i) || corners(b.b).includes(i)),'AFFECTS_NEIGHBOR');
      if (!selected.has(cellIndex(...c))) guard(!s.occupancy.has(cellIndex(...c)), 'AFFECTS_NEIGHBOR');
    }
    steps += Math.abs(next - previous) / economy.terraform.stepDm;
    s.heights[i] = next; changed.add(i);
  }
  const affected = new Map<number,Cell>();
  for (const i of changed) for (const c of affectedVertexCells(i)) affected.set(cellIndex(...c),c);
  for (const [i,c] of affected) {
    guard(shoreValid(s,c,Boolean(s.flags[i]! & CellFlag.EMBANKED)),'SHORE_RULE');
    if (!selected.has(i) && s.roadTier[i]) guard(roadValid(s,c),'AFFECTS_NEIGHBOR');
  }
  // Check boundary edges only; embanked cells permit a steep shoreline.
  for (const i of changed) {
    const x = i % VERTS, z = Math.floor(i / VERTS);
    for (const [nx,nz] of [[x-1,z],[x+1,z],[x,z-1],[x,z+1]]) {
      if (nx! < 0 || nz! < 0 || nx! > GRID || nz! > GRID) continue;
      const ni = vertIndex(nx!,nz!);
      if (changed.has(ni)) continue;
      const support = affectedVertexCells(i).filter(c => corners(c).includes(ni));
      if (support.some(c => s.surface[cellIndex(...c)] === Surface.WATER || (s.flags[cellIndex(...c)]! & CellFlag.EMBANKED))) continue;
      guard(Math.abs(s.heights[i]! - s.heights[ni]!) <= 20,'TOO_STEEP_EDGE');
    }
  }
  const cost = { ...zeroCost(), cash: Math.ceil(steps * economy.terraform.costPerStep) };
  pay(s,cost,true);
  if (mode === 'FLATTEN' && rect[2] - rect[0] >= 1 && rect[3] - rect[1] >= 1) event(s,'TERRAFORM','flat_2x2');
  return cost;
}

export function terrain(s: SimState, cmd: Command): Cost | undefined {
  if (cmd.type === 'TERRAFORM') return terraform(s,cmd.payload.rect,cmd.payload.mode,cmd.payload.targetHDm);
  if (cmd.type === 'BUILD_ROAD') {
    const def = economy.roadTiers[cmd.payload.tier]; requireLevel(s,def.unlockLevel);
    guard(kindAllows(def.mapKinds,s.template.mapKind),'WRONG_MAP');
    let cost = zeroCost();
    const changed: Cell[] = [];
    for (const c of cmd.payload.cells) {
      requireEditable(s,c);
      const i = cellIndex(...c), previous = s.roadTier[i]!;
      guard(s.surface[i] !== Surface.WATER,'CELL_BLOCKED');
      guard(s.surface[i] !== Surface.TILLED,'CELL_TILLED');
      guard(!s.occupancy.has(i),'OCCUPIED');
      if (previous >= cmd.payload.tier) continue;
      const old = previous ? economy.roadTiers[previous as 1|2|3].cost : zeroCost();
      const paid = {cash:def.cost.cash-old.cash,wood:def.cost.wood-old.wood,stone:def.cost.stone-old.stone};
      recordRoadPayment(s, i, paid.cash + paid.wood * economy.materialPrices.wood + paid.stone * economy.materialPrices.stone);
      cost = addCost(cost,{cash:def.cost.cash-old.cash,wood:def.cost.wood-old.wood,stone:def.cost.stone-old.stone});
      s.surface[i] = Surface.ROAD; s.roadTier[i] = cmd.payload.tier; changed.push(c);
    }
    for (const c of changed) guard(roadValid(s,c),'TOO_STEEP');
    pay(s,cost,true); if (changed.length) event(s,'ROAD','cells',changed.length); return cost;
  }
  if (cmd.type === 'REMOVE_ROAD') {
    // docs/16 §5: removing any infrastructure refunds 50% — of what was actually paid for that cell (template roads: 0).
    let paid = 0;
    for (const c of cmd.payload.cells) {
      requireEditable(s,c); const i = cellIndex(...c);
      guard(!(s.flags[i]! & CellFlag.ENTRY),'PROTECTED');
      guard(!s.snapshot.bridges.some(b => cellIndex(...b.a) === i || cellIndex(...b.b) === i),'BRIDGE_END_INVALID');
      guard(s.roadTier[i]! > 0,'CELL_BLOCKED');
      paid += roadPaidValue(s, i);
      s.surface[i] = Surface.DIRT; s.roadTier[i] = 0;
      forgetRoadPayment(s, i);
    }
    refund(s, { cash: paid, wood: 0, stone: 0 }, economy.construction.refund);
    return zeroCost();
  }
  if (cmd.type === 'EMBANK' || cmd.type === 'REMOVE_EMBANK') {
    requireLevel(s,economy.embank.unlockLevel); let count = 0;
    for (const c of cmd.payload.cells) {
      requireEditable(s,c); const i = cellIndex(...c);
      guard(isShore(s,c),'NOT_SHORE'); guard(!s.occupancy.has(i),'OCCUPIED');
      if (cmd.type === 'EMBANK') {
        if (!(s.flags[i]! & CellFlag.EMBANKED)) { s.flags[i] = s.flags[i]! | CellFlag.EMBANKED; count++; }
      } else {
        guard(Boolean(s.flags[i]! & CellFlag.EMBANKED),'NOT_SHORE');
        guard(!s.snapshot.bridges.some(b => cellIndex(...b.a) === i || cellIndex(...b.b) === i),'BRIDGE_END_INVALID');
        guard(shoreValid(s,c,false),'SHORE_RULE');
        s.flags[i] = s.flags[i]! & ~CellFlag.EMBANKED; count++;
      }
    }
    const cost = scaleCost(economy.embank.cost,count);
    if (cmd.type === 'EMBANK') { pay(s,cost,true); event(s,'EMBANK','cells',count); return cost; }
    refund(s,cost,economy.construction.refund); return zeroCost();
  }
  return undefined;
}
