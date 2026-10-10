/**
 * Graphics quality (docs/11 §8): "low" turns shadows off, lowers the pixel ratio and thins small scenery
 * (flowers, reeds, half the bushes) and merges scenery batches, to stay within the mobile budget
 * (≤150 draw calls, ≥30 FPS). Touch devices start on "low"; the choice is remembered per browser.
 */
export type Quality = 'high' | 'low';
const KEY = 'xay-nha.graphics';
export const isTouch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
export function loadQuality(): Quality {
  try { const value = localStorage.getItem(KEY); if (value === 'high' || value === 'low') return value; } catch { /* storage blocked */ }
  return isTouch() ? 'low' : 'high';
}
export function saveQuality(quality: Quality): void {
  try { localStorage.setItem(KEY, quality); } catch { /* storage blocked: still applies for this session */ }
}
export function pixelRatio(quality: Quality, device = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1): number {
  return Math.min(device, quality === 'low' ? (isTouch() ? 1.25 : 1.5) : (isTouch() ? 1.5 : 2));
}
/** Small decorative scenery dropped or thinned in low quality ("giảm mật độ cỏ"). */
export function keepInLow(assetId: string, envId: string): boolean {
  if (assetId.startsWith('flower') || assetId.startsWith('reed')) return false;
  if (assetId.startsWith('bush')) { let h = 0; for (let i = 0; i < envId.length; i++) h = (h * 31 + envId.charCodeAt(i)) | 0; return (h & 1) === 0; }
  return true;
}
