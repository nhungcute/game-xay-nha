import { afterEach, describe, expect, it, vi } from 'vitest';

describe('client telemetry (docs/11 §10)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  async function load() {
    const beacons: unknown[] = [];
    vi.stubGlobal('location', { pathname: '/' });
    vi.stubGlobal('navigator', { sendBeacon: (_url: string, blob: Blob) => { beacons.push(blob); return true; } });
    return { beacons, ...(await import('./telemetry')) };
  }
  it('sends each distinct report once and stops after 20', async () => {
    const { beacons, report } = await load();
    expect(report('load', 'GLB asset not loaded: farmhouse', { mapId: 'farm-valley-01' })).toBe(true);
    expect(report('load', 'GLB asset not loaded: farmhouse')).toBe(false);
    for (let i = 0; i < 30; i++) report('error', `boom ${i}`);
    expect(beacons).toHaveLength(20);
    const first = JSON.parse(await (beacons[0] as Blob).text());
    expect(first).toMatchObject({ kind: 'load', message: 'GLB asset not loaded: farmhouse', mapId: 'farm-valley-01', path: '/' });
  });
  it('falls back to fetch and never throws', async () => {
    vi.stubGlobal('location', { pathname: '/' });
    vi.stubGlobal('navigator', {});
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const { report } = await import('./telemetry');
    expect(() => report('rejection', 'x')).not.toThrow();
    expect(fetch).toHaveBeenCalledWith('/api/telemetry', expect.objectContaining({ method: 'POST', keepalive: true }));
  });
  it('reports window errors and unhandled rejections, ignores resource-load events', async () => {
    const { beacons, installTelemetry } = await load();
    const handlers: Record<string, (e: unknown) => void> = {};
    installTelemetry({ addEventListener: ((type: string, h: (e: unknown) => void) => { handlers[type] = h; }) as Window['addEventListener'] });
    vi.stubGlobal('ErrorEvent', class { constructor(readonly message: string, readonly filename = 'a.js', readonly lineno = 1, readonly colno = 2, readonly error = new Error('e')) {} });
    handlers.error!(new (globalThis as unknown as { ErrorEvent: new (m: string) => unknown }).ErrorEvent('TypeError: x is undefined'));
    handlers.error!({ type: 'error' });
    handlers.unhandledrejection!({ reason: new Error('lost promise') });
    const sent = await Promise.all(beacons.map(b => (b as Blob).text().then(JSON.parse)));
    expect(sent.map(s => [s.kind, s.message])).toEqual([['error', 'TypeError: x is undefined'], ['rejection', 'lost promise']]);
  });
});
