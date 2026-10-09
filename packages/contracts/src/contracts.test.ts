import { describe, expect, it } from 'vitest';
import {
  CellSchema, CommandSchema, PlacedBuildingSchema, PlacedBridgeSchema, WorldSnapshotSchema, WorldTemplateSchema,
  decodeInt16, decodeUint8, encodeInt16, encodeUint8,
  GRID, VERTS, type CommandType, type WorldTemplate,
} from './index.js';

function envelope(type: CommandType, payload: unknown): unknown {
  return { commandId: 'c07174e4-bfc8-47e2-a72e-bff02282dc51', worldId: 'world_1', expectedRevision: 0, clientTime: 1000, type, payload };
}

function template(): WorldTemplate {
  return {
    schemaVersion: 1, mapId: 'test', mapKind: 'farm', templateVersion: 1,
    generatorVersion: 'veg-1.0.0', seed: 1, waterLevelDm: 0,
    grid: { size: 128, cellSizeM: 2 },
    layers: {
      heightsDm: encodeInt16(new Int16Array(VERTS * VERTS)),
      surface: encodeUint8(new Uint8Array(GRID * GRID)),
      flags: encodeUint8(new Uint8Array(GRID * GRID)),
      roadTier: encodeUint8(new Uint8Array(GRID * GRID)),
      biome: encodeUint8(new Uint8Array(GRID * GRID)),
    },
    water: { lakes: [], rivers: [], waterfalls: [] },
    startZones: [27, 28, 35, 36], entryCells: [[56, 56]],
    env: { catalogVersion: 1, anchors: [], scatter: [] },
    camera: { target: [128, 0, 128], yawDeg: 45, pitchDeg: 55, distance: 140 },
    palette: { grass: '#7fbf4d' },
  };
}

function snapshot() {
  return {
    schemaVersion: 1, worldId: 'world_1', accountId: 'account_1', mapId: 'test', mapKind: 'farm',
    templateVersion: 1, contentVersion: 1, seed: 1, generatorVersion: 'veg-1.0.0', revision: 0,
    serverTime: 1000, character: { displayName: 'Minh', tag: '1234', createdAt: 1000, netWorth: 2500 },
    wallet: { cash: 2000, wood: 20, stone: 10 },
    progress: { xp: 0, level: 1, questIndex: 0, questProgress: {}, tutorialDone: false },
    unlockedZones: [27, 28, 35, 36], landValue: 0, delta: { zones: {}, removedEnvIds: [] },
    buildings: [], bridges: [], crops: [], inventory: {},
  };
}

describe('strict command contracts', () => {
  it.each([
    ['CLEAR_ENV', { envIds: ['A-1'] }],
    ['TERRAFORM', { rect: [1, 1, 2, 2], mode: 'FLATTEN', targetHDm: 10 }],
    ['TERRAFORM', { rect: [1, 1, 2, 2], mode: 'FLATTEN' }],
    ['TILL', { rect: [1, 1, 2, 2] }], ['UNTILL', { rect: [1, 1, 2, 2] }],
    ['EMBANK', { cells: [[1, 1]] }], ['REMOVE_EMBANK', { cells: [[1, 1]] }],
    ['BUILD_ROAD', { tier: 1, cells: [[1, 1], [2, 1], [2, 2]] }],
    ['REMOVE_ROAD', { cells: [[1, 1]] }],
    ['BUILD_BRIDGE', { typeId: 'bridge_wood', a: [1, 1], b: [4, 1] }],
    ['REMOVE_BRIDGE', { bridgeId: 'br_1' }],
    ['PLACE_BUILDING', { defId: 'farmhouse', anchor: [1, 1], rotation: 1 }],
    ['DEMOLISH', { buildingId: 'b_1' }],
    ['CANCEL_CONSTRUCTION', { buildingId: 'b_1' }], ['SPEED_UP', { bridgeId: 'br_1' }],
    ['COLLECT', { buildingIds: [] }],
    ['PLANT', { rect: [1, 1, 2, 2], cropId: 'rice' }],
    ['HARVEST', { cells: [[1, 1]] }],
    ['START_PRODUCTION', { buildingId: 'b_1', recipeId: 'flour', count: 1 }],
    ['COLLECT_PRODUCTION', { buildingId: 'b_1' }],
    ['SELL', { items: { rice: 2 } }], ['BUY_MATERIAL', { wood: 1 }],
    ['UNLOCK_ZONE', { zoneId: 1 }], ['CLAIM_QUEST', { questId: 'farm_1' }],
  ] as const)('accepts documented %s payload', (type, payload) => {
    expect(CommandSchema.safeParse(envelope(type, payload)).success).toBe(true);
  });

  it.each([
    ['HARVEST', { cells: [[1, 1], [1, 1]] }],
    ['BUILD_ROAD', { tier: 1, cells: [[1, 1], [2, 2]] }],
    ['TILL', { rect: [0, 0, 16, 15] }],
    ['TILL', { rect: [2, 1, 1, 2] }],
    ['PLANT', { rect: [0, 0, 127, 127], cropId: 'rice' }],
    ['TERRAFORM', { rect: [1, 1, 1, 1], mode: 'LOWER', targetHDm: 5 }],
    ['TERRAFORM', { rect: [1, 1, 1, 1], mode: 'FLATTEN', targetHDm: 11 }],
    ['CLEAR_ENV', { envIds: ['A-1', 'A-1'] }],
    ['CANCEL_CONSTRUCTION', { buildingId: 'b_1', bridgeId: 'br_1' }],
    ['CANCEL_CONSTRUCTION', {}],
    ['BUY_MATERIAL', {}], ['BUY_MATERIAL', { wood: -1 }],
    ['SELL', { items: { rice: 0 } }], ['SELL', { items: {} }],
    ['PLACE_BUILDING', { defId: 'house', anchor: [128, 0], rotation: 0 }],
    ['PLACE_BUILDING', { defId: 'house', anchor: [0, 0], rotation: 4 }],
    ['PLACE_BUILDING', { defId: 'house', anchor: [0, 0], rotation: 0, cashPaid: 0 }],
    ['UNLOCK_ZONE', { zoneId: 64 }],
  ] as const)('rejects malformed %s payload', (type, payload) => {
    expect(CommandSchema.safeParse(envelope(type, payload)).success).toBe(false);
  });

  it('accepts exactly 256 cells and rejects 257', () => {
    const cells = Array.from({ length: 256 }, (_, i) => [i % 128, Math.floor(i / 128)]);
    expect(CommandSchema.safeParse(envelope('HARVEST', { cells })).success).toBe(true);
    expect(CommandSchema.safeParse(envelope('HARVEST', { cells: [...cells, [0, 2]] })).success).toBe(false);
  });

  it('rejects client-assigned resource and clock fields', () => {
    const data = envelope('TILL', { rect: [1, 1, 1, 1] }) as Record<string, unknown>;
    expect(CommandSchema.safeParse({ ...data, wallet: { cash: 999 } }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...data, commandId: 'c07174e4-bfc8-17e2-a72e-bff02282dc51' }).success).toBe(false);
    expect(CommandSchema.safeParse({ ...data, clientTime: NaN }).success).toBe(false);
  });

  it('preserves omitted flatten height for simulation to choose the rounded average', () => {
    const parsed = CommandSchema.parse(envelope('TERRAFORM', { rect: [1, 1, 2, 2], mode: 'FLATTEN' }));
    expect(parsed.type).toBe('TERRAFORM');
    if (parsed.type === 'TERRAFORM') expect(parsed.payload.targetHDm).toBeUndefined();
  });
});

describe('template and snapshot schemas', () => {
  it('accepts complete structurally valid records', () => {
    expect(WorldTemplateSchema.safeParse(template()).success).toBe(true);
    expect(WorldSnapshotSchema.safeParse(snapshot()).success).toBe(true);
  });
  it('rejects unknown versions and fields without modifying the supplied object', () => {
    const raw = snapshot();
    const bad = { ...raw, schemaVersion: 2, injected: true };
    const before = JSON.stringify(bad);
    expect(WorldSnapshotSchema.safeParse(bad).success).toBe(false);
    expect(JSON.stringify(bad)).toBe(before);
  });
  it('rejects negative/fractional wallet and duplicate zones', () => {
    const raw = snapshot();
    expect(WorldSnapshotSchema.safeParse({ ...raw, wallet: { ...raw.wallet, cash: 0.5 } }).success).toBe(false);
    expect(WorldSnapshotSchema.safeParse({ ...raw, wallet: { ...raw.wallet, wood: -1 } }).success).toBe(false);
    expect(WorldSnapshotSchema.safeParse({ ...raw, unlockedZones: [27, 27] }).success).toBe(false);
  });
  it('rejects truncated, oversized and noncanonical layer data', () => {
    const raw = template();
    expect(WorldTemplateSchema.safeParse({ ...raw, layers: { ...raw.layers, surface: raw.layers.surface.slice(4) } }).success).toBe(false);
    expect(WorldTemplateSchema.safeParse({ ...raw, layers: { ...raw.layers, surface: raw.layers.surface + 'AAAA' } }).success).toBe(false);
    expect(WorldTemplateSchema.safeParse({ ...raw, layers: { ...raw.layers, surface: raw.layers.surface.slice(0, -4) + 'AB==' } }).success).toBe(false);
  });
  it('rejects rivers with mismatched point/width arrays', () => {
    const raw = template();
    const river = { id: 'r1', centerlineXZ: [[1, 1], [2, 2], [3, 3]], widthM: [1, 1] };
    expect(WorldTemplateSchema.safeParse({ ...raw, water: { ...raw.water, rivers: [river] } }).success).toBe(false);
  });
  it('requires seed and generator identity on snapshots', () => {
    const raw = snapshot();
    expect(WorldSnapshotSchema.safeParse({ ...raw, seed: undefined }).success).toBe(false);
    expect(WorldSnapshotSchema.safeParse({ ...raw, generatorVersion: undefined }).success).toBe(false);
  });
  it('rejects invalid zone delta keys and unknown nested fields', () => {
    const raw = snapshot();
    expect(WorldSnapshotSchema.safeParse({ ...raw, delta: { zones: { 64: {} }, removedEnvIds: [] } }).success).toBe(false);
    expect(WorldSnapshotSchema.safeParse({ ...raw, progress: { ...raw.progress, freeCash: 1 } }).success).toBe(false);
  });
  it.each([[0, 0], [127, 127]])('accepts grid boundary (%s,%s)', (x, z) => {
    expect(CellSchema.safeParse([x, z]).success).toBe(true);
  });
  it.each([[-1, 0], [128, 127], [0.5, 0], [Infinity, 0]])('rejects invalid coordinate (%s,%s)', (x, z) => {
    expect(CellSchema.safeParse([x, z]).success).toBe(false);
  });
});

describe('portable canonical layer codec', () => {
  it.each([[], [0], [0, 255], [1, 2, 3], [255, 128, 0, 127]].map(values => ({ values })))('roundtrips byte array $values', ({ values }) => {
    const bytes = Uint8Array.from(values);
    expect(decodeUint8(encodeUint8(bytes), bytes.length)).toEqual(bytes);
  });
  it('stores signed heights in little endian', () => {
    expect(encodeInt16(Int16Array.from([1, -1, -32768, 32767]))).toBe('AQD//wCA/38=');
    expect(decodeInt16('AQD//wCA/38=', 4)).toEqual(Int16Array.from([1, -1, -32768, 32767]));
  });
  it.each(['AB==', 'A===', 'AA=', '====', 'AA==\n', 'AAA!', 'AA'])('rejects malformed base64 %j', value => {
    expect(() => decodeUint8(value)).toThrow();
  });
  it('rejects mismatched length and odd Int16 byte length', () => {
    expect(() => decodeUint8('AA==', 2)).toThrow();
    expect(() => decodeInt16('AA==')).toThrow();
  });
});

describe('construction and production persistence', () => {
  const building = {
    id: 'b_1', defId: 'rice_mill', anchor: [56, 56], rotation: 1,
    placedAt: 1000, buildEndsAt: 901000, status: 'CONSTRUCTING',
    cashPaid: 3000, materialsPaid: { cash: 3000, wood: 20, stone: 20 }, investedValue: 3700,
  };
  const bridge = {
    id: 'br_1', typeId: 'bridge_wood', a: [56, 56], b: [59, 56], deckHeightDm: 20,
    placedAt: 1000, buildEndsAt: 121000, status: 'CONSTRUCTING',
    cashPaid: 160, materialsPaid: { cash: 160, wood: 10, stone: 0 }, investedValue: 310,
  };
  const job = { recipeId: 'flour', startedAt: 1000, readyAt: 901000 };

  it('persists actual paid cost for building refund and bridge refund', () => {
    expect(PlacedBuildingSchema.parse(building).materialsPaid).toEqual(building.materialsPaid);
    expect(PlacedBridgeSchema.parse(bridge).materialsPaid).toEqual(bridge.materialsPaid);
  });
  it('requires paid material cost so restored construction can be refunded', () => {
    expect(PlacedBuildingSchema.safeParse({ ...building, materialsPaid: undefined }).success).toBe(false);
    expect(PlacedBridgeSchema.safeParse({ ...bridge, materialsPaid: undefined }).success).toBe(false);
  });
  it('requires bridge lifecycle fields', () => {
    expect(PlacedBridgeSchema.safeParse({ ...bridge, placedAt: undefined }).success).toBe(false);
    expect(PlacedBridgeSchema.safeParse({ ...bridge, status: undefined }).success).toBe(false);
    expect(PlacedBridgeSchema.safeParse({ ...bridge, cashPaid: undefined }).success).toBe(false);
  });
  it('preserves separate queues, including empty slots', () => {
    expect(PlacedBuildingSchema.parse({ ...building, slots: [[], [job, job, job]] }).slots).toEqual([[], [job, job, job]]);
  });
  it('rejects more than three queued batches in one slot', () => {
    expect(PlacedBuildingSchema.safeParse({ ...building, slots: [[job, job, job, job]] }).success).toBe(false);
  });
  it('rejects previous flat slot representation', () => {
    expect(PlacedBuildingSchema.safeParse({ ...building, slots: [job] }).success).toBe(false);
  });
  it('rejects invalid placed IDs and refund data', () => {
    expect(PlacedBuildingSchema.safeParse({ ...building, id: 'br_1' }).success).toBe(false);
    expect(PlacedBridgeSchema.safeParse({ ...bridge, id: 'b_1' }).success).toBe(false);
    expect(PlacedBuildingSchema.safeParse({ ...building, cashPaid: 1.5 }).success).toBe(false);
    expect(PlacedBridgeSchema.safeParse({ ...bridge, materialsPaid: { cash: 160, wood: -10, stone: 0 } }).success).toBe(false);
  });
});
