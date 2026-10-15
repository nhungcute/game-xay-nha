import { validate, type SimState } from '@xay-nha/sim';
import type { Command } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import { ALL_ZONES } from './geometry';

/** What the Khu đất tool shows over one locked zone. All of it comes from `validate(UNLOCK_ZONE)` (no client-side rules). */
export interface ZoneHighlight {
  zone: number;
  /** ok: buyable now · poor: adjacent and level ok but too little cash · level: blocked by level · far: not adjacent · max: zone limit. */
  kind: 'ok' | 'poor' | 'level' | 'far' | 'max';
  /** Sim price in cash (ok, poor). */
  cost?: number;
  /** Level that lifts the level block (level). */
  level?: number;
}

/** Probe commands are never applied, so one fixed id is fine. */
const PROBE_ID = '00000000-0000-4000-8000-000000000001';
const MAX_LEVEL = economy.xp.maxLevel; // the snapshot schema rejects higher levels
const BIG = 1_000_000_000_000;
const ask = (s: SimState, zone: number, now: number, patch?: { cash?: boolean; level?: number }) => {
  const snapshot = { ...s.snapshot, wallet: patch?.cash ? { ...s.snapshot.wallet, cash: BIG } : s.snapshot.wallet, progress: patch?.level ? { ...s.snapshot.progress, level: patch.level } : s.snapshot.progress };
  const command = { type: 'UNLOCK_ZONE', payload: { zoneId: zone }, commandId: PROBE_ID, worldId: s.snapshot.worldId, expectedRevision: s.snapshot.revision, clientTime: now } as Command;
  return validate({ ...s, snapshot }, command, now);
};

/** Classifies every locked zone for the Khu đất overlay. Probes with a rich / high-level copy of the wallet so the sim itself says why and how much. */
export function zoneHighlights(s: SimState, now: number): ZoneHighlight[] {
  const owned = new Set(s.snapshot.unlockedZones), out: ZoneHighlight[] = [];
  let needLevel: number | undefined;
  for (const zone of ALL_ZONES) {
    if (owned.has(zone)) continue;
    const r = ask(s, zone, now);
    if (r.valid) { out.push({ zone, kind: 'ok', cost: r.cost.cash }); continue; }
    if (r.code === 'LIMIT_REACHED') { out.push({ zone, kind: 'max' }); continue; }
    if (r.code === 'INSUFFICIENT_FUNDS') { const rich = ask(s, zone, now, { cash: true }); out.push({ zone, kind: 'poor', cost: rich.valid ? rich.cost.cash : 0 }); continue; }
    if (r.code === 'LEVEL_REQUIRED') {
      // The level guard runs before adjacency: re-ask at max level to tell "far" from "adjacent, level-blocked".
      const high = ask(s, zone, now, { level: MAX_LEVEL });
      if (!high.valid && high.code === 'ZONE_LOCKED') { out.push({ zone, kind: 'far' }); continue; }
      if (needLevel === undefined) { // same for every zone at this purchase count: bisect the lowest level that passes the guard
        let lo = s.snapshot.progress.level, hi = MAX_LEVEL;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1, m = ask(s, zone, now, { level: mid }); if (!m.valid && m.code === 'LEVEL_REQUIRED') lo = mid; else hi = mid; }
        needLevel = hi;
      }
      out.push({ zone, kind: 'level', level: needLevel }); continue;
    }
    out.push({ zone, kind: 'far' });
  }
  return out;
}
