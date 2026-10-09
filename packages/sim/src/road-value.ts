import { Surface } from '@xay-nha/contracts';
import { economy } from '@xay-nha/content';
import type { SimState } from './state';

export const ROAD_PAID_PREFIX = 'infra_paid_road_';
export const roadPaidKey = (index: number): string => `${ROAD_PAID_PREFIX}${index}`;
const value = (tier: 0 | 1 | 2 | 3): number => tier ? economy.roadTiers[tier].cost.cash
  + economy.roadTiers[tier].cost.wood * economy.materialPrices.wood
  + economy.roadTiers[tier].cost.stone * economy.materialPrices.stone : 0;

/** G0 snapshots predate payment metadata; their original tier-difference valuation is preserved. */
export function roadPaidValue(s: SimState, index: number): number {
  if (s.surface[index] !== Surface.ROAD || !s.roadTier[index]) return 0;
  const explicit = s.snapshot.progress.questProgress[roadPaidKey(index)];
  if (explicit !== undefined) return explicit;
  return value(s.roadTier[index] as 1 | 2 | 3) - value(s.baseRoadTier[index] as 0 | 1 | 2 | 3);
}

export function recordRoadPayment(s: SimState, index: number, paidValue: number): void {
  const total = roadPaidValue(s, index) + paidValue;
  if (total) s.snapshot.progress.questProgress[roadPaidKey(index)] = total;
}

export function forgetRoadPayment(s: SimState, index: number): void { delete s.snapshot.progress.questProgress[roadPaidKey(index)]; }

export function validateRoadPayments(s: SimState): string[] {
  const errors: string[] = [];
  for (const [key, paid] of Object.entries(s.snapshot.progress.questProgress)) {
    if (!key.startsWith(ROAD_PAID_PREFIX)) continue;
    const suffix = key.slice(ROAD_PAID_PREFIX.length), index = Number(suffix);
    if (!/^(?:0|[1-9]\d*)$/.test(suffix) || index >= 128 * 128 || s.surface[index] !== Surface.ROAD || !s.roadTier[index]) { errors.push(`ROAD_PAYMENT_CELL:${key}`); continue; }
    const full = value(s.roadTier[index] as 1 | 2 | 3), inherited = full - value(s.baseRoadTier[index] as 0 | 1 | 2 | 3);
    if (!Number.isSafeInteger(paid) || paid <= 0 || (paid !== full && paid !== inherited)) errors.push(`ROAD_PAYMENT_VALUE:${key}`);
  }
  return errors;
}
