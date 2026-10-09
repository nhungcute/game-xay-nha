import type { MapKind } from './grid.js';

export interface Cost { cash: number; wood: number; stone: number }

export interface BuildingDef {
  id: string;
  mapKinds: MapKind[];
  nameKey: string;
  size: [number, number];
  entranceSide: 'N' | 'E' | 'S' | 'W';
  cost: Cost;
  unlockLevel: number;
  buildSeconds: number;
  buildXp?: number;
  maxCount?: number;
  limit?: [number, number, number];
  costScaling?: number[];
  unlockLevels?: number[];
  population?: number;
  jobs?: number;
  baseRatePerHour?: number;
  decor?: { bonus: number; radius: number };
  waterBonusOverride?: number;
  bankCapHours?: number;
  production?: { slots: number; queueLimit: number; recipes: string[] };
  storageBonus?: number;
  fieldQuota?: number;
  irrigationRadius?: number;
  modelId: string;
}

export interface CropDef {
  id: string; nameKey: string; unlockLevel: number;
  seedCost: number; growSeconds: number; yield: number; itemId: string; xp: number;
  stageModels: [string, string, string];
}

export interface RecipeDef {
  id: string; inputs: Record<string, number>; output: string; seconds: number; xp: number;
}

export interface ItemDef { id: string; nameKey: string; sellPrice: number; iconId: string }

export interface BridgeDef {
  id: string; maxSpan: number; costPerCell: Cost; unlockLevel: number;
  mapKinds: MapKind[]; buildSecondsPerCell: number;
}

export interface QuestDef {
  id: string; nameKey: string; kind: string; action: string; target: number;
  buildingId?: string; cropId?: string; requiresRoad?: boolean; farBank?: boolean;
  reward: Cost; xp: number; tutorial: boolean;
}

export interface ContentCatalog {
  contentVersion: number;
  buildings: Record<string, BuildingDef>;
  crops: Record<string, CropDef>;
  recipes: Record<string, RecipeDef>;
  items: Record<string, ItemDef>;
  bridges: Record<string, BridgeDef>;
  quests: Record<MapKind, QuestDef[]>;
}
