/**
 * docs/11 §10: send JS errors, unhandled promise rejections and world/asset load failures to /api/telemetry,
 * so problems on testers' devices show up in the server log. Online builds only; at most 20 distinct reports
 * per page load; never throws and never reports its own failures.
 */
export type TelemetryKind = 'error' | 'rejection' | 'load';
const ENABLED = import.meta.env.VITE_OFFLINE !== '1', MAX = 20;
const seen = new Set<string>();

export function report(kind: TelemetryKind, message: string, extra: { source?: string; stack?: string; mapId?: string } = {}): boolean {
  const key = `${kind}:${message}`;
  if (!ENABLED || !message || seen.size >= MAX || seen.has(key)) return false;
  seen.add(key);
  const body = JSON.stringify({ kind, message: message.slice(0, 500), path: location.pathname, ...extra, stack: extra.stack?.slice(0, 2000) });
  try {
    if (navigator.sendBeacon?.('/api/telemetry', new Blob([body], { type: 'application/json' }))) return true;
  } catch { /* fall back to fetch */ }
  try { void fetch('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => undefined); } catch { /* ignore */ }
  return true;
}

export function installTelemetry(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener('error', event => {
    if (!(event instanceof ErrorEvent)) return; // resource load events carry no message
    report('error', event.message, { source: `${event.filename}:${event.lineno}:${event.colno}`, stack: (event.error as Error | undefined)?.stack });
  });
  target.addEventListener('unhandledrejection', event => {
    const reason = (event as PromiseRejectionEvent).reason;
    report('rejection', reason instanceof Error ? reason.message : String(reason), { stack: reason instanceof Error ? reason.stack : undefined });
  });
}
