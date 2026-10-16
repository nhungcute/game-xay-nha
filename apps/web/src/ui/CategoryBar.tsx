import { catalog } from '@xay-nha/content';
import { hasFarmFeatures, kindAllows, type BuildingDef, type MapKind } from '@xay-nha/contracts';
import { buildingLimit } from '@xay-nha/sim';
import type { Tool } from '../game/ToolController';
import type { WorldStore } from '../game/WorldStore';
import { duration, money, t } from '../i18n';
import { GameIcon, type GameIconName } from './GameIcon';

export type Category = 'buildings' | 'roads' | 'farms' | 'land' | 'decorations' | 'utilities';
export const CATEGORIES: { id: Category; label: string; icon: GameIconName; farmOnly?: boolean }[] = [
  { id: 'buildings', label: 'Công trình', icon: 'buildings' },
  { id: 'roads', label: 'Đường', icon: 'road' },
  { id: 'farms', label: 'Nông trại', icon: 'farm', farmOnly: true },
  { id: 'land', label: 'Đất đai', icon: 'zone' },
  { id: 'decorations', label: 'Trang trí', icon: 'decor' },
  { id: 'utilities', label: 'Tiện ích', icon: 'utilities' },
];
const TOOLS: Record<Category, Tool[]> = {
  buildings: [], roads: ['road', 'bridge', 'embank'], farms: ['till', 'plant', 'harvest'],
  land: ['clear', 'terraform', 'zone'], decorations: [], utilities: [],
};
/** Phá (demolish) is no tab's tool: it is the quick button beside the Dock, reachable from any tab. */
export const QUICK_TOOL: Tool = 'demolish';
/** Which bar category a building belongs to (presentation only). */
export function buildingCategory(def: BuildingDef): Category {
  if (def.id.startsWith('landmark_')) return 'buildings';
  if (def.decor || def.id.startsWith('deco_')) return 'decorations';
  if (def.production) return 'farms';
  if (def.bankCapHours) return 'buildings'; // the bank is a functional building, not a utility
  if (def.storageBonus || def.id === 'well') return 'utilities';
  return 'buildings';
}
export function categoryOf(tool: Tool, buildingId: string): Category | null {
  if (tool === 'build') { const def = catalog.buildings[buildingId]; return def ? buildingCategory(def) : 'buildings'; }
  return (Object.keys(TOOLS) as Category[]).find(c => TOOLS[c].includes(tool)) ?? null;
}
/** Tabs shown for a map kind: farm-only ones are dropped on the city, and a tab with no tool and no building is hidden (no empty tray). */
export function visibleCategories(kind: MapKind) {
  return CATEGORIES.filter(c => (!c.farmOnly || hasFarmFeatures(kind)) && (TOOLS[c.id].length > 0 || Object.values(catalog.buildings).some(d => kindAllows(d.mapKinds, kind) && buildingCategory(d) === c.id)));
}
export function categoryTools(category: Category): Tool[] { return TOOLS[category]; }

interface BarProps {
  kind: MapKind; active: Category | null; hintCategory?: Category | null;
  onCategory: (category: Category) => void; onMeasure: (element: HTMLElement | null) => void;
}
export function CategoryBar({ kind, active, hintCategory, onCategory, onMeasure }: BarProps) {
  return <nav className="hud3-pill hud3-bar" aria-label="Danh mục xây dựng" ref={onMeasure}>
    {visibleCategories(kind).map(c => <button type="button" key={c.id} className="hud3-cat" data-cat={c.id}
      aria-pressed={active === c.id} onClick={() => onCategory(c.id)}>
      <span className="hud3-cat-icon"><GameIcon name={c.icon}/>{hintCategory === c.id && active !== c.id && <span className="hud3-dot" aria-label="Có công cụ hướng dẫn"/>}</span>
      <span>{c.label}</span>
    </button>)}
  </nav>;
}

interface TrayProps {
  state: WorldStore['state']; category: Category; tool: Tool; buildingId: string; hintTool?: Tool;
  onTool: (tool: Tool) => void; onBuilding: (defId: string) => void;
}
export function CategoryTray({ state, category, tool, buildingId, hintTool, onTool, onBuilding }: TrayProps) {
  const kind = state.template.mapKind, level = state.snapshot.progress.level;
  const defs = Object.values(catalog.buildings).filter(d => kindAllows(d.mapKinds, kind) && buildingCategory(d) === category);
  const label = CATEGORIES.find(c => c.id === category)!.label;
  return <div className="hud3-pill hud3-tray" role="group" aria-label={label}>
    {TOOLS[category].map(item => <button type="button" key={item} className={`hud3-tool ${hintTool === item && tool !== item ? 'is-hint' : ''}`} data-tool={item}
      aria-pressed={tool === item} onClick={() => onTool(item)}><GameIcon name={item}/><span>{t(item)}</span></button>)}
    {defs.map(def => {
      const count = state.snapshot.buildings.filter(b => b.defId === def.id).length, limit = buildingLimit(state, def), locked = def.unlockLevel > level;
      return <button type="button" key={def.id} className="hud3-card" data-def={def.id} aria-pressed={tool === 'build' && buildingId === def.id}
        disabled={locked} title={locked ? `Mở khóa ở cấp ${def.unlockLevel}` : ''} onClick={() => onBuilding(def.id)}>
        <strong>{t(def.nameKey)}</strong>
        <span className="hud3-card-cost"><GameIcon name="cash"/>{money(def.cost.cash)}{def.cost.wood ? <><GameIcon name="wood"/>{def.cost.wood}</> : null}{def.cost.stone ? <><GameIcon name="stone"/>{def.cost.stone}</> : null}</span>
        <small>{locked ? <><GameIcon name="lock"/>Cấp {def.unlockLevel}</> : <>{def.size.join('×')} · {duration(def.buildSeconds * 1000)} · {count}/{Number.isFinite(limit) ? limit : '∞'}</>}</small>
      </button>;
    })}
  </div>;
}

/** Quick Phá toggle beside the Dock: pressed while demolish is active, press again to go back to explore. */
export function DemolishButton({ active, hint, onToggle }: { active: boolean; hint?: boolean; onToggle: () => void }) {
  return <button type="button" className={`hud3-pill hud3-quick ${hint && !active ? 'is-hint' : ''}`} data-tool="demolish" aria-label="Phá công trình" aria-pressed={active} title="Phá (bấm lần nữa để thoát)" onClick={onToggle}>
    <GameIcon name="demolish"/><span>{t('demolish')}</span>
  </button>;
}
