import { describe, expect, it } from 'vitest';
import { parseTelemetry } from './telemetry';

describe('client telemetry parsing (docs/11 §10)', () => {
  it('accepts the three kinds and keeps only bounded, known fields', () => {
    const r = parseTelemetry({ kind: 'load', message: 'GLB asset not loaded: farmhouse', mapId: 'farm-valley-01', path: '/', extra: 'dropped', stack: 'x'.repeat(5000) });
    expect(r).toEqual({ kind: 'load', message: 'GLB asset not loaded: farmhouse', mapId: 'farm-valley-01', path: '/', stack: 'x'.repeat(2000) });
    expect(parseTelemetry({ kind: 'error', message: 'a\nb\u0000c' })).toEqual({ kind: 'error', message: 'a b c' });
  });
  it('rejects malformed reports', () => {
    for (const body of [null, [], 'text', { kind: 'other', message: 'x' }, { kind: 'error' }, { kind: 'error', message: '' }, { kind: 'error', message: 5 }]) {
      expect(parseTelemetry(body)).toBeNull();
    }
  });
});
