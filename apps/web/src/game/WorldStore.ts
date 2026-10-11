import { create } from 'zustand';
import type { Command, CommandType, Cost, ErrorCode, WorldTemplate } from '@xay-nha/contracts';
import { advanceTime, cloneState, createState, execute, recompute, stateHash, validateSnapshot, type SimState } from '@xay-nha/sim';
import { generateEnvironment, validateTemplate } from '@xay-nha/worldgen';
import { errorText, t } from '../i18n';
import { ApiError, type CommandBatchResponse, type SnapshotResponse } from '../net/api';

export type Connection = 'local' | 'online' | 'syncing' | 'offline';
export interface WorldView { state: SimState | null; message: string; error: boolean; cacheStatus: string; connection: Connection; pending: number }
export const useWorld = create<WorldView>(() => ({ state: null, message: '', error: false, cacheStatus: '', connection: 'local', pending: 0 }));
type Listener = (state: SimState, dirty: readonly number[], entitiesChanged: boolean) => void;
const ALL_ZONES = Array.from({ length: 64 }, (_, i) => i);
const MAX_PENDING = 20, MAX_BATCH = 10;

export class SnapshotCache {
  private db: IDBDatabase | undefined;
  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('xay-nha-offline-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('worlds');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  async read(key: string): Promise<unknown> {
    return new Promise((resolve, reject) => { const request = this.db!.transaction('worlds').objectStore('worlds').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async write(state: SimState): Promise<void> {
    const snapshot = structuredClone(state.snapshot);
    await new Promise<void>((resolve, reject) => { const tx = this.db!.transaction('worlds', 'readwrite'); tx.objectStore('worlds').put(snapshot, snapshot.worldId); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }
  close(): void { this.db?.close(); }
}

/** Server transport (G2). The server is authoritative; sim runs locally for previews and optimism. */
export interface Transport {
  send(commands: Command[]): Promise<CommandBatchResponse>;
  fetchSnapshot(): Promise<SnapshotResponse>;
}

export class WorldStore {
  state: SimState;
  private readonly listeners = new Set<Listener>();
  private readonly cache = new SnapshotCache();
  private readonly results = new Map<string, ReturnType<typeof execute>>();
  private saveChain = Promise.resolve();
  private timeOffset = 0;
  private disposed = false;
  // Online mode: `confirmed` mirrors the server; `state` = confirmed + pending (optimistic).
  private confirmed: SimState | null = null;
  private pending: Command[] = [];
  private inflight = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 1000;

  constructor(readonly template: WorldTemplate, now = Date.now(), private readonly transport: Transport | null = null,
    identity = { worldId: 'offline-farm', accountId: 'offline', displayName: 'Người chơi', tag: '0001' }) {
    const errors = validateTemplate(template); if (errors.length) throw new Error(errors.join('\n'));
    this.state = createState(template, now, generateEnvironment(template), identity);
    recompute(this.state); useWorld.setState({ state: this.state, connection: transport ? 'syncing' : 'local', pending: 0 });
  }

  /** Online bootstrap: validate-everything-then-swap the server snapshot (docs/08 §6.1). */
  static async online(template: WorldTemplate, transport: Transport): Promise<WorldStore> {
    const response = await transport.fetchSnapshot();
    const s = response.snapshot;
    const store = new WorldStore(template, Math.min(Date.now(), s.serverTime), transport,
      { worldId: s.worldId, accountId: s.accountId, displayName: s.character.displayName, tag: s.character.tag });
    store.adoptServer(response);
    await store.cache.open().catch(() => undefined);
    return store;
  }

  now(): number { return Math.max(this.state.snapshot.serverTime, Date.now() + this.timeOffset); }
  /** Debug panel (docs/11 §10): server clock minus local clock, as last measured. */
  clockSkewMs(): number { return this.timeOffset; }
  /** Presentation hooks (sound effects): local command results and time ticks, with the state before and after. */
  onCommand?: (command: Command, accepted: boolean, before: SimState, after: SimState) => void;
  onTick?: (before: SimState, after: SimState) => void;
  pendingCount(): number { return this.pending.length; }
  get online(): boolean { return this.transport !== null; }

  async load(): Promise<void> {
    if (this.transport) return;
    try {
      await this.cache.open(); const cached = await this.cache.read(this.state.snapshot.worldId);
      if (cached !== undefined) {
        const checked = validateSnapshot(this.state, cached, this.now());
        if (checked.ok) { this.state = checked.state; this.publish(ALL_ZONES, true); }
        else this.message(t('cacheError'), true);
      }
    } catch (error) { this.message(`${t('cacheError')} ${error instanceof Error ? error.message : ''}`, true); }
  }

  command(type: CommandType, payload: unknown): Command {
    return { type, payload, commandId: crypto.randomUUID(), worldId: this.state.snapshot.worldId, expectedRevision: this.state.snapshot.revision, clientTime: this.now() } as Command;
  }
  apply(type: CommandType, payload: unknown): ReturnType<typeof execute> { return this.dispatch(this.command(type, payload)); }

  dispatch(command: Command): ReturnType<typeof execute> {
    const prior = this.results.get(command.commandId); if (prior) return prior;
    if (this.transport && this.pending.length >= MAX_PENDING) {
      this.message(t('queueFull'), true);
      return { state: this.state, cost: { cash: 0, wood: 0, stone: 0 }, dirtyZones: [], result: { commandId: command.commandId, accepted: false, code: 'REVISION_CONFLICT', revision: this.state.snapshot.revision, serverTime: this.now() } };
    }
    const before = this.state, execution = execute(this.state, command, this.now()); this.results.set(command.commandId, execution);
    this.onCommand?.(command, execution.result.accepted, before, execution.state);
    if (execution.result.accepted) {
      this.state = execution.state; this.publish(execution.dirtyZones, true); this.message(t('valid'));
      if (this.transport) { this.pending.push(command); this.updateSync(); void this.flush(); } else this.save();
    } else this.message(errorText(execution.result.code), true);
    return execution;
  }

  /** Sends pending commands in order (≤ 10 per request); verifies the server state hash. */
  private async flush(): Promise<void> {
    if (!this.transport || this.inflight || !this.pending.length || this.disposed) return;
    this.inflight = true; this.updateSync();
    const batch = this.pending.slice(0, MAX_BATCH);
    try {
      const response = await this.transport.send(batch);
      if (this.disposed) return;
      this.timeOffset = response.serverTime - Date.now(); this.retryDelay = 1000;
      useWorld.setState({ connection: 'online' });
      let confirmed = this.confirmed!, processed = 0, rejected: ErrorCode | null = null;
      for (const [i, result] of response.results.entries()) {
        processed++;
        if (result.accepted) confirmed = execute(confirmed, batch[i]!, result.serverTime).state;
        else { rejected = result.code; break; }
      }
      this.pending.splice(0, processed);
      if (stateHash(confirmed) !== response.stateHash) { await this.resync(); return; }
      this.confirmed = confirmed; this.saveConfirmed();
      if (rejected) { this.message(errorText(rejected), true); this.rebase(); }
    } catch (error) {
      if (error instanceof ApiError && error.status !== 0 && error.status !== 429 && error.status < 500) { await this.resync(); return; }
      useWorld.setState({ connection: 'offline' });
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.flush(); }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    } finally {
      this.inflight = false; this.updateSync();
      if (this.pending.length && useWorld.getState().connection !== 'offline') void this.flush();
    }
  }

  /** Re-applies pending commands on top of the confirmed state with fresh ids/revisions. */
  private rebase(): void {
    let s = this.confirmed!; const kept: Command[] = [];
    for (const old of this.pending) {
      const cmd = { ...old, commandId: crypto.randomUUID(), expectedRevision: s.snapshot.revision } as Command;
      const e = execute(s, cmd, this.now());
      if (e.result.accepted) { s = e.state; kept.push(cmd); }
    }
    this.pending = kept; this.state = s; this.publish(ALL_ZONES, true); this.updateSync();
  }

  /** Reloads the authoritative snapshot (hash mismatch, conflict, auth/validation errors). */
  async resync(): Promise<void> {
    if (!this.transport) return;
    try {
      this.adoptServer(await this.transport.fetchSnapshot());
      this.rebase();
    } catch { useWorld.setState({ connection: 'offline' }); }
  }

  private adoptServer(response: SnapshotResponse): void {
    this.timeOffset = response.serverTime - Date.now();
    const base = createState(this.template, Math.min(this.state.snapshot.serverTime, response.snapshot.serverTime), this.state.env.length ? this.state.env : generateEnvironment(this.template),
      { worldId: response.snapshot.worldId, accountId: response.snapshot.accountId, displayName: response.snapshot.character.displayName, tag: response.snapshot.character.tag });
    const checked = validateSnapshot(base, response.snapshot, response.serverTime);
    if (!checked.ok) throw new Error(`${t('cacheError')} ${checked.errors[0] ?? ''}`);
    recompute(checked.state);
    this.confirmed = checked.state; this.state = checked.state; this.pending = [];
    this.publish(ALL_ZONES, true); useWorld.setState({ connection: 'online' }); this.saveConfirmed();
  }

  tick(): void {
    const next = cloneState(this.state), before = JSON.stringify([next.snapshot.buildings, next.snapshot.bridges]);
    const previous = this.state;
    advanceTime(next, this.now()); this.state = next; this.onTick?.(previous, next);
    this.publish([], before !== JSON.stringify([next.snapshot.buildings, next.snapshot.bridges]));
    if (this.transport && this.pending.length && !this.inflight && useWorld.getState().connection === 'offline' && !this.retryTimer) void this.flush();
  }

  /** Validate-everything-then-swap for an externally supplied snapshot (offline test harness). */
  loadSnapshot(input: unknown): { ok: boolean; errors?: unknown } {
    if (this.transport) return { ok: false, errors: ['online mode'] };
    const checked = validateSnapshot(this.state, input, this.now());
    if (!checked.ok) return { ok: false, errors: checked.errors };
    this.state = checked.state; recompute(this.state); this.publish(ALL_ZONES, true); this.save();
    return { ok: true };
  }
  /** Only exposed in the offline development test harness; progression still runs through sim. */
  advanceForTest(ms: number): void { if (this.transport) return; this.timeOffset += ms; this.tick(); }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  message(message: string, error = false): void { useWorld.setState({ message, error }); }
  private updateSync(): void {
    const connection = useWorld.getState().connection;
    useWorld.setState({ pending: this.pending.length, connection: connection === 'offline' ? 'offline' : this.pending.length || this.inflight ? 'syncing' : (this.transport ? 'online' : 'local') });
  }
  private publish(dirty: readonly number[], entitiesChanged: boolean): void { useWorld.setState({ state: this.state }); for (const listener of this.listeners) listener(this.state, dirty, entitiesChanged); }
  private saveConfirmed(): void { if (this.confirmed) { const s = this.confirmed; this.saveChain = this.saveChain.then(() => this.cache.write(s)).catch(() => undefined); } }
  save(): void {
    this.saveChain = this.saveChain.then(async () => { if (!this.disposed) { await this.cache.write(this.state); useWorld.setState({ cacheStatus: t('saved') }); } }).catch(() => this.message(t('cacheError'), true));
  }
  async flushSaves(): Promise<void> { await this.saveChain; }
  /** Waits until every pending command has been confirmed (used before switching maps). */
  async drain(timeoutMs = 3000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (this.pending.length && Date.now() < end) { void this.flush(); await new Promise(r => setTimeout(r, 100)); }
    return this.pending.length === 0;
  }
  dispose(): void { this.disposed = true; clearTimeout(this.retryTimer); this.cache.close(); this.listeners.clear(); }
}
export interface ToolPreview { command: Command | null; cells: import('@xay-nha/contracts').Cell[]; valid: boolean; warning: boolean; code?: ErrorCode; cost?: Cost;
  /** Extra consequence shown before confirming (e.g. buildings that would lose road access). */ note?: string;
  /** Cells that are themselves the obstacle (drawn darker than the rest of an invalid preview). */ bad?: import('@xay-nha/contracts').Cell[] }
