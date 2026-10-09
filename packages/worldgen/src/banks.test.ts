import { describe, expect, it } from 'vitest';
import { WorldTemplateSchema, type Cell } from '@xay-nha/contracts';
import { createTestTemplate, decodeLayers, encodeLayers, rasterizeWater, validateTemplate } from './index';
import { createState } from '../../sim/src/state';
import { isFarBank } from '../../sim/src/common';

function joinedBanks() {
  const template = createTestTemplate();
  template.water.rivers[0]!.centerlineXZ = [[124, 80], [124, 180]];
  const layers = decodeLayers(template), water = rasterizeWater(template.water);
  layers.surface.forEach((surface, i) => { if (surface === 7) layers.surface[i] = 0; if (water[i]) layers.surface[i] = 7; });
  layers.heightsDm.fill(50);
  for (let z = 0; z <= 128; z++) for (let x = 0; x <= 128; x++) {
    const adjacent: number[] = [];
    for (const cz of [z - 1, z]) for (const cx of [x - 1, x]) if (cx >= 0 && cx < 128 && cz >= 0 && cz < 128) adjacent.push(water[cz * 128 + cx]!);
    if (adjacent.some(Boolean)) layers.heightsDm[z * 129 + x] = adjacent.every(Boolean) ? 15 : 35;
  }
  template.layers = encodeLayers(layers);
  const region = (x0: number, x1: number): Cell[] => Array.from({ length: 32 }, (_, z) => Array.from({ length: x1 - x0 + 1 }, (_, x) => [x0 + x, 48 + z] as Cell)).flat();
  template.bankRegions = [{ id: 'home', cells: region(64, 79) }, { id: 'far', cells: region(48, 59) }];
  return template;
}
describe('authored bank regions', () => {
  it('accepts valid authored dry regions and preserves optional backwards compatibility', () => {
    expect(validateTemplate(joinedBanks())).toEqual([]);
    expect(WorldTemplateSchema.safeParse(createTestTemplate()).success).toBe(true);
  });
  it('rejects duplicate region ID and duplicate cells within/across regions', () => {
    const template = joinedBanks(); template.bankRegions![1]!.id = 'home';
    template.bankRegions![0]!.cells.push([64, 48]); template.bankRegions![1]!.cells.push([64, 48]);
    const errors = validateTemplate(template);
    expect(errors.some(error => error.includes('duplicate ID'))).toBe(true);
    expect(errors.filter(error => error.includes('overlapping cell')).length).toBeGreaterThanOrEqual(2);
  });
  it('rejects water cells, out-of-bounds cells and missing ENTRY region', () => {
    const template = joinedBanks(); template.bankRegions![0]!.cells = [[60, 60]];
    expect(validateTemplate(template).some(error => error.includes('water cell'))).toBe(true);
    expect(validateTemplate(template).some(error => error.includes('ENTRY outside'))).toBe(true);
    template.bankRegions![0]!.cells = [[128, 60]];
    expect(validateTemplate(template).length).toBeGreaterThan(0);
  });
  it('awards far-bank evidence via completed bridge even when dry banks connect around river ends', () => {
    const template = joinedBanks(), s = createState(template, 1000000);
    const footprint: Cell[] = [[55, 74], [56, 74]];
    expect(isFarBank(s, footprint)).toBe(false);
    s.snapshot.bridges.push({ id: 'br_test', typeId: 'bridge_wood', a: [59, 74], b: [64, 74], deckHeightDm: 35,
      placedAt: 0, buildEndsAt: 1000000, status: 'CONSTRUCTING', cashPaid: 320, materialsPaid: { cash: 320, wood: 20, stone: 0 }, investedValue: 620 });
    expect(isFarBank(s, footprint)).toBe(false); s.snapshot.bridges[0]!.status = 'ACTIVE';
    expect(isFarBank(s, footprint)).toBe(true);
    expect(isFarBank(s, [[70, 74]])).toBe(false); expect(isFarBank(s, [[55, 74], [70, 74]])).toBe(false);
    delete template.bankRegions;
    expect(isFarBank(s, footprint)).toBe(false);
  });
});
