import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene } from 'three';
import { createTestTemplate } from '@xay-nha/worldgen';
import { cloneState, createState } from '@xay-nha/sim';
import { commandEffects, commandPosition, EffectsRenderer, progressEffects } from './EffectsRenderer';

const NOW = 1_000_000;
/** Minimal DOM for the label layer (the unit suite runs in Node without jsdom). */
class FakeEl {
  className = ''; textContent = ''; style: Record<string, string> = {}; parent?: FakeEl; children: FakeEl[] = [];
  setAttribute(): void {}
  appendChild(child: FakeEl): FakeEl { child.parent = this; this.children.push(child); return child; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = undefined; }
  get childElementCount(): number { return this.children.length; }
  get firstElementChild(): FakeEl | null { return this.children[0] ?? null; }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  find(cls: string): FakeEl | undefined { for (const c of this.children) { if (c.className.split(' ').includes(cls)) return c; const d = c.find(cls); if (d) return d; } return undefined; }
}
const farmhouse = (status: 'CONSTRUCTING' | 'ACTIVE') => ({ id: 'b_1', defId: 'farmhouse', anchor: [72, 50] as [number, number], rotation: 0 as const, status,
  placedAt: NOW - 60_000, buildEndsAt: NOW, cashPaid: 500, materialsPaid: { cash: 500, wood: 10, stone: 5 }, investedValue: 750 });

describe('VFX (docs/13 §4.7, docs/09)', () => {
  it('locates commands in world metres', () => {
    const s = createState(createTestTemplate('farm'), NOW);
    expect(commandPosition('TERRAFORM', { rect: [10, 20, 12, 20], mode: 'RAISE' }, s, s)).toEqual([23, 41]);
    expect(commandPosition('HARVEST', { cells: [[4, 4]] }, s, s)).toEqual([9, 9]);
    expect(commandPosition('BUY_MATERIAL', { wood: 1 }, s, s)).toBeUndefined();
    const withB = cloneState(s); withB.snapshot.buildings.push(farmhouse('ACTIVE'));
    expect(commandPosition('COLLECT_PRODUCTION', { buildingId: 'b_1' }, withB, withB)).toEqual([147, 103]);
  });
  it('bursts and money/XP labels for accepted commands; construction done and level up from any change', () => {
    const before = createState(createTestTemplate('farm'), NOW); before.snapshot.buildings.push(farmhouse('CONSTRUCTING'));
    const after = cloneState(before);
    after.snapshot.wallet.cash += 120; after.snapshot.progress.xp += 15; after.snapshot.progress.level += 1; after.snapshot.buildings[0]!.status = 'ACTIVE';
    const effects = commandEffects('CLAIM_QUEST', { questId: 'q' }, before, after);
    expect(effects.map(e => e.burst ?? e.label)).toEqual(['+$120', '+15 XP', 'dust', '✔ Xong', 'sparkle', `Lên cấp ${after.snapshot.progress.level}!`]);
    expect(commandEffects('CLEAR_ENV', { envIds: [before.env[0]!.id] }, before, before)[0]).toMatchObject({ burst: 'chips' });
    expect(progressEffects(before, before)).toEqual([]);
    const xpOnly = cloneState(before); xpOnly.snapshot.progress.xp += 3;
    expect(commandEffects('TERRAFORM', { rect: [10, 20, 12, 20], mode: 'RAISE' }, before, xpOnly)).toContainEqual({ label: '+3 XP', tone: 'xp', at: [23, 41] });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('renders particles as one untextured instanced mesh, labels in a DOM layer, and cleans up', () => {
    vi.stubGlobal('document', { createElement: () => new FakeEl() });
    const scene = new Scene(), host = new FakeEl(), s = createState(createTestTemplate('farm'), NOW);
    const fx = new EffectsRenderer(scene, host as unknown as HTMLElement, () => s, () => [100, 100]);
    fx.show([{ burst: 'sparkle' }, { label: '+15 XP', tone: 'xp' }], () => ({ x: 10, y: 10 }));
    fx.animate(0.1);
    const mesh = scene.getObjectByName('vfx-particles') as unknown as { count: number; material: { map?: unknown } };
    expect(mesh.count).toBeGreaterThan(0); expect(mesh.material.map ?? null).toBeNull();
    expect(host.find('vfx-label')?.textContent).toBe('+15 XP');
    for (let i = 0; i < 40; i++) fx.animate(0.1);
    expect(mesh.count).toBe(0);
    fx.dispose(); expect(scene.getObjectByName('vfx-particles')).toBeUndefined(); expect(host.childElementCount).toBe(0);
  });
});
