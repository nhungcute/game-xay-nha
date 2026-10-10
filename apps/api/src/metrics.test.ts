import { describe, expect, it } from 'vitest';
import { CommandMetrics } from './metrics';

describe('command metrics (docs/11 §10)', () => {
  it('reports commands/s, rejection rate by code, p95 and active worlds over a sliding window', () => {
    let now = 1_000_000;
    const m = new CommandMetrics(60_000, () => now);
    for (let i = 1; i <= 100; i++) m.record(i % 2 ? 'w1' : 'w2', i % 10 !== 0, i % 10 ? undefined : (i % 20 ? 'NOT_FLAT' : 'OCCUPIED'), i);
    const r = m.report();
    expect(r).toMatchObject({ commands: 100, accepted: 90, rejected: 10, rejectionRate: 0.1, p95Ms: 95, activeWorlds: 2, windowSeconds: 60 });
    expect(r.rejectedByCode).toEqual({ NOT_FLAT: 5, OCCUPIED: 5 });
    expect(r.commandsPerSecond).toBeCloseTo(100 / 60, 3);
    now += 61_000; m.record('w3', true, undefined, 2);
    expect(m.report()).toMatchObject({ commands: 1, activeWorlds: 1, p95Ms: 2, rejectionRate: 0 });
  });
  it('is empty and safe without traffic', () => {
    expect(new CommandMetrics().report()).toMatchObject({ commands: 0, p95Ms: 0, rejectionRate: 0, activeWorlds: 0 });
  });
});
