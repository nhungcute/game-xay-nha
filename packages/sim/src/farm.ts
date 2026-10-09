import { GRID, Surface, cellIndex, type Cell, type Command, type Cost } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { footprintCells } from './footprint';
import { access } from './roads';
import { editable, slope, type SimState } from './state';
import { addXp, event, guard, isFarBank, lookup, pay, rectCells, requireEditable, requireLevel, scaleCost, zeroCost } from './common';

function operating(s: SimState, building: SimState['snapshot']['buildings'][number]): boolean {
  return building.status === 'ACTIVE' && access(s, building) > 0;
}

export function fieldQuota(s: SimState): number {
  return s.snapshot.buildings.reduce((total, b) => total + (operating(s, b) ? lookup(catalog.buildings, b.defId)?.fieldQuota ?? 0 : 0), 0);
}
export function storageCapacity(s: SimState): number {
  return economy.farm.baseStorage + s.snapshot.buildings.reduce((total, b) => total + (operating(s, b) ? lookup(catalog.buildings, b.defId)?.storageBonus ?? 0 : 0), 0);
}
export function inventoryCount(s: SimState): number {
  return Object.values(s.snapshot.inventory).reduce((total, count) => total + count, 0);
}
function putItem(s: SimState, id: string, count: number): void {
  s.snapshot.inventory[id] = (s.snapshot.inventory[id] ?? 0) + count;
}
function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}
function irrigated(s: SimState, cell: Cell): boolean {
  const radius = economy.farm.waterIrrigationRadius;
  for (let z = Math.max(0, cell[1] - radius); z <= Math.min(GRID - 1, cell[1] + radius); z++) {
    for (let x = Math.max(0, cell[0] - radius); x <= Math.min(GRID - 1, cell[0] + radius); x++) {
      if (s.surface[cellIndex(x, z)] === Surface.WATER) return true;
    }
  }
  return s.snapshot.buildings.some(building => {
    const def = lookup(catalog.buildings, building.defId);
    return def?.irrigationRadius !== undefined && operating(s, building)
      && footprintCells(def, building.anchor, building.rotation).some(source => distance(source, cell) <= def.irrigationRadius!);
  });
}

export function farm(s: SimState, cmd: Command, now: number): Cost | undefined {
  if (!['TILL', 'UNTILL', 'PLANT', 'HARVEST', 'START_PRODUCTION', 'COLLECT_PRODUCTION', 'SELL'].includes(cmd.type)) return undefined;
  guard(s.snapshot.mapKind === 'farm', 'WRONG_MAP');
  const result = zeroCost();
  switch (cmd.type) {
    case 'TILL': {
      requireLevel(s, economy.till.unlockLevel);
      const cells = rectCells(cmd.payload.rect);
      for (const c of cells) {
        requireEditable(s, c);
        guard([Surface.GRASS, Surface.DIRT, Surface.SAND].includes(s.surface[cellIndex(...c)]!), 'CELL_BLOCKED');
        guard(!s.occupancy.has(cellIndex(...c)), 'OCCUPIED');
        guard(slope(s, c) <= economy.terraform.stepDm, 'TOO_STEEP');
      }
      const current = s.surface.reduce((count, surface) => count + Number(surface === Surface.TILLED), 0);
      guard(current + cells.length <= fieldQuota(s), 'FIELD_LIMIT');
      const cost = scaleCost({ ...zeroCost(), cash: economy.till.cost }, cells.length);
      pay(s, cost, true);
      for (const c of cells) s.surface[cellIndex(...c)] = Surface.TILLED;
      event(s, 'TILL', 'cells', cells.length);
      const quest = catalog.quests.farm[s.snapshot.progress.questIndex];
      if (quest?.kind === 'cells_far_bank' && isFarBank(s, cells)) event(s, 'TILL', 'cells_far_bank', cells.length);
      return cost;
    }
    case 'UNTILL': {
      requireLevel(s, economy.till.unlockLevel);
      const cells = rectCells(cmd.payload.rect);
      for (const c of cells) {
        requireEditable(s, c);
        guard(s.surface[cellIndex(...c)] === Surface.TILLED, 'CELL_BLOCKED');
        guard(!s.occupancy.has(cellIndex(...c)), 'OCCUPIED');
      }
      const cost = scaleCost({ ...zeroCost(), cash: economy.till.removeCost }, cells.length);
      pay(s, cost);
      for (const c of cells) s.surface[cellIndex(...c)] = Surface.GRASS;
      return cost;
    }
    case 'PLANT': {
      const def = lookup(catalog.crops, cmd.payload.cropId);
      guard(def !== undefined, 'NOT_FOUND');
      requireLevel(s, def.unlockLevel);
      // Invalid cells are skipped only for planting, per docs/15 §10.
      const cells = rectCells(cmd.payload.rect).filter(c => editable(s, c)
        && s.surface[cellIndex(...c)] === Surface.TILLED && !s.occupancy.has(cellIndex(...c)));
      guard(cells.length > 0, 'CELL_BLOCKED');
      const cost = scaleCost({ ...zeroCost(), cash: def.seedCost }, cells.length);
      pay(s, cost);
      const quest = catalog.quests.farm[s.snapshot.progress.questIndex];
      const tutorial = !s.snapshot.progress.tutorialDone && quest?.action === 'PLANT' && quest.cropId === def.id && quest.tutorial;
      for (const cell of cells) {
        const growSeconds = tutorial ? economy.tutorial.farmGrowSeconds
          : def.growSeconds * (irrigated(s, cell) ? economy.farm.irrigationMultiplier : 1);
        s.snapshot.crops.push({ cell, cropId: def.id, plantedAt: now, readyAt: now + Math.round(growSeconds * 1000) });
        s.occupancy.set(cellIndex(...cell), `crop:${cellIndex(...cell)}`);
      }
      event(s, 'PLANT', def.id, cells.length);
      return cost;
    }
    case 'HARVEST': {
      for (const cell of cmd.payload.cells) requireEditable(s, cell);
      let remaining = storageCapacity(s) - inventoryCount(s), harvested = 0, xp = 0, ripe = false;
      const remove = new Set<number>();
      for (const cell of cmd.payload.cells) {
        const index = s.snapshot.crops.findIndex(c => cellIndex(...c.cell) === cellIndex(...cell));
        const crop = s.snapshot.crops[index];
        if (!crop || crop.readyAt > now) continue;
        ripe = true;
        const def = lookup(catalog.crops, crop.cropId);
        guard(def !== undefined, 'NOT_FOUND');
        if (remaining < def.yield) continue;
        putItem(s, def.itemId, def.yield);
        remaining -= def.yield; xp += def.xp; harvested++; event(s, 'HARVEST', def.id, 1);
        remove.add(index); s.occupancy.delete(cellIndex(...cell));
      }
      guard(harvested > 0, ripe ? 'STORAGE_FULL' : 'INVALID_COMMAND');
      s.snapshot.crops = s.snapshot.crops.filter((_crop, index) => !remove.has(index));
      addXp(s, xp); event(s, 'HARVEST', 'first_harvest', harvested);
      return result;
    }
    case 'START_PRODUCTION': {
      const building = s.snapshot.buildings.find(b => b.id === cmd.payload.buildingId);
      guard(building !== undefined, 'BUILDING_NOT_FOUND');
      guard(building.status === 'ACTIVE', 'UNDER_CONSTRUCTION');
      guard(access(s, building) > 0, 'NO_ROAD_ACCESS');
      const producer = lookup(catalog.buildings, building.defId)?.production;
      const recipe = lookup(catalog.recipes, cmd.payload.recipeId);
      guard(producer !== undefined && recipe !== undefined && producer.recipes.includes(recipe.id), 'NOT_FOUND');
      const slots = building.slots ?? Array.from({ length: producer.slots }, () => []);
      guard(slots.length === producer.slots, 'INVALID_SNAPSHOT');
      const capacity = slots.reduce((total, slot) => total + producer.queueLimit - slot.length, 0);
      guard(cmd.payload.count <= capacity, 'LIMIT_REACHED');
      for (const [id, count] of Object.entries(recipe.inputs)) {
        guard((s.snapshot.inventory[id] ?? 0) >= count * cmd.payload.count, 'INSUFFICIENT_ITEMS');
      }
      for (const [id, count] of Object.entries(recipe.inputs)) s.snapshot.inventory[id]! -= count * cmd.payload.count;
      for (let i = 0; i < cmd.payload.count; i++) {
        // Pick the earliest available slot; offline output is finite and prepaid.
        const candidates = slots.map((slot, index) => ({ index, start: Math.max(now, slot.at(-1)?.readyAt ?? now) }))
          .filter(({ index }) => slots[index]!.length < producer.queueLimit).sort((a, b) => a.start - b.start || a.index - b.index);
        const chosen = candidates[0];
        guard(chosen !== undefined, 'LIMIT_REACHED');
        slots[chosen.index]!.push({ recipeId: recipe.id, startedAt: chosen.start, readyAt: chosen.start + recipe.seconds * 1000 });
      }
      building.slots = slots;
      event(s, 'PRODUCE', building.defId, cmd.payload.count);
      return result;
    }
    case 'COLLECT_PRODUCTION': {
      const building = s.snapshot.buildings.find(b => b.id === cmd.payload.buildingId);
      guard(building !== undefined, 'BUILDING_NOT_FOUND');
      guard(building.status === 'ACTIVE', 'UNDER_CONSTRUCTION');
      guard(lookup(catalog.buildings, building.defId)?.production !== undefined, 'NOT_FOUND');
      let remaining = storageCapacity(s) - inventoryCount(s), collected = 0;
      for (const slot of building.slots ?? []) {
        while (slot[0] && slot[0].readyAt <= now && remaining > 0) {
          const recipe = lookup(catalog.recipes, slot[0].recipeId);
          guard(recipe !== undefined, 'NOT_FOUND');
          slot.shift(); putItem(s, recipe.output, 1); remaining--; collected++;
        }
      }
      guard(collected > 0, remaining <= 0 ? 'STORAGE_FULL' : 'INVALID_COMMAND');
      return result;
    }
    case 'SELL': {
      const markets = s.snapshot.buildings.filter(b => b.defId === 'market' && b.status === 'ACTIVE');
      guard(markets.length > 0, 'BUILDING_NOT_FOUND');
      guard(markets.some(b => access(s, b) > 0), 'NO_ROAD_ACCESS');
      let revenue = 0, sold = 0;
      for (const [id, count] of Object.entries(cmd.payload.items)) {
        const item = lookup(catalog.items, id);
        guard(item !== undefined, 'NOT_FOUND');
        guard((s.snapshot.inventory[id] ?? 0) >= count, 'INSUFFICIENT_ITEMS');
        revenue += item.sellPrice * count; sold += count;
      }
      guard(Number.isSafeInteger(revenue) && Number.isSafeInteger(s.snapshot.wallet.cash + revenue), 'INVALID_COMMAND');
      for (const [id, count] of Object.entries(cmd.payload.items)) s.snapshot.inventory[id]! -= count;
      s.snapshot.wallet.cash += revenue;
      event(s, 'SELL', 'farm_items', sold);
      for (const [id, count] of Object.entries(cmd.payload.items)) event(s, 'SELL', id, count);
      return result;
    }
    default: return undefined;
  }
}
