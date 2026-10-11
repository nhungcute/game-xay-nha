import { describe, expect, it } from 'vitest';
import { createTestTemplate } from '@xay-nha/worldgen';
import { createState } from '@xay-nha/sim';
import { maxBatches } from './BuildingPanel';
import { unlocksAt } from './LevelUp';

describe('G4 review fixes', () => {
  it('level-up lists what opens at that level', () => {
    expect(unlocksAt('city', 3)).toEqual(expect.arrayContaining(['Kè bờ']));
    expect(unlocksAt('city', 4)).toEqual(expect.arrayContaining(['Cầu gỗ', 'Đường lát đá']));
    expect(unlocksAt('city', 5)).toEqual(expect.arrayContaining(['Đội thợ thứ 3']));
    expect(unlocksAt('farm', 3).some(item => item.includes('thứ 2'))).toBe(true); // second farmhouse
    expect(unlocksAt('farm', 2).some(item => item.startsWith('Giống'))).toBe(true);
    expect(unlocksAt('city', 1)).not.toContain('Đội thợ thứ 2');
  });
  it('max production batches = free queue room limited by stored inputs', () => {
    const s = createState(createTestTemplate('farm'), 1_000_000);
    const coop = { id: 'b_c', defId: 'chicken_coop', anchor: [72, 70] as [number, number], rotation: 0 as const, status: 'ACTIVE' as const,
      placedAt: 0, buildEndsAt: 0, cashPaid: 0, materialsPaid: { cash: 0, wood: 0, stone: 0 }, investedValue: 0 };
    expect(maxBatches(s, coop, 'chicken_coop')).toBe(0);
    s.snapshot.inventory.corn = 3;
    expect(maxBatches(s, coop, 'chicken_coop')).toBe(3);
    s.snapshot.inventory.corn = 500;
    expect(maxBatches(s, coop, 'chicken_coop')).toBeGreaterThan(3);
    expect(maxBatches(s, coop, 'chicken_coop')).toBeLessThan(500);
  });
});
