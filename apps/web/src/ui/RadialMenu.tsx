import { useEffect, useRef } from 'react';
import type { Cell, MapKind } from '@xay-nha/contracts';
import { GameIcon, type GameIconName } from './GameIcon';

export type RadialAction = 'house' | 'road' | 'remove' | 'farm' | 'terraform' | 'nature';
interface Item { action: RadialAction; label: string; icon: GameIconName; x: number; y: number }
/** Layout of the reference: one action on top, two above-sides, two below-sides of the tile. */
export function radialItems(kind: MapKind): Item[] {
  return [
    { action: 'house', label: 'Nhà', icon: 'buildings', x: 0, y: -112 },
    { action: 'road', label: 'Đường', icon: 'road', x: -82, y: -58 },
    { action: 'remove', label: 'Dọn', icon: 'clear', x: 82, y: -58 },
    kind === 'farm' ? { action: 'farm', label: 'Ruộng', icon: 'wheat', x: -92, y: 40 } : { action: 'terraform', label: 'San nền', icon: 'terraform', x: -92, y: 40 },
    { action: 'nature', label: 'Thiên nhiên', icon: 'forest', x: 96, y: 40 },
  ];
}

interface Props {
  cell: Cell; kind: MapKind; project: (x: number, z: number) => { x: number; y: number };
  onAction: (action: RadialAction, cell: Cell) => void; onClose: () => void;
}
/** Radial action menu around a tapped empty tile, with the tile outlined as a diamond (screen-space SVG). */
export function RadialMenu({ cell, kind, project, onAction, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null), outline = useRef<SVGPolygonElement>(null);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      const host = root.current?.parentElement?.getBoundingClientRect();
      if (root.current && outline.current && host) {
        const [x, z] = cell, c = project(x * 2 + 1, z * 2 + 1);
        root.current.style.left = `${c.x - host.left}px`; root.current.style.top = `${c.y - host.top}px`;
        // Tile corners relative to the tile centre, scaled up to a readable on-screen size (the reference's large diamond).
        const corners = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([dx, dz]) => { const p = project(x * 2 + dx!, z * 2 + dz!); return [p.x - c.x, p.y - c.y] as const; });
        const width = Math.max(...corners.map(p => p[0])) - Math.min(...corners.map(p => p[0])), scale = Math.max(1, 110 / Math.max(1, width));
        outline.current.setAttribute('points', corners.map(([px, py]) => `${px * scale},${py * scale}`).join(' '));
      }
      frame = requestAnimationFrame(place);
    };
    place();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key); };
  }, [cell, project, onClose]);
  return <div className="hud3-radial" ref={root} role="menu" aria-label={`Thao tác tại ô ${cell[0]}, ${cell[1]}`}>
    <svg className="hud3-radial-tile" aria-hidden="true" width="1" height="1"><polygon ref={outline}/></svg>
    {radialItems(kind).map((item, i) => <button type="button" role="menuitem" key={item.action} className="hud3-radial-item" data-action={item.action}
      style={{ '--rx': `${item.x}px`, '--ry': `${item.y}px`, animationDelay: `${i * 25}ms` } as React.CSSProperties}
      onClick={() => onAction(item.action, cell)}><GameIcon name={item.icon}/><span>{item.label}</span></button>)}
  </div>;
}
