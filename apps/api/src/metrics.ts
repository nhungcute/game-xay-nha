/**
 * docs/11 §10 command metrics: commands/second, rejection rate by code, p95 processing time and active worlds,
 * over a sliding window. In-memory only (single API process in the MVP); reported through the JSON log.
 */
interface Sample { at: number; worldId: string; accepted: boolean; code?: string; durationMs: number }

export interface MetricsReport {
  windowSeconds: number; commands: number; commandsPerSecond: number; accepted: number; rejected: number;
  rejectionRate: number; rejectedByCode: Record<string, number>; p95Ms: number; activeWorlds: number;
}

export class CommandMetrics {
  private samples: Sample[] = [];
  constructor(private readonly windowMs = 300_000, private readonly clock: () => number = Date.now) {}
  record(worldId: string, accepted: boolean, code: string | undefined, durationMs: number): void {
    this.samples.push({ at: this.clock(), worldId, accepted, code, durationMs });
    if (this.samples.length > 50_000) this.samples.splice(0, this.samples.length - 50_000);
  }
  report(): MetricsReport {
    const since = this.clock() - this.windowMs;
    this.samples = this.samples.filter(s => s.at >= since);
    const n = this.samples.length, rejected = this.samples.filter(s => !s.accepted), rejectedByCode: Record<string, number> = {};
    for (const s of rejected) rejectedByCode[s.code ?? 'UNKNOWN'] = (rejectedByCode[s.code ?? 'UNKNOWN'] ?? 0) + 1;
    const times = this.samples.map(s => s.durationMs).sort((a, b) => a - b);
    const p95 = n ? times[Math.min(n - 1, Math.ceil(n * 0.95) - 1)]! : 0;
    return {
      windowSeconds: this.windowMs / 1000, commands: n, commandsPerSecond: round(n / (this.windowMs / 1000)),
      accepted: n - rejected.length, rejected: rejected.length, rejectionRate: n ? round(rejected.length / n) : 0,
      rejectedByCode, p95Ms: round(p95), activeWorlds: new Set(this.samples.map(s => s.worldId)).size,
    };
  }
}
const round = (v: number) => Math.round(v * 1000) / 1000;
