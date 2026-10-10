import { useEffect, useRef, useState } from 'react';
import { GRID, Surface, cellIndex } from '@xay-nha/contracts';
import type { WorldStore } from '../game/WorldStore';
import type { CameraRig } from '../game/CameraRig';
import { GameIcon } from './GameIcon';

export function MiniMap({ state, rig }: { state: WorldStore['state']; rig: CameraRig | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null), marker = useRef<HTMLSpanElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const revision = state.snapshot.revision;
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx || collapsed) return;
    const pixels = ctx.createImageData(GRID, GRID), unlocked = new Set(state.snapshot.unlockedZones);
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const i = cellIndex(x, z), surface = state.surface[i];
      const color = surface === Surface.WATER ? [61, 158, 164] : surface === Surface.ROCK_GROUND ? [144, 151, 115]
        : surface === Surface.SAND ? [210, 207, 135] : surface === Surface.TILLED ? [136, 116, 70]
        : [135 + (x * 7 + z * 13) % 18, 169 + (x * 3 + z * 5) % 18, 89];
      const shade = unlocked.has(Math.floor(z / 16) * 8 + Math.floor(x / 16)) ? 1 : .75;
      for (let n = 0; n < 3; n++) pixels.data[i * 4 + n] = color[n]! * shade;
      pixels.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const removed = new Set(state.snapshot.delta.removedEnvIds);
    ctx.fillStyle = '#557b48';
    for (const env of state.env) if (!removed.has(env.id) && env.assetId.startsWith('tree')) ctx.fillRect(env.cell[0], env.cell[1], 1.3, 1.3);
    ctx.fillStyle = '#d8c898';
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) if (state.roadTier[cellIndex(x, z)]) ctx.fillRect(x, z, 1, 1);
    ctx.fillStyle = '#fff2bd';
    for (const building of state.snapshot.buildings) ctx.fillRect(building.anchor[0] - 1, building.anchor[1] - 1, 3, 3);
  }, [state, revision, collapsed]);
  useEffect(() => {
    if (!rig || collapsed) return;
    const refresh = () => {
      if (!marker.current) return;
      marker.current.style.left = `${rig.target.x / 2 / GRID * 100}%`;
      marker.current.style.top = `${rig.target.z / 2 / GRID * 100}%`;
      marker.current.style.width = `${Math.min(60, rig.distance / 5)}%`;
      marker.current.style.height = `${Math.min(60, rig.distance / 6)}%`;
    };
    refresh(); const timer = window.setInterval(refresh, 150); return () => window.clearInterval(timer);
  }, [rig, collapsed]);
  return <aside className={`mini-map ${collapsed ? 'is-collapsed' : ''}`} aria-label="Bản đồ thu nhỏ">
    <button className="mini-map-toggle" aria-label={collapsed ? 'Mở bản đồ thu nhỏ' : 'Thu gọn bản đồ thu nhỏ'} aria-expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)}><GameIcon name={collapsed ? 'maps' : 'down'}/></button>
    {!collapsed && <button className="mini-map-surface" aria-label="Di chuyển góc nhìn trên bản đồ thu nhỏ" onClick={event => {
      if (event.detail === 0) { rig?.reset(); return; }
      const bounds = event.currentTarget.getBoundingClientRect();
      rig?.focus((event.clientX - bounds.left) / bounds.width * GRID * 2, (event.clientY - bounds.top) / bounds.height * GRID * 2);
    }}><canvas ref={canvas} width={GRID} height={GRID}/><span className="mini-map-viewport" ref={marker}/></button>}
  </aside>;
}
