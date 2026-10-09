import { describe, expect, it } from 'vitest';
import { CellFlag, Surface } from '@xay-nha/contracts';
import { decodeLayers, generateEnvironment, validateTemplate } from '@xay-nha/worldgen';
import { createG1FarmLayout } from './g1-layout';
import { buildTemplate } from './template';

describe('provisional G1 Farm authoring', () => {
  it('builds real river/lakes/waterfall with untouched terrain and dry ENTRY path', () => {
    const template = buildTemplate(createG1FarmLayout()), layers = decodeLayers(template);
    expect(validateTemplate(template)).toEqual([]); expect(template.water.lakes).toHaveLength(2);
    expect(template.water.waterfalls).toHaveLength(1); expect(template.bankRegions).toHaveLength(2);
    expect(layers.surface.includes(Surface.TILLED)).toBe(false); expect(layers.surface.includes(Surface.FOUNDATION)).toBe(false);
    expect(layers.flags.some(flag => (flag & CellFlag.EMBANKED) !== 0)).toBe(false);
    expect(layers.roadTier.some(tier => tier > 1)).toBe(false);
    expect(Math.max(...layers.heightsDm) - Math.min(...layers.heightsDm)).toBeGreaterThan(100);
    expect(generateEnvironment(template).length).toBeGreaterThan(100);
  });
  it('builds deterministically and refuses water-crossing authored roads', () => {
    const layout = createG1FarmLayout(); expect(buildTemplate(layout)).toEqual(buildTemplate(layout));
    layout.roads[0]!.push([60, 74]); expect(() => buildTemplate(layout)).toThrow('overlaps water');
  });
  it('rejects authored region water overlaps before exporting a map', () => {
    const layout = createG1FarmLayout(); layout.bankRegions![0]!.cells.push([60, 74]);
    expect(() => buildTemplate(layout)).toThrow('water cell');
  });
});
