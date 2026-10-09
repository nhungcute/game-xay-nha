import economyData from '../economy.v1.json';
import catalogData from '../catalog.v1.json';
import viData from '../i18n/vi.json';
import { CatalogSchema } from './schema.js';

export const contentVersion = economyData.contentVersion;
export const economy = economyData;
export const catalog = CatalogSchema.parse(catalogData);
export const quests = catalog.quests;
export const vi: Readonly<Record<string, string>> = viData;
export type EconomySettings = typeof economy;
export { CatalogSchema } from './schema.js';
export type { ContentCatalog, BuildingDef, CropDef, RecipeDef, ItemDef, BridgeDef, QuestDef, Cost } from '@xay-nha/contracts';
