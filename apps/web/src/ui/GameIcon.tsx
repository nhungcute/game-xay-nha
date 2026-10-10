import {
  Axe, BrickWall, Bridge, Check, ChevronDown, Coins, Compass, Gem, HandCoins, HardHat,
  House, HousePlus, Layers, LayoutGrid, Menu, Minus, PackageOpen, Pickaxe, Plus, Hammer, Settings,
  RotateCcw, RotateCw, Route, ScrollText, Shovel, Sprout, Star, Trash2,
  TreePine, Users, Wallet, Wheat, Wifi, WifiOff, X, Map, ChartColumn, Crosshair, ChevronRight, Gift,
} from 'lucide-react';

const icons = {
  explore: Compass, clear: Axe, terraform: Shovel, till: Pickaxe, road: Route, embank: BrickWall,
  bridge: Bridge, build: HousePlus, plant: Sprout, harvest: Wheat, demolish: Trash2, zone: LayoutGrid,
  wood: TreePine, stone: Gem, cash: Coins, builders: HardHat, people: Users, inventory: PackageOpen,
  profile: Wallet, settings: Settings, quests: ScrollText, maps: Map, menu: Menu, down: ChevronDown,
  city: House, farm: Sprout, level: Star, collect: HandCoins, online: Wifi, offline: WifiOff,
  confirm: Check, close: X, zoomIn: Plus, zoomOut: Minus, reset: RotateCcw, rotate: RotateCw, terrain: Layers,
  stats: ChartColumn, focus: Crosshair, next: ChevronRight, gift: Gift,
  construction: Hammer,
};
export type GameIconName = keyof typeof icons;

export function GameIcon({ name, className = '' }: { name: GameIconName; className?: string }) {
  const art = illustrated[name];
  if (art) return <svg className={`game-icon illustrated-icon icon-${name} ${className}`} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{art}</svg>;
  const Icon = icons[name];
  return <Icon className={`game-icon ${className}`} size={20} strokeWidth={1.8} aria-hidden="true" focusable="false"/>;
}

// Small native vectors retain crisp edges at every display density, with the reference's warm palette.
const illustrated: Partial<Record<GameIconName, React.ReactNode>> = {
  cash: <><circle cx="12" cy="12" r="10" fill="#e9b845"/><circle cx="12" cy="12" r="7.5" fill="#ffd96c" stroke="#d89c28" strokeWidth="1.5"/><path d="M14.5 8.5h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4H9.5M12 6.5v11" fill="none" stroke="#b17a1e" strokeWidth="1.7" strokeLinecap="round"/></>,
  wood: <g transform="rotate(-28 12 12)"><rect x="5" y="3" width="15" height="5" rx="2.5" fill="#a47146"/><circle cx="7.5" cy="5.5" r="2.5" fill="#c9a172"/><circle cx="7.5" cy="5.5" r="1.1" fill="none" stroke="#956e47" strokeWidth=".7"/><rect x="2" y="9" width="16" height="5" rx="2.5" fill="#92603b"/><circle cx="4.5" cy="11.5" r="2.5" fill="#d1ae7e"/><circle cx="4.5" cy="11.5" r="1.1" fill="none" stroke="#9b7046" strokeWidth=".7"/><rect x="6" y="15" width="15" height="5" rx="2.5" fill="#ab784b"/><circle cx="8.5" cy="17.5" r="2.5" fill="#d7b687"/><circle cx="8.5" cy="17.5" r="1.1" fill="none" stroke="#a1764a" strokeWidth=".7"/></g>,
  stone: <><path d="m3 11 4-6 6-2 5 5 2 9-7 5-9-3z" fill="#8f9487"/><path d="m7 5 6-2 1 9-10 7-1-8z" fill="#b2b5a7"/><path d="m14 12 4-4 2 9-7 5z" fill="#747d71"/><path d="m17 18 3-3 3 2-1 4-4 1z" fill="#66805a"/></>,
  city: <><path d="m2 11 10-9 10 9-3 1v10H5V12z" fill="currentColor"/><path d="M10 15h5v7h-5z" fill="#73945e"/><path d="M17 3h3v6l-3-3z" fill="currentColor"/></>,
  build: <><path d="m2 11 10-9 10 9M5 10v11h14V10" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 14h5v7h-5z" fill="currentColor"/></>,
  road: <><path d="M7 2h10l5 20H2z" fill="currentColor"/><path d="M12 4v4m0 3v4m0 3v3" stroke="#fffdf1" strokeWidth="1.5"/></>,
  bridge: <><path d="M3 14a9 9 0 0 1 18 0M6 14a6 6 0 0 1 12 0M2 15h20M5 15v6m14-6v6M9 11v4m6-4v4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></>,
  embank: <><path d="M5 3v18M12 3v18M19 3v18M2 8h20M2 16h20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></>,
  terraform: <><path d="m2 21 7-15 5 7 3-5 6 13z" fill="currentColor"/><path d="m7 11 2-5 3 5m4 1 1-4 2 4" fill="#faf8e8"/></>,
  clear: <><path d="m12 1 7 9h-4l6 8h-7v5h-4v-5H3l6-8H5z" fill="currentColor"/><path d="m12 1 0 16H5l5-7H7z" fill="#759569"/></>,
  demolish: <><path d="m2 21 4-8 4 3 1-11 4 10 5-6-2 10 4 2z" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"/><path d="m7 21 3-5 3 3 2-2 2 4" fill="currentColor"/></>,
  zone: <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray="3 2"/>,
  people: <><circle cx="9" cy="7" r="4" fill="currentColor"/><circle cx="18" cy="8" r="3" fill="#80a36f"/><path d="M1 21v-4a8 8 0 0 1 16 0v4z" fill="currentColor"/><path d="M18 14a6 6 0 0 1 5 6v1h-4v-4z" fill="#80a36f"/></>,
  construction: <><path d="m4 20 10-12 3 3L7 23z" fill="#af7f31"/><path d="m12 3 4-2 7 6-4 5-7-6z" fill="#e7be59" stroke="#ad843d" strokeWidth="1"/></>,
};
