import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WorldTemplateSchema } from '@xay-nha/contracts';
import { apply, createState, validate, type SimState } from '@xay-nha/sim';
import { zoneHighlights } from './zoneHighlight';

const NOW = 1_000_000;
const load = (mapId: string): SimState => createState(WorldTemplateSchema.parse(JSON.parse(
  readFileSync(new URL(`../../../public/worlds/${mapId}/template.v2.json`, import.meta.url), 'utf8'))), NOW);
const unlock = (s: SimState, zoneId: number) => ({ type: 'UNLOCK_ZONE', payload: { zoneId }, commandId: crypto.randomUUID(), worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, clientTime: NOW }) as never;

describe('Khu đất overlay classification', () => {
  for (const mapId of ['city-coast-01', 'farm-valley-01']) describe(mapId, () => {
    it('marks exactly the zones the sim would accept, with the sim price', () => {
      const s = load(mapId); s.snapshot.wallet.cash = 50_000_000; s.snapshot.progress.level = 20;
      const list = zoneHighlights(s, NOW), owned = new Set(s.snapshot.unlockedZones);
      expect(list.length).toBe(64 - owned.size);
      const ok = list.filter(h => h.kind === 'ok');
      expect(ok.length).toBeGreaterThan(0);
      for (const h of list) {
        const r = validate(s, unlock(s, h.zone), NOW);
        expect(r.valid).toBe(h.kind === 'ok');
        if (r.valid) expect(h.cost).toBe(r.cost.cash);
      }
      expect(list.filter(h => h.kind === 'far').length).toBeGreaterThan(0);
    });
    it('keeps the price but flags "poor" when cash is short, and drops to level when the level blocks', () => {
      const s = load(mapId); s.snapshot.wallet.cash = 1; s.snapshot.progress.level = 20;
      const poor = zoneHighlights(s, NOW).filter(h => h.kind === 'poor');
      expect(poor.length).toBeGreaterThan(0);
      for (const h of poor) expect(h.cost).toBeGreaterThan(1);
      s.snapshot.wallet.cash = 50_000_000; s.snapshot.progress.level = 1;
      const list = zoneHighlights(s, NOW), lv = list.filter(h => h.kind === 'level');
      if (lv.length) { expect(lv[0]!.level).toBeGreaterThan(1); expect(list.some(h => h.kind === 'ok')).toBe(false); }
    });
    it('a bought zone disappears from the list and its neighbours become reachable', () => {
      const s = load(mapId); s.snapshot.wallet.cash = 50_000_000; s.snapshot.progress.level = 20;
      const first = zoneHighlights(s, NOW).find(h => h.kind === 'ok')!;
      const e = apply(s, unlock(s, first.zone), NOW); expect(e.result.accepted).toBe(true);
      const next = zoneHighlights(e.state, NOW);
      expect(next.some(h => h.zone === first.zone)).toBe(false);
      expect(next.filter(h => h.kind === 'ok').length).toBeGreaterThan(0);
    });
  });
});
