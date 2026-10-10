import { BoxGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D, type Scene } from 'three';
import { CELL_SIZE_M, type Cell, type CommandType } from '@xay-nha/contracts';
import { catalog } from '@xay-nha/content';
import { rotatedSize, type SimState } from '@xay-nha/sim';
import { terrainHeight } from '../assets/placement';

/**
 * Local VFX (docs/13 §4.7, docs/09): dust, wood chips, water splash, level-up sparkle as small untextured cubes in one
 * InstancedMesh (no image planes), plus floating HTML labels ("+$120", "+15 XP", "✔ Xong", "Lên cấp!").
 * Presentation only; driven by the same command/tick hooks as the sound effects.
 */
export type Burst = 'dust' | 'chips' | 'splash' | 'sparkle';
export interface Effect { burst?: Burst; label?: string; tone?: 'money' | 'xp' | 'done' | 'level'; at?: [number, number] }

const COLORS: Record<Burst, string[]> = {
  dust: ['#b39a73', '#9c8460', '#c8b48f'], chips: ['#8a5a2b', '#a8743d', '#5f7f3a'],
  splash: ['#9fd3e6', '#d8f1f7', '#6fb3cc'], sparkle: ['#ffd84a', '#fff2a8', '#ffb627'],
};
const COUNT: Record<Burst, number> = { dust: 18, chips: 14, splash: 16, sparkle: 30 };
const MAX = 512;

const center = (cells: readonly Cell[]): [number, number] | undefined => {
  if (!cells.length) return undefined;
  const x = cells.reduce((s, c) => s + c[0], 0) / cells.length, z = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  return [(x + .5) * CELL_SIZE_M, (z + .5) * CELL_SIZE_M];
};
const buildingCenter = (s: SimState, id: string): [number, number] | undefined => {
  const b = s.snapshot.buildings.find(x => x.id === id), def = b && catalog.buildings[b.defId];
  if (!b || !def) return undefined;
  const [w, d] = rotatedSize(def, b.rotation);
  return [(b.anchor[0] + w / 2) * CELL_SIZE_M, (b.anchor[1] + d / 2) * CELL_SIZE_M];
};
/** World position (x, z in metres) a command acted on, when it has one. */
export function commandPosition(type: CommandType, payload: unknown, before: SimState, after: SimState): [number, number] | undefined {
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.rect)) { const [x0, z0, x1, z1] = p.rect as number[]; return center([[x0!, z0!], [x1!, z1!]]); }
  if (Array.isArray(p.cells)) return center(p.cells as Cell[]);
  if (Array.isArray(p.envIds)) return center(before.env.filter(e => (p.envIds as string[]).includes(e.id)).map(e => e.cell));
  if (Array.isArray(p.anchor) && typeof p.defId === 'string') { const placed = after.snapshot.buildings.at(-1); return placed ? buildingCenter(after, placed.id) : undefined; }
  if (typeof p.buildingId === 'string') return buildingCenter(before, p.buildingId) ?? buildingCenter(after, p.buildingId);
  if (Array.isArray(p.buildingIds) && p.buildingIds.length === 1) return buildingCenter(before, p.buildingIds[0] as string);
  if (Array.isArray(p.a) && Array.isArray(p.b)) return center([p.a as Cell, p.b as Cell]);
  return undefined;
}
const BURST: Partial<Record<CommandType, Burst>> = {
  CLEAR_ENV: 'chips', DEMOLISH: 'dust', TERRAFORM: 'dust', TILL: 'dust', UNTILL: 'dust', PLANT: 'dust', BUILD_ROAD: 'dust', REMOVE_ROAD: 'dust',
  PLACE_BUILDING: 'dust', EMBANK: 'splash', REMOVE_EMBANK: 'splash', BUILD_BRIDGE: 'splash', REMOVE_BRIDGE: 'splash', HARVEST: 'chips',
};
const money = (v: number) => `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
/** Effects for one accepted command (pure; unit-tested). */
export function commandEffects(type: CommandType, payload: unknown, before: SimState, after: SimState): Effect[] {
  const at = commandPosition(type, payload, before, after), effects: Effect[] = [];
  const burst = BURST[type]; if (burst && at) effects.push({ burst, at });
  const gained = after.snapshot.wallet.cash - before.snapshot.wallet.cash;
  if (gained > 0 && ['COLLECT', 'SELL', 'CLAIM_QUEST'].includes(type)) effects.push({ label: money(gained), tone: 'money', at });
  // XP from this command floats up where the player acted, not at the camera centre.
  return [...effects, ...progressEffects(before, after).map(e => (e.tone === 'xp' && at ? { ...e, at } : e))];
}
/** XP, level and construction-finished effects from any state change (commands or time). */
export function progressEffects(before: SimState, after: SimState): Effect[] {
  const effects: Effect[] = [], xp = after.snapshot.progress.xp - before.snapshot.progress.xp;
  if (xp > 0) effects.push({ label: `+${xp} XP`, tone: 'xp' });
  const was = new Map([...before.snapshot.buildings, ...before.snapshot.bridges].map(b => [b.id, b.status]));
  for (const b of after.snapshot.buildings) if (b.status === 'ACTIVE' && was.get(b.id) === 'CONSTRUCTING') {
    const at = buildingCenter(after, b.id); effects.push({ burst: 'dust', at }, { label: '✔ Xong', tone: 'done', at });
  }
  if (after.snapshot.progress.level > before.snapshot.progress.level) effects.push({ burst: 'sparkle' }, { label: `Lên cấp ${after.snapshot.progress.level}!`, tone: 'level' });
  return effects;
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; age: number; color: Color }
export class EffectsRenderer {
  private readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly particles: Particle[] = [];
  private readonly labels: HTMLDivElement;
  private seed = 1;
  constructor(private readonly scene: Scene, host: HTMLElement | null, private readonly state: () => SimState, private readonly focus: () => [number, number]) {
    this.mesh = new InstancedMesh(new BoxGeometry(.45, .45, .45), new MeshBasicMaterial({ color: '#ffffff' }), MAX);
    this.mesh.name = 'vfx-particles'; this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new Color('#ffffff'));
    scene.add(this.mesh);
    this.labels = document.createElement('div'); this.labels.className = 'vfx-labels'; this.labels.setAttribute('aria-hidden', 'true');
    host?.appendChild(this.labels);
  }
  private random(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  show(effects: readonly Effect[], project: (x: number, z: number) => { x: number; y: number }): void {
    for (const e of effects) {
      const at = e.at ?? this.focus();
      if (e.burst) this.burst(e.burst, at);
      if (e.label) this.label(e.label, e.tone ?? 'xp', project(at[0], at[1]));
    }
  }
  private burst(kind: Burst, [x, z]: [number, number]): void {
    const y = terrainHeight(this.state(), x, z) + .3, palette = COLORS[kind];
    for (let i = 0; i < COUNT[kind] && this.particles.length < MAX; i++) {
      const angle = this.random() * Math.PI * 2, speed = (kind === 'sparkle' ? 4 : 2) * (.5 + this.random());
      this.particles.push({ x, y, z, vx: Math.cos(angle) * speed, vy: (kind === 'sparkle' ? 7 : 3.5) * (.6 + this.random() * .6), vz: Math.sin(angle) * speed,
        life: .7 + this.random() * .5, age: 0, color: new Color(palette[i % palette.length]) });
    }
  }
  private label(text: string, tone: string, at: { x: number; y: number }): void {
    const el = document.createElement('div'); el.className = `vfx-label ${tone}`; el.textContent = text;
    const host = this.labels.getBoundingClientRect();
    el.style.left = `${at.x - host.left}px`; el.style.top = `${at.y - host.top}px`;
    this.labels.appendChild(el);
    while (this.labels.childElementCount > 12) this.labels.firstElementChild?.remove();
    setTimeout(() => el.remove(), 1600);
  }
  animate(dt: number): void {
    if (!this.particles.length && !this.mesh.count) return;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!; p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.vy -= 12 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    this.particles.forEach((p, i) => {
      const scale = Math.max(.05, 1 - p.age / p.life);
      this.dummy.position.set(p.x, p.y, p.z); this.dummy.scale.setScalar(scale); this.dummy.rotation.set(p.age * 6, p.age * 4, 0);
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); this.mesh.setColorAt(i, p.color);
    });
    this.mesh.count = this.particles.length;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose(): void {
    this.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as MeshBasicMaterial).dispose(); this.mesh.dispose();
    this.labels.remove(); this.particles.length = 0;
  }
}
