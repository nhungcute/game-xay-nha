import { describe, expect, it } from 'vitest';
import { TOAST_MAX, TOAST_MS, expireToasts, pushToast, type Toast } from './toasts';

describe('toast queue', () => {
  it('merges identical messages with a counter and a refreshed timer', () => {
    let l: Toast[] = pushToast([], 'Có vật cản trên ô.', true, 1000, 1);
    l = pushToast(l, 'Có vật cản trên ô.', true, 2000, 2);
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ id: 1, count: 2, until: 2000 + TOAST_MS.error });
  });
  it('keeps error and info of the same text apart', () => {
    expect(pushToast(pushToast([], 'a', true, 0, 1), 'a', false, 0, 2)).toHaveLength(2);
  });
  it('caps at 3 visible, dropping the oldest', () => {
    let l: Toast[] = []; ['a', 'b', 'c', 'd'].forEach((x, i) => { l = pushToast(l, x, true, i, i + 1); });
    expect(l.map(x => x.text)).toEqual(['b', 'c', 'd']); expect(l).toHaveLength(TOAST_MAX);
  });
  it('expires errors after 2.5 s and info after 1.8 s', () => {
    const l = pushToast(pushToast([], 'e', true, 0, 1), 'i', false, 0, 2);
    expect(expireToasts(l, 1799)).toHaveLength(2); expect(expireToasts(l, 1800).map(x => x.text)).toEqual(['e']);
    expect(expireToasts(l, 2500)).toHaveLength(0);
  });
  it('a refreshed toast outlives its original deadline and a push drops expired ones', () => {
    let l = pushToast([], 'a', true, 0, 1); l = pushToast(l, 'a', true, 2000, 2);
    expect(expireToasts(l, 3000)).toHaveLength(1);
    expect(pushToast(l, 'b', true, 9000, 3).map(x => x.text)).toEqual(['b']);
  });
});
