import {
  CellFlag, Surface, cellIndex, vertIndex,
  type BuildingDef, type Cell, type Command, type Cost, type PlacedBridge, type PlacedBuilding,
} from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { footprintCells, rotatedSize } from './footprint';
import { bridgeCells, corners, inBounds, isShore, isUnlocked, neighbors, rebuildOccupancy, type SimState } from './state';
import { constructionCompleted, guard, lookup, pay, refund, requireEditable, requireLevel, scaleCost, zeroCost } from './common';
import { terraform } from './terrain';
import { fieldQuota, inventoryCount, storageCapacity } from './farm';

export type ConstructionObject = PlacedBuilding | PlacedBridge;

export function builderCapacity(s: SimState): number {
  return economy.construction.builders.reduce((count, row) => s.snapshot.progress.level >= row.unlockLevel ? row.count : count, 0);
}

export function requireBuilder(s: SimState): void {
  const busy = [...s.snapshot.buildings, ...s.snapshot.bridges].filter(object => object.status === 'CONSTRUCTING').length;
  guard(busy < builderCapacity(s), 'NO_BUILDER_FREE');
}

export function buildingLimit(s: SimState, def: BuildingDef): number {
  if (!def.limit) return def.maxCount ?? Infinity;
  const [base, step, cap] = def.limit;
  return Math.min(cap, Math.floor(base + step * Math.max(0, s.snapshot.progress.level - def.unlockLevel)));
}

function value(cost: Cost): number {
  return cost.cash + cost.wood * economy.materialPrices.wood + cost.stone * economy.materialPrices.stone;
}

function entityId(s: SimState, prefix: 'b' | 'br'): string {
  const ids = new Set([...s.snapshot.buildings, ...s.snapshot.bridges].map(object => object.id));
  let suffix = 0;
  const stem = `${prefix}_${s.snapshot.revision + 1}`;
  while (ids.has(`${stem}_${suffix}`)) suffix++;
  return `${stem}_${suffix}`;
}

function tutorialInstant(s: SimState, defId: string): boolean {
  const index = s.snapshot.progress.questIndex;
  const quest = catalog.quests[s.snapshot.mapKind][index];
  return !s.snapshot.progress.tutorialDone && index < economy.construction.tutorialInstantThroughQuest
    && quest?.action === 'BUILD' && quest.buildingId === defId;
}

/** The caller settles income at the completion timestamp before invoking this. */
export function completeConstruction(s: SimState, object: ConstructionObject): void {
  if (object.status === 'ACTIVE') return;
  object.status = 'ACTIVE';
  constructionCompleted(s, object);
}

function placeBuilding(s: SimState, cmd: Extract<Command, { type: 'PLACE_BUILDING' }>, now: number): Cost {
  const { defId, anchor, rotation, autoFlattenHDm } = cmd.payload;
  const def = lookup(catalog.buildings,defId);
  guard(def, 'NOT_FOUND');
  const cells = footprintCells(def, anchor, rotation);
  for (const c of cells) guard(inBounds(c) && isUnlocked(s, c), 'ZONE_LOCKED');
  for (const c of cells) guard(![Surface.WATER, Surface.ROAD, Surface.TILLED].includes(s.surface[cellIndex(...c)]!), 'CELL_BLOCKED');
  for (const c of cells) guard(!s.occupancy.has(cellIndex(...c)), 'OCCUPIED', s.occupancy.get(cellIndex(...c)));
  const vertices = [...new Set(cells.flatMap(corners))];
  const flat = vertices.every(index => s.heights[index] === s.heights[vertices[0]!]);
  let terrainCost = zeroCost();
  if (autoFlattenHDm !== undefined) {
    const [w, d] = rotatedSize(def, rotation);
    terrainCost = terraform(s, [anchor[0], anchor[1], anchor[0] + w - 1, anchor[1] + d - 1], 'FLATTEN', autoFlattenHDm);
  } else guard(flat, 'NOT_FLAT');
  for (const c of cells) guard(!isShore(s, c) || Boolean(s.flags[cellIndex(...c)]! & CellFlag.EMBANKED), 'NEAR_WATER_NOT_EMBANKED');
  const count = s.snapshot.buildings.filter(building => building.defId === defId).length;
  requireLevel(s, def.unlockLevels?.[count] ?? def.unlockLevel);
  guard(count < buildingLimit(s, def), 'LIMIT_REACHED');
  const cost: Cost = { ...def.cost, cash: def.costScaling?.[count] ?? def.cost.cash };
  pay(s, cost);
  requireBuilder(s);
  for (const c of cells) {
    requireEditable(s, c);
    guard(!(s.flags[cellIndex(...c)]! & CellFlag.NO_BUILD), 'CELL_BLOCKED');
  }
  guard(def.mapKinds.includes(s.snapshot.mapKind), 'WRONG_MAP');
  const object: PlacedBuilding = {
    id: entityId(s, 'b'), defId, anchor: [...anchor], rotation,
    placedAt: now, buildEndsAt: now + (tutorialInstant(s, defId) ? 0 : def.buildSeconds * 1000),
    status: 'CONSTRUCTING', cashPaid: cost.cash, materialsPaid: { ...cost }, investedValue: value(cost),
    ...(s.snapshot.mapKind === 'city' ? { accrued: 0, settledAt: now } : {}),
    ...(def.production ? { slots: Array.from({ length: def.production.slots }, () => []) } : {}),
  };
  s.snapshot.buildings.push(object);
  for (const c of cells) s.surface[cellIndex(...c)] = Surface.FOUNDATION;
  rebuildOccupancy(s);
  if (object.buildEndsAt === now) completeConstruction(s, object);
  return { cash: cost.cash + terrainCost.cash, wood: cost.wood + terrainCost.wood, stone: cost.stone + terrainCost.stone };
}

function edgeHeight(s: SimState, bank: Cell, direction: Cell): number {
  const [x, z] = bank;
  const vertices = direction[0] ? [vertIndex(x + (direction[0] > 0 ? 1 : 0), z), vertIndex(x + (direction[0] > 0 ? 1 : 0), z + 1)]
    : [vertIndex(x, z + (direction[1] > 0 ? 1 : 0)), vertIndex(x + 1, z + (direction[1] > 0 ? 1 : 0))];
  return (s.heights[vertices[0]!]! + s.heights[vertices[1]!]!) / 2;
}

export function validateBridge(s: SimState, a: Cell, b: Cell, maxSpan: number, ignoreId?: string): { cells: Cell[]; deckHeightDm: number } {
  guard(a[0] === b[0] || a[1] === b[1], 'BRIDGE_NOT_STRAIGHT');
  for (const bank of [a, b]) {
    requireEditable(s, bank);
    const index = cellIndex(...bank);
    guard(s.surface[index] !== Surface.WATER && Boolean(s.flags[index]! & CellFlag.EMBANKED) && Boolean(s.roadTier[index]), 'BRIDGE_END_INVALID');
    guard(!s.occupancy.has(index), 'OCCUPIED');
  }
  const cells = bridgeCells(a, b);
  guard(cells.length >= 1 && cells.length <= maxSpan, 'BRIDGE_TOO_LONG');
  for (const c of cells) {
    requireEditable(s, c);
    guard(s.surface[cellIndex(...c)] === Surface.WATER, 'BRIDGE_SPAN_NOT_WATER');
    const id = s.occupancy.get(cellIndex(...c));
    guard(!id || id === ignoreId, 'BRIDGE_CROSSING');
  }
  const direction: Cell = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
  const hA = edgeHeight(s, a, direction), hB = edgeHeight(s, b, [-direction[0], -direction[1]]);
  guard(Math.abs(hA - hB) <= 10, 'BRIDGE_HEIGHT_MISMATCH');
  const own = new Set(cells.map(c => cellIndex(...c)));
  for (const existing of s.snapshot.bridges) if (existing.id !== ignoreId) {
    const parallel = (existing.a[0] === existing.b[0]) === (a[0] === b[0]);
    for (const c of bridgeCells(existing.a, existing.b)) {
      guard(!own.has(cellIndex(...c)), 'BRIDGE_CROSSING');
      if (parallel) guard(!neighbors(c).some(n => own.has(cellIndex(...n))), 'BRIDGE_CROSSING');
    }
  }
  return { cells, deckHeightDm: Math.max(hA, hB) };
}

function buildBridge(s: SimState, cmd: Extract<Command, { type: 'BUILD_BRIDGE' }>, now: number): Cost {
  const { typeId, a, b } = cmd.payload;
  const def = catalog.bridges[typeId];
  guard(def, 'NOT_FOUND');
  const { cells, deckHeightDm } = validateBridge(s, a, b, def.maxSpan);
  guard(def.mapKinds.includes(s.snapshot.mapKind), 'WRONG_MAP');
  requireLevel(s, def.unlockLevel);
  const cost = scaleCost(def.costPerCell, cells.length);
  pay(s, cost);
  requireBuilder(s);
  s.snapshot.bridges.push({
    id: entityId(s, 'br'), typeId, a: [...a], b: [...b], deckHeightDm,
    placedAt: now, buildEndsAt: now + cells.length * def.buildSecondsPerCell * 1000,
    status: 'CONSTRUCTING', cashPaid: cost.cash, materialsPaid: { ...cost }, investedValue: value(cost),
  });
  rebuildOccupancy(s);
  return cost;
}

function requireDemolitionSafe(s: SimState, object: PlacedBuilding): void {
  const def = catalog.buildings[object.defId]!;
  const after = { ...s, snapshot: { ...s.snapshot, buildings: s.snapshot.buildings.filter(other => other.id !== object.id) } };
  if (def.fieldQuota) {
    guard(s.surface.reduce((sum, surface) => sum + Number(surface === Surface.TILLED), 0) <= fieldQuota(after), 'FIELD_LIMIT');
  }
  if (def.storageBonus) {
    guard(inventoryCount(s) <= storageCapacity(after), 'STORAGE_FULL');
  }
  guard(!object.slots?.some(queue => queue.length > 0), 'PRODUCTION_ACTIVE');
}

function remove(s: SimState, object: ConstructionObject, fraction: number): void {
  refund(s, object.materialsPaid, fraction);
  if ('defId' in object) {
    s.snapshot.wallet.cash += Math.floor(object.accrued ?? 0);
    for (const c of footprintCells(catalog.buildings[object.defId]!, object.anchor, object.rotation)) s.surface[cellIndex(...c)] = Surface.FOUNDATION;
    s.snapshot.buildings = s.snapshot.buildings.filter(building => building.id !== object.id);
  } else s.snapshot.bridges = s.snapshot.bridges.filter(bridge => bridge.id !== object.id);
  rebuildOccupancy(s);
}

export function construction(s: SimState, cmd: Command, now: number): Cost | undefined {
  if (cmd.type === 'PLACE_BUILDING') return placeBuilding(s, cmd, now);
  if (cmd.type === 'BUILD_BRIDGE') return buildBridge(s, cmd, now);
  if (cmd.type === 'DEMOLISH' || cmd.type === 'REMOVE_BRIDGE') {
    const payload = cmd.payload;
    const object = 'buildingId' in payload ? s.snapshot.buildings.find(building => building.id === payload.buildingId)
      : s.snapshot.bridges.find(bridge => bridge.id === payload.bridgeId);
    guard(object, 'NOT_FOUND');
    guard(object.status === 'ACTIVE', 'UNDER_CONSTRUCTION');
    if ('defId' in object) requireDemolitionSafe(s, object);
    remove(s, object, economy.construction.refund);
    return zeroCost();
  }
  if (cmd.type === 'CANCEL_CONSTRUCTION' || cmd.type === 'SPEED_UP') {
    const payload = cmd.payload;
    const object = 'buildingId' in payload ? s.snapshot.buildings.find(building => building.id === payload.buildingId)
      : s.snapshot.bridges.find(bridge => bridge.id === payload.bridgeId);
    guard(object, 'NOT_FOUND');
    guard(object.status === 'CONSTRUCTING' && now < object.buildEndsAt, 'NOT_UNDER_CONSTRUCTION');
    if (cmd.type === 'CANCEL_CONSTRUCTION') {
      remove(s, object, economy.construction.cancelRefund);
      return zeroCost();
    }
    const cost = { ...zeroCost(), cash: Math.max(economy.construction.speedupMinimumCash,
      Math.ceil(economy.construction.speedupPct * object.cashPaid * (object.buildEndsAt - now) / (object.buildEndsAt - object.placedAt))) };
    pay(s, cost);
    object.buildEndsAt = now;
    completeConstruction(s, object);
    return cost;
  }
  return undefined;
}
