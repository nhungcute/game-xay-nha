import {
  CellFlag, GRID, Surface, VERTS, ZONE_CELLS, cellIndex, vertIndex, zoneOf,
  decodeInt16, decodeUint8, encodeInt16, encodeUint8,
  type Cell, type EnvInstance, type WorldSnapshot, type WorldTemplate,
} from '@xay-nha/contracts';
import { catalog, economy } from '@xay-nha/content';
import { footprintCells } from './footprint';

export interface SimState {
  template: WorldTemplate;
  snapshot: WorldSnapshot;
  heights: Int16Array;
  surface: Uint8Array;
  flags: Uint8Array;
  roadTier: Uint8Array;
  biome: Uint8Array;
  occupancy: Map<number, string>;
  env: EnvInstance[];
  connected: Uint8Array;
  rates: Record<string, number>;
  baseRoadTier: Uint8Array;
}

export function createState(template: WorldTemplate, now: number, env = template.env.anchors,
  identity = { worldId: 'world-test', accountId: 'account-test', displayName: 'Người chơi', tag: '0001' }): SimState {
  const s: SimState = {
    template,
    snapshot: {
      schemaVersion: 1, worldId: identity.worldId, accountId: identity.accountId, mapId: template.mapId, mapKind: template.mapKind,
      seed: template.seed, generatorVersion: template.generatorVersion,
      templateVersion: template.templateVersion, contentVersion: economy.contentVersion,
      revision: 0, serverTime: now,
      character: { displayName: identity.displayName, tag: identity.tag, createdAt: now, netWorth: 0 },
      wallet: { cash: economy.start.cash, wood: economy.start.wood, stone: economy.start.stone },
      progress: { level: economy.start.level, xp: economy.start.xp, questIndex: 0, questProgress: {}, tutorialDone: false },
      unlockedZones: [...template.startZones], landValue: 0,
      delta: { zones: {}, removedEnvIds: [] }, buildings: [], bridges: [], crops: [], inventory: {},
    },
    heights: decodeInt16(template.layers.heightsDm, VERTS * VERTS),
    surface: decodeUint8(template.layers.surface, GRID * GRID),
    flags: decodeUint8(template.layers.flags, GRID * GRID),
    roadTier: decodeUint8(template.layers.roadTier, GRID * GRID),
    biome: decodeUint8(template.layers.biome, GRID * GRID),
    env: env.map(o => ({ ...o, cell: [...o.cell] })),
    occupancy: new Map(), connected: new Uint8Array(GRID * GRID), rates: {},
    baseRoadTier: decodeUint8(template.layers.roadTier, GRID * GRID),
  };
  rebuildOccupancy(s);
  s.snapshot.character.netWorth = economy.start.cash + economy.start.wood * economy.materialPrices.wood + economy.start.stone * economy.materialPrices.stone;
  return s;
}

export function cloneState(s: SimState): SimState {
  return {
    ...s, snapshot: JSON.parse(JSON.stringify(s.snapshot)) as WorldSnapshot,
    heights: s.heights.slice(), surface: s.surface.slice(), flags: s.flags.slice(),
    roadTier: s.roadTier.slice(), biome: s.biome.slice(), occupancy: new Map(s.occupancy),
    connected: s.connected.slice(), rates: { ...s.rates },
  };
}

export const inBounds = ([x, z]: Cell): boolean => Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < GRID && z < GRID;
export function neighbors([x, z]: Cell): Cell[] {
  return ([[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]] as Cell[]).filter(inBounds);
}
export const corners = ([x, z]: Cell): number[] => [vertIndex(x, z), vertIndex(x + 1, z), vertIndex(x, z + 1), vertIndex(x + 1, z + 1)];
export const slope = (s: SimState, c: Cell): number => {
  const hs = corners(c).map(i => s.heights[i]!);
  return Math.max(...hs) - Math.min(...hs);
};
export const meanHeight = (s: SimState, c: Cell): number => corners(c).reduce((v, i) => v + s.heights[i]!, 0) / 4;
export const isShore = (s: SimState, c: Cell): boolean => s.surface[cellIndex(...c)] !== Surface.WATER && neighbors(c).some(n => s.surface[cellIndex(...n)] === Surface.WATER);
export const isUnlocked = (s: SimState, c: Cell): boolean => inBounds(c) && s.snapshot.unlockedZones.includes(zoneOf(...c));

export function rebuildOccupancy(s: SimState): string[] {
  const errors: string[] = [];
  s.occupancy.clear();
  const occupy = (id: string, cells: Cell[]) => {
    for (const c of cells) {
      if (!inBounds(c)) { errors.push(`BOUNDS:${id}`); continue; }
      const i = cellIndex(...c);
      if (s.occupancy.has(i)) errors.push(`OVERLAP:${id}:${s.occupancy.get(i)}`);
      else s.occupancy.set(i, id);
    }
  };
  const removed = new Set(s.snapshot.delta.removedEnvIds);
  for (const e of s.env) if (e.blocking && !removed.has(e.id)) {
    const cells: Cell[] = [];
    for (let z = 0; z < e.footprint; z++) for (let x = 0; x < e.footprint; x++) cells.push([e.cell[0] + x, e.cell[1] + z]);
    occupy(e.id, cells);
  }
  for (const b of s.snapshot.buildings) {
    const def = catalog.buildings[b.defId];
    if (!def) { errors.push(`REFERENCE:${b.id}`); continue; }
    occupy(b.id, footprintCells(def, b.anchor, b.rotation));
  }
  for (const crop of s.snapshot.crops) occupy(`crop:${cellIndex(...crop.cell)}`, [crop.cell]);
  for (const bridge of s.snapshot.bridges) occupy(bridge.id, bridgeCells(bridge.a, bridge.b));
  return errors;
}

export function bridgeCells(a: Cell, b: Cell): Cell[] {
  if (a[0] !== b[0] && a[1] !== b[1]) return [];
  const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
  const length = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  return Array.from({ length: Math.max(0, length - 1) }, (_, i) => [a[0] + dx * (i + 1), a[1] + dz * (i + 1)] as Cell);
}

export function writeDeltas(s: SimState): number[] {
  const changed: number[] = [];
  const base = {
    heights: decodeInt16(s.template.layers.heightsDm, VERTS * VERTS),
    surface: decodeUint8(s.template.layers.surface, GRID * GRID),
    flags: decodeUint8(s.template.layers.flags, GRID * GRID),
    roadTier: decodeUint8(s.template.layers.roadTier, GRID * GRID),
  };
  for (let zone = 0; zone < 64; zone++) {
    const ox = zone % 8 * ZONE_CELLS, oz = Math.floor(zone / 8) * ZONE_CELLS;
    const hs = new Int16Array(17 * 17), surface = new Uint8Array(256), flags = new Uint8Array(256), roads = new Uint8Array(256);
    let dirty = false;
    for (let z = 0; z <= ZONE_CELLS; z++) for (let x = 0; x <= ZONE_CELLS; x++) {
      const i = vertIndex(ox + x, oz + z); hs[z * 17 + x] = s.heights[i]!;
      dirty ||= hs[z * 17 + x] !== base.heights[i];
    }
    for (let z = 0; z < ZONE_CELLS; z++) for (let x = 0; x < ZONE_CELLS; x++) {
      const i = cellIndex(ox + x, oz + z), j = z * 16 + x;
      surface[j] = s.surface[i]!; flags[j] = s.flags[i]!; roads[j] = s.roadTier[i]!;
      dirty ||= surface[j] !== base.surface[i] || flags[j] !== base.flags[i] || roads[j] !== base.roadTier[i];
    }
    const key = String(zone);
    const previous = s.snapshot.delta.zones[key];
    if (dirty) {
      const next = { heightsDm: encodeInt16(hs), surface: encodeUint8(surface), flags: encodeUint8(flags), roadTier: encodeUint8(roads) };
      if (JSON.stringify(previous) !== JSON.stringify(next)) changed.push(zone);
      s.snapshot.delta.zones[key] = next;
    } else if (previous) { delete s.snapshot.delta.zones[key]; changed.push(zone); }
  }
  return changed;
}

export function restoreDeltas(s: SimState): string[] {
  const errors: string[] = [], seen = new Map<number, number>();
  for (const [key, delta] of Object.entries(s.snapshot.delta.zones)) {
    const zone = Number(key), ox = zone % 8 * 16, oz = Math.floor(zone / 8) * 16;
    if (!Number.isInteger(zone) || zone < 0 || zone >= 64) { errors.push(`DELTA_ZONE:${key}`); continue; }
    try {
      const hs = decodeInt16(delta.heightsDm, 289), surface = decodeUint8(delta.surface, 256), flags = decodeUint8(delta.flags, 256), roads = decodeUint8(delta.roadTier, 256);
      for (let z = 0; z <= 16; z++) for (let x = 0; x <= 16; x++) {
        const i = vertIndex(ox + x, oz + z), h = hs[z * 17 + x]!;
        if (seen.has(i) && seen.get(i) !== h) errors.push(`SHARED_EDGE:${i}`);
        seen.set(i, h); s.heights[i] = h;
      }
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const i = cellIndex(ox + x, oz + z), j = z * 16 + x;
        s.surface[i] = surface[j]!; s.flags[i] = flags[j]!; s.roadTier[i] = roads[j]!;
      }
    } catch { errors.push(`DELTA_LENGTH:${key}`); }
  }
  return errors;
}

export function affectedVertexCells(i: number): Cell[] {
  const x = i % VERTS, z = Math.floor(i / VERTS);
  return ([[x - 1, z - 1], [x, z - 1], [x - 1, z], [x, z]] as Cell[]).filter(inBounds);
}

export function editable(s: SimState, c: Cell): boolean {
  return isUnlocked(s, c) && !(s.flags[cellIndex(...c)]! & CellFlag.PROTECTED);
}
