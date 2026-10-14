import { describe, expect, it } from 'vitest';
import { catalog, economy } from '@xay-nha/content';
import { CellFlag, Surface, cellIndex, type Cell, type Command, type CommandPayload, type CommandType } from '@xay-nha/contracts';
import { createTestTemplate, decodeLayers, encodeLayers, validateTemplate } from '@xay-nha/worldgen';
import { access, isFarBank } from './index';
import { createState, rebuildOccupancy, type SimState } from './state';
import { authoredQuestProgress, execute } from './engine';
import { recompute } from './economy';

const NOW = 1_000_000;

function command<T extends CommandType>(s: SimState, type: T, payload: CommandPayload[T]): Command {
  return {
    type, payload,
    worldId: s.snapshot.worldId,
    commandId: crypto.randomUUID(),
    expectedRevision: s.snapshot.revision,
    clientTime: NOW,
  } as Command;
}

function apply<T extends CommandType>(s: SimState, type: T, payload: CommandPayload[T]): SimState {
  const result = execute(s, command(s, type, payload), NOW);
  expect(result.result.accepted).toBe(true);
  return result.state;
}

describe('D039 Law A: road connectivity, quests and far-bank topology', () => {
  it('công trình giáp một đoạn đường lẻ có thu nhập; công trình không giáp đường nào thì không', () => {
    const s = createState(createTestTemplate('city'), NOW);
    s.snapshot.wallet = { cash: 100_000, wood: 1000, stone: 1000 };
    s.snapshot.progress = { xp: economy.xp.cumulative.city[20]!, level: 20, questIndex: 12, questProgress: {}, tutorialDone: true };

    // Clear all existing roads so nothing is connected to entry
    s.roadTier.fill(0);
    for (let i = 0; i < s.surface.length; i++) {
      if (s.surface[i] === Surface.ROAD) s.surface[i] = Surface.GRASS;
    }

    // Build an isolated road segment of 1 cell at [50, 60]
    s.roadTier[cellIndex(50, 60)] = 1;
    s.surface[cellIndex(50, 60)] = Surface.ROAD;

    // Building 1: adjacent to the isolated road [50, 60]
    const b1 = {
      id: 'b_road', defId: 'house_small', anchor: [51, 60] as Cell, rotation: 0 as const,
      status: 'ACTIVE' as const, placedAt: 0, buildEndsAt: 0, cashPaid: 100,
      materialsPaid: { cash: 100, wood: 0, stone: 0 }, investedValue: 100, accrued: 0, settledAt: NOW,
    };
    // Building 2: no road anywhere near it
    const b2 = {
      id: 'b_noroad', defId: 'house_small', anchor: [70, 60] as Cell, rotation: 0 as const,
      status: 'ACTIVE' as const, placedAt: 0, buildEndsAt: 0, cashPaid: 100,
      materialsPaid: { cash: 100, wood: 0, stone: 0 }, investedValue: 100, accrued: 0, settledAt: NOW,
    };

    s.snapshot.buildings = [b1, b2];
    rebuildOccupancy(s);
    recompute(s);

    expect(access(s, b1)).toBe(1);
    expect(s.rates[b1.id]).toBeGreaterThan(0);

    expect(access(s, b2)).toBe(0);
    expect(s.rates[b2.id]).toBe(0);
  });

  it('xóa đường cuối cùng giáp công trình thì phát hiện công trình sẽ mất đường nối', () => {
    const s = createState(createTestTemplate('city'), NOW);
    s.snapshot.wallet = { cash: 100_000, wood: 1000, stone: 1000 };
    s.snapshot.progress = { xp: economy.xp.cumulative.city[20]!, level: 20, questIndex: 12, questProgress: {}, tutorialDone: true };

    // Clear all existing roads
    s.roadTier.fill(0);
    for (let i = 0; i < s.surface.length; i++) {
      if (s.surface[i] === Surface.ROAD) s.surface[i] = Surface.GRASS;
    }

    // Single road cell at [50, 60]
    s.roadTier[cellIndex(50, 60)] = 1;
    s.surface[cellIndex(50, 60)] = Surface.ROAD;

    // Building adjacent only to [50, 60]
    const b = {
      id: 'b_test', defId: 'house_small', anchor: [51, 60] as Cell, rotation: 0 as const,
      status: 'ACTIVE' as const, placedAt: 0, buildEndsAt: 0, cashPaid: 100,
      materialsPaid: { cash: 100, wood: 0, stone: 0 }, investedValue: 100, accrued: 0, settledAt: NOW,
    };
    s.snapshot.buildings = [b];
    rebuildOccupancy(s);
    recompute(s);

    expect(access(s, b)).toBe(1);

    // Simulate ToolController check for REMOVE_ROAD
    const cmd = command(s, 'REMOVE_ROAD', { cells: [[50, 60]] });
    const next = execute(s, cmd, NOW).state;
    const cut = s.snapshot.buildings.filter(bld =>
      bld.status === 'ACTIVE' && access(s, bld) > 0 &&
      next.snapshot.buildings.some(n => n.id === bld.id) &&
      !access(next, next.snapshot.buildings.find(n => n.id === bld.id)!),
    ).length;

    expect(cut).toBe(1);
  });

  it('nhiệm vụ "Làm 6 ô đường" đếm đúng số ô người chơi làm và cho phép nhận thưởng', () => {
    let s = createState(createTestTemplate('city'), NOW);
    s.snapshot.wallet = { cash: 10_000, wood: 100, stone: 100 };
    s.snapshot.progress.questIndex = 1; // city-2: "Làm 6 ô đường"

    expect(catalog.quests.city[1]!.kind).toBe('road_cells');
    expect(authoredQuestProgress(s)).toBe(0);

    // Build 2 road cells
    s = apply(s, 'BUILD_ROAD', { tier: 1, cells: [[52, 60], [53, 60]] });
    expect(authoredQuestProgress(s)).toBe(2);

    // Build 4 more road cells
    s = apply(s, 'BUILD_ROAD', { tier: 1, cells: [[54, 60], [55, 60], [56, 60], [57, 60]] });
    expect(authoredQuestProgress(s)).toBe(6);

    // Claim quest
    const claimed = apply(s, 'CLAIM_QUEST', { questId: catalog.quests.city[1]!.id });
    expect(claimed.snapshot.progress.questIndex).toBe(2);
  });

  it('"bờ bên kia" hoạt động chính xác trên template không có ô vào làng (entryCells rỗng)', () => {
    const template = createTestTemplate('city');
    template.entryCells = [];
    const layers = decodeLayers(template);
    layers.flags[70 * 128 + 48] = layers.flags[70 * 128 + 48]! & ~CellFlag.ENTRY;
    template.layers = encodeLayers(layers);
    // Validate template with empty entryCells succeeds
    const valErrors = validateTemplate(template);
    expect(valErrors).toEqual([]);

    const s = createState(template, NOW);
    s.snapshot.wallet = { cash: 100_000, wood: 1000, stone: 1000 };

    // Active bridge across the river in startZones
    // River in test template runs down centerline at x=124.
    // Let's create a fixture river cross at x=60-63 with bridge
    // Bank A: [59, 70], Bank B: [64, 70], river between 60..63
    for (let x = 60; x <= 63; x++) s.surface[cellIndex(x, 70)] = Surface.WATER;
    s.flags[cellIndex(59, 70)] = CellFlag.EMBANKED;
    s.flags[cellIndex(64, 70)] = CellFlag.EMBANKED;
    s.surface[cellIndex(59, 70)] = Surface.ROAD;
    s.surface[cellIndex(64, 70)] = Surface.ROAD;
    s.roadTier[cellIndex(59, 70)] = 1;
    s.roadTier[cellIndex(64, 70)] = 1;

    s.snapshot.bridges.push({
      id: 'br_d039', typeId: 'bridge_wood', a: [59, 70], b: [64, 70], deckHeightDm: 25,
      placedAt: 0, buildEndsAt: NOW, status: 'ACTIVE', cashPaid: 320,
      materialsPaid: { cash: 320, wood: 20, stone: 0 }, investedValue: 620,
    });

    // Right side (x=63..79, 544 cells) is larger than left side (x=48..60, 416 cells),
    // so right bank is the home bank, and left bank is the far bank.
    // Home bank cell should NOT be far bank
    expect(isFarBank(s, [[70, 70]])).toBe(false);
    // Far bank cell across active bridge should BE far bank
    expect(isFarBank(s, [[50, 70]])).toBe(true);
  });
});
