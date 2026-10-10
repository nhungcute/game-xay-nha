import { Color } from 'three';
import { GRID, Surface, cellIndex, vertIndex } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';

/**
 * Display-only natural ground tint per cell (user request G3-map-art-request.md; docs/03, docs/04 §3, docs/07).
 * Grass is broken into soft, terrain-driven patches: several greens, warm dry-earth patches, light alluvial
 * soil and sand along water, grey rock on rocky hills and steep slopes, darker green under forest.
 * Reads only surface/biome/height data; never changes rules, surfaces or the template.
 */
export const GROUND = {
  greenDeep: new Color('#5e9142'), greenLush: new Color('#79a951'), greenDry: new Color('#9bae5a'),
  forest: new Color('#557c3b'), dryEarth: new Color('#a88a5c'), alluvial: new Color('#ae9768'),
  sand: new Color('#cdb784'), rock: new Color('#8e877a'),
} as const;
const BASE = ['#79a951', '#a9875a', '#d3be82', '#88877a', '#765136', '#b49363', '#b5a68a', '#616e54'].map(c => new Color(c));
const SHORE_CELLS = 4, BIOME_FOREST = 1, BIOME_ROCKY = 2;

const smooth = (t: number) => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, v: number) => smooth(Math.min(1, Math.max(0, (v - a) / (b - a))));
function lattice(seed: number, x: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in [0,1]; `period` in cells. */
function valueNoise(seed: number, x: number, z: number, period: number): number {
  const fx = x / period, fz = z / period, ix = Math.floor(fx), iz = Math.floor(fz), tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = lattice(seed, ix, iz), b = lattice(seed, ix + 1, iz), c = lattice(seed, ix, iz + 1), d = lattice(seed, ix + 1, iz + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}
const fbm = (seed: number, x: number, z: number, period: number) =>
  valueNoise(seed, x, z, period) * 0.65 + valueNoise(seed + 101, x, z, period / 2.7) * 0.35;

/** Breadth-first distance (cells, 4-neighbour) to the nearest WATER cell, capped. */
export function waterDistance(surface: Uint8Array, cap = SHORE_CELLS + 1): Uint8Array {
  const dist = new Uint8Array(GRID * GRID).fill(cap), queue: number[] = [];
  for (let i = 0; i < surface.length; i++) if (surface[i] === Surface.WATER) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % GRID, z = (i - x) / GRID, next = dist[i]! + 1;
    if (next >= cap) continue;
    for (const [nx, nz] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]] as const) {
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
      const j = cellIndex(nx, nz);
      if (dist[j]! > next) { dist[j] = next; queue.push(j); }
    }
  }
  return dist;
}

/** RGB triplets (linear, as THREE.Color stores them) for every cell. */
export function groundColors<T extends Float32Array>(s: SimState, out: T): T {
  const seed = s.template.seed | 0, water = s.template.waterLevelDm, dist = waterDistance(s.surface), c = new Color();
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const i = cellIndex(x, z), surface = s.surface[i] ?? Surface.GRASS;
    c.copy(BASE[surface] ?? BASE[0]!);
    if (surface === Surface.GRASS) {
      const h = [s.heights[vertIndex(x, z)]!, s.heights[vertIndex(x + 1, z)]!, s.heights[vertIndex(x, z + 1)]!, s.heights[vertIndex(x + 1, z + 1)]!];
      const slope = Math.max(...h) - Math.min(...h), mean = (h[0]! + h[1]! + h[2]! + h[3]!) / 4, d = dist[i]!;
      // Several greens in broad patches.
      const hue = fbm(seed, x, z, 22);
      c.copy(GROUND.greenDeep).lerp(GROUND.greenLush, smoothstep(0.2, 0.5, hue)).lerp(GROUND.greenDry, smoothstep(0.55, 0.85, hue));
      if (s.biome[i] === BIOME_FOREST) c.lerp(GROUND.forest, 0.45);
      // Warm dry-earth patches on open, higher ground, away from water.
      const shore = d < SHORE_CELLS ? 1 - d / SHORE_CELLS : 0;
      const dry = smoothstep(0.6, 0.78, fbm(seed + 7, x, z, 15)) * (1 - shore) * (0.75 + 0.25 * smoothstep(water + 10, water + 40, mean));
      c.lerp(GROUND.dryEarth, dry * 0.8);
      // Light alluvial soil along streams and lakes, sandy right at the water's edge.
      if (shore > 0) {
        c.lerp(GROUND.alluvial, shore * (0.45 + 0.3 * valueNoise(seed + 13, x, z, 6)));
        if (d === 1) c.lerp(GROUND.sand, 0.35);
      }
      // Grey rock on rocky hills and steep slopes.
      const rocky = Math.max(s.biome[i] === BIOME_ROCKY ? 0.35 + 0.35 * valueNoise(seed + 29, x, z, 5) : 0, smoothstep(6, 16, slope) * 0.65);
      c.lerp(GROUND.rock, rocky);
    }
    // Small per-cell grain so even flat areas are not a single flat colour.
    const grain = 0.96 + lattice(seed + 3, x, z) * 0.08;
    out[i * 3] = c.r * grain; out[i * 3 + 1] = c.g * grain; out[i * 3 + 2] = c.b * grain;
  }
  return out;
}
