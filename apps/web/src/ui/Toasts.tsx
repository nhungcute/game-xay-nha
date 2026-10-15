import { useEffect } from 'react';
import { dismissToast, expireToasts, useToasts } from '../game/toasts';

/** Top-centre floating toasts under the HUD top bar. Errors are assertive, info polite; a tap dismisses one. */
export function Toasts() {
  const toasts = useToasts(s => s.toasts);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => useToasts.setState(s => ({ toasts: expireToasts(s.toasts, Date.now()) })), Math.max(0, Math.min(...toasts.map(x => x.until)) - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [toasts]);
  return <div className="hud3-toasts">
    {toasts.map(x => <div key={x.id} className={`hud3-toast ${x.error ? 'is-error' : 'is-info'}`} role="status" aria-live={x.error ? 'assertive' : 'polite'} onClick={() => dismissToast(x.id)}>
      <span>{x.text}</span>{x.count > 1 && <b key={x.count} className="hud3-toast-n">×{x.count}</b>}</div>)}
  </div>;
}
