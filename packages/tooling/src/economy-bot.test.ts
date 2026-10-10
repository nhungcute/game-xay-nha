import { describe, expect, it } from 'vitest';
import { economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { EconomyBot } from './economy-bot-core';
import { nextHarvestMinute, sessions } from './economy-bot-schedule';
import { pacingComparison, runEconomy } from '../sim-economy';

describe('real sim economy bot', () => {
  it('uses exactly the three reference-model schedules including day-one exceptions', () => {
    expect(sessions('thuong', 2)).toEqual([{ start: 1200, end: 1225, day: 1 }, { start: 1920, end: 1928, day: 2 }, { start: 2190, end: 2198, day: 2 }, { start: 2700, end: 2710, day: 2 }]);
    expect(sessions('cham', 2)).toHaveLength(8); expect(sessions('nhan', 2)).toHaveLength(2);
  });
  it('crops ripe during a session can be harvested immediately; others wait for the next visit', () => {
    const calendar = sessions('thuong', 2);
    expect(nextHarvestMinute(1205, calendar)).toBe(1205); expect(nextHarvestMinute(1250, calendar)).toBe(1920);
  });
  it.each(['city', 'farm'] as const)('%s bot uses commands to progress from starting resources without violating state invariants', kind => {
    const bot = new EconomyBot(createTestTemplate(kind), 'thuong', 1), before = bot.s.snapshot;
    expect(before.wallet.cash).toBe(economy.start.cash); expect(before.buildings).toHaveLength(0);
    const result = bot.run();
    expect(result.commands).toBeGreaterThan(10); expect(result.final.level).toBeGreaterThan(1);
    expect(result.final.buildings).toBeGreaterThan(0); expect(result.invariants).toEqual({ snapshotValid: true, errors: [], walletSafe: true, occupancyValid: true });
    expect(result.final.questIndex).toBeGreaterThanOrEqual(economy.construction.tutorialInstantThroughQuest);
  });
  it('reports missing milestones as UNREACHED instead of passing them', () => {
    const bot = new EconomyBot(createTestTemplate('city'), 'thuong', 1).run();
    expect(pacingComparison(bot).every(row => row.status === 'UNREACHED')).toBe(true);
  });
  it('refuses invalid simulation arguments before running anything', async () => {
    await expect(runEconomy(['--days', '0'])).rejects.toThrow('--days');
    await expect(runEconomy(['--style', 'unsupported'])).rejects.toThrow('map/style');
    await expect(runEconomy(['--fake', '1'])).rejects.toThrow('Unknown');
  });
});
