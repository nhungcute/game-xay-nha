import { writeFile } from 'node:fs/promises';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { advanceTime, costValue, createState, execute, validateSnapshot } from '@xay-nha/sim';
import type { CommandPayload, CommandType } from '@xay-nha/contracts';

// Funded L8 rule fixture: legal commands and snapshot validation, not a human/authored-map playtest.
const start = 10_000_000_000, template = createTestTemplate('city');
template.env = { catalogVersion: 1, anchors: [], scatter: [] };
let state = createState(template, start), at = start, serial = 0;
state.snapshot.wallet = { cash: 1_000_000, wood: 1000, stone: 1000 };
state.snapshot.progress = { xp: economy.xp.cumulative.city[8]!, level: 8,
  questIndex: catalog.quests.city.length, questProgress: {}, tutorialDone: true };
function apply<T extends CommandType>(type: T, payload: CommandPayload[T]): void {
  const result = execute(state, { type, payload, worldId: state.snapshot.worldId,
    expectedRevision: state.snapshot.revision, clientTime: at,
    commandId: `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}` }, at);
  if (!result.result.accepted) throw new Error(`${type}: ${result.result.code}`);
  state = result.state;
}
apply('EMBANK', { cells: [[59, 70]] });
apply('TERRAFORM', { rect: [59, 70, 59, 70], mode: 'FLATTEN', targetHDm: 40 });
apply('BUILD_ROAD', { tier: 3, cells: Array.from({ length: 11 }, (_, i) => [49 + i, 70]) });
apply('BUILD_ROAD', { tier: 3, cells: Array.from({ length: 7 }, (_, i) => [49, 71 + i]) });
apply('PLACE_BUILDING', { defId: 'house_small', anchor: [50, 68], rotation: 0 });
apply('PLACE_BUILDING', { defId: 'shop_grocery', anchor: [56, 68], rotation: 0 });
apply('PLACE_BUILDING', { defId: 'deco_park', anchor: [50, 71], rotation: 0 });
at += catalog.buildings.deco_park!.buildSeconds * 1000; advanceTime(state, at);
apply('PLACE_BUILDING', { defId: 'deco_park', anchor: [54, 71], rotation: 0 });
apply('PLACE_BUILDING', { defId: 'deco_park', anchor: [50, 75], rotation: 0 });
at += catalog.buildings.deco_park!.buildSeconds * 1000; advanceTime(state, at);
const valid = validateSnapshot(state, state.snapshot, at);
if (!valid.ok) throw new Error(valid.errors.join(', '));
const grocery = state.snapshot.buildings.find(building => building.defId === 'shop_grocery')!;
const rate = state.rates[grocery.id]!, value = costValue(grocery.materialsPaid);
const report = { contentVersion: economy.contentVersion, level: state.snapshot.progress.level,
  commands: serial, snapshotValid: true, building: grocery.defId, investedValue: value,
  actualRatePerHour: rate, paybackHours: value / rate, belowOneHour: value / rate < 1,
  layout: state.snapshot.buildings.map(building => ({ defId: building.defId, anchor: building.anchor })),
  scope: 'Controlled City rule fixture at L8; supporting roads/decor/embankment costs excluded from single-building payback.' };
await writeFile('docs/reports/G3-payback-fixture.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
