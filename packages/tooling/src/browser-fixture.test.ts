import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runWorldgenFixture } from './browser-fixture';

describe('shared browser/Node worldgen golden fixture', () => {
  const result = runWorldgenFixture();
  it('retains the version-one complete environment golden', () => {
    const digest = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    expect(digest).toBe('1d03406d2f3df059625642bf36911ddec65a0fc7d520ec599eae19102edcac3c');
  });
  it('covers both maps, uint32 seed boundaries, generator versions and reversed zone order', () => {
    expect(result.cases).toHaveLength(16);
    expect(new Set(result.cases.map(record => record.mapKind))).toEqual(new Set(['city', 'farm']));
    expect(new Set(result.cases.map(record => record.seed))).toEqual(new Set([0, 1, 20261009, 0xffffffff]));
    expect(new Set(result.cases.map(record => record.generatorVersion))).toEqual(new Set(['veg-1.0.0', 'veg-1.0.1']));
    expect(result.zoneOrderCases).toEqual([
      { mapKind: 'city', count: 475, equal: true },
      { mapKind: 'farm', count: 477, equal: true },
    ]);
  });
});
