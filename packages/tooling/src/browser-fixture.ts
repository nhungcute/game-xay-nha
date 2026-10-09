import { CellFlag, GRID, Surface, cellIndex, type EnvInstance, type MapKind, type WorldTemplate } from '@xay-nha/contracts';
import { createTestTemplate, decodeLayers, generateEnvironment, generateZone, validateTemplate } from '@xay-nha/worldgen';

function canonicalEnvironment(env: EnvInstance[]): EnvInstance[] {
  return [...env].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function assertEnvironment(template: WorldTemplate, env: EnvInstance[]): void {
  const layers = decodeLayers(template), ids = new Set<string>(), occupied = new Set<number>();
  for (const instance of env) {
    if (ids.has(instance.id)) throw new Error(`Duplicate environment ID: ${instance.id}`);
    ids.add(instance.id);
    if (!instance.blocking) continue;
    for (let z = 0; z < instance.footprint; z++) for (let x = 0; x < instance.footprint; x++) {
      const cx = instance.cell[0] + x, cz = instance.cell[1] + z;
      if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID) throw new Error(`Out-of-bounds environment: ${instance.id}`);
      const index = cellIndex(cx, cz);
      if (layers.surface[index] === Surface.WATER || layers.roadTier[index] || (layers.flags[index]! & CellFlag.ENTRY)) {
        throw new Error(`Environment on water, road or entry: ${instance.id}`);
      }
      if (occupied.has(index)) throw new Error(`Environment collision: ${instance.id}`);
      occupied.add(index);
    }
  }
}

/** Run the same pure fixture in actual browser JavaScript and Node bundles. */
export function runWorldgenFixture() {
  const cases: { mapKind: MapKind; seed: number; generatorVersion: string; environment: EnvInstance[] }[] = [];
  const zoneOrderCases: { mapKind: MapKind; count: number; equal: boolean }[] = [];
  for (const mapKind of ['city', 'farm'] as const) {
    for (const seed of [0, 1, 20261009, 0xffffffff]) for (const generatorVersion of ['veg-1.0.0', 'veg-1.0.1']) {
      const template = createTestTemplate(mapKind);
      template.seed = seed;
      template.generatorVersion = generatorVersion;
      const errors = validateTemplate(template);
      if (errors.length) throw new Error(`Invalid ${mapKind} fixture: ${errors.join('; ')}`);
      const environment = canonicalEnvironment(generateEnvironment(template));
      assertEnvironment(template, environment);
      cases.push({ mapKind, seed, generatorVersion, environment });
      if (seed === 20261009 && generatorVersion === 'veg-1.0.0') {
        const reversed = canonicalEnvironment(Array.from({ length: 64 }, (_, index) => generateZone(template, 63 - index)).flat());
        const equal = JSON.stringify(environment) === JSON.stringify(reversed);
        if (!equal) throw new Error(`Zone generation order changes ${mapKind} environment`);
        zoneOrderCases.push({ mapKind, count: environment.length, equal });
      }
    }
  }
  return { fixtureVersion: 1, cases, zoneOrderCases };
}
