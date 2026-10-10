import {
  Axe, BrickWall, Bridge, Check, ChevronDown, Coins, Compass, Gem, HandCoins, HardHat,
  House, HousePlus, Layers, LayoutGrid, Menu, Minus, PackageOpen, Pickaxe, Plus,
  RotateCcw, RotateCw, Route, ScrollText, Settings2, Shovel, Sprout, Star, Trash2,
  TreePine, Users, Wallet, Wheat, Wifi, WifiOff, X,
} from 'lucide-react';

const icons = {
  explore: Compass, clear: Axe, terraform: Shovel, till: Pickaxe, road: Route, embank: BrickWall,
  bridge: Bridge, build: HousePlus, plant: Sprout, harvest: Wheat, demolish: Trash2, zone: LayoutGrid,
  wood: TreePine, stone: Gem, cash: Coins, builders: HardHat, people: Users, inventory: PackageOpen,
  profile: Wallet, settings: Settings2, quests: ScrollText, maps: Route, menu: Menu, down: ChevronDown,
  city: House, farm: Sprout, level: Star, collect: HandCoins, online: Wifi, offline: WifiOff,
  confirm: Check, close: X, zoomIn: Plus, zoomOut: Minus, reset: RotateCcw, rotate: RotateCw, terrain: Layers,
};
export type GameIconName = keyof typeof icons;

export function GameIcon({ name, className = '' }: { name: GameIconName; className?: string }) {
  const Icon = icons[name];
  return <Icon className={`game-icon ${className}`} size={20} strokeWidth={1.8} aria-hidden="true" focusable="false"/>;
}
