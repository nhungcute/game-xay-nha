import { describe, expect, it } from 'vitest';
import { economy } from '@xay-nha/content';
import { MAX_BUY, buyQuote } from './MaterialShop';

describe('material shop quote', () => {
  const wood = economy.materialPrices.wood;
  it('prices the typed quantity and checks it against cash', () => {
    expect(buyQuote('10', 'wood', 1_000)).toEqual({ count: 10, total: 10 * wood, affordable: true, max: Math.floor(1_000 / wood) });
    expect(buyQuote('10', 'wood', 10 * wood - 1).affordable).toBe(false);
    expect(buyQuote('3', 'stone', 0)).toMatchObject({ count: 3, affordable: false, max: 0 });
  });
  it('treats empty, negative or fractional input as whole units, capped', () => {
    expect(buyQuote('', 'wood', 1_000)).toMatchObject({ count: 0, affordable: false });
    expect(buyQuote('-4', 'wood', 1_000)).toMatchObject({ count: 0, affordable: false });
    expect(buyQuote('2.9', 'wood', 1_000)).toMatchObject({ count: 2, total: 2 * wood });
    expect(buyQuote('1e9', 'wood', Number.MAX_SAFE_INTEGER).count).toBe(MAX_BUY);
  });
});
