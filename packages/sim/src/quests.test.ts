import { describe, expect, it } from 'vitest';
import { cellIndex, Surface, type CommandType, type MapKind } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { event } from './common';
import { recompute } from './economy';
import { authoredQuestProgress, execute } from './engine';
import { ensureRepeatQuests, maxReferenceIncome, referenceIncome } from './quests';
import { cloneState, createState, rebuildOccupancy, type SimState } from './state';
import { validateSnapshot } from './snapshot';

const NOW = 10_000_000_000, HOUR = 3_600_000;
function world(kind: MapKind, level = 8, worldId = 'w-quests'): SimState {
  const s = createState(createTestTemplate(kind), NOW, undefined, { worldId, accountId: 'acc', displayName: 'Người chơi', tag: '0001' });
  s.snapshot.progress = { xp: economy.xp.cumulative[kind][level]!, level, questIndex: catalog.quests[kind].length, questProgress: {}, tutorialDone: true };
  s.snapshot.wallet = { cash: 100_000, wood: 500, stone: 500 };
  recompute(s); ensureRepeatQuests(s);
  return s;
}
const run = (s: SimState, type: CommandType, payload: unknown, now = NOW) =>
  execute(s, { type, payload, worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, commandId: `00000000-0000-4000-8000-${String(s.snapshot.revision + 1).padStart(12, '0')}`, clientTime: now }, now);

describe('repeat quests (docs/16 §10.3, D017, D024)', () => {
  it('start only after the 12 authored quests and always fill 3 slots with distinct quests', () => {
    const fresh = createState(createTestTemplate('city'), NOW);
    ensureRepeatQuests(fresh);
    expect(fresh.snapshot.progress.repeat).toBeUndefined();
    const s = world('city');
    const active = s.snapshot.progress.repeat!.active;
    expect(active).toHaveLength(economy.repeatQuests.slots);
    expect(new Set(active.map(q => `${q.template}:${q.subject}:${q.target}`)).size).toBe(active.length);
    for (const kind of ['city', 'farm'] as const) for (const level of [2, 6, 10]) expect(world(kind, level).snapshot.progress.repeat!.active).toHaveLength(3);
  });
  it('are deterministic per world and differ between worlds', () => {
    const a = world('city', 8, 'world-a'), b = world('city', 8, 'world-a'), c = world('city', 8, 'world-c');
    expect(a.snapshot.progress.repeat).toEqual(b.snapshot.progress.repeat);
    expect(JSON.stringify(a.snapshot.progress.repeat)).not.toBe(JSON.stringify(c.snapshot.progress.repeat));
  });
  it('only target unlocked content (low-level farm: no producers, only unlocked crops)', () => {
    const s = world('farm', 2);
    for (const q of s.snapshot.progress.repeat!.active) {
      expect(q.template).not.toBe('produce_item');
      if (q.template === 'harvest_crop') expect(catalog.crops[q.subject!]!.unlockLevel).toBeLessThanOrEqual(2);
      if (q.template === 'sell_item') expect(Object.values(catalog.crops).find(c => c.itemId === q.subject)!.unlockLevel).toBeLessThanOrEqual(2);
    }
  });
  it('reward = 25% of reference income rounded to $10 (min $100), XP = round(2√reward)', () => {
    const s = world('city');
    for (const q of s.snapshot.progress.repeat!.active) {
      const expected = Math.max(100, Math.round(referenceIncome(s) * 0.25 / 10) * 10);
      expect(q.reward.cash).toBe(expected);
      expect(q.xp).toBe(Math.round(2 * Math.sqrt(expected)));
    }
  });
  it('a farm without support buildings still always has a quest (falls back to the previous template)', () => {
    const s = world('farm', 10);
    const only = s.snapshot.progress.repeat!.active;
    expect(only.length).toBeGreaterThan(0);
    const q = only[0]!;
    event(s, 'SELL', q.subject!, q.target);
    const e = run(s, 'CLAIM_QUEST', { questId: q.id });
    expect(e.result.accepted).toBe(true);
    expect(e.state.snapshot.progress.repeat!.active.length).toBeGreaterThan(0);
  });
  it('progress counts only matching actions/subjects and claiming pays, replaces and never repeats the template back-to-back', () => {
    const s = world('farm', 10);
    s.snapshot.buildings.push({ id: 'b_fh', defId: 'farmhouse', anchor: [71, 77], rotation: 0, status: 'ACTIVE', placedAt: NOW - 120_000, buildEndsAt: NOW - 60_000,
      cashPaid: 500, materialsPaid: { cash: 500, wood: 10, stone: 5 }, investedValue: 750 });
    rebuildOccupancy(s); recompute(s);
    s.snapshot.progress.repeat = undefined; ensureRepeatQuests(s);
    expect(s.snapshot.progress.repeat!.active).toHaveLength(3);
    const r = s.snapshot.progress.repeat!;
    const q = r.active[0]!;
    const spec: Record<string, [string, string]> = { harvest_crop: ['HARVEST', q.subject ?? ''], sell_item: ['SELL', q.subject ?? ''], produce_item: ['PRODUCED', q.subject ?? ''], till_cells: ['TILL', 'cells'] };
    const [action, kind] = spec[q.template]!;
    event(s, action, 'something-else', 99);
    expect(q.progress).toBe(0);
    event(s, action, kind, q.target - 1);
    let e = run(s, 'CLAIM_QUEST', { questId: q.id });
    expect(e.result.accepted ? 'accepted' : e.result.code).toBe('QUEST_NOT_READY');
    event(s, action, kind, 5);
    expect(q.progress).toBe(q.target);
    const cash = s.snapshot.wallet.cash, xp = s.snapshot.progress.xp;
    e = run(s, 'CLAIM_QUEST', { questId: q.id });
    expect(e.result.accepted).toBe(true);
    const after = e.state.snapshot;
    expect(after.wallet.cash).toBeGreaterThanOrEqual(cash + q.reward.cash);
    expect(after.progress.xp).toBeGreaterThanOrEqual(xp + q.xp);
    expect(after.progress.repeat!.active.map(x => x.id)).not.toContain(q.id);
    expect(after.progress.repeat!.active).toHaveLength(3);
  });
  it('the replacement uses a different template than the one just claimed when another is eligible', () => {
    const s = world('city');
    const q = s.snapshot.progress.repeat!.active.find(x => x.template !== 'population')!;
    q.progress = q.target;
    const e = run(s, 'CLAIM_QUEST', { questId: q.id });
    expect(e.result.accepted).toBe(true);
    const fresh = e.state.snapshot.progress.repeat!.active.at(-1)!;
    expect(fresh.template).not.toBe(q.template);
  });
  it('city population quest uses the live population at claim time', () => {
    const s = world('city');
    s.snapshot.progress.repeat!.active = [{ id: 'r99', template: 'population', target: 4, progress: 0, reward: { cash: 100, wood: 0, stone: 0 }, xp: 20 }];
    expect(run(s, 'CLAIM_QUEST', { questId: 'r99' }).result).toMatchObject({ accepted: false, code: 'QUEST_NOT_READY' });
    for (let x = 49; x <= 60; x++) { s.roadTier[cellIndex(x, 70)] = 1; s.surface[cellIndex(x, 70)] = Surface.ROAD; }
    s.snapshot.buildings.push({ id: 'b_house', defId: 'house_small', anchor: [52, 68], rotation: 0, status: 'ACTIVE', placedAt: NOW - 60_000, buildEndsAt: NOW - 30_000,
      cashPaid: 300, materialsPaid: { cash: 300, wood: 5, stone: 0 }, investedValue: 375, accrued: 0, settledAt: NOW });
    rebuildOccupancy(s); recompute(s);
    expect(run(s, 'CLAIM_QUEST', { questId: 'r99' }).result.accepted).toBe(true);
  });
  it('one free reroll every 4 hours', () => {
    const s = world('city');
    const first = s.snapshot.progress.repeat!.active[0]!.id;
    const e1 = run(s, 'REROLL_QUEST', { questId: first });
    expect(e1.result.accepted).toBe(true);
    const s1 = e1.state, second = s1.snapshot.progress.repeat!.active[0]!.id;
    expect(run(s1, 'REROLL_QUEST', { questId: second }, NOW + HOUR).result).toMatchObject({ accepted: false, code: 'QUEST_NOT_READY' });
    expect(run(s1, 'REROLL_QUEST', { questId: second }, NOW + 4 * HOUR).result.accepted).toBe(true);
    expect(run(s1, 'REROLL_QUEST', { questId: 'r-missing' }, NOW + 5 * HOUR).result).toMatchObject({ accepted: false, code: 'NOT_FOUND' });
  });
  it('collect_cash target is exactly one hour of base income (not rounded to $10); reward keeps the $10 rounding', () => {
    for (let seq = 0; seq < 40; seq++) {
      const s = world('city', 10, `w-cash-${seq}`);
      s.rates = { b_a: 287.4, b_b: 150 }; s.snapshot.progress.repeat = undefined; ensureRepeatQuests(s);
      const q = s.snapshot.progress.repeat!.active.find(x => x.template === 'collect_cash');
      if (!q) continue;
      expect(q.target).toBe(437);
      expect(q.ref).toBe(437);
      expect(q.reward.cash).toBe(110);
      return;
    }
    throw new Error('no collect_cash quest generated in 40 worlds');
  });
  it('validateSnapshot rejects forged repeat quests (reward, XP, id, subject, timing, map, progress)', () => {
    const s = world('farm', 6);
    const forge = (mutate: (r: NonNullable<SimState['snapshot']['progress']['repeat']>) => void, code: string) => {
      const snap = structuredClone(s.snapshot); mutate(snap.progress.repeat!);
      const checked = validateSnapshot(cloneState(s), snap, NOW);
      expect(checked.ok ? [] : checked.errors.join(' ')).toContain(code);
    };
    forge(r => { r.active[0]!.reward.cash = 1_000_000; }, 'REWARD');
    forge(r => { const q = r.active[0]!; q.reward.cash += 10; q.xp = Math.round(2 * Math.sqrt(q.reward.cash)); }, 'REWARD');
    forge(r => { r.active[0]!.reward.wood = 50; }, 'REWARD');
    forge(r => { r.active[0]!.xp += 1; }, ':XP');
    forge(r => { r.active[0]!.ref = 10_000_000; }, ':REF');
    forge(r => { r.active[0]!.id = `r${r.seq + 5}`; }, ':ID');
    forge(r => { r.active[1]!.id = r.active[0]!.id; }, 'DUPLICATE');
    forge(r => { r.active[0]!.template = 'road_cells'; r.active[0]!.subject = undefined; }, 'TEMPLATE');
    forge(r => { r.active[0]!.template = 'harvest_crop'; r.active[0]!.subject = 'no-such-crop'; }, 'SUBJECT');
    forge(r => { r.active[0]!.progress = r.active[0]!.target + 1; }, 'PROGRESS');
    forge(r => { r.rerollAt = NOW + 48 * HOUR; }, 'REROLL_TIME');
    forge(r => { r.active.push({ ...r.active[0]!, id: `r${r.seq}` }); r.seq++; }, 'progress.repeat.active'); // schema caps the list at 3
    const early = structuredClone(s.snapshot); early.progress.questIndex = 3;
    const checked = validateSnapshot(cloneState(s), early, NOW);
    expect(checked.ok ? [] : checked.errors.join(' ')).toContain('BEFORE_AUTHORED_DONE');
  });
  it('locked subjects are rejected and the reference-income bound grows with level', () => {
    const s = world('farm', 2);
    const locked = Object.values(catalog.crops).find(c => c.unlockLevel > 2)!;
    const snap = structuredClone(s.snapshot), q = snap.progress.repeat!.active[0]!;
    q.template = 'harvest_crop'; q.subject = locked.id;
    const checked = validateSnapshot(cloneState(s), snap, NOW);
    expect(checked.ok ? [] : checked.errors.join(' ')).toContain('SUBJECT');
    expect(maxReferenceIncome('farm', 10)).toBeGreaterThanOrEqual(maxReferenceIncome('farm', 2));
    expect(maxReferenceIncome('city', 10)).toBeGreaterThan(maxReferenceIncome('city', 2));
    for (const kind of ['city', 'farm'] as const) {
      const w = world(kind, 8);
      expect(referenceIncome(w)).toBeLessThanOrEqual(maxReferenceIncome(kind, 8));
    }
  });
  it('snapshots with repeat quests pass validate-then-swap', () => {
    const s = world('farm', 6);
    const checked = validateSnapshot(cloneState(s), structuredClone(s.snapshot), NOW);
    expect(checked.ok).toBe(true);
  });
});

describe('authored state quests count work done before the quest appeared (G3 sim-economy finding)', () => {
  it('road quest counts connected player-built road cells regardless of when they were built', () => {
    const s = createState(createTestTemplate('city'), NOW);
    s.snapshot.progress.questIndex = 1; // city-2: road ≥ 6 connected cells
    expect(authoredQuestProgress(s)).toBe(0);
    const e = run(s, 'BUILD_ROAD', { tier: 1, cells: [[49, 70], [50, 70], [51, 70], [52, 70], [53, 70], [54, 70]] });
    expect(e.result.accepted).toBe(true);
    expect(authoredQuestProgress(e.state)).toBe(6);
    // Built while quest 1 was still active: progress is measured from the state, so it still counts.
    const early = createState(createTestTemplate('city'), NOW);
    const built = run(early, 'BUILD_ROAD', { tier: 1, cells: [[49, 70], [50, 70], [51, 70], [52, 70], [53, 70], [54, 70]] }).state;
    built.snapshot.progress.questIndex = 1;
    expect(run(built, 'CLAIM_QUEST', { questId: catalog.quests.city[1]!.id }).result.accepted).toBe(true);
  });
  it('template village roads and disconnected roads do not count', () => {
    const s = createState(createTestTemplate('city'), NOW);
    s.snapshot.progress.questIndex = 1;
    // Two free, flat cells away from the village road and ENTRY.
    let pair: [number, number][] | null = null;
    for (let z = 50; z < 62 && !pair; z++) for (let x = 50; x < 75 && !pair; x++) {
      const cells: [number, number][] = [[x, z], [x + 1, z]];
      if (cells.every(c => !s.occupancy.get(cellIndex(...c)) && s.surface[cellIndex(...c)] !== Surface.WATER)) pair = cells;
    }
    const e = run(s, 'BUILD_ROAD', { tier: 1, cells: pair! });
    expect(e.result.accepted).toBe(true);
    expect(authoredQuestProgress(e.state)).toBe(0);
  });
});
