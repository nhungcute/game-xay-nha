import * as THREE from 'three';
import type { SimState } from '@xay-nha/sim';
import { money } from '../../i18n';
import { ALL_ZONES, heightAt } from './geometry';
import { zoneHighlights, type ZoneHighlight } from './zoneHighlight';

const ZONE_M = 32, STEP = 8, FILL_N = 8, EDGE_N = 16, BORDER_M = 0.9, LIFT = 0.35;
const FILL_VERTS = FILL_N * FILL_N * 6, EDGE_VERTS = 4 * EDGE_N * 6, PER_ZONE = FILL_VERTS + EDGE_VERTS;
/** RGBA (alpha scales with the pulse via material opacity). */
const COLORS = {
  ok: { fill: [1, 0.8, 0.2, 0.4], hot: [1, 0.85, 0.3, 0.62], edge: [1, 0.93, 0.55, 0.95] },
  poor: { fill: [1, 0.55, 0.25, 0.28], hot: [1, 0.6, 0.3, 0.46], edge: [1, 0.68, 0.45, 0.9] },
} as const;
const LABEL_W = 512, LABEL_H = 144;

interface Label { sprite: THREE.Sprite; material: THREE.SpriteMaterial; texture: THREE.CanvasTexture | null; key: string }

/** Canvas for a label, or null where there is no DOM (unit tests). */
function drawLabel(h: ZoneHighlight, hot: boolean, canvas: HTMLCanvasElement): void {
  const c = canvas.getContext('2d'); if (!c) return;
  c.clearRect(0, 0, LABEL_W, LABEL_H);
  const ok = h.kind === 'ok', poor = h.kind === 'poor', lock = h.kind === 'level';
  c.fillStyle = hot ? 'rgba(52,38,6,.92)' : 'rgba(22,26,32,.84)'; c.strokeStyle = ok ? '#ffe08a' : poor ? '#ff8f6b' : '#9aa3ad'; c.lineWidth = hot ? 7 : 4;
  c.beginPath(); c.roundRect(6, 6, LABEL_W - 12, LABEL_H - 12, 34); c.fill(); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 54px "Segoe UI", system-ui, sans-serif';
  const row = (text: string, y: number) => { c.fillText(text, LABEL_W / 2, y); };
  if (lock) { c.fillStyle = '#c9d0d8'; row(`Khóa · Cấp ${h.level}`, LABEL_H / 2); return; }
  const lead = 'Mở khu · ', price = money(h.cost ?? 0), wl = c.measureText(lead).width, wp = c.measureText(price).width, x0 = (LABEL_W - wl - wp) / 2, y = poor ? 54 : LABEL_H / 2;
  c.textAlign = 'left'; c.fillStyle = '#ffffff'; c.fillText(lead, x0, y); c.fillStyle = poor ? '#ff6b64' : '#ffd95c'; c.fillText(price, x0 + wl, y);
  if (poor) { c.textAlign = 'center'; c.font = '600 36px "Segoe UI", system-ui, sans-serif'; c.fillStyle = '#ffb4a8'; c.fillText('Chưa đủ tiền', LABEL_W / 2, 104); }
}

/**
 * Khu đất tool overlay: while the tool is active, locked zones the sim would sell right now get a pulsing gold tint plus a bright
 * border on the terrain and a billboard price label; zones blocked by cash keep the tint with a red price; level-blocked zones get a
 * small "Khóa · Cấp N" tag; non-adjacent zones show nothing (their faint outline stays with OverlayRenderer). One merged
 * vertex-coloured mesh for tints + borders (one draw call) and a pool of ≤64 sprites; rebuilt only on revision / level / cash-band /
 * hover changes. Unlit and untinted by night, below the bloom threshold.
 */
export class ZoneHighlightRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly mesh: THREE.Mesh;
  private readonly group = new THREE.Group();
  private readonly labels = new Map<number, Label>();
  private shown: ZoneHighlight[] = [];
  private base: ZoneHighlight[] = [];
  private baseKey = '';
  private viewKey = '';
  private hover = -1;
  private time = 0;
  private active = false;
  constructor(private readonly scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ALL_ZONES.length * PER_ZONE * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ALL_ZONES.length * PER_ZONE * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.name = 'zone-highlight'; this.mesh.renderOrder = 4; this.mesh.frustumCulled = false;
    this.group.name = 'zone-highlight-labels'; this.group.visible = false; this.mesh.visible = false;
    scene.add(this.mesh, this.group);
  }
  /** Zones currently highlighted (for tests and QA). */
  get highlights(): readonly ZoneHighlight[] { return this.shown; }
  get visible(): boolean { return this.active; }

  /** Cheap to call every frame: reclassifies only when revision / level / zones change, recolours when a price becomes (un)affordable or the hover moves. */
  sync(state: SimState, now: number, active: boolean, hoverZone = -1): void {
    if (!active) { if (this.active) { this.active = false; this.viewKey = ''; this.shown = []; this.mesh.visible = false; this.group.visible = false; } return; }
    const s = state.snapshot, key = `${s.revision}|${s.progress.level}|${s.unlockedZones.join(',')}`;
    if (key !== this.baseKey) { this.baseKey = key; this.base = zoneHighlights(state, now); this.viewKey = ''; }
    const cash = s.wallet.cash, view = this.base.map(h => h.cost !== undefined ? { ...h, kind: cash >= h.cost ? 'ok' : 'poor' } as ZoneHighlight : h);
    const viewKey = `${view.map(h => h.kind[0]).join('')}|${hoverZone}`;
    if (viewKey === this.viewKey && this.active) return;
    this.viewKey = viewKey; this.active = true; this.hover = hoverZone; this.shown = view.filter(h => h.kind === 'ok' || h.kind === 'poor' || h.kind === 'level');
    this.build(state, view); this.mesh.visible = true; this.group.visible = true;
  }

  private build(state: SimState, view: ZoneHighlight[]): void {
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute, col = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    let v = 0;
    const put = (x: number, z: number, rgba: readonly number[]) => { pos.setXYZ(v, x, heightAt(state.heights, x, z) + LIFT, z); col.setXYZW(v, rgba[0]!, rgba[1]!, rgba[2]!, rgba[3]!); v++; };
    const quad = (x0: number, z0: number, x1: number, z1: number, rgba: readonly number[]) => { put(x0, z0, rgba); put(x0, z1, rgba); put(x1, z1, rgba); put(x0, z0, rgba); put(x1, z1, rgba); put(x1, z0, rgba); };
    for (const h of view) {
      const palette = h.kind === 'ok' ? COLORS.ok : h.kind === 'poor' ? COLORS.poor : null;
      if (palette) {
        const ox = h.zone % 8 * ZONE_M, oz = Math.floor(h.zone / 8) * ZONE_M, hot = h.zone === this.hover, fill = hot ? palette.hot : palette.fill;
        const e = hot ? [1, 1, 0.8, 1] : palette.edge;
        for (let j = 0; j < FILL_N; j++) for (let i = 0; i < FILL_N; i++) quad(ox + i * STEP / 2, oz + j * STEP / 2, ox + (i + 1) * STEP / 2, oz + (j + 1) * STEP / 2, fill);
        // Border strips, inside the zone edge so neighbouring zones never overlap.
        const k = ZONE_M / EDGE_N, w = hot ? BORDER_M * 1.5 : BORDER_M;
        for (let n = 0; n < EDGE_N; n++) {
          quad(ox + n * k, oz, ox + (n + 1) * k, oz + w, e); quad(ox + n * k, oz + ZONE_M - w, ox + (n + 1) * k, oz + ZONE_M, e);
          quad(ox, oz + n * k, ox + w, oz + (n + 1) * k, e); quad(ox + ZONE_M - w, oz + n * k, ox + ZONE_M, oz + (n + 1) * k, e);
        }
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true; this.geometry.setDrawRange(0, v);
    const used = new Set<number>();
    for (const h of view) if (h.kind === 'ok' || h.kind === 'poor' || h.kind === 'level') {
      used.add(h.zone); this.label(h, state);
    }
    for (const [zone, label] of this.labels) label.sprite.visible = used.has(zone);
  }

  private label(h: ZoneHighlight, state: SimState): void {
    let label = this.labels.get(h.zone);
    if (!label) {
      const material = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
      const sprite = new THREE.Sprite(material); sprite.name = `zone-label-${h.zone}`; sprite.renderOrder = 12; sprite.center.set(0.5, 0.5);
      this.group.add(sprite); label = { sprite, material, texture: null, key: '' }; this.labels.set(h.zone, label);
    }
    const hot = h.zone === this.hover, key = `${h.kind}|${h.cost ?? ''}|${h.level ?? ''}|${hot}`;
    const x = h.zone % 8 * ZONE_M + ZONE_M / 2, z = Math.floor(h.zone / 8) * ZONE_M + ZONE_M / 2;
    label.sprite.position.set(x, heightAt(state.heights, x, z) + 4, z);
    if (key === label.key || typeof document === 'undefined') return;
    label.key = key;
    if (!label.texture) {
      const canvas = document.createElement('canvas'); canvas.width = LABEL_W; canvas.height = LABEL_H;
      label.texture = new THREE.CanvasTexture(canvas); label.texture.colorSpace = THREE.SRGBColorSpace; label.texture.anisotropy = 4;
      label.material.map = label.texture; label.material.needsUpdate = true;
    }
    drawLabel(h, hot, label.texture.image as HTMLCanvasElement); label.texture.needsUpdate = true;
  }

  /** Pulse, and keep labels a readable screen size: world height grows with camera distance, clamped so one never outgrows its zone. */
  animate(dt: number, camera: THREE.Camera): void {
    if (!this.active) return;
    this.time += dt; this.material.opacity = 0.82 + 0.18 * Math.sin(this.time * 3.2);
    for (const label of this.labels.values()) if (label.sprite.visible) {
      const hgt = Math.min(6.5, Math.max(1.6, camera.position.distanceTo(label.sprite.position) * 0.04)) * (label.key.endsWith('true') ? 1.12 : 1);
      label.sprite.scale.set(hgt * LABEL_W / LABEL_H, hgt, 1);
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh, this.group); this.geometry.dispose(); this.material.dispose();
    for (const label of this.labels.values()) { label.material.dispose(); label.texture?.dispose(); }
    this.labels.clear();
  }
}
