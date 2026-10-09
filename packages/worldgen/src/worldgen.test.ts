import { describe, expect, it } from 'vitest';
import { CellFlag, Surface, type WorldTemplate } from '@xay-nha/contracts';
import { createHash } from 'node:crypto';
import { createTestTemplate, decodeInt16, decodeLayers, decodeUint8, encodeInt16, encodeLayers, encodeUint8,
  generateEnvironment, generateZone, hash32, mulberry32, pointInPolygon, pointInRiver, rasterizeWater, validateTemplate } from './index';

function changedLayers(mutate: (layers: ReturnType<typeof decodeLayers>) => void): WorldTemplate {
  const template = createTestTemplate(), layers = decodeLayers(template);
  mutate(layers); template.layers = encodeLayers(layers); return template;
}
function denseTemplate(): WorldTemplate {
  const template = createTestTemplate();
  template.env.scatter = [{ biome: 0, category: 'tree_deciduous', densityPerCell: 1, assetIds: ['tree_deciduous_01'], rules: {} }];
  return template;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('portable binary layer codec', () => {
  it('encodes standard base64 vectors and all bytes', () => {
    expect(encodeUint8(new Uint8Array([102]))).toBe('Zg==');
    expect(encodeUint8(new Uint8Array([102, 111, 111]))).toBe('Zm9v');
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeUint8(encodeUint8(bytes))).toEqual(bytes);
  });
  it('uses explicit signed little endian', () => {
    const values = new Int16Array([-32768, -1, 0, 1, 32767]);
    expect([...decodeUint8(encodeInt16(values))]).toEqual([0, 128, 255, 255, 0, 0, 1, 0, 255, 127]);
    expect(decodeInt16(encodeInt16(values))).toEqual(values);
  });
  it.each(['Zg', 'Z===', 'Zm9v\n', '!!!!', 'Zh=='])('rejects malformed/noncanonical base64 %s', value => expect(() => decodeUint8(value)).toThrow());
  it('rejects wrong layer lengths and odd int16 bytes', () => {
    expect(() => decodeUint8('Zg==', 2)).toThrow();
    expect(() => decodeInt16('Zg==')).toThrow();
  });
  it('round trips all template arrays without sharing input memory', () => {
    const template = createTestTemplate(), first = decodeLayers(template), second = decodeLayers(template);
    expect(encodeLayers(first)).toEqual(template.layers);
    first.heightsDm[0] = -500;
    expect(second.heightsDm[0]).not.toBe(-500);
  });
});

describe('deterministic environment generation', () => {
  it('matches the canonical colon-separated FNV-1a input', () => {
    let hash = 0x811c9dc5;
    for (const byte of Buffer.from('20261009:27:0:veg-1.0.0')) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    expect(hash32(20261009, 27, 0, 'veg-1.0.0')).toBe(hash);
  });
  it('implements the known mulberry32 stream', () => {
    const rng = mulberry32(1);
    expect([rng(), rng(), rng()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });
  it('same template produces byte-identical complete environment and preserves template', () => {
    const template = createTestTemplate(), before = JSON.stringify(template);
    expect(digest(generateEnvironment(template))).toBe(digest(generateEnvironment(template)));
    expect(JSON.stringify(template)).toBe(before);
  });
  it('generates zones independently of request order', () => {
    const template = createTestTemplate();
    const ascending = [26, 27, 28, 35, 36].flatMap(zone => generateZone(template, zone)).sort((a, b) => a.id.localeCompare(b.id));
    const reverse = [36, 35, 28, 27, 26].flatMap(zone => generateZone(template, zone)).sort((a, b) => a.id.localeCompare(b.id));
    expect(digest(reverse)).toBe(digest(ascending));
  });
  it('consumes four draws per visited cell, including excluded cells', () => {
    const template = denseTemplate(), env = generateZone(template, 0), rng = mulberry32(hash32(template.seed, 0, 0, template.generatorVersion));
    for (const entity of env) {
      rng(); rng(); const offsetBits = Math.floor(rng() * 4294967296), rotationBits = Math.floor(rng() * 4294967296);
      expect(entity.offsetXZ).toEqual([((offsetBits & 65535) / 65535 - 0.5) * 1.2, ((offsetBits >>> 16) / 65535 - 0.5) * 1.2]);
      expect(entity.yawDeg).toBe((rotationBits & 65535) / 65536 * 360);
    }
    const altered = decodeLayers(template);
    altered.flags[0] = CellFlag.ENTRY;
    template.layers = encodeLayers(altered);
    expect(generateZone(template, 0)).toEqual(env.filter(entity => entity.id !== 'Z0-tree_deciduous-0'));
  });
  it('seed and generator version alter scatter but preserve anchors', () => {
    const template = denseTemplate(), original = generateZone(template, 27);
    template.seed++;
    expect(digest(generateZone(template, 27))).not.toBe(digest(original));
    template.generatorVersion = 'veg-2';
    expect(generateZone(template, 27).filter(entity => entity.id.startsWith('A-'))).toEqual(original.filter(entity => entity.id.startsWith('A-')));
  });
  it('excludes water, roads and ENTRY across every blocking footprint', () => {
    const template = denseTemplate(), layers = decodeLayers(template);
    for (const entity of generateEnvironment(template)) for (let z = entity.cell[1]; z < entity.cell[1] + entity.footprint; z++) for (let x = entity.cell[0]; x < entity.cell[0] + entity.footprint; x++) {
      expect(layers.surface[z * 128 + x]).not.toBe(Surface.WATER);
      expect(layers.roadTier[z * 128 + x]).toBe(0);
      expect(layers.flags[z * 128 + x]! & CellFlag.ENTRY).toBe(0);
    }
  });
  it('reserves anchors including all four large rock cells', () => {
    const template = denseTemplate(), entities = generateZone(template, 28);
    for (const [x, z] of [[66, 52], [67, 52], [66, 53], [67, 53]]) expect(entities.filter(entity => entity.cell[0] === x && entity.cell[1] === z && !entity.id.startsWith('A-'))).toHaveLength(0);
    entities[0]!.cell[0] = 0;
    expect(template.env.anchors.find(entity => entity.id === 'A-4')!.cell).toEqual([66, 52]);
  });
  it('large rocks and trees never overlap or cross generating zone edges', () => {
    const template = denseTemplate();
    template.env.scatter.unshift({ biome: 0, category: 'rock_large', densityPerCell: 1, assetIds: ['rock_large_01'], rules: {} });
    const occupied = new Set<string>();
    for (const entity of generateEnvironment(template)) for (let z = entity.cell[1]; z < entity.cell[1] + entity.footprint; z++) for (let x = entity.cell[0]; x < entity.cell[0] + entity.footprint; x++) {
      const key = `${x},${z}`;
      expect(occupied.has(key)).toBe(false); occupied.add(key);
      if (!entity.id.startsWith('A-')) expect(Math.floor(x / 16)).toBe(Math.floor(entity.cell[0] / 16));
    }
  });
  it('honors shore, biome, minimum water distance, slope and suggested lots', () => {
    const template = denseTemplate();
    template.env.anchors = [];
    template.env.scatter[0]!.rules = { onlyShore: true };
    const shore = generateZone(template, 27);
    expect(shore.length).toBeGreaterThan(0);
    expect(shore.every(entity => entity.cell[0] === 59)).toBe(true);
    template.env.scatter[0]!.rules = { minWaterDistCells: 2, maxSlopeDm: 10, avoidSuggestedLots: true };
    expect(generateZone(template, 27).every(entity => entity.cell[0] <= 58)).toBe(true);
    expect(generateZone(template, 28).some(entity => entity.cell[0] >= 72 && entity.cell[0] <= 78 && entity.cell[1] >= 50 && entity.cell[1] <= 58)).toBe(false);
    template.env.scatter[0]!.biome = 99;
    expect(generateZone(template, 27)).toEqual([]);
  });
  it('rejects invalid zone IDs', () => {
    for (const id of [-1, 64, 2.5, NaN]) expect(() => generateZone(createTestTemplate(), id)).toThrow();
  });
});

describe('template validation and water geometry', () => {
  it.each(['farm', 'city'] as const)('validates provisional %s fixture', kind => expect(validateTemplate(createTestTemplate(kind))).toEqual([]));
  it('tests polygon center membership and tapered river width geometrically', () => {
    expect(pointInPolygon(3, 3, [[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(true);
    expect(pointInPolygon(13, 3, [[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(false);
    expect(pointInRiver(3, 9, [[0, 0], [0, 10]], [2, 8])).toBe(true);
    expect(pointInRiver(3, 1, [[0, 0], [0, 10]], [2, 8])).toBe(false);
    expect([...rasterizeWater({ lakes: [{ id: 'lake', polygonXZ: [[0, 0], [4, 0], [4, 4], [0, 4]] }], rivers: [], waterfalls: [] })].filter(Boolean)).toHaveLength(4);
  });
  it('reports water raster mismatch', () => expect(validateTemplate(changedLayers(l => { l.surface[0] = Surface.WATER; })).some(error => error.includes('raster mismatch'))).toBe(true));
  it('rejects all player-built template surfaces/flags/roads', () => {
    const errors = validateTemplate(changedLayers(l => { l.surface[0] = Surface.TILLED; l.surface[1] = Surface.FOUNDATION; l.flags[2] = CellFlag.EMBANKED; l.roadTier[3] = 3; }));
    expect(errors.filter(error => /player surface|embankment|paved road/.test(error))).toHaveLength(4);
  });
  it('enforces both shared shore and underwater-only height constraints', () => {
    const errors = validateTemplate(changedLayers(l => { l.heightsDm[60] = 0; l.heightsDm[62] = 90; }));
    expect(errors.some(error => error.includes('D002'))).toBe(true);
    expect(errors.some(error => error.includes('water-only'))).toBe(true);
  });
  it('rejects disconnected start zones and an entry outside them', () => {
    const template = createTestTemplate(); template.startZones = [0, 63];
    const errors = validateTemplate(template);
    expect(errors.some(error => error.includes('connected'))).toBe(true);
    expect(errors.some(error => error.includes('outside startZones'))).toBe(true);
  });
  it('requires a natural road to border and protected external path', () => {
    const template = changedLayers(l => { l.roadTier[90 * 128 + 70] = 0; l.surface[90 * 128 + 70] = Surface.GRASS; l.flags[100 * 128 + 70] = 0; });
    const errors = validateTemplate(template);
    expect(errors.some(error => error.includes('no village road'))).toBe(true);
    expect(errors.some(error => error.includes('external village road'))).toBe(true);
  });
  it('requires at least 200 buildable cells', () => {
    const template = changedLayers(l => { l.flags.fill(CellFlag.NO_BUILD); l.flags[79 * 128 + 70] = CellFlag.ENTRY; });
    expect(validateTemplate(template).some(error => error.includes('requires 200'))).toBe(true);
  });
  it('reports duplicate, overlap and illegal anchor footprint failures together', () => {
    const template = createTestTemplate(), anchor = template.env.anchors[0]!;
    template.env.anchors.push({ ...anchor }, { ...anchor, id: 'A-99', cell: [60, 60] }, { ...anchor, id: 'A-100', cell: [127, 127], footprint: 2 });
    const errors = validateTemplate(template);
    for (const term of ['duplicate ID', 'overlap', 'on water', 'outside map']) expect(errors.some(error => error.includes(term))).toBe(true);
  });
  it('rejects unknown schemas, corrupt arrays and unsolicited player objects', () => {
    const template = createTestTemplate();
    expect(validateTemplate({ ...template, schemaVersion: 2 }).length).toBeGreaterThan(0);
    expect(validateTemplate({ ...template, buildings: [] }).length).toBeGreaterThan(0);
    template.layers.flags = 'AAAA';
    expect(validateTemplate(template).some(error => error.startsWith('layers.flags'))).toBe(true);
  });
});
