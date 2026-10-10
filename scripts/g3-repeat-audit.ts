/** Independent Q005 audit. Fixture level/resources/history are synthetic; transitions use execute(). */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { type CommandType, type MapKind, type RepeatQuest, type WorldSnapshot } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { cloneState, createState, ensureRepeatQuests, execute, fieldQuota, recompute, referenceIncome, SimSession, stateHash, validateSnapshot, type SimState } from '@xay-nha/sim';

const NOW = 10_000_000_000, HOUR = 3_600_000;
const directory = 'docs/evidence/g3/repeat-audit';
type Check = { name: string; pass: boolean; actual: unknown; expected: string; scope: string };
const checks: Check[] = [], commands: unknown[] = [];
let serial = 0;
function check(name: string, pass: boolean, actual: unknown, expected: string, scope = 'Q005'): void {
  checks.push({ name, pass, actual, expected, scope });
}
function fixture(kind: MapKind, level = 8, id = `audit-${kind}`): SimState {
  const s = createState(createTestTemplate(kind), NOW, undefined, { worldId: id, accountId: 'audit', displayName: 'Kiểm tra', tag: '0001' });
  s.snapshot.progress = { xp: economy.xp.cumulative[kind][level]!, level, questIndex: 12, questProgress: {}, tutorialDone: true };
  s.snapshot.wallet = { cash: 1_000_000, wood: 1_000, stone: 1_000 };
  recompute(s);
  return s;
}
function command(s: SimState, type: CommandType, payload: unknown, now = s.snapshot.serverTime) {
  return { commandId: `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, type, payload,
    worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, clientTime: now };
}
function run(s: SimState, type: CommandType, payload: unknown, now = s.snapshot.serverTime): SimState {
  const input = command(s, type, payload, now), execution = execute(s, input, now);
  commands.push({ input, accepted: execution.result.accepted, result: execution.result, beforeHash: stateHash(s), afterHash: stateHash(execution.state) });
  if (!execution.result.accepted) throw new Error(`${type}: ${execution.result.code}`);
  return execution.state;
}
function independentIncome(s: SimState): number {
  if (s.template.mapKind === 'city') return Object.values(s.rates).reduce((a, b) => a + b, 0);
  const best = Math.max(0, ...Object.values(catalog.crops).filter(c => c.unlockLevel <= s.snapshot.progress.level)
    .map(c => (catalog.items[c.itemId]!.sellPrice * c.yield - c.seedCost) * 3600 / c.growSeconds));
  return fieldQuota(s) * best * 0.5;
}
function rewardChecks(s: SimState, label: string): void {
  const income = independentIncome(s), cash = Math.max(100, Math.round(income * 0.25 / 10) * 10), xp = Math.round(2 * Math.sqrt(cash));
  check(`${label}: income reference`, Math.abs(referenceIncome(s) - income) < 1e-8, { actual: referenceIncome(s), income }, 'Independent approved City/Farm formula');
  check(`${label}: generated reward and XP`, (s.snapshot.progress.repeat?.active ?? []).every(q => q.reward.cash === cash && q.reward.wood === 0 && q.reward.stone === 0 && q.xp === xp),
    { income, cash, xp, quests: s.snapshot.progress.repeat?.active }, '25% reference, round $10, minimum $100; round(2*sqrt(cash))');
}
function mutate(s: SimState, name: string, change: (snapshot: WorldSnapshot) => void): void {
  const before = stateHash(s), snapshot = structuredClone(s.snapshot);
  change(snapshot);
  const result = validateSnapshot(s, snapshot, s.snapshot.serverTime);
  check(`snapshot rejects ${name}`, !result.ok, result.ok ? { accepted: true, repeat: result.state.snapshot.progress.repeat } : result.errors,
    'Reject malformed/semantically invalid repeat state before publishing', 'Snapshot integrity');
  check(`snapshot preserves current state: ${name}`, before === stateHash(s), { before, after: stateHash(s) }, 'No mutation of current state', 'Snapshot integrity');
}

await mkdir(directory, { recursive: true });
const sourcePaths = ['packages/sim/src/quests.ts', 'packages/sim/src/snapshot.ts', 'packages/sim/src/common.ts', 'packages/sim/src/engine.ts',
  'packages/contracts/src/schema.ts', 'packages/content/economy.v1.json', 'docs/16_ECONOMY_AND_BALANCE.md', 'docs/DECISIONS.md'];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));

// Completing authored quest 12 is a command; only prior quest history is fixture setup.
let city = fixture('city');
city.snapshot.progress.questIndex = 11;
city.snapshot.progress.questProgress['city-12'] = catalog.quests.city[11]!.target;
ensureRepeatQuests(city);
check('no repeats before quest 12 is claimed', city.snapshot.progress.repeat === undefined, city.snapshot.progress.repeat ?? null, 'Repeat state absent');
city = run(city, 'CLAIM_QUEST', { questId: 'city-12' });
check('quest 12 claim creates exactly 3 active City repeats', city.snapshot.progress.repeat?.active.length === 3, city.snapshot.progress.repeat, 'Exactly 3 active quests');
rewardChecks(city, 'City without income');

// Build supported Farm through actual commands on the fixture map (rich level-8 setup).
let farm = fixture('farm');
farm = run(farm, 'BUILD_ROAD', { tier: 1, cells: Array.from({ length: 9 }, (_, i) => [70, 78 - i]) });
farm = run(farm, 'PLACE_BUILDING', { defId: 'farmhouse', anchor: [71, 69], rotation: 0, autoFlattenHDm: 50 });
farm = run(farm, 'PLACE_BUILDING', { defId: 'market', anchor: [71, 74], rotation: 0, autoFlattenHDm: 50 });
farm = run(farm, 'BUY_MATERIAL', { wood: 1 }, NOW + 60_000);
ensureRepeatQuests(farm);
check('supported Farm has 3 active repeat quests', farm.snapshot.progress.repeat?.active.length === 3, farm.snapshot.progress.repeat, 'Exactly 3 active quests');
rewardChecks(farm, 'Farm with connected field quota');
for (const [label, s] of [['City', city], ['Farm', farm]] as const) {
  const result = validateSnapshot(cloneState(s), structuredClone(s.snapshot), s.snapshot.serverTime);
  check(`${label} valid repeat snapshot roundtrip`, result.ok && stateHash(result.state) === stateHash(s), result.ok ? { hash: stateHash(result.state) } : result.errors, 'Validated identical snapshot', 'Snapshot integrity');
}
await writeFile(`${directory}/valid-city-snapshot.json`, JSON.stringify(city.snapshot, null, 2));
await writeFile(`${directory}/valid-farm-snapshot.json`, JSON.stringify(farm.snapshot, null, 2));

const q0 = (snapshot: WorldSnapshot): RepeatQuest => snapshot.progress.repeat!.active[0]!;
mutate(farm, 'forged cash reward', s => { q0(s).reward.cash += 1_000_000; });
mutate(farm, 'forged XP reward', s => { q0(s).xp += 1_000_000; });
mutate(farm, 'material reward outside Q005', s => { q0(s).reward.wood = 99; });
mutate(farm, 'duplicate quest IDs', s => { s.progress.repeat!.active[1]!.id = q0(s).id; });
mutate(farm, 'consecutive generated templates', s => { s.progress.repeat!.active[1] = { ...q0(s), id: 'r1' }; });
mutate(farm, 'unknown target subject', s => { Object.assign(q0(s), { template: 'harvest_crop', subject: 'unknown_crop' }); });
mutate(farm, 'crop above character level', s => { Object.assign(q0(s), { template: 'harvest_crop', subject: 'coffee' }); });
mutate(farm, 'wrong-map City template', s => { Object.assign(q0(s), { template: 'build_type', subject: 'house_small' }); });
mutate(farm, 'progress above target', s => { q0(s).progress = q0(s).target + 1; });
mutate(farm, 'zero target', s => { q0(s).target = 0; });
mutate(farm, 'nonfinite reward', s => { q0(s).reward.cash = Infinity; });
mutate(farm, 'nonfinite target', s => { q0(s).target = NaN; });
mutate(farm, 'nonfinite reroll clock', s => { s.progress.repeat!.rerollAt = Infinity; });
mutate(farm, 'reroll clock beyond 4h', s => { s.progress.repeat!.rerollAt = s.serverTime + 400 * HOUR; });
mutate(farm, 'repeat state before authored quests end', s => { s.progress.questIndex = 0; });
mutate(farm, 'quest ID beyond generation sequence', s => { q0(s).id = 'r999999999'; });
mutate(farm, 'fewer than 3 active repeat quests', s => { s.progress.repeat!.active.pop(); });

// Actual repeat completion and replacement: till through valid commands, then claim.
const tillQuest = farm.snapshot.progress.repeat!.active.find(q => q.template === 'till_cells')!;
if (!tillQuest) throw new Error('Expected till quest in three eligible Farm templates');
for (let i = 0; i < tillQuest.target; i++) {
  const x = 74 + i % 6, z = 65 + Math.floor(i / 6);
  farm = run(farm, 'TILL', { rect: [x, z, x, z] });
}
check('real till commands advance matching repeat progress', farm.snapshot.progress.repeat!.active.find(q => q.id === tillQuest.id)?.progress === tillQuest.target,
  farm.snapshot.progress.repeat!.active, 'Matching TILL events reach target');
const priorCash = farm.snapshot.wallet.cash, priorXp = farm.snapshot.progress.xp, priorIds = new Set(farm.snapshot.progress.repeat!.active.map(q => q.id));
const completedSnapshot = structuredClone(farm.snapshot);
const completed = completedSnapshot.progress.repeat!.active.find(q => q.id === tillQuest.id)!;
completed.reward.cash += 1_000_000; completed.xp += 1_000_000;
const forged = validateSnapshot(farm, completedSnapshot, farm.snapshot.serverTime);
let forgedPayout: unknown = { rejectedAtValidation: true };
if (forged.ok) {
  const initial = forged.state.snapshot.wallet.cash;
  const e = execute(forged.state, command(forged.state, 'CLAIM_QUEST', { questId: tillQuest.id }), forged.state.snapshot.serverTime);
  forgedPayout = { validationAccepted: true, commandAccepted: e.result.accepted, cashDelta: e.state.snapshot.wallet.cash - initial, xpAfter: e.state.snapshot.progress.xp };
  await writeFile(`${directory}/forged-completed-snapshot.json`, JSON.stringify(completedSnapshot, null, 2));
}
check('forged completed reward cannot validate then pay', !forged.ok, forgedPayout, 'Snapshot rejected before CLAIM_QUEST', 'Snapshot integrity');
const claimCommand = command(farm, 'CLAIM_QUEST', { questId: tillQuest.id });
const session = new SimSession(farm), claimed = session.execute(claimCommand, farm.snapshot.serverTime);
farm = session.state;
check('completed repeat claim pays exact cash and XP', claimed.accepted && farm.snapshot.wallet.cash === priorCash + tillQuest.reward.cash && farm.snapshot.progress.xp === priorXp + tillQuest.xp,
  { claimed, cashDelta: farm.snapshot.wallet.cash - priorCash, xpDelta: farm.snapshot.progress.xp - priorXp }, 'Exactly approved quest reward');
check('completed Farm repeat is replaced immediately to 3 slots', farm.snapshot.progress.repeat!.active.length === 3,
  farm.snapshot.progress.repeat, 'Exactly 3 after CLAIM_QUEST');
const fresh = farm.snapshot.progress.repeat!.active.filter(q => !priorIds.has(q.id));
check('replacement never repeats just-completed template', fresh.length === 1 && fresh[0]!.template !== tillQuest.template,
  { previous: tillQuest.template, replacements: fresh }, 'A different template (Q005 has no fallback exception)');
const claimedHash = stateHash(farm), repeated = session.execute(claimCommand, farm.snapshot.serverTime + 1);
check('repeat CLAIM_QUEST command is idempotent', JSON.stringify(repeated) === JSON.stringify(claimed) && stateHash(session.state) === claimedHash,
  { first: claimed, repeated, claimedHash, repeatedHash: stateHash(session.state) }, 'Same result, no second payment', 'Command integrity');

// Reroll cooldown boundary: free at start, rejected just before 4h, accepted at 4h.
let reroll = city;
const rerollId = reroll.snapshot.progress.repeat!.active[0]!.id, cashBeforeReroll = reroll.snapshot.wallet.cash;
reroll = run(reroll, 'REROLL_QUEST', { questId: rerollId });
check('first reroll is free and schedules exactly 4h', reroll.snapshot.wallet.cash === cashBeforeReroll && reroll.snapshot.progress.repeat!.rerollAt === NOW + 4 * HOUR,
  { wallet: reroll.snapshot.wallet, rerollAt: reroll.snapshot.progress.repeat!.rerollAt }, 'No charge; now + 4h');
const secondId = reroll.snapshot.progress.repeat!.active[0]!.id;
const earlyInput = command(reroll, 'REROLL_QUEST', { questId: secondId }, NOW + 4 * HOUR - 1), beforeEarly = stateHash(reroll);
const early = execute(reroll, earlyInput, NOW + 4 * HOUR - 1);
check('reroll rejected 1ms before 4h and preserves state', !early.result.accepted && early.result.code === 'QUEST_NOT_READY' && stateHash(early.state) === beforeEarly,
  early.result, 'QUEST_NOT_READY; unchanged state');
reroll = run(reroll, 'REROLL_QUEST', { questId: secondId }, NOW + 4 * HOUR);
check('reroll accepted exactly at 4h', reroll.snapshot.progress.repeat!.rerollAt === NOW + 8 * HOUR, reroll.snapshot.progress.repeat, 'Cooldown renewed for 4h');

for (const [label, payload] of [['missing quest ID', {}], ['nonstring quest ID', { questId: 17 }], ['extra key', { questId: 'r0', extra: true }]] as const) {
  const input = command(reroll, 'REROLL_QUEST', payload), invalid = new SimSession(reroll), before = stateHash(invalid.state);
  const first = invalid.execute(input, reroll.snapshot.serverTime), second = invalid.execute(input, reroll.snapshot.serverTime);
  check(`malformed ${label} rejected atomically/idempotently`, !first.accepted && first.code === 'INVALID_COMMAND' && before === stateHash(invalid.state) && JSON.stringify(first) === JSON.stringify(second),
    { first, second, before, after: stateHash(invalid.state) }, 'INVALID_COMMAND, unchanged state, cached same rejection', 'Command integrity');
}

// Reachable support-loss state: remove roads from an otherwise valid, supported post-12 fixture.
let unsupported = cloneState(farm);
unsupported = run(unsupported, 'REMOVE_ROAD', { cells: [[70, 78]] });
const harvestId = unsupported.snapshot.progress.repeat!.active.find(q => q.template === 'harvest_crop')!.id;
unsupported = run(unsupported, 'REROLL_QUEST', { questId: harvestId });
check('support-loss first reroll keeps 3 active quests', unsupported.snapshot.progress.repeat!.active.length === 3,
  { quota: fieldQuota(unsupported), repeat: unsupported.snapshot.progress.repeat }, 'Exactly 3 per character after quest 12');
const tillId = unsupported.snapshot.progress.repeat!.active.find(q => q.template === 'till_cells')!.id;
unsupported = run(unsupported, 'REROLL_QUEST', { questId: tillId }, unsupported.snapshot.serverTime + 4 * HOUR);
check('Farm with zero connected quota still gets exactly 3 quests', unsupported.snapshot.progress.repeat!.active.length === 3,
  { quota: fieldQuota(unsupported), repeat: unsupported.snapshot.progress.repeat }, 'Exactly 3 per character after quest 12');
const only = unsupported.snapshot.progress.repeat!.active[0]!;
unsupported = run(unsupported, 'REROLL_QUEST', { questId: only.id }, unsupported.snapshot.serverTime + 4 * HOUR);
check('support-loss reroll avoids same template consecutively', unsupported.snapshot.progress.repeat!.active.every(q => q.template !== only.template),
  { previous: only.template, repeat: unsupported.snapshot.progress.repeat }, 'Never same template twice consecutively');

// Generator-only sweep: inspect unlocked references; this is not normal-play pace evidence.
const locked: unknown[] = [];
for (const kind of ['city', 'farm'] as const) for (let level = 1; level <= 20; level++) for (let seed = 0; seed < 8; seed++) {
  const s = fixture(kind, level, `unlock-${kind}-${level}-${seed}`); ensureRepeatQuests(s);
  for (const q of s.snapshot.progress.repeat!.active) {
    const def = q.template === 'build_type' ? catalog.buildings[q.subject!] : q.template === 'harvest_crop' ? catalog.crops[q.subject!] : undefined;
    if (def && (def.unlockLevel > level || ('mapKinds' in def && !def.mapKinds.includes(kind)))) locked.push({ kind, level, q });
    if (q.template === 'embank_cells' && level < economy.embank.unlockLevel) locked.push({ kind, level, q });
    if (q.template === 'sell_item' && !Object.values(catalog.crops).some(c => c.itemId === q.subject && c.unlockLevel <= level)) locked.push({ kind, level, q });
  }
}
check('generated targets are unlocked across 320 setup states', locked.length === 0, locked, 'Only unlocked map-compatible targets', 'Generator fixture sweep');

// A nonzero City rate with road multiplier verifies the collect target and rewards before caps.
let incomeCity = fixture('city', 8, 'income-city');
const incomeRoad = Array.from({ length: 10 }, (_, i) => [49 + i, 70]);
incomeCity = run(incomeCity, 'BUILD_ROAD', { tier: 2, cells: incomeRoad });
for (const x of [50, 52, 54, 56]) {
  incomeCity = run(incomeCity, 'PLACE_BUILDING', { defId: 'house_small', anchor: [x, 68], rotation: 0, autoFlattenHDm: 40 });
  incomeCity = run(incomeCity, 'BUY_MATERIAL', { wood: 1 }, incomeCity.snapshot.serverTime + 30_000);
}
for (let attempt = 0; attempt < 64; attempt++) {
  incomeCity.snapshot.worldId = `income-city-${attempt}`;
  incomeCity.snapshot.progress.repeat = undefined; ensureRepeatQuests(incomeCity);
  if (incomeCity.snapshot.progress.repeat!.active.some(q => q.template === 'collect_cash')) break;
}
const collectionQuest = incomeCity.snapshot.progress.repeat!.active.find(q => q.template === 'collect_cash');
check('City collect target equals exactly one hour of current base rate', !!collectionQuest && Math.abs(collectionQuest.target - independentIncome(incomeCity)) < 1e-8,
  { referenceIncome: independentIncome(incomeCity), collectionQuest }, 'X = current one-hour base income (Q005 specifies reward rounding, not target rounding)');
rewardChecks(incomeCity, 'City nonzero income');

// Production completion is distinct from queue submission. Feed is a synthetic fixture resource.
let producer = cloneState(farm);
producer = run(producer, 'BUILD_ROAD', { tier: 1, cells: Array.from({ length: 7 }, (_, i) => [71 + i, 72]) });
producer = run(producer, 'PLACE_BUILDING', { defId: 'chicken_coop', anchor: [75, 69], rotation: 0, autoFlattenHDm: 50 });
producer = run(producer, 'BUY_MATERIAL', { wood: 1 }, producer.snapshot.serverTime + 5 * 60_000);
producer.snapshot.inventory.corn = 20; recompute(producer);
for (let attempt = 0; attempt < 64; attempt++) {
  producer.snapshot.worldId = `producer-${attempt}`;
  producer.snapshot.progress.repeat = undefined; ensureRepeatQuests(producer);
  if (producer.snapshot.progress.repeat!.active.some(q => q.template === 'produce_item')) break;
}
const produceQuest = producer.snapshot.progress.repeat!.active.find(q => q.template === 'produce_item');
if (!produceQuest) throw new Error('No production repeat generated with eligible owned producer');
const producerValidation = validateSnapshot(producer, structuredClone(producer.snapshot), producer.snapshot.serverTime);
check('production fixture snapshot validates before execution', producerValidation.ok, producerValidation.ok ? true : producerValidation.errors, 'Valid supported producer state', 'Snapshot integrity');
const coop = producer.snapshot.buildings.find(b => b.defId === 'chicken_coop')!;
producer = run(producer, 'START_PRODUCTION', { buildingId: coop.id, recipeId: 'chicken_coop', count: produceQuest.target });
const queued = producer.snapshot.buildings.find(b => b.id === coop.id)!.slots!.flat();
const notYetProduced = queued.every(job => job.readyAt > producer.snapshot.serverTime);
const prematureClaim = execute(producer, command(producer, 'CLAIM_QUEST', { questId: produceQuest.id }), producer.snapshot.serverTime);
check('produce-N-units quest cannot be claimed while every job is still queued', notYetProduced && !prematureClaim.result.accepted && prematureClaim.result.code === 'QUEST_NOT_READY',
  { template: produceQuest, queued, serverTime: producer.snapshot.serverTime, progressAfterQueue: producer.snapshot.progress.repeat!.active.find(q => q.id === produceQuest.id)?.progress, claim: prematureClaim.result },
  'Production quest requires produced units, not only submitting the queue', 'Q005');

const endHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const sourceStable = JSON.stringify(sourceHashes) === JSON.stringify(endHashes);
const result = { generatedAt: new Date().toISOString(), fixtureCaveat: 'Synthetic level-8/resources/quest history, provisional template. Command transitions are real sim execution; not normal-play progression or 30–60 minute pace proof.',
  sourceStable, sourceHashes, endHashes, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length, checks };
await writeFile(`${directory}/results.json`, JSON.stringify(result, null, 2));
await writeFile(`${directory}/commands.json`, JSON.stringify(commands, null, 2));
console.log(JSON.stringify({ passed: result.passed, failed: result.failed, sourceStable, failures: checks.filter(c => !c.pass).map(c => c.name) }, null, 2));
if (result.failed || !sourceStable) process.exitCode = 1;
