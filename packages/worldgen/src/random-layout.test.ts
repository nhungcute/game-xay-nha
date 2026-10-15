import { describe, expect, it } from 'vitest';
import { generateRandomLayout, checkPlayability, generateWorldTemplate } from './random-layout';
import { rasterizeWater } from './geometry';
import { validateTemplate } from './validator';

describe('D039 Random Layout and Playability', () => {
  it('generates deterministic layout with empty roads and empty entryCells', () => {
    const layout1 = generateRandomLayout('city', 12345, 0);
    const layout2 = generateRandomLayout('city', 12345, 0);
    expect(layout1).toEqual(layout2);
    expect(layout1.roads).toEqual([]);
    expect(layout1.entryCells).toEqual([]);
  });

  it('generates a playable city template that passes validateTemplate and checkPlayability', () => {
    const { template, attempt } = generateWorldTemplate('city', 20261014);
    expect(attempt).toBeLessThan(50);
    expect(validateTemplate(template)).toEqual([]);
    expect(checkPlayability(template)).toEqual([]);
  });

  it('generates a playable farm template that passes validateTemplate and checkPlayability', () => {
    const { template, attempt } = generateWorldTemplate('farm', 20261014);
    expect(attempt).toBeLessThan(50);
    expect(validateTemplate(template)).toEqual([]);
    expect(checkPlayability(template)).toEqual([]);
  });

  it.each(['city', 'farm'] as const)('%s: water is centred on 20% and rivers meander without hard corners', kind => {
    for (const seed of [20260000, 20260001, 20260002]) {
      const layout = generateRandomLayout(kind, seed, 0);
      const water = rasterizeWater(layout.water);
      let cells = 0;
      for (const w of water) if (w) cells++;
      expect(cells / 163.84).toBeGreaterThanOrEqual(19.9);
      expect(cells / 163.84).toBeLessThanOrEqual(20.25);
      for (const river of layout.water.rivers) {
        const c = river.centerlineXZ;
        let worst = 0;
        for (let i = 2; i < c.length; i++) {
          const a1 = Math.atan2(c[i - 1]![1] - c[i - 2]![1], c[i - 1]![0] - c[i - 2]![0]), a2 = Math.atan2(c[i]![1] - c[i - 1]![1], c[i]![0] - c[i - 1]![0]);
          let d = Math.abs(a2 - a1) * 180 / Math.PI;
          if (d > 180) d = 360 - d;
          worst = Math.max(worst, d);
        }
        expect(worst).toBeLessThan(50); // ~6 m steps: no hard corner
      }
    }
  });

  it('is stored as template version 1 with the current generator version', () => {
    const { template } = generateWorldTemplate('farm', 777);
    expect(template.templateVersion).toBe(1);
    expect(template.mapId).toBe('rnd-farm-777');
  });
});
