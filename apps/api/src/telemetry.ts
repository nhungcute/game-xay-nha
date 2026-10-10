/**
 * docs/11 §10 client telemetry: JS errors and asset/world load failures reported by browsers.
 * No account needed (errors can happen before login), strictly bounded fields, logged only (no storage in MVP).
 */
export type TelemetryKind = 'error' | 'rejection' | 'load';
export interface TelemetryReport { kind: TelemetryKind; message: string; source?: string; mapId?: string; stack?: string; path?: string }

const KINDS: readonly TelemetryKind[] = ['error', 'rejection', 'load'];
/** Control characters (log injection) become spaces; empty strings are dropped. */
const text = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.length
  ? Array.from(value.slice(0, max), ch => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('') : undefined;

/** Returns a sanitized report, or null when the body is not a telemetry report. */
export function parseTelemetry(body: unknown): TelemetryReport | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>, message = text(b.message, 500);
  if (!KINDS.includes(b.kind as TelemetryKind) || !message) return null;
  const report: TelemetryReport = { kind: b.kind as TelemetryKind, message };
  for (const [key, max] of [['source', 300], ['mapId', 40], ['stack', 2000], ['path', 200]] as const) {
    const value = text(b[key], max); if (value) report[key] = value;
  }
  return report;
}
