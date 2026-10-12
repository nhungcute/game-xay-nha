import { describe, expect, it } from 'vitest';
import { economy } from '@xay-nha/content';
import { cellIndex, Surface, type Cell, type Command, type CommandType } from '@xay-nha/contracts';
import { createTestTemplate } from '@xay-nha/worldgen';
import { createState, isUnlocked, recompute } from '@xay-nha/sim';
import { focusAt } from '../game/ToolController';
import { actionOutcome, describeFocus } from './ObjectPanel';

const NOW = 1_000_000;
function world() { const s = createState(createTestTemplate('farm'), NOW); recompute(s); return s; }
type State = ReturnType<typeof world>;
const command = (s: State, type: CommandType, payload: unknown): Command =>
  ({ type, payload, commandId: crypto.randomUUID(), worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, clientTime: NOW }) as Command;
const category = (s: State, assetId: string) => s.template.env.scatter.find(spec => spec.assetIds.includes(assetId))?.category ?? assetId;
function editableEnv(s: State, prefix: string) {
  return s.env.find(e => category(s, e.assetId).startsWith(prefix) && (prefix !== 'rock' || !category(s, e.assetId).startsWith('rock_large'))
    && Array.from({ length: e.footprint ** 2 }, (_, k): Cell => [e.cell[0] + k % e.footprint, e.cell[1] + Math.floor(k / e.footprint)]).every(c => isUnlocked(s, c)));
}

describe('D033 object panel', () => {
  it('a click picks scenery, then crops, roads and tilled soil; bare ground picks nothing', () => {
    const s = world(), tree = editableEnv(s, 'tree')!;
    expect(focusAt(s, tree.cell)).toEqual({ kind: 'env', id: tree.id, cell: tree.cell });
    const road = s.roadTier.findIndex(tier => tier > 0), roadCell: Cell = [road % 128, Math.floor(road / 128)];
    expect(focusAt(s, roadCell)).toEqual({ kind: 'road', cell: roadCell });
    const bare = s.surface.findIndex((surface, i) => surface === Surface.GRASS && !s.occupancy.has(i) && !s.roadTier[i]);
    const bareCell: Cell = [bare % 128, Math.floor(bare / 128)];
    expect(focusAt(s, bareCell)).toBeNull();
    s.surface[bare] = Surface.TILLED;
    expect(focusAt(s, bareCell)).toEqual({ kind: 'tilled', cell: bareCell });
    s.snapshot.crops.push({ cell: bareCell, cropId: 'veg_greens', plantedAt: 0, readyAt: NOW + 60_000 });
    expect(focusAt(s, bareCell)).toEqual({ kind: 'crop', cell: bareCell });
    expect(focusAt(s, [-1, 0])).toBeNull();
  });

  it('a tree offers "Chặt cây" priced by the sim: pays the clear cost, gains the wood reward', () => {
    const s = world(), tree = editableEnv(s, 'tree')!;
    const info = describeFocus(s, { kind: 'env', id: tree.id, cell: tree.cell })!;
    const clear = info.actions.find(a => a.kind === 'command')!;
    expect(clear.label).toBe('Chặt cây');
    expect(info.actions.some(a => a.kind === 'tool' && a.tool === 'clear')).toBe(true);
    if (clear.kind !== 'command') throw new Error('expected a command');
    const outcome = actionOutcome(s, command(s, clear.type, clear.payload), NOW);
    expect(outcome.valid).toBe(true);
    expect(outcome.text).toContain(`+${economy.clear.tree.reward.wood} gỗ`);
    expect(outcome.text).toContain('−');
  });

  it('rocks offer "Đập đá" and pay out stone', () => {
    const s = world(), rock = editableEnv(s, 'rock');
    if (!rock) return; // the small test template may scatter no rock in the start zones
    const info = describeFocus(s, { kind: 'env', id: rock.id, cell: rock.cell })!;
    const clear = info.actions[0]!;
    if (clear.kind !== 'command') throw new Error('expected a command');
    expect(['Đập đá', 'Đập đá lớn']).toContain(clear.label);
    expect(actionOutcome(s, command(s, clear.type, clear.payload), NOW).text).toMatch(/\+\d+ đá/);
  });

  it('a road offers higher tiers for this map and a guarded removal; a cleared object closes the panel', () => {
    const s = world(), road = s.roadTier.findIndex(tier => tier === 1);
    const cell: Cell = [road % 128, Math.floor(road / 128)];
    const info = describeFocus(s, { kind: 'road', cell })!;
    const labels = info.actions.map(a => a.label);
    expect(labels).toContain('Xóa đường');
    for (const tier of [2, 3] as const) {
      expect(labels.includes(tier === 2 ? 'Nâng lên Đường lát đá' : 'Nâng lên Đường nhựa')).toBe(economy.roadTiers[tier].mapKinds.includes('farm'));
    }
    expect(info.actions.find(a => a.label === 'Xóa đường')).toMatchObject({ danger: true });
    const tree = editableEnv(s, 'tree')!;
    s.snapshot.delta.removedEnvIds.push(tree.id);
    expect(describeFocus(s, { kind: 'env', id: tree.id, cell: tree.cell })).toBeNull();
    s.roadTier[cellIndex(...cell)] = 0;
    expect(describeFocus(s, { kind: 'road', cell })).toBeNull();
  });

  it('a growing crop shows the time left; a ripe one can be harvested into storage', () => {
    const s = world(), i = s.surface.findIndex((surface, k) => surface === Surface.GRASS && !s.occupancy.has(k) && isUnlocked(s, [k % 128, Math.floor(k / 128)]));
    const cell: Cell = [i % 128, Math.floor(i / 128)];
    s.surface[i] = Surface.TILLED;
    s.snapshot.crops.push({ cell, cropId: 'veg_greens', plantedAt: 0, readyAt: NOW + 90_000 });
    s.occupancy.set(i, `crop:${i}`);
    expect(describeFocus(s, { kind: 'crop', cell })!.status).toMatch(/^Còn /);
    s.snapshot.crops[s.snapshot.crops.length - 1]!.readyAt = NOW - 1;
    const info = describeFocus(s, { kind: 'crop', cell })!, harvest = info.actions[0]!;
    expect(info.status).toBe('Đã chín, thu hoạch được');
    if (harvest.kind !== 'command') throw new Error('expected a command');
    const outcome = actionOutcome(s, command(s, harvest.type, harvest.payload), NOW);
    expect(outcome.valid).toBe(true);
    expect(outcome.text).toMatch(/^\+\d+ /);
  });
});
