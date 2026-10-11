import { describe, expect, it } from 'vitest';
import { CellFlag, Surface, cellIndex, decodeInt16, encodeInt16, type WorldSnapshot } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { createState, writeDeltas, type SimState } from './state';
import { recompute } from './economy';
import { stateHash, validateSnapshot } from './snapshot';

const NOW = 1000000;
function playingState(): SimState {
  const state = createState(createTestTemplate('city'), NOW);
  state.snapshot.buildings = [[50, 60], [54, 60], [66, 60]].map((anchor, index) => ({
    id: `b_test${index}`, defId: 'house_small', anchor: anchor as [number, number], rotation: 0,
    placedAt: NOW - 60000, buildEndsAt: NOW - 30000, status: 'ACTIVE' as const,
    investedValue: 375, cashPaid: 300, materialsPaid: { cash: 300, wood: 5, stone: 0 }, accrued: 0, settledAt: NOW,
  }));
  recompute(state); return state;
}
const snapshotCopy = (state: SimState): WorldSnapshot => JSON.parse(JSON.stringify(state.snapshot)) as WorldSnapshot;
function memoryHash(state: SimState): string {
  return JSON.stringify({ snapshot: state.snapshot, heights: [...state.heights], surface: [...state.surface], flags: [...state.flags], roads: [...state.roadTier], occupancy: [...state.occupancy] });
}
function rejectsWithoutMutation(state: SimState, mutate: (snapshot: WorldSnapshot) => void, expected: string): void {
  const before = memoryHash(state), snapshot = snapshotCopy(state);
  mutate(snapshot);
  const result = validateSnapshot(state, snapshot, NOW);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.some(error => error.includes(expected))).toBe(true);
  expect(memoryHash(state)).toBe(before);
  expect(state.snapshot.buildings).toHaveLength(3);
}

describe('validate everything then swap snapshot', () => {
  it('loads a valid 3-building snapshot into a separate state with matching hash', () => {
    const state = playingState(), result = validateSnapshot(state, snapshotCopy(state), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).not.toBe(state); expect(stateHash(result.state)).toBe(stateHash(state));
      expect(result.state.occupancy.size).toBeGreaterThanOrEqual(12);
      result.state.heights[0] = 999;
      expect(state.heights[0]).not.toBe(999);
    }
  });
  it('unknown def at the end preserves the currently playing world', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.defId = 'missing'; }, 'BUILDING_REFERENCE'));
  it('inherited catalog object keys are rejected safely', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.defId = 'constructor'; }, 'BUILDING_REFERENCE'));
  it('duplicate building IDs preserve current world', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.id = s.buildings[0]!.id; }, 'DUPLICATE_ID'));
  it('out-of-bounds footprint preserves current world', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.anchor = [127, 127]; }, 'BOUNDS'));
  it('locked-zone building preserves current world', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.anchor = [10, 10]; }, 'ZONE_LOCKED'));
  it('overlapping buildings preserve current world', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.anchor = [...s.buildings[0]!.anchor]; }, 'OVERLAP'));
  it('building on river is rejected', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.anchor = [61, 60]; }, 'BUILDING_SURFACE'));
  it('building on village road is rejected', () => rejectsWithoutMutation(playingState(), s => { s.buildings[2]!.anchor = [48, 70]; }, 'BUILDING_SURFACE'));
  it.each(['mapId', 'templateVersion', 'seed', 'generatorVersion', 'mapKind'] as const)('rejects template mismatch %s without touching state', key => {
    rejectsWithoutMutation(playingState(), snapshot => {
      if (key === 'mapKind') snapshot[key] = 'farm';
      else if (key === 'mapId' || key === 'generatorVersion') snapshot[key] = 'wrong';
      else snapshot[key]++;
    }, 'TEMPLATE_MISMATCH');
  });
  it('rejects account identity and content version changes', () => {
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.accountId = 'another'; }, 'IDENTITY_MISMATCH');
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.contentVersion++; }, 'CONTENT_VERSION');
  });
  it('rejects removed env ID not in template', () => rejectsWithoutMutation(playingState(), snapshot => { snapshot.delta.removedEnvIds = ['A-9999']; }, 'ENV_REFERENCE'));
  it('rejects negative/fractional money through schema', () => {
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.wallet.cash = -1; }, 'wallet.cash');
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.wallet.cash = 0.5; }, 'wallet.cash');
  });
  it('rejects level that disagrees with XP table', () => rejectsWithoutMutation(playingState(), snapshot => { snapshot.progress.level = 2; }, 'LEVEL_XP'));
  it('rejects creation/settlement time >5 minutes in future', () => {
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.buildings[0]!.placedAt = NOW + 300001; }, 'TIME');
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.buildings[0]!.settledAt = NOW + 300001; }, 'TIME');
  });
  it('allows a valid construction deadline in the future', () => {
    const state = playingState(), snapshot = snapshotCopy(state), building = snapshot.buildings[0]!;
    building.placedAt = NOW; building.buildEndsAt = NOW + catalog.buildings.house_small!.buildSeconds * 1000; building.status = 'CONSTRUCTING';
    expect(validateSnapshot(state, snapshot, NOW).ok).toBe(true);
  });
  it('allows a catalog construction deadline several hours ahead', () => {
    const state = playingState(), snapshot = snapshotCopy(state), building = snapshot.buildings[0]!, def = catalog.buildings.hotel!;
    building.defId = def.id; building.anchor = [72, 60]; building.placedAt = NOW; building.buildEndsAt = NOW + def.buildSeconds * 1000; building.status = 'CONSTRUCTING';
    building.materialsPaid = { ...def.cost }; building.cashPaid = def.cost.cash; building.investedValue = def.cost.cash + def.cost.wood * economy.materialPrices.wood + def.cost.stone * economy.materialPrices.stone;
    snapshot.character.netWorth += building.investedValue - 375;
    snapshot.progress.level = def.unlockLevel; snapshot.progress.xp = economy.xp.cumulative.city[def.unlockLevel]!;
    expect(building.buildEndsAt - NOW).toBeGreaterThan(300000);
    expect(validateSnapshot(state, snapshot, NOW).ok).toBe(true);
  });
  it('rejects a constructor status and builder slot overbooking', () => {
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.buildings[0]!.status = 'CONSTRUCTING'; }, 'CONSTRUCTION_STATUS');
    rejectsWithoutMutation(playingState(), snapshot => {
      for (const building of snapshot.buildings) { building.placedAt = NOW; building.buildEndsAt = NOW + 30000; building.status = 'CONSTRUCTING'; }
    }, 'NO_BUILDER_FREE');
  });
  it('rejects false net worth', () => rejectsWithoutMutation(playingState(), snapshot => { snapshot.character.netWorth++; }, 'NET_WORTH'));
  it.each(['cashPaid', 'investedValue'] as const)('rejects forged building %s', field => rejectsWithoutMutation(playingState(), snapshot => { snapshot.buildings[0]![field]++; }, 'PAID_VALUE'));
  it('rejects incorrect building refund materials', () => rejectsWithoutMutation(playingState(), snapshot => { snapshot.buildings[0]!.materialsPaid.wood++; }, 'PAID_VALUE'));
  it('rejects nonadjacent zones', () => rejectsWithoutMutation(playingState(), snapshot => { snapshot.unlockedZones.push(0); }, 'ZONES:DISCONNECTED'));
  it('detects changed edge against an omitted neighboring delta', () => {
    const state = playingState(); state.heights[60 * 129 + 64] = 55; writeDeltas(state);
    rejectsWithoutMutation(state, snapshot => { delete snapshot.delta.zones[28]; }, 'SHARED_EDGE');
  });
  it('detects changed edge between two explicit deltas', () => {
    const state = playingState(); state.heights[60 * 129 + 64] = 55; writeDeltas(state);
    rejectsWithoutMutation(state, snapshot => {
      const zone = snapshot.delta.zones[28]!, heights = decodeInt16(zone.heightsDm, 289); heights[12 * 17] = 50; zone.heightsDm = encodeInt16(heights);
    }, 'SHARED_EDGE');
  });
  it('rejects corrupt delta lengths', () => {
    const state = playingState(); state.surface[cellIndex(74, 74)] = Surface.DIRT; writeDeltas(state);
    rejectsWithoutMutation(state, snapshot => { snapshot.delta.zones[36]!.surface = 'AA=='; }, 'delta.zones.36.surface');
  });
  it('rejects unknown surface and flag bits in validly encoded arrays', () => {
    const state = playingState(); state.surface[cellIndex(74, 74)] = 255; state.flags[cellIndex(75, 74)] = 128; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'SURFACE_ENUM');
    rejectsWithoutMutation(state, () => undefined, 'FLAG_ENUM');
  });
  it('rejects road tiers inconsistent with surface', () => {
    const state = playingState(); state.roadTier[cellIndex(74, 74)] = 3; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'ROAD_SURFACE');
  });
  it('rejects height outside permitted range', () => {
    const state = playingState(); state.heights[74 * 129 + 74] = state.template.waterLevelDm + 301; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'HEIGHT_RANGE');
  });
  it('rejects terrain changes in locked zones', () => {
    const state = playingState(); state.surface[cellIndex(10, 10)] = Surface.DIRT; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'LOCKED_CELL_CHANGED');
  });
  it('rejects edits to a vertex used by locked land', () => {
    const state = playingState(); state.heights[10 * 129 + 10] = 45; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'LOCKED_VERTEX_CHANGED');
  });
  it('rejects height changes that do not land on a 5dm step', () => {
    const state = playingState(); state.heights[74 * 129 + 74] = 41; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'HEIGHT_STEP');
  });
  it('rejects forged protection/build prohibition flags', () => {
    const state = playingState(); state.flags[cellIndex(74, 74)] = CellFlag.NO_BUILD; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'IMMUTABLE_FLAGS');
  });
  it('rejects embankments away from the water shore', () => {
    const state = playingState(); state.flags[cellIndex(74, 74)] = CellFlag.EMBANKED; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'EMBANK_NOT_SHORE');
  });
  it('rejects a road exceeding cell slope', () => {
    const state = playingState(); state.roadTier[cellIndex(74, 74)] = 1; state.surface[cellIndex(74, 74)] = Surface.ROAD; state.heights[74 * 129 + 74] = 60; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'ROAD_SLOPE');
  });
  it('rejects a low shore even if a neighboring embankment exists', () => {
    const state = playingState(); state.heights[70 * 129 + 60] = state.template.waterLevelDm; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'SHORE_RULE');
  });
  it('rejects changing the immutable water raster in a delta', () => {
    const state = playingState(); state.surface[cellIndex(61, 70)] = Surface.GRASS; writeDeltas(state);
    rejectsWithoutMutation(state, () => undefined, 'WATER_CHANGED');
  });
  it('rejects mismatched level limits and wrong-map buildings', () => {
    rejectsWithoutMutation(playingState(), snapshot => { snapshot.buildings[2]!.defId = 'market'; }, 'WRONG_MAP');
    rejectsWithoutMutation(playingState(), snapshot => {
      for (let i = 0; i < 2; i++) snapshot.buildings.push({ ...snapshot.buildings[0]!, id: `b_extra${i}`, anchor: [72 + i * 3, 60] });
    }, 'LIMIT_REACHED');
  });
  it('reports independent semantic errors together', () => {
    const state = playingState(), snapshot = snapshotCopy(state);
    snapshot.mapId = 'wrong'; snapshot.progress.level = 20; snapshot.delta.removedEnvIds.push('A-9999'); snapshot.buildings[2]!.defId = 'missing';
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) for (const term of ['TEMPLATE_MISMATCH', 'LEVEL_XP', 'ENV_REFERENCE', 'BUILDING_REFERENCE']) expect(result.errors.some(error => error.includes(term))).toBe(true);
  });
  it('hash ignores object key insertion order and changes with wallet', () => {
    const state = playingState(), original = stateHash(state);
    state.snapshot.wallet = { stone: state.snapshot.wallet.stone, wood: state.snapshot.wallet.wood, cash: state.snapshot.wallet.cash };
    expect(stateHash(state)).toBe(original); state.snapshot.wallet.cash++;
    expect(stateHash(state)).not.toBe(original);
  });
  it('farm crop planted on uncultivated soil or unknown item is rejected', () => {
    const state = createState(createTestTemplate(), NOW), snapshot = snapshotCopy(state);
    snapshot.crops.push({ cell: [74, 74], cropId: 'veg_greens', plantedAt: NOW, readyAt: NOW + economy.tutorial.farmGrowSeconds * 1000 });
    snapshot.inventory.unknown = 1;
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.errors.some(error => error.includes('CROP_SURFACE'))).toBe(true); expect(result.errors.some(error => error.includes('ITEM_REFERENCE'))).toBe(true); }
  });
  it('allows historical tutorial greens after tutorial completion; rejects rice with the tutorial duration atomically', () => {
    const state = createState(createTestTemplate(), NOW), def = catalog.buildings.farmhouse!;
    const tutorialCrop = catalog.quests.farm.find(quest => quest.tutorial && quest.action === 'PLANT')!.cropId!;
    expect(tutorialCrop).toBe('veg_greens');
    state.snapshot.buildings.push({ id: 'b_farmhouse', defId: def.id, anchor: [71, 73], rotation: 0,
      placedAt: NOW - def.buildSeconds * 1000, buildEndsAt: NOW, status: 'ACTIVE', cashPaid: def.cost.cash, materialsPaid: { ...def.cost },
      investedValue: def.cost.cash + def.cost.wood * economy.materialPrices.wood + def.cost.stone * economy.materialPrices.stone,
    });
    state.snapshot.progress.tutorialDone = true; state.snapshot.progress.questIndex = economy.construction.tutorialInstantThroughQuest;
    state.surface[cellIndex(74, 74)] = Surface.TILLED;
    state.snapshot.crops.push({ cell: [74, 74], cropId: tutorialCrop, plantedAt: NOW - economy.tutorial.farmGrowSeconds * 1000, readyAt: NOW });
    writeDeltas(state); recompute(state);
    const before = memoryHash(state), originalHash = stateHash(state);
    expect(validateSnapshot(state, snapshotCopy(state), NOW).ok).toBe(true);
    const forged = snapshotCopy(state); forged.crops[0]!.cropId = 'rice';
    const result = validateSnapshot(state, forged, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(error => error.includes('CROP_DURATION'))).toBe(true);
    expect(stateHash(state)).toBe(originalHash); expect(memoryHash(state)).toBe(before);
  });
  it('rejects inventory beyond all physical storage support', () => {
    const state = createState(createTestTemplate(), NOW), snapshot = snapshotCopy(state);
    snapshot.inventory.veg_greens = economy.farm.baseStorage + 1;
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('STORAGE_CAPACITY');
  });
  it('rejects tilled fields without any physical farmhouse support', () => {
    const state = createState(createTestTemplate(), NOW); state.surface[cellIndex(74, 74)] = Surface.TILLED; writeDeltas(state);
    const result = validateSnapshot(state, snapshotCopy(state), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('FIELD_QUOTA');
  });
  it('rejects bridge with dry span and invalid endpoints', () => {
    const state = playingState(), snapshot = snapshotCopy(state);
    snapshot.bridges.push({ id: 'br_bad', typeId: 'bridge_wood', a: [72, 72], b: [76, 72], deckHeightDm: 40,
      placedAt: NOW - 180000, buildEndsAt: NOW, status: 'ACTIVE', cashPaid: 240, materialsPaid: { cash: 240, wood: 15, stone: 0 }, investedValue: 465 });
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(error => error.includes('BRIDGE_RULE'))).toBe(true);
  });
  it('allows future production batches scheduled behind a running batch; rejects gaps and forged recipes', () => {
    const state = createState(createTestTemplate(), NOW), def = catalog.buildings.chicken_coop!, recipe = catalog.recipes.chicken_coop!;
    state.snapshot.progress.level = def.unlockLevel; state.snapshot.progress.xp = economy.xp.cumulative.farm[def.unlockLevel]!;
    state.snapshot.buildings.push({ id: 'b_coop', defId: def.id, anchor: [74, 60], rotation: 0,
      placedAt: NOW - def.buildSeconds * 1000, buildEndsAt: NOW, status: 'ACTIVE', cashPaid: def.cost.cash, materialsPaid: { ...def.cost },
      investedValue: def.cost.cash + def.cost.wood * economy.materialPrices.wood + def.cost.stone * economy.materialPrices.stone,
      slots: Array.from({ length: def.production!.slots }, (_, index) => index ? [] : [
        { recipeId: recipe.id, startedAt: NOW, readyAt: NOW + recipe.seconds * 1000 },
        { recipeId: recipe.id, startedAt: NOW + recipe.seconds * 1000, readyAt: NOW + recipe.seconds * 2000 },
      ]),
    });
    recompute(state);
    expect(validateSnapshot(state, snapshotCopy(state), NOW).ok).toBe(true);
    const gap = snapshotCopy(state); gap.buildings[0]!.slots![0]![1]!.startedAt++;
    const gapResult = validateSnapshot(state, gap, NOW);
    expect(gapResult.ok).toBe(false); if (!gapResult.ok) expect(gapResult.errors.some(error => error.includes('QUEUE_ORDER'))).toBe(true);
    const forged = snapshotCopy(state); forged.buildings[0]!.slots![0]![0]!.recipeId = 'constructor';
    const forgedResult = validateSnapshot(state, forged, NOW);
    expect(forgedResult.ok).toBe(false); if (!forgedResult.ok) expect(forgedResult.errors.some(error => error.includes('RECIPE_REFERENCE'))).toBe(true);
  });
  it('preserves ENTRY flags', () => {
    const state = playingState(); state.flags[cellIndex(48, 70)] = state.flags[cellIndex(48, 70)]! & ~CellFlag.ENTRY; writeDeltas(state);
    const current = playingState();
    const result = validateSnapshot(current, snapshotCopy(state), NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(error => error.includes('ENTRY_REMOVED'))).toBe(true);
  });
});

describe('content migration v1 → v2 (D025)', () => {
  it('a v1 Farm world (old thresholds) loads: XP kept, level recomputed upwards, migrated to the current version', () => {
    const state = createState(createTestTemplate('farm'), NOW), snapshot = snapshotCopy(state);
    // Level 8 under the v1 Farm table (5 700 XP); the v2 table puts 5 700 XP at level 9 (5 320 ≤ xp < 8 270).
    snapshot.contentVersion = 1; snapshot.progress.xp = 5700; snapshot.progress.level = 8;
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok ? 'ok' : result.errors).toBe('ok');
    if (result.ok) {
      expect(result.state.snapshot.contentVersion).toBe(economy.contentVersion);
      expect(result.state.snapshot.progress).toMatchObject({ xp: 5700, level: 9 });
    }
    expect(state.snapshot.contentVersion).toBe(economy.contentVersion);
  });
  it('a v1 City world keeps its level (City table unchanged)', () => {
    const state = playingState(), snapshot = snapshotCopy(state);
    snapshot.contentVersion = 1; snapshot.progress.xp = economy.xp.cumulative.city[6]!; snapshot.progress.level = 6;
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok && result.state.snapshot.progress.level).toBe(6);
  });
  it('a v2 world (before D028) loads unchanged as the current version', () => {
    const state = playingState(), snapshot = snapshotCopy(state);
    snapshot.contentVersion = 2;
    const result = validateSnapshot(state, snapshot, NOW);
    expect(result.ok ? result.state.snapshot.contentVersion : result.errors).toBe(economy.contentVersion);
    if (result.ok) expect(stateHash(result.state)).toBe(stateHash(state));
  });
  it('unknown future versions are still rejected', () => {
    const state = playingState();
    rejectsWithoutMutation(state, snapshot => { snapshot.contentVersion = economy.contentVersion + 1; }, 'CONTENT_VERSION');
  });
});
