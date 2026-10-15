import {
  CellFlag, GRID, Surface, VERTS, WorldSnapshotSchema, cellIndex, decodeInt16, decodeUint8, vertIndex,
  type WorldSnapshot,
} from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createState, inBounds, isUnlocked, isShore, corners, affectedVertexCells, meanHeight, neighbors, slope, rebuildOccupancy, restoreDeltas, type SimState } from './state';
import { footprintCells } from './footprint';
import { builderCapacity, buildersBusy, buildingLimit, validateBridge } from './construction';
import { slotCount, tierDef, upgradeSeconds, upgradeable } from './upgrades';
import { costValue, recompute } from './economy';
import { validateRoadPayments } from './road-value';
import { validateRepeat } from './quests';

/**
 * Content migrations (docs/16 §11), applied in sequence. v1 → v2 (D025): Farm XP thresholds lowered; XP is
 * kept and the level is recomputed from it (never lower, since thresholds only dropped). v2 → v3 (D028):
 * upgrades, relief, larger base storage and collect-all only add optional fields or loosen rules, so the data
 * carries over unchanged. Unknown/newer versions are left for the CONTENT_VERSION check to reject.
 */
export function migrateContent(snapshot: WorldSnapshot): WorldSnapshot {
  if (snapshot.contentVersion >= economy.contentVersion) return snapshot;
  let migrated = snapshot;
  if (migrated.contentVersion === 1) {
    const table = economy.xp.cumulative[migrated.mapKind];
    let level = 1;
    while (level < economy.xp.maxLevel && migrated.progress.xp >= table[level + 1]!) level++;
    migrated = { ...migrated, contentVersion: 2, progress: { ...migrated.progress, level: Math.max(level, migrated.progress.level) } };
  }
  if (migrated.contentVersion === 2) migrated = { ...migrated, contentVersion: 3 };
  return migrated;
}

/**
 * Quests became parallel (D041): older saves only carry `questIndex`. They read as "the first N quests of the
 * chain are claimed"; the converted form is persisted by the next save. No SQL migration.
 */
export function normalizeQuests(snapshot: WorldSnapshot): WorldSnapshot {
  if (snapshot.progress.claimedQuests) return snapshot;
  const claimedQuests = catalog.quests[snapshot.mapKind].slice(0, snapshot.progress.questIndex).map(q => q.id);
  return { ...snapshot, progress: { ...snapshot.progress, claimedQuests } };
}

export type SnapshotValidation = { ok: true; state: SimState } | { ok: false; errors: string[] };

/** No current-state, scene or cache mutation occurs while validating a replacement snapshot. */
export function validateSnapshot(current: SimState, input: unknown, now: number): SnapshotValidation {
  const parsed = WorldSnapshotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => `SCHEMA:${issue.path.join('.')}:${issue.message}`) };
  const snapshot = normalizeQuests(migrateContent(parsed.data)), errors: string[] = [], template = current.template;
  for (const key of ['mapId', 'mapKind', 'templateVersion', 'seed', 'generatorVersion'] as const) {
    if (snapshot[key] !== template[key]) errors.push(`TEMPLATE_MISMATCH:${key}`);
  }
  for (const key of ['worldId', 'accountId'] as const) if (snapshot[key] !== current.snapshot[key]) errors.push(`IDENTITY_MISMATCH:${key}`);
  if (snapshot.contentVersion !== economy.contentVersion) errors.push('CONTENT_VERSION');
  if (!Number.isFinite(now) || snapshot.serverTime > now + 300000) errors.push('TIME:serverTime');
  const createdTime = (time: number, label: string) => { if (time > snapshot.serverTime + 300000) errors.push(`TIME:${label}`); };
  createdTime(snapshot.character.createdAt, 'character.createdAt');
  if (snapshot.progress.reliefAt !== undefined) createdTime(snapshot.progress.reliefAt, 'progress.reliefAt');
  const table = economy.xp.cumulative[snapshot.mapKind];
  let level = 1;
  while (level < economy.xp.maxLevel && snapshot.progress.xp >= table[level + 1]!) level++;
  if (snapshot.progress.level !== level) errors.push('LEVEL_XP');
  if (snapshot.progress.questIndex > catalog.quests[snapshot.mapKind].length) errors.push('QUEST_INDEX');
  {
    const known = new Set(catalog.quests[snapshot.mapKind].map(q => q.id)), claimed = snapshot.progress.claimedQuests ?? [];
    if (claimed.some(id => !known.has(id))) errors.push('QUEST_CLAIMED:UNKNOWN');
    if (new Set(claimed).size !== claimed.length) errors.push('QUEST_CLAIMED:DUPLICATE');
    if (claimed.length !== snapshot.progress.questIndex) errors.push('QUEST_CLAIMED:COUNT');
  }
  errors.push(...validateRepeat(snapshot));
  if ((snapshot.progress.questProgress.spend_xp_remainder ?? 0) >= economy.xp.spendDivisor
    || (snapshot.progress.questProgress.collect_xp_remainder ?? 0) >= economy.xp.collectDivisor) errors.push('XP_REMAINDER');
  const unlocked = new Set(snapshot.unlockedZones);
  if (template.startZones.some(zone => !unlocked.has(zone))) errors.push('ZONES:MISSING_START');
  const visited = new Set<number>(), queue = snapshot.unlockedZones.length ? [snapshot.unlockedZones[0]!] : [];
  while (queue.length) {
    const zone = queue.pop()!;
    if (visited.has(zone)) continue;
    visited.add(zone);
    for (const next of [zone % 8 > 0 ? zone - 1 : -1, zone % 8 < 7 ? zone + 1 : -1, zone - 8, zone + 8]) if (unlocked.has(next) && !visited.has(next)) queue.push(next);
  }
  if (visited.size !== unlocked.size) errors.push('ZONES:DISCONNECTED');
  const envIds = new Set(current.env.map(entity => entity.id));
  for (const id of snapshot.delta.removedEnvIds) if (!envIds.has(id)) errors.push(`ENV_REFERENCE:${id}`);
  const ids = new Set<string>();
  for (const entity of [...snapshot.buildings, ...snapshot.bridges]) {
    if (ids.has(entity.id)) errors.push(`DUPLICATE_ID:${entity.id}`);
    ids.add(entity.id); createdTime(entity.placedAt, `${entity.id}.placedAt`);
    if (entity.buildEndsAt < entity.placedAt) errors.push(`CONSTRUCTION_TIME:${entity.id}`);
    if ((entity.status === 'ACTIVE') !== (entity.buildEndsAt <= snapshot.serverTime)) errors.push(`CONSTRUCTION_STATUS:${entity.id}`);
  }
  let candidate: SimState;
  try {
    candidate = createState(template, snapshot.serverTime, current.env, {
      worldId: snapshot.worldId, accountId: snapshot.accountId, displayName: snapshot.character.displayName, tag: snapshot.character.tag,
    });
    candidate.snapshot = snapshot;
    errors.push(...restoreDeltas(candidate));
    // An omitted neighboring delta uses immutable template heights; it must share the changed edge too.
    const base = decodeInt16(template.layers.heightsDm, VERTS * VERTS), seen = new Map<number, number>();
    for (let zone = 0; zone < 64; zone++) {
      const delta = snapshot.delta.zones[zone], heights = delta ? decodeInt16(delta.heightsDm, 17 * 17) : undefined;
      const ox = zone % 8 * 16, oz = Math.floor(zone / 8) * 16;
      for (let z = 0; z <= 16; z++) for (let x = 0; x <= 16; x++) {
        if (x !== 0 && x !== 16 && z !== 0 && z !== 16) continue;
        const global = vertIndex(ox + x, oz + z), height = heights?.[z * 17 + x] ?? base[global]!;
        if (seen.has(global) && seen.get(global) !== height) errors.push(`SHARED_EDGE:${global}`);
        seen.set(global, height);
      }
    }
  } catch (error) { return { ok: false, errors: [...errors, `DELTA:${error instanceof Error ? error.message : String(error)}`] }; }
  // Occupancy construction indexes catalog IDs; exclude inherited object properties first.
  const badBuildingIds = new Set(snapshot.buildings.filter(building => !Object.hasOwn(catalog.buildings, building.defId)).map(building => building.id));
  for (const id of badBuildingIds) errors.push(`BUILDING_REFERENCE:${id}`);
  if (badBuildingIds.size) {
    const buildings = candidate.snapshot.buildings;
    candidate.snapshot.buildings = buildings.filter(building => !badBuildingIds.has(building.id));
    errors.push(...rebuildOccupancy(candidate));
    candidate.snapshot.buildings = buildings;
  } else errors.push(...rebuildOccupancy(candidate));
  if (buildersBusy(candidate) > builderCapacity(candidate)) errors.push('NO_BUILDER_FREE');
  const templateSurface = decodeUint8(template.layers.surface, GRID * GRID), templateFlags = decodeUint8(template.layers.flags, GRID * GRID);
  const templateRoads = decodeUint8(template.layers.roadTier, GRID * GRID), templateHeights = decodeInt16(template.layers.heightsDm, VERTS * VERTS);
  for (let i = 0; i < GRID * GRID; i++) {
    const cell: [number, number] = [i % GRID, Math.floor(i / GRID)], unlockedCell = isUnlocked(candidate, cell);
    if (candidate.surface[i]! > Surface.WATER) errors.push(`SURFACE_ENUM:${i}`);
    if (candidate.flags[i]! & ~15) errors.push(`FLAG_ENUM:${i}`);
    if (candidate.roadTier[i]! > 3) errors.push(`ROAD_TIER:${i}`);
    if ((candidate.surface[i] === Surface.ROAD) !== (candidate.roadTier[i]! > 0)) errors.push(`ROAD_SURFACE:${i}`);
    if (candidate.surface[i] === Surface.WATER && candidate.roadTier[i]) errors.push(`ROAD_WATER:${i}`);
    if ((candidate.surface[i] === Surface.WATER) !== (templateSurface[i] === Surface.WATER)) errors.push(`WATER_CHANGED:${i}`);
    if (snapshot.mapKind === 'city' && candidate.surface[i] === Surface.TILLED) errors.push(`WRONG_MAP:TILLED:${i}`);
    let immutableFlags = templateFlags[i]! & (CellFlag.NO_BUILD | CellFlag.ENTRY | CellFlag.PROTECTED);
    if (templateRoads[i] && unlockedCell && !(immutableFlags & CellFlag.NO_BUILD)) immutableFlags &= ~CellFlag.PROTECTED;
    if ((candidate.flags[i]! & (CellFlag.NO_BUILD | CellFlag.ENTRY | CellFlag.PROTECTED)) !== immutableFlags) errors.push(`IMMUTABLE_FLAGS:${i}`);
    if ((immutableFlags & CellFlag.ENTRY) && !(candidate.flags[i]! & CellFlag.ENTRY)) errors.push(`ENTRY_REMOVED:${i}`);
    if ((!unlockedCell || (immutableFlags & CellFlag.PROTECTED)) && (candidate.surface[i] !== templateSurface[i] || candidate.roadTier[i] !== templateRoads[i] || candidate.flags[i] !== templateFlags[i])) errors.push(`LOCKED_CELL_CHANGED:${i}`);
    if ((candidate.flags[i]! & CellFlag.EMBANKED) && !isShore(candidate, cell)) errors.push(`EMBANK_NOT_SHORE:${i}`);
    if (candidate.roadTier[i]) {
      if (slope(candidate, cell) > 10 || neighbors(cell).some(neighbor => candidate.roadTier[cellIndex(...neighbor)] && Math.abs(meanHeight(candidate, cell) - meanHeight(candidate, neighbor)) > 5)) errors.push(`ROAD_SLOPE:${i}`);
    }
    if (isShore(candidate, cell)) {
      const shared = corners(cell).filter(vertex => affectedVertexCells(vertex).some(neighbor => candidate.surface[cellIndex(...neighbor)] === Surface.WATER));
      if (shared.some(vertex => candidate.heights[vertex]! < template.waterLevelDm + 5
        || (!(candidate.flags[i]! & CellFlag.EMBANKED) && candidate.heights[vertex]! > template.waterLevelDm + 20))) errors.push(`SHORE_RULE:${i}`);
    }
  }
  for (let i = 0; i < candidate.heights.length; i++) {
    const height = candidate.heights[i]!;
    if (height < template.waterLevelDm - 40 || height > template.waterLevelDm + 300) errors.push(`HEIGHT_RANGE:${i}`);
    if (height !== templateHeights[i]) {
      if (height % economy.terraform.stepDm) errors.push(`HEIGHT_STEP:${i}`);
      if (affectedVertexCells(i).some(cell => !isUnlocked(candidate, cell) || (candidate.flags[cellIndex(...cell)]! & CellFlag.PROTECTED))) errors.push(`LOCKED_VERTEX_CHANGED:${i}`);
      if (affectedVertexCells(i).every(cell => candidate.surface[cellIndex(...cell)] === Surface.WATER)) errors.push(`WATER_VERTEX_CHANGED:${i}`);
    }
  }
  for (const id of snapshot.delta.removedEnvIds) {
    const entity = current.env.find(env => env.id === id);
    if (entity && (!isUnlocked(candidate, entity.cell) || (candidate.flags[cellIndex(...entity.cell)]! & CellFlag.PROTECTED))) errors.push(`ENV_LOCKED:${id}`);
  }
  const counts = new Map<string, number>();
  for (const building of snapshot.buildings) {
    const def = Object.hasOwn(catalog.buildings, building.defId) ? catalog.buildings[building.defId] : undefined;
    if (!def) { errors.push(`BUILDING_REFERENCE:${building.id}`); continue; }
    counts.set(def.id, (counts.get(def.id) ?? 0) + 1);
    if (!def.mapKinds.includes(snapshot.mapKind)) errors.push(`WRONG_MAP:${building.id}`);
    if (snapshot.progress.level < def.unlockLevel) errors.push(`LEVEL_REQUIRED:${building.id}`);
    if (building.materialsPaid.cash !== building.cashPaid || building.materialsPaid.wood !== def.cost.wood || building.materialsPaid.stone !== def.cost.stone
      || !(def.costScaling ?? [def.cost.cash]).includes(building.cashPaid) || building.investedValue !== costValue(building.materialsPaid)) errors.push(`PAID_VALUE:${building.id}`);
    if (building.buildEndsAt - building.placedAt > def.buildSeconds * 1000 + 1000) errors.push(`CONSTRUCTION_DURATION:${building.id}`);
    if (building.settledAt !== undefined) createdTime(building.settledAt, `${building.id}.settledAt`);
    // D028 upgrades: tier needs the level; an upgrade in progress runs on a finished building and is not yet due.
    if (building.tier !== undefined && (!upgradeable(def) || snapshot.progress.level < tierDef(building.tier).unlockLevel)) errors.push(`UPGRADE_TIER:${building.id}`);
    if (building.upgrade) {
      const { tier, startedAt, endsAt } = building.upgrade;
      if (!upgradeable(def) || building.status !== 'ACTIVE' || tier !== (building.tier ?? 1) + 1 || snapshot.progress.level < tierDef(tier).unlockLevel) errors.push(`UPGRADE_TIER:${building.id}`);
      if (startedAt < building.buildEndsAt || endsAt <= snapshot.serverTime || endsAt < startedAt || endsAt - startedAt > upgradeSeconds(def, tier) * 1000 + 1000) errors.push(`UPGRADE_TIME:${building.id}`);
      createdTime(startedAt, `${building.id}.upgrade.startedAt`);
    }
    const cells = footprintCells(def, building.anchor, building.rotation), vertices = new Set<number>();
    for (const cell of cells) {
      if (!inBounds(cell)) continue;
      if (!isUnlocked(candidate, cell)) errors.push(`ZONE_LOCKED:${building.id}`);
      if (candidate.flags[cellIndex(...cell)]! & (CellFlag.NO_BUILD | CellFlag.PROTECTED | CellFlag.ENTRY)) errors.push(`BUILDING_FLAGS:${building.id}`);
      if ([Surface.WATER, Surface.ROAD, Surface.TILLED].includes(candidate.surface[cellIndex(...cell)]!)) errors.push(`BUILDING_SURFACE:${building.id}`);
      if (isShore(candidate, cell) && !(candidate.flags[cellIndex(...cell)]! & CellFlag.EMBANKED)) errors.push(`NEAR_WATER_NOT_EMBANKED:${building.id}`);
      corners(cell).forEach(index => vertices.add(index));
    }
    if (new Set([...vertices].map(index => candidate.heights[index])).size > 1) errors.push(`NOT_FLAT:${building.id}`);
    if (def.production && !building.slots) errors.push(`PRODUCTION_SLOTS:${building.id}`);
    if (building.slots) {
      if (!def.production || building.slots.length !== slotCount(building, def)) errors.push(`PRODUCTION_SLOTS:${building.id}`);
      if (building.status !== 'ACTIVE' && building.slots.some(slot => slot.length)) errors.push(`PRODUCTION_STATUS:${building.id}`);
      for (const slot of building.slots) {
        if (slot.length > (def.production?.queueLimit ?? 0)) errors.push(`QUEUE_LIMIT:${building.id}`);
        for (let index = 0; index < slot.length; index++) {
          const batch = slot[index]!, recipe = Object.hasOwn(catalog.recipes, batch.recipeId) ? catalog.recipes[batch.recipeId] : undefined;
          if (!recipe || !def.production?.recipes.includes(batch.recipeId)) { errors.push(`RECIPE_REFERENCE:${building.id}`); continue; }
          if (Math.abs(batch.readyAt - batch.startedAt - recipe.seconds * 1000) > 1000) errors.push(`PRODUCTION_DURATION:${building.id}`);
          if (index === 0) createdTime(batch.startedAt, `${building.id}.queue.startedAt`);
          if (index > 0 && batch.startedAt !== slot[index - 1]!.readyAt) errors.push(`QUEUE_ORDER:${building.id}`);
        }
      }
    }
  }
  for (const [id, count] of counts) {
    const def = catalog.buildings[id]!;
    if (count > buildingLimit(candidate, def)) errors.push(`LIMIT_REACHED:${id}`);
    if (def.unlockLevels && count > def.unlockLevels.filter(unlock => snapshot.progress.level >= unlock).length) errors.push(`LEVEL_LIMIT:${id}`);
  }
  for (const crop of snapshot.crops) {
    const def = Object.hasOwn(catalog.crops, crop.cropId) ? catalog.crops[crop.cropId] : undefined;
    if (!def) { errors.push(`CROP_REFERENCE:${crop.cropId}`); continue; }
    if (snapshot.mapKind !== 'farm') errors.push('WRONG_MAP:CROP');
    if (snapshot.progress.level < def.unlockLevel) errors.push(`CROP_LEVEL:${crop.cropId}`);
    createdTime(crop.plantedAt, `crop.${crop.cell}.plantedAt`);
    if (!isUnlocked(candidate, crop.cell)) errors.push(`CROP_ZONE:${crop.cell}`);
    if (candidate.surface[cellIndex(...crop.cell)] !== Surface.TILLED) errors.push(`CROP_SURFACE:${crop.cell}`);
    if (candidate.flags[cellIndex(...crop.cell)]! & (CellFlag.PROTECTED | CellFlag.ENTRY)) errors.push(`CROP_FLAGS:${crop.cell}`);
    const duration = crop.readyAt - crop.plantedAt;
    // Irrigation is fixed at sowing; current well/road state cannot reconstruct that historical decision.
    const durations = [def.growSeconds * 1000, Math.round(def.growSeconds * economy.farm.irrigationMultiplier) * 1000];
    // A completed tutorial may leave its accelerated crop in the saved world.
    if (catalog.quests.farm.some(quest => quest.tutorial && quest.action === 'PLANT' && quest.cropId === def.id)) durations.push(economy.tutorial.farmGrowSeconds * 1000);
    if (!durations.some(valid => Math.abs(duration - valid) <= 1000)) errors.push(`CROP_DURATION:${crop.cell}`);
  }
  for (const bridge of snapshot.bridges) {
    const def = catalog.bridges[bridge.typeId];
    if (!def || !def.mapKinds.includes(snapshot.mapKind)) { errors.push(`BRIDGE_REFERENCE:${bridge.id}`); continue; }
    if (snapshot.progress.level < def.unlockLevel) errors.push(`BRIDGE_LEVEL:${bridge.id}`);
    try {
      const geometry = validateBridge(candidate, bridge.a, bridge.b, def.maxSpan, bridge.id);
      if (geometry.deckHeightDm !== bridge.deckHeightDm) errors.push(`BRIDGE_DECK:${bridge.id}`);
      if (bridge.cashPaid !== def.costPerCell.cash * geometry.cells.length || bridge.materialsPaid.cash !== bridge.cashPaid
        || bridge.materialsPaid.wood !== def.costPerCell.wood * geometry.cells.length || bridge.materialsPaid.stone !== def.costPerCell.stone * geometry.cells.length
        || bridge.investedValue !== costValue(bridge.materialsPaid)) errors.push(`PAID_VALUE:${bridge.id}`);
      if (bridge.buildEndsAt - bridge.placedAt > geometry.cells.length * def.buildSecondsPerCell * 1000 + 1000) errors.push(`BRIDGE_DURATION:${bridge.id}`);
    } catch (error) { errors.push(`BRIDGE_RULE:${bridge.id}:${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const item of Object.keys(snapshot.inventory)) if (!Object.hasOwn(catalog.items, item)) errors.push(`ITEM_REFERENCE:${item}`);
  errors.push(...validateRoadPayments(candidate));
  if (snapshot.mapKind === 'farm') {
    // Lost road access may reduce effective capacity, but cannot create new physical support buildings.
    const support = snapshot.buildings.filter(building => building.status === 'ACTIVE' && Object.hasOwn(catalog.buildings, building.defId));
    const maximumStorage = economy.farm.baseStorage + support.reduce((total, building) => total + (catalog.buildings[building.defId]!.storageBonus ?? 0), 0);
    const maximumFields = support.reduce((total, building) => total + (catalog.buildings[building.defId]!.fieldQuota ?? 0), 0);
    if (Object.values(snapshot.inventory).reduce((sum, count) => sum + count, 0) > maximumStorage) errors.push('STORAGE_CAPACITY');
    if (candidate.surface.reduce((sum, surface) => sum + Number(surface === Surface.TILLED), 0) > maximumFields) errors.push('FIELD_QUOTA');
  }
  if (snapshot.mapKind === 'city' && Object.values(snapshot.inventory).some(count => count > 0)) errors.push('WRONG_MAP:INVENTORY');
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  const savedWorth = snapshot.character.netWorth;
  try { recompute(candidate); } catch (error) { return { ok: false, errors: [`RECOMPUTE:${error instanceof Error ? error.message : String(error)}`] }; }
  if (candidate.snapshot.character.netWorth !== savedWorth) return { ok: false, errors: ['NET_WORTH'] };
  return { ok: true, state: candidate };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Portable deterministic snapshot fingerprint for reload checks; not a security signature. */
export function stateHash(state: SimState): string {
  let hash = 0x811c9dc5;
  const byte = (value: number) => { hash = Math.imul(hash ^ value, 0x01000193) >>> 0; };
  for (const character of canonical(normalizeQuests(state.snapshot as WorldSnapshot))) {
    const cp = character.codePointAt(0)!;
    if (cp < 128) byte(cp);
    else if (cp < 2048) { byte(192 | (cp >>> 6)); byte(128 | (cp & 63)); }
    else if (cp < 65536) { byte(224 | (cp >>> 12)); byte(128 | ((cp >>> 6) & 63)); byte(128 | (cp & 63)); }
    else { byte(240 | (cp >>> 18)); byte(128 | ((cp >>> 12) & 63)); byte(128 | ((cp >>> 6) & 63)); byte(128 | (cp & 63)); }
  }
  return hash.toString(16).padStart(8, '0');
}
