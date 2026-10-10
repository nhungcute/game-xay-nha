import { writeFile } from 'node:fs/promises';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { advanceTime, costValue, createState, execute, netWorth, type SimState } from '@xay-nha/sim';
import type { CommandPayload, CommandType } from '@xay-nha/contracts';

// Controlled rule fixtures; these are not player pacing simulations.
const now = 10_000_000_000;
let serial = 0;
function command<T extends CommandType>(state: SimState, type: T, payload: CommandPayload[T], at = now) {
  return execute(state, { type, payload, worldId: state.snapshot.worldId,
    expectedRevision: state.snapshot.revision, clientTime: at,
    commandId: `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}` }, at);
}
function accepted<T extends CommandType>(state: SimState, type: T, payload: CommandPayload[T], at = now): SimState {
  const result = command(state, type, payload, at);
  if (!result.result.accepted) throw new Error(`${type}: ${result.result.code}`);
  return result.state;
}
function fixture() {
  const template = createTestTemplate('farm');
  template.env = { catalogVersion: 1, anchors: [], scatter: [] };
  const state = createState(template, now);
  state.snapshot.wallet = { cash: 1_000_000, wood: 1000, stone: 1000 };
  // Keep authored progression before repeats to isolate transaction reversals.
  state.snapshot.progress = { xp: economy.xp.cumulative.farm[20]!, level: 20,
    questIndex: 6, questProgress: {}, tutorialDone: true };
  return state;
}

const payback = Object.values(catalog.buildings).flatMap(def => {
  if (def.baseRatePerHour) {
    const maxMultiplier = Math.max(...Object.values(economy.roadTiers).map(tier => tier.multiplier))
      * (1 + economy.income.decorCap + (def.waterBonusOverride ?? economy.income.waterBonus));
    return [{ id: def.id, unlockLevel: def.unlockLevel, baseHours: costValue(def.cost) / def.baseRatePerHour,
      bestCaseHours: costValue(def.cost) / (def.baseRatePerHour * maxMultiplier),
      assumption: 'Full workforce, highest road tier, maximum decor and water bonus; excludes shared infrastructure cost.' }];
  }
  if (!def.production) return [];
  const profit = Math.max(...def.production.recipes.map(id => {
    const recipe = catalog.recipes[id]!;
    const inputs = Object.entries(recipe.inputs).reduce((sum, [item, count]) => sum + catalog.items[item]!.sellPrice * count, 0);
    return (catalog.items[recipe.output]!.sellPrice - inputs) / (recipe.seconds / 3600) * def.production!.slots;
  }));
  return [{ id: def.id, unlockLevel: def.unlockLevel, baseHours: costValue(def.cost) / profit,
    bestCaseHours: costValue(def.cost) / profit,
    assumption: 'Full producer capacity; grown inputs valued at sale price; excludes supporting buildings.' }];
});

const reversals = [];
for (const cancel of [true, false]) {
  let state = fixture();
  const startWorth = netWorth(state), startXp = state.snapshot.progress.xp;
  const cycles = 10;
  for (let index = 0; index < cycles; index++) {
    const at = now + index * 120_000;
    state = accepted(state, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [71, 76], rotation: 0 }, at);
    const building = state.snapshot.buildings.at(-1)!;
    if (cancel) state = accepted(state, 'CANCEL_CONSTRUCTION', { buildingId: building.id }, at);
    else {
      advanceTime(state, building.buildEndsAt);
      state = accepted(state, 'DEMOLISH', { buildingId: building.id }, building.buildEndsAt);
    }
  }
  reversals.push({ cycle: cancel ? 'build-cancel' : 'build-demolish', cycles,
    worthDelta: netWorth(state) - startWorth, xpDelta: state.snapshot.progress.xp - startXp,
    status: netWorth(state) <= startWorth && (!cancel || state.snapshot.progress.xp === startXp) ? 'PASS' : 'FAIL' });
}
let state = fixture();
state = accepted(state, 'BUILD_ROAD', { tier: 1, cells: [[70, 78]] });
state = accepted(state, 'PLACE_BUILDING', { defId: 'market', anchor: [71, 76], rotation: 0 });
const marketReadyAt = state.snapshot.buildings.at(-1)!.buildEndsAt;
advanceTime(state, marketReadyAt);
const startWorth = netWorth(state), startXp = state.snapshot.progress.xp;
state = accepted(state, 'BUY_MATERIAL', { wood: 3, stone: 2 }, marketReadyAt);
const sale = command(state, 'SELL', { items: { wood: 3, stone: 2 } }, marketReadyAt);
reversals.push({ cycle: 'buy-sell-material', worthDelta: netWorth(state) - startWorth,
  xpDelta: state.snapshot.progress.xp - startXp, saleCode: sale.result.accepted ? 'ACCEPTED' : sale.result.code,
  status: !sale.result.accepted && netWorth(state) === startWorth ? 'PASS' : 'FAIL' });
state = createState(createTestTemplate('farm'), now);
state = accepted(state, 'CLEAR_ENV', { envIds: ['A-0'] });
const worthAfterClear = netWorth(state), duplicateClear = command(state, 'CLEAR_ENV', { envIds: ['A-0'] });
reversals.push({ cycle: 'clear-same-environment-twice', secondCode: duplicateClear.result.accepted ? 'ACCEPTED' : duplicateClear.result.code,
  worthDeltaOnRetry: netWorth(duplicateClear.state) - worthAfterClear,
  status: !duplicateClear.result.accepted && netWorth(duplicateClear.state) === worthAfterClear ? 'PASS' : 'FAIL' });

const report = { contentVersion: economy.contentVersion, payback, reversals,
  newBuildingsAfterLevel5: payback.filter(row => row.unlockLevel > 5 && row.bestCaseHours < 1),
  anyAvailableBuildingAfterLevel5: payback.filter(row => row.bestCaseHours < 1),
  limitations: ['Finite reversal regression checks do not prove absence of every exploit.',
    'Repeat quest rewards are excluded from reversal fixtures; quest-combined adversarial loops have not been exhaustively tested.',
    'Best-case payback is an upper rate bound, not a measured player layout.'] };
await writeFile('docs/reports/G3-economy-audit.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (reversals.some(row => row.status === 'FAIL')) process.exitCode = 1;
