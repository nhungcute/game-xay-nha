import { describe, expect, it } from 'vitest';
import { CellFlag, Surface, cellIndex, type CommandType, type MapKind } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { apply, execute, previewCost, SimSession, validate } from './engine';
import { createState, type SimState } from './state';
import { stateHash } from './snapshot';
import { recompute } from './economy';

const NOW = 1000000;
let sequence = 0;
function command(state: SimState, type: CommandType, payload: unknown) {
  return { commandId: `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`,
    worldId: state.snapshot.worldId, expectedRevision: state.snapshot.revision, clientTime: NOW, type, payload };
}
function initial(kind: MapKind = 'farm'): SimState {
  const state = createState(createTestTemplate(kind), NOW); recompute(state); return state;
}
function accepted(state: SimState, type: CommandType, payload: unknown, now = NOW): SimState {
  const result = execute(state, command(state, type, payload), now);
  expect(result.result.accepted, JSON.stringify(result.result)).toBe(true);
  return result.state;
}
function rejected(state: SimState, type: CommandType, payload: unknown, code: string, now = NOW): void {
  const before = stateHash(state), execution = execute(state, command(state, type, payload), now);
  expect(execution.result.accepted).toBe(false);
  if (!execution.result.accepted) expect(execution.result.code).toBe(code);
  expect(execution.state).toBe(state); expect(stateHash(state)).toBe(before);
}

describe('atomic command engine and previews', () => {
  it('a valid maximum-length world ID does not overflow generated entity IDs',()=>{
    const state=initial();state.snapshot.worldId='w'.repeat(128);
    const execution=execute(state,command(state,'PLACE_BUILDING',{defId:'market',anchor:[71,77],rotation:0}),NOW);
    expect(execution.result).toMatchObject({accepted:true});
    expect(execution.state.snapshot.buildings[0]!.id.length).toBeLessThanOrEqual(128);
  });
  it('patch includes character valuation and land ownership needed to reproduce an unlock',()=>{
    const state=initial();state.snapshot.progress.xp=economy.xp.cumulative.farm[2]!;state.snapshot.progress.level=2;
    const execution=execute(state,command(state,'UNLOCK_ZONE',{zoneId:26}),NOW);
    expect(execution.result.accepted).toBe(true);
    if(execution.result.accepted) {
      expect(execution.result.patch.unlockedZones).toEqual(execution.state.snapshot.unlockedZones);
      expect(execution.result.patch.landValue).toBe(execution.state.snapshot.landValue);
      expect(execution.result.patch.character).toEqual(execution.state.snapshot.character);
    }
  });
  it('validate and preview cost match accepted apply without modifying input', () => {
    const state = initial(), input = command(state, 'CLEAR_ENV', { envIds: ['A-0', 'A-1'] }), before = stateHash(state);
    const validation = validate(state, input, NOW), preview = previewCost(state, input, NOW), application = apply(state, input, NOW);
    expect(validation.valid).toBe(true); expect(preview).toEqual(validation);
    if (validation.valid) { expect(application.cost).toEqual(validation.cost); expect(application.dirtyZones).toEqual(validation.dirtyZones); }
    expect(stateHash(state)).toBe(before); expect(application.state).not.toBe(state);
    expect(application.state.snapshot.revision).toBe(state.snapshot.revision + 1);
  });
  it('failure after one valid clear target never clears or charges anything', () => rejected(initial(), 'CLEAR_ENV', { envIds: ['A-0', 'unknown'] }, 'NOT_FOUND'));
  it('failure after one valid road cell never writes any road delta', () => rejected(initial(), 'BUILD_ROAD', { tier: 1, cells: [[59, 60], [60, 60]] }, 'CELL_BLOCKED'));
  it('insufficient funds rejects all cells atomically', () => {
    const state = initial(); state.snapshot.wallet.cash = 0;
    rejected(state, 'CLEAR_ENV', { envIds: ['A-0', 'A-1'] }, 'INSUFFICIENT_FUNDS');
  });
  it('stale expected revision rejects command before any time settlement', () => {
    const state = initial(), input = command(state, 'BUY_MATERIAL', { wood: 1 }); input.expectedRevision++;
    const result = execute(state, input, NOW + 100000);
    expect(result.result.accepted).toBe(false);
    if (!result.result.accepted) expect(result.result.code).toBe('REVISION_CONFLICT');
    expect(result.state).toBe(state); expect(state.snapshot.serverTime).toBe(NOW);
  });
  it('world identity mismatch cannot affect another character', () => {
    const state = initial(), input = command(state, 'BUY_MATERIAL', { wood: 1 }); input.worldId = 'other-world';
    expect(execute(state, input, NOW).state).toBe(state);
    expect(execute(state, input, NOW).result.accepted).toBe(false);
  });
  it('invalid command envelope is rejected without mutation', () => {
    const state = initial(), before = stateHash(state);
    for (const input of [null, {}, { ...command(state, 'BUY_MATERIAL', { wood: 1 }), commandId: 'not-uuid' }, { ...command(state, 'BUY_MATERIAL', { wood: 1 }), extra: true }]) expect(execute(state, input, NOW).result.accepted).toBe(false);
    expect(stateHash(state)).toBe(before);
  });
  it('client time cannot move authoritative command time', () => {
    const state = initial(), input = command(state, 'BUY_MATERIAL', { wood: 1 }); input.clientTime = NOW + 900000000;
    const result = execute(state, input, NOW);
    expect(result.result.accepted).toBe(true); expect(result.state.snapshot.serverTime).toBe(NOW);
  });
  it('past authoritative time is rejected', () => rejected(initial(), 'BUY_MATERIAL', { wood: 1 }, 'INVALID_TIME', NOW - 1));
  it.each([{ wood: -1 }, { stone: 1.5 }, {}, { wood: 0 }, { wood: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed material quantities %j', payload => rejected(initial(), 'BUY_MATERIAL', payload, 'INVALID_COMMAND'));
});

describe('idempotent offline session ledger', () => {
  it('same command ID applies only once even with stale revision and later time', () => {
    const session = new SimSession(initial()), input = command(session.state, 'BUY_MATERIAL', { wood: 1 });
    const first = session.execute(input, NOW), after = stateHash(session.state), second = session.execute(input, NOW + 600000);
    expect(second).toEqual(first); expect(stateHash(session.state)).toBe(after); expect(session.state.snapshot.revision).toBe(1);
  });
  it('caches rejected commands and does not reapply after replenishing wallet', () => {
    const state = initial(); state.snapshot.wallet.cash = 0;
    const session = new SimSession(state), input = command(state, 'BUY_MATERIAL', { wood: 1 }), first = session.execute(input, NOW);
    expect(first.accepted).toBe(false); session.state.snapshot.wallet.cash = 100;
    expect(session.execute(input, NOW)).toEqual(first); expect(session.state.snapshot.wallet.cash).toBe(100);
  });
  it('returns cached value copies so callers cannot change idempotency results', () => {
    const session = new SimSession(initial()), input = command(session.state, 'BUY_MATERIAL', { wood: 1 }), first = session.execute(input, NOW);
    if (first.accepted && first.patch.wallet) first.patch.wallet.cash = 999999;
    expect(session.state.snapshot.wallet.cash).toBe(economy.start.cash - economy.materialPrices.wood);
    const second = session.execute(input, NOW);
    if (second.accepted) expect(second.patch.wallet?.cash).toBe(economy.start.cash - economy.materialPrices.wood);
  });
});

describe('clear, materials and land purchase economy', () => {
  it.each([['A-0', 'tree'], ['A-3', 'rock'], ['A-4', 'rock_large']] as const)('clear %s uses content costs and resource rewards', (id, category) => {
    const state = initial(), next = accepted(state, 'CLEAR_ENV', { envIds: [id] }), def = economy.clear[category];
    for (const resource of ['cash', 'wood', 'stone'] as const) expect(next.snapshot.wallet[resource]).toBe(state.snapshot.wallet[resource] - def.cost[resource] + def.reward[resource]);
    expect(next.snapshot.delta.removedEnvIds).toContain(id);
    expect([...next.occupancy.values()].includes(id)).toBe(false);
    rejected(next, 'CLEAR_ENV', { envIds: [id] }, 'NOT_FOUND');
  });
  it('multiple clear costs are totaled before applying finite resource rewards', () => {
    const state = initial(), next = accepted(state, 'CLEAR_ENV', { envIds: ['A-0', 'A-3'] });
    expect(next.snapshot.wallet.cash).toBe(state.snapshot.wallet.cash - economy.clear.tree.cost.cash - economy.clear.rock.cost.cash);
    expect(next.snapshot.wallet.wood).toBe(state.snapshot.wallet.wood + economy.clear.tree.reward.wood);
    expect(next.snapshot.wallet.stone).toBe(state.snapshot.wallet.stone + economy.clear.rock.reward.stone);
  });
  it('buy materials costs exactly catalog dollar rates and does not award spend XP', () => {
    const state = initial(), next = accepted(state, 'BUY_MATERIAL', { wood: 3, stone: 2 });
    expect(next.snapshot.wallet).toEqual({ cash: state.snapshot.wallet.cash - 3 * economy.materialPrices.wood - 2 * economy.materialPrices.stone, wood: state.snapshot.wallet.wood + 3, stone: state.snapshot.wallet.stone + 2 });
    expect(next.snapshot.progress.xp).toBe(state.snapshot.progress.xp);
  });
  it('material resource integer overflow is rejected atomically', () => {
    const state = initial(); state.snapshot.wallet.wood = Number.MAX_SAFE_INTEGER;
    rejected(state, 'BUY_MATERIAL', { wood: 1 }, 'INVALID_COMMAND');
  });
  it('safe quantities whose multiplied material cash overflows are rejected', () => rejected(initial(), 'BUY_MATERIAL', { wood: Number.MAX_SAFE_INTEGER }, 'INVALID_COMMAND'));
  it('unlock requires level and a neighboring zone', () => {
    const state = initial(); rejected(state, 'UNLOCK_ZONE', { zoneId: 29 }, 'LEVEL_REQUIRED');
    state.snapshot.progress.xp = economy.xp.cumulative.farm[2]!; state.snapshot.progress.level = 2;
    rejected(state, 'UNLOCK_ZONE', { zoneId: 0 }, 'ZONE_LOCKED');
    rejected(state, 'UNLOCK_ZONE', { zoneId: 27 }, 'ZONE_LOCKED');
  });
  it('successive unlocks use quadratic price, advance land value and retain sorted zone list', () => {
    let state = initial(); state.snapshot.progress.xp = economy.xp.cumulative.farm[2]!; state.snapshot.progress.level = 2; state.snapshot.wallet.cash = 10000;
    const firstCash = state.snapshot.wallet.cash;
    state = accepted(state, 'UNLOCK_ZONE', { zoneId: 29 });
    expect(state.snapshot.wallet.cash).toBe(firstCash - economy.zones.costBase);
    const secondCost = economy.zones.costBase + economy.zones.costLinear + economy.zones.costQuadratic;
    state = accepted(state, 'UNLOCK_ZONE', { zoneId: 30 });
    expect(state.snapshot.landValue).toBe(economy.zones.costBase + secondCost);
    expect(state.snapshot.unlockedZones).toEqual([...state.snapshot.unlockedZones].sort((a, b) => a - b));
  });
  it('majority water zone receives exactly the specified land discount', () => {
    const state = initial(); state.snapshot.progress.xp = economy.xp.cumulative.farm[2]!; state.snapshot.progress.level = 2;
    for (let z = 48; z < 64; z++) for (let x = 32; x < 48; x++) state.surface[cellIndex(x, z)] = Surface.WATER;
    const next = accepted(state, 'UNLOCK_ZONE', { zoneId: 26 });
    expect(next.snapshot.landValue).toBe(Math.floor(economy.zones.costBase * economy.zones.waterPriceMultiplier));
  });
  it('buying external village path releases natural road protection', () => {
    const state = initial(); state.snapshot.progress.xp = economy.xp.cumulative.farm[2]!; state.snapshot.progress.level = 2;
    expect(state.flags[cellIndex(70, 80)]! & CellFlag.PROTECTED).toBeTruthy();
    const next = accepted(state, 'UNLOCK_ZONE', { zoneId: 44 });
    expect(next.flags[cellIndex(70, 80)]! & CellFlag.PROTECTED).toBe(0);
    expect(next.roadTier[cellIndex(70, 80)]).toBe(1);
  });
});

describe('quests and tutorial completion', () => {
  it.each(['constructor','__proto__','toString'])('rejects inherited building catalog key %s atomically',defId=>{
    rejected(initial(),'PLACE_BUILDING',{defId,anchor:[74,60],rotation:0},'NOT_FOUND');
  });
  it('not-ready quest and a different quest ID cannot be claimed', () => {
    rejected(initial('city'), 'CLAIM_QUEST', { questId: 'city-1' }, 'QUEST_NOT_READY');
    rejected(initial('city'), 'CLAIM_QUEST', { questId: 'city-2' }, 'NOT_FOUND');
  });
  it('claim grants exactly content rewards once, XP and an event', () => {
    let state = initial('city'); state = accepted(state, 'CLEAR_ENV', { envIds: ['A-0', 'A-1', 'A-2'] });
    const quest = catalog.quests.city[0]!, beforeCash = state.snapshot.wallet.cash, beforeXp = state.snapshot.progress.xp;
    const execution = execute(state, command(state, 'CLAIM_QUEST', { questId: quest.id }), NOW);
    expect(execution.result.accepted).toBe(true);
    expect(execution.state.snapshot.wallet.cash).toBe(beforeCash + quest.reward.cash);
    expect(execution.state.snapshot.progress.xp).toBe(beforeXp + quest.xp);
    if (execution.result.accepted) expect(execution.result.events).toContainEqual({ type: 'QUEST_COMPLETED', questId: quest.id });
    rejected(execution.state, 'CLAIM_QUEST', { questId: quest.id }, 'NOT_FOUND');
  });
  it('disconnected market does not satisfy the initial farm quest', () => {
    const state = accepted(initial(), 'PLACE_BUILDING', { defId: 'market', anchor: [74, 60], rotation: 0 });
    expect(state.snapshot.buildings[0]!.status).toBe('ACTIVE');
    rejected(state, 'CLAIM_QUEST', { questId: 'farm-1' }, 'QUEST_NOT_READY');
  });
  it('Farm tutorial completes through real commands in under six minutes at level >=2', () => {
    let state = initial();
    state = accepted(state, 'PLACE_BUILDING', { defId: 'market', anchor: [71, 77], rotation: 0 });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'farm-1' });
    state = accepted(state, 'BUILD_ROAD', { tier: 1, cells: Array.from({ length: 7 }, (_, n) => [70, 79 - n]) });
    state = accepted(state, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [71, 73], rotation: 0 });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'farm-2' });
    state = accepted(state, 'TILL', { rect: [74, 73, 79, 73] });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'farm-3' });
    state = accepted(state, 'PLANT', { rect: [74, 73, 79, 73], cropId: 'veg_greens' });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'farm-4' });
    const ready = Math.max(...state.snapshot.crops.map(crop => crop.readyAt));
    state = accepted(state, 'HARVEST', { cells: Array.from({ length: 6 }, (_, n) => [74 + n, 73]) }, ready);
    state = accepted(state, 'CLAIM_QUEST', { questId: 'farm-5' }, ready);
    state = accepted(state, 'SELL', { items: { veg_greens: 12 } }, ready);
    state = accepted(state, 'CLAIM_QUEST', { questId: 'farm-6' }, ready);
    expect(state.snapshot.progress.tutorialDone).toBe(true); expect(state.snapshot.progress.questIndex).toBe(6);
    expect(state.snapshot.progress.level).toBeGreaterThanOrEqual(2); expect(ready - NOW).toBeLessThanOrEqual(360000);
  });
  it('City tutorial completes through real commands in under six minutes at level >=2', () => {
    let state = initial('city');
    state = accepted(state, 'CLEAR_ENV', { envIds: ['A-0', 'A-1', 'A-2'] });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'city-1' });
    state = accepted(state, 'BUILD_ROAD', { tier: 1, cells: Array.from({ length: 6 }, (_, n) => [48, 70 - n]) });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'city-2' });
    state = accepted(state, 'TERRAFORM', { rect: [50, 65, 51, 66], mode: 'FLATTEN' });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'city-3' });
    state = accepted(state, 'PLACE_BUILDING', { defId: 'house_small', anchor: [49, 67], rotation: 0 });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'city-4' });
    state = accepted(state, 'PLACE_BUILDING', { defId: 'shop_grocery', anchor: [49, 64], rotation: 0 });
    state = accepted(state, 'CLAIM_QUEST', { questId: 'city-5' });
    state = accepted(state, 'COLLECT', { buildingIds: state.snapshot.buildings.map(building => building.id) }, NOW + 1000);
    state = accepted(state, 'CLAIM_QUEST', { questId: 'city-6' }, NOW + 1000);
    expect(state.snapshot.progress.tutorialDone).toBe(true); expect(state.snapshot.progress.questIndex).toBe(6);
    expect(state.snapshot.progress.level).toBeGreaterThanOrEqual(2);
  });
});
