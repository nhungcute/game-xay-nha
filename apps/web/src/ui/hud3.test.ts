import { describe, expect, it } from 'vitest';
import { catalog, economy } from '@xay-nha/content';
import { createTestTemplate } from '@xay-nha/worldgen';
import { createState, recompute } from '@xay-nha/sim';
import { CATEGORIES, buildingCategory, categoryOf, categoryTools } from './CategoryBar';
import { clockIcon, notifications, playerTitle } from './TopBar';

describe('reference HUD logic', () => {
  it('clock icon follows the scene lighting (forced day/night included), falling back to the server hour', () => {
    expect(clockIcon(13, 1)).toBe('moon'); // "Luôn ban đêm" at 13:00
    expect(clockIcon(22, 0)).toBe('sun');  // "Luôn ban ngày" at 22:00
    expect(clockIcon(18, 0.4)).toBe('sun'); expect(clockIcon(18, 0.6)).toBe('moon');
    expect(clockIcon(13)).toBe('sun'); expect(clockIcon(23)).toBe('moon'); expect(clockIcon(20)).toBe('sun'); expect(clockIcon(5)).toBe('moon');
  });
  it('player titles climb with level, per map', () => {
    expect(playerTitle('city', 1)).toBe('Người lập làng');
    expect(playerTitle('city', 12)).toBe('Thị trưởng');
    expect(playerTitle('farm', 20)).toBe('Lão nông huyền thoại');
  });
  it('every building lands in exactly one bar category, and every category has something on each map that shows it', () => {
    for (const def of Object.values(catalog.buildings)) expect(CATEGORIES.map(c => c.id)).toContain(buildingCategory(def));
    expect(buildingCategory(catalog.buildings.house_small!)).toBe('buildings');
    expect(buildingCategory(catalog.buildings.chicken_coop!)).toBe('farms');
    expect(buildingCategory(catalog.buildings.deco_park!)).toBe('decorations');
    expect(buildingCategory(catalog.buildings.bank!)).toBe('utilities');
    // D037: landmark buildings always map to 'buildings' despite having decor properties
    expect(buildingCategory(catalog.buildings.landmark_palace!)).toBe('buildings');
    expect(buildingCategory(catalog.buildings.landmark_castle!)).toBe('buildings');
    expect(buildingCategory(catalog.buildings.landmark_culture!)).toBe('buildings');
    for (const kind of ['city', 'farm'] as const) for (const c of CATEGORIES.filter(c => !c.farmOnly || kind === 'farm')) {
      const buildings = Object.values(catalog.buildings).filter(d => d.mapKinds.includes(kind) && buildingCategory(d) === c.id);
      expect(buildings.length + categoryTools(c.id).length, `${kind}/${c.id}`).toBeGreaterThan(0);
    }
  });
  it('maps chosen tools back to their category (for the highlighted bar button)', () => {
    expect(categoryOf('clear', 'x')).toBe('nature');
    expect(categoryOf('bridge', 'x')).toBe('roads');
    expect(categoryOf('build', 'market')).toBe('buildings');
    expect(categoryOf('build', 'deco_flowerbed')).toBe('decorations');
    expect(categoryOf('explore', 'x')).toBeNull();
  });
  it('notifications: ripe crops and finished constructions are reported, nothing when idle', () => {
    const s = createState(createTestTemplate('farm'), 1_000_000); recompute(s);
    expect(notifications(s)).toEqual(expect.not.arrayContaining([expect.stringContaining('chín')]));
    s.snapshot.crops.push({ cell: [70, 70], cropId: 'veg_greens', plantedAt: 0, readyAt: 1 });
    s.snapshot.buildings.push({ id: 'b_1', defId: 'farmhouse', anchor: [72, 50], rotation: 0, status: 'CONSTRUCTING', placedAt: 0, buildEndsAt: 1,
      cashPaid: 500, materialsPaid: { cash: 500, wood: 10, stone: 5 }, investedValue: 750 });
    const notes = notifications(s);
    expect(notes.some(n => n.includes('chín'))).toBe(true);
    expect(notes.some(n => n.includes('xây xong'))).toBe(true);
    void economy;
  });
});
