import { describe, expect, it } from 'vitest';
import { cellIndex, Surface, type CommandType, type MapKind } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { event } from './common';
import { recompute } from './economy';
import { execute } from './engine';
import { ensureRepeatQuests, referenceIncome } from './quests';
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
  it('start only after the 12 authored quests, with 3 distinct templates', () => {
    const fresh = createState(createTestTemplate('city'), NOW);
    ensureRepeatQuests(fresh);
    expect(fresh.snapshot.progress.repeat).toBeUndefined();
    const s = world('city');
    const active = s.snapshot.progress.repeat!.active;
    expect(active).toHaveLength(economy.repeatQuests.slots);
    expect(new Set(active.map(q => q.template)).size).toBe(active.length);
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
    const spec: Record<string, [string, string]> = { harvest_crop: ['HARVEST', q.subject ?? ''], sell_item: ['SELL', q.subject ?? ''], produce_item: ['PRODUCE', q.subject ?? ''], till_cells: ['TILL', 'cells'] };
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
  it('snapshots with repeat quests pass validate-then-swap', () => {
    const s = world('farm', 6);
    const checked = validateSnapshot(cloneState(s), structuredClone(s.snapshot), NOW);
    expect(checked.ok).toBe(true);
  });
});
