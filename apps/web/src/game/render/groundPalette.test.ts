import { readFileSync } from 'node:fs';
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { GRID, Surface, WorldTemplateSchema, cellIndex } from '@xay-nha/contracts';
import { createState, type SimState } from '@xay-nha/sim';
import { GROUND, groundColors, waterDistance } from './groundPalette';

const load = (mapId: string): SimState => createState(WorldTemplateSchema.parse(JSON.parse(
  readFileSync(new URL(`../../../public/worlds/${mapId}/template.v2.json`, import.meta.url), 'utf8'))), 1_000_000);
const colorAt = (c: Float32Array, i: number) => new Color(c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!);
/** Green dominance: >0 reads as grass, ≤0 as earth/sand/rock. */
const greenness = (c: Color) => c.g - Math.max(c.r, c.b);

describe('natural ground palette (G3 map art request)', () => {
  for (const mapId of ['city-coast-01', 'farm-valley-01']) it(`${mapId}: grass is broken into earthy, shore and rock patches, not one flat green`, () => {
    const s = load(mapId), colors = groundColors(s, new Float32Array(GRID * GRID * 3)), dist = waterDistance(s.surface);
    expect(groundColors(s, new Float32Array(GRID * GRID * 3))).toEqual(colors); // deterministic
    let grass = 0, earthy = 0, shoreSum = 0, shoreN = 0, farSum = 0, farN = 0;
    const hues = new Set<number>();
    for (let i = 0; i < GRID * GRID; i++) {
      if (s.surface[i] !== Surface.GRASS) continue;
      const c = colorAt(colors, i), g = greenness(c); grass++;
      earthy += Number(g < 0.02);
      hues.add(Math.round(c.getHSL({ h: 0, s: 0, l: 0 }).h * 36));
      if (dist[i] === 1) { shoreSum += g; shoreN++; } else if (dist[i]! > 4) { farSum += g; farN++; }
    }
    // A visible but minority share of open ground is earth-toned; several hue bands are present.
    expect(earthy / grass).toBeGreaterThan(0.05);
    expect(earthy / grass).toBeLessThan(0.45);
    expect(hues.size).toBeGreaterThanOrEqual(5);
    // Banks are browner (alluvial/sand) than ground away from water.
    expect(shoreSum / shoreN).toBeLessThan(farSum / farN);
  });
  it('only tints grass: tilled fields, roads and foundations keep their gameplay colours; rules data is untouched', () => {
    const s = load('farm-valley-01'), surface = s.surface.slice(), heights = s.heights.slice();
    const cells = [cellIndex(70, 80), cellIndex(71, 80), cellIndex(72, 80)];
    s.surface[cells[0]!] = Surface.TILLED; s.surface[cells[1]!] = Surface.ROAD; s.surface[cells[2]!] = Surface.FOUNDATION;
    const colors = groundColors(s, new Float32Array(GRID * GRID * 3));
    const base = [new Color('#765136'), new Color('#b49363'), new Color('#b5a68a')];
    cells.forEach((cell, n) => {
      const c = colorAt(colors, cell), ratio = c.r / base[n]!.r;
      expect(ratio).toBeGreaterThan(0.95); expect(ratio).toBeLessThan(1.05);
      expect(c.g / base[n]!.g).toBeCloseTo(ratio, 5);
    });
    expect(s.heights).toEqual(heights);
    expect([...s.surface].filter((v, i) => !cells.includes(i) && v !== surface[i])).toHaveLength(0);
  });
  it('rocky-hill biome leans grey (lower saturation than open grass)', () => {
    const s = load('city-coast-01'), colors = groundColors(s, new Float32Array(GRID * GRID * 3));
    const mean = (biome: number) => {
      let n = 0, sum = 0;
      for (let i = 0; i < GRID * GRID; i++) if (s.surface[i] === Surface.GRASS && s.biome[i] === biome) { sum += colorAt(colors, i).getHSL({ h: 0, s: 0, l: 0 }).s; n++; }
      return n ? sum / n : NaN;
    };
    // Rock is low-saturation grey; rocky cells are less saturated than plain grass.
    if (s.biome.includes(2)) expect(mean(2)).toBeLessThan(mean(0));
    expect(GROUND.rock.getHSL({ h: 0, s: 0, l: 0 }).s).toBeLessThan(GROUND.greenLush.getHSL({ h: 0, s: 0, l: 0 }).s / 2); // warm grey
  });
});
