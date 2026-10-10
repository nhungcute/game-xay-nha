import { useEffect, useRef } from 'react';
import { GRID, Surface, cellIndex } from '@xay-nha/contracts';
import type { WorldStore } from '../game/WorldStore';
import type { CameraRig } from '../game/CameraRig';

/** Round mini-map (bottom-left) with a north marker; click to move the camera, the frame shows the current view. */
export function MiniMap({ state, rig }: { state: WorldStore['state']; rig: CameraRig | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null), marker = useRef<HTMLSpanElement>(null);
  const revision = state.snapshot.revision;
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const pixels = ctx.createImageData(GRID, GRID), unlocked = new Set(state.snapshot.unlockedZones);
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const i = cellIndex(x, z), surface = state.surface[i];
      const color = surface === Surface.WATER ? [74, 164, 196] : surface === Surface.ROCK_GROUND ? [150, 150, 128]
        : surface === Surface.SAND ? [214, 200, 140] : surface === Surface.TILLED ? [136, 104, 62]
        : [118 + (x * 7 + z * 13) % 16, 168 + (x * 3 + z * 5) % 16, 82];
      const shade = unlocked.has(Math.floor(z / 16) * 8 + Math.floor(x / 16)) ? 1 : .8;
      for (let n = 0; n < 3; n++) pixels.data[i * 4 + n] = color[n]! * shade;
      pixels.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const removed = new Set(state.snapshot.delta.removedEnvIds);
    ctx.fillStyle = '#3f6e3c';
    for (const env of state.env) if (!removed.has(env.id) && env.assetId.startsWith('tree')) ctx.fillRect(env.cell[0], env.cell[1], 1.4, 1.4);
    ctx.fillStyle = '#9b7348';
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) if (state.roadTier[cellIndex(x, z)]) ctx.fillRect(x, z, 1, 1);
    ctx.fillStyle = '#fff6d2';
    for (const building of state.snapshot.buildings) ctx.fillRect(building.anchor[0] - 1, building.anchor[1] - 1, 3, 3);
  }, [state, revision]);
  useEffect(() => {
    if (!rig) return;
    const refresh = () => {
      if (!marker.current) return;
      marker.current.style.left = `${rig.target.x / 2 / GRID * 100}%`;
      marker.current.style.top = `${rig.target.z / 2 / GRID * 100}%`;
      marker.current.style.width = `${Math.min(55, rig.distance / 5)}%`;
      marker.current.style.height = `${Math.min(45, rig.distance / 6.5)}%`;
    };
    refresh(); const timer = window.setInterval(refresh, 150); return () => window.clearInterval(timer);
  }, [rig]);
  return <aside className="hud3-minimap" aria-label="Bản đồ thu nhỏ">
    <span className="hud3-north" aria-hidden="true"><b>N</b><i/></span>
    <button type="button" className="hud3-minimap-surface" aria-label="Di chuyển góc nhìn trên bản đồ thu nhỏ" onClick={event => {
      if (event.detail === 0) { rig?.reset(); return; }
      const bounds = event.currentTarget.getBoundingClientRect();
      rig?.focus((event.clientX - bounds.left) / bounds.width * GRID * 2, (event.clientY - bounds.top) / bounds.height * GRID * 2);
    }}><canvas ref={canvas} width={GRID} height={GRID}/><span className="hud3-minimap-view" ref={marker}/></button>
  </aside>;
}
