import { create } from 'zustand';

/** Floating toasts (D043): rejected actions and sync errors. Pure list helpers below are unit-tested; hover previews never toast. */
export interface Toast { id: number; text: string; error: boolean; count: number; until: number }
export const TOAST_MAX = 3, TOAST_MS = { error: 2500, info: 1800 };
/** Same text already visible -> bump its counter and refresh its timer (no stacking); else append, dropping the oldest beyond the cap. */
export function pushToast(list: readonly Toast[], text: string, error: boolean, now: number, id: number): Toast[] {
  const live = list.filter(x => x.until > now), same = live.find(x => x.text === text && x.error === error), until = now + (error ? TOAST_MS.error : TOAST_MS.info);
  if (same) return live.map(x => x === same ? { ...x, count: x.count + 1, until } : x);
  return [...live, { id, text, error, count: 1, until }].slice(-TOAST_MAX);
}
export const expireToasts = (list: readonly Toast[], now: number): Toast[] => list.filter(x => x.until > now);

let nextId = 1;
export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
export const toast = (text: string, error = true): void => useToasts.setState(s => ({ toasts: pushToast(s.toasts, text, error, Date.now(), nextId++) }));
export const dismissToast = (id: number): void => useToasts.setState(s => ({ toasts: s.toasts.filter(x => x.id !== id) }));
