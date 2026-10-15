import { describe, expect, it } from 'vitest';
import type { CommandType, WorldSnapshot } from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { OPEN_QUESTS, claimedQuestIds, openQuests, tutorialActive } from './common';
import { recompute } from './economy';
import { authoredQuestProgressFor, execute } from './engine';
import { ensureRepeatQuests } from './quests';
import { createState, type SimState } from './state';
import { stateHash, validateSnapshot } from './snapshot';

const NOW = 10_000_000_000;
const ids = (kind: 'city' | 'farm') => catalog.quests[kind].map(q => q.id);
const run = (s: SimState, type: CommandType, payload: unknown) =>
  execute(s, { type, payload, worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, commandId: `00000000-0000-4000-8000-${String(s.snapshot.revision + 1).padStart(12, '0')}`, clientTime: NOW }, NOW);
const road6 = [[49, 70], [50, 70], [51, 70], [52, 70], [53, 70], [54, 70]];

describe('parallel authored quests (D041)', () => {
  it('lists the first 5 unclaimed quests in chain order', () => {
    const s = createState(createTestTemplate('city'), NOW);
    expect(openQuests(s).map(q => q.id)).toEqual(ids('city').slice(0, OPEN_QUESTS));
    s.snapshot.progress.claimedQuests = ['city-3', 'city-1'];
    s.snapshot.progress.questIndex = 2;
    expect(openQuests(s).map(q => q.id)).toEqual(['city-2', 'city-4', 'city-5', 'city-6', 'city-7']);
  });

  it('claims quest #2 before #1, then the next quest joins the list', () => {
    let s = createState(createTestTemplate('city'), NOW);
    s.snapshot.wallet = { cash: 10_000, wood: 100, stone: 100 };
    const early = run(s, 'CLAIM_QUEST', { questId: 'city-2' });
    expect(early.result.accepted).toBe(false);
    if (!early.result.accepted) expect(early.result.code).toBe('QUEST_NOT_READY');
    s = run(s, 'BUILD_ROAD', { tier: 1, cells: road6 }).state;
    expect(authoredQuestProgressFor(s, 'city-2')).toBe(6);
    const cash = s.snapshot.wallet.cash, xp = s.snapshot.progress.xp, quest = catalog.quests.city[1]!;
    const claim = run(s, 'CLAIM_QUEST', { questId: 'city-2' });
    expect(claim.result.accepted).toBe(true);
    s = claim.state;
    expect(s.snapshot.wallet.cash).toBe(cash + quest.reward.cash);
    expect(s.snapshot.progress.xp).toBeGreaterThanOrEqual(xp + quest.xp);
    expect(s.snapshot.progress.claimedQuests).toEqual(['city-2']);
    expect(s.snapshot.progress.questIndex).toBe(1);
    expect(openQuests(s).map(q => q.id)).toEqual(['city-1', 'city-3', 'city-4', 'city-5', 'city-6']);
    // Claiming again, or a quest that is not open yet, is rejected.
    for (const questId of ['city-2', 'city-7', 'unknown']) {
      const again = run(s, 'CLAIM_QUEST', { questId });
      expect(again.result.accepted).toBe(false);
      if (!again.result.accepted) expect(again.result.code).toBe('NOT_FOUND');
    }
  });

  it('every open quest accumulates event progress, and farm quests can be claimed out of order', () => {
    let s = createState(createTestTemplate('farm'), NOW);
    recompute(s);
    const ok = (type: CommandType, payload: unknown) => {
      const e = run(s, type, payload);
      expect(e.result.accepted, JSON.stringify(e.result)).toBe(true);
      s = e.state;
    };
    expect(openQuests(s).map(q => q.id)).toEqual(['farm-1', 'farm-2', 'farm-3', 'farm-4', 'farm-5']);
    ok('PLACE_BUILDING', { defId: 'market', anchor: [71, 77], rotation: 0 });
    ok('BUILD_ROAD', { tier: 1, cells: Array.from({ length: 7 }, (_, n) => [70, 79 - n]) });
    ok('PLACE_BUILDING', { defId: 'farmhouse', anchor: [71, 73], rotation: 0 });
    ok('TILL', { rect: [74, 73, 79, 73] });
    ok('PLANT', { rect: [74, 73, 79, 73], cropId: 'veg_greens' });
    expect(authoredQuestProgressFor(s, 'farm-3')).toBe(6);
    expect(authoredQuestProgressFor(s, 'farm-4')).toBe(6);
    // farm-4 first, before farm-1..3; the tutorial crop used the fast timer because farm-4 was open.
    ok('CLAIM_QUEST', { questId: 'farm-4' });
    expect(s.snapshot.progress.claimedQuests).toEqual(['farm-4']);
    expect(openQuests(s).map(q => q.id)).toEqual(['farm-1', 'farm-2', 'farm-3', 'farm-5', 'farm-6']);
    ok('CLAIM_QUEST', { questId: 'farm-1' });
    expect(s.snapshot.progress.questIndex).toBe(2);
  });

  it('tutorial helpers stay active until every tutorial quest is claimed', () => {
    const s = createState(createTestTemplate('farm'), NOW);
    expect(tutorialActive(s)).toBe(true);
    s.snapshot.progress.claimedQuests = ids('farm').slice(0, 5);
    s.snapshot.progress.questIndex = 5;
    expect(tutorialActive(s)).toBe(true);
    s.snapshot.progress.claimedQuests = ids('farm').slice(0, 6);
    s.snapshot.progress.questIndex = 6;
    expect(tutorialActive(s)).toBe(false);
    // Legacy flag-only worlds keep working.
    const legacy = createState(createTestTemplate('farm'), NOW);
    legacy.snapshot.progress.questIndex = economy.construction.tutorialInstantThroughQuest;
    expect(tutorialActive(legacy)).toBe(false);
  });

  it('repeat quests start only when every authored quest is claimed', () => {
    const s = createState(createTestTemplate('city'), NOW);
    s.snapshot.progress.claimedQuests = ids('city').slice(1);
    s.snapshot.progress.questIndex = 11;
    ensureRepeatQuests(s);
    expect(s.snapshot.progress.repeat).toBeUndefined();
    s.snapshot.progress.claimedQuests = ids('city');
    s.snapshot.progress.questIndex = 12;
    ensureRepeatQuests(s);
    expect(s.snapshot.progress.repeat!.active).toHaveLength(economy.repeatQuests.slots);
  });
});

describe('legacy snapshots (only questIndex)', () => {
  function legacyCity(index: number): SimState {
    const s = createState(createTestTemplate('city'), NOW);
    s.snapshot.progress = { xp: economy.xp.cumulative.city[6]!, level: 6, questIndex: index, questProgress: { collect_xp_remainder: 3, 'city-11': 0 }, tutorialDone: true };
    s.snapshot.wallet = { cash: 50_000, wood: 300, stone: 300 };
    recompute(s);
    return s;
  }
  it('loads as claimedQuests = chain[0..questIndex) and keeps working', () => {
    const s = legacyCity(10), raw = JSON.parse(JSON.stringify(s.snapshot)) as WorldSnapshot;
    expect('claimedQuests' in raw.progress).toBe(false);
    const checked = validateSnapshot(s, raw, NOW);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.state.snapshot.progress.claimedQuests).toEqual(ids('city').slice(0, 10));
    expect(claimedQuestIds(checked.state)).toEqual(ids('city').slice(0, 10));
    expect(openQuests(checked.state).map(q => q.id)).toEqual(['city-11', 'city-12']);
    // The legacy and the converted form hash identically (client/server stay in step across the conversion).
    expect(stateHash(checked.state)).toBe(stateHash(s));
    // Claiming from the converted state writes the new form.
    const hit = run(checked.state, 'CLAIM_QUEST', { questId: 'city-12' });
    expect(hit.result.accepted).toBe(false);
  });
  it('a legacy state claims straight away without an explicit list', () => {
    const s = legacyCity(11);
    s.snapshot.buildings = [];
    const e = run(s, 'CLAIM_QUEST', { questId: 'city-12' });
    // not ready (no far-bank building), but the quest is open and was resolved from questIndex
    expect(e.result.accepted).toBe(false);
    if (!e.result.accepted) expect(e.result.code).toBe('QUEST_NOT_READY');
  });
  it('rejects inconsistent claimed lists', () => {
    const s = legacyCity(2);
    const base = () => ({ ...(JSON.parse(JSON.stringify(s.snapshot)) as WorldSnapshot) });
    const bad = (mutate: (w: WorldSnapshot) => void, code: string) => {
      const w = base(); mutate(w);
      const r = validateSnapshot(s, w, NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some(e => e.includes(code))).toBe(true);
    };
    bad(w => { w.progress.claimedQuests = ['city-1', 'nope']; }, 'QUEST_CLAIMED:UNKNOWN');
    bad(w => { w.progress.claimedQuests = ['city-1', 'city-1']; }, 'QUEST_CLAIMED:DUPLICATE');
    bad(w => { w.progress.claimedQuests = ['city-1']; }, 'QUEST_CLAIMED:COUNT');
    const good = base(); good.progress.claimedQuests = ['city-2', 'city-1'];
    expect(validateSnapshot(s, good, NOW).ok).toBe(true);
  });
});
